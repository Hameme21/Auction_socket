const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const admin = require('firebase-admin');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3000;

// --- FILE UPLOAD CONFIGURATION ---
const uploadDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        // Clean filename to prevent issues
        const safeName = file.originalname.replace(/\s+/g, '_');
        cb(null, Date.now() + '-' + safeName);
    }
});

const upload = multer({ storage: storage });

app.use(express.static('public'));
app.use('/uploads', express.static(uploadDir));

// --- FIREBASE SETUP ---
let serviceAccount;
try {
    if (process.env.FIREBASE_JSON) {
        serviceAccount = JSON.parse(process.env.FIREBASE_JSON);
    } else {
        serviceAccount = require('./firebase-service-account.json');
    }
} catch (e) {
    console.error("CRITICAL ERROR: No Firebase Key found.");
    process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
const DOC_REF = db.collection('auction_data').doc('current_state');

// --- STATE ---
let STATE = {
    teams: [],
    categories: [],
    playersSnapshot: {},
    activeBids: {},
    soldPrices: {},
    managers: {},
    currentActivePlayer: null,
    config: { impactAmount: 0 }
};

// --- DATABASE FUNCTIONS ---
async function saveToFirebase() {
    try { await DOC_REF.set(STATE); } catch (e) { console.error("Save Error:", e.message); }
}

async function loadFromFirebase() {
    try {
        const doc = await DOC_REF.get();
        if (doc.exists) {
            STATE = doc.data();
            // Ensure config exists
            if (!STATE.config) STATE.config = { impactAmount: 0 };
        } else {
            await saveToFirebase();
        }
    } catch (e) { console.log("Load Error:", e.message); }
}

// --- UPLOAD ROUTE ---
app.post('/upload', upload.any(), (req, res) => {
    if (!req.files || req.files.length === 0) return res.status(400).send('No file uploaded.');
    res.json({ url: `/uploads/${req.files[0].filename}` });
});

// --- SOCKET LOGIC ---
io.on('connection', (socket) => {
    
    // Sync Popup for new connections
    if (STATE.currentActivePlayer) {
        socket.emit('popup:open', STATE.currentActivePlayer);
    }

    // 1. AUTHENTICATION
    socket.on('manager:login', ({ username, password }) => {
        if (STATE.managers && STATE.managers[username] === password) {
            socket.emit('manager:logged_in', { username, state: STATE });
        } else {
            socket.emit('auth:portal_error', 'Invalid Creds');
        }
    });

    socket.on('manager:register', ({ username, password }) => {
        if (!STATE.managers) STATE.managers = {};
        if (STATE.managers[username]) return socket.emit('auth:portal_error', 'Taken');
        STATE.managers[username] = password;
        saveToFirebase();
        socket.emit('auth:portal_success', { msg: 'Created' });
    });

    socket.on('participant:connect', (hostId) => {
        if (!STATE.managers || !STATE.managers[hostId]) return socket.emit('auth:portal_error', 'Host Not Found');
        socket.emit('init:teams_available', { hostId, teams: STATE.teams || [] });
    });

    socket.on('team:login', ({ teamId, password, role }) => {
        const team = STATE.teams.find(t => t.id === teamId);
        if (role === 'team' && (!team || team.password !== password)) return socket.emit('auth:team_error', 'Bad Password');
        socket.emit('auction:enter', { role, teamId, state: STATE });
    });

    // 2. IMPACT PURSE LOGIC (CRITICAL)
    socket.on('team:activateImpact', ({ teamId }) => {
        const team = STATE.teams.find(t => t.id === teamId);
        const bonus = Number(STATE.config.impactAmount) || 0;
        
        // Only allow if not used yet and not currently active
        if (team && !team.impactUsed && !team.impactActive && bonus > 0) {
            team.purse = Number(team.purse) + bonus;
            team.impactActive = true; // Mark active for this round
            
            io.emit('admin:toast', { msg: `⚡ IMPACT: ${team.name} activated +${bonus}!`, type: 'impact' });
            io.emit('state:updated', STATE);
            saveToFirebase();
        }
    });

    socket.on('admin:resetImpact', ({ teamId }) => {
        const team = STATE.teams.find(t => t.id === teamId);
        const bonus = Number(STATE.config.impactAmount) || 0;
        
        // Manual admin override to reset impact (takes money back)
        if (team && (team.impactUsed || team.impactActive)) {
            team.purse = Number(team.purse) - bonus;
            team.impactUsed = false;
            team.impactActive = false;
            io.emit('admin:toast', { msg: `↩️ Reset Impact for ${team.name}`, type: 'normal' });
            io.emit('state:updated', STATE);
            saveToFirebase();
        }
    });

    // 3. POPUP & IMAGES
    socket.on('admin:select_player', (playerData) => {
        STATE.currentActivePlayer = playerData;
        io.emit('popup:open', playerData); // SYNC POPUP
        saveToFirebase();
    });

    socket.on('admin:close_popup', () => {
        STATE.currentActivePlayer = null;
        io.emit('popup:close'); // CLOSE FOR EVERYONE
        saveToFirebase();
    });

    socket.on('admin:update_player_image', ({ category, name, imageUrl }) => {
        // Update in list
        if (STATE.playersSnapshot[category]) {
            const p = STATE.playersSnapshot[category].find(x => x.name === name);
            if (p) p.image = imageUrl;
        }
        // Update in active popup
        if (STATE.currentActivePlayer && STATE.currentActivePlayer.name === name) {
            STATE.currentActivePlayer.image = imageUrl;
        }
        io.emit('state:updated', STATE);
        io.emit('popup:update_image', { imageUrl });
        saveToFirebase();
    });

    // 4. BIDDING & SALES
    socket.on('player:bid', (data) => {
        const key = `${data.category}:${data.name}`;
        if (!STATE.activeBids) STATE.activeBids = {};
        STATE.activeBids[key] = data.price;
        
        // Update price in live popup
        if (STATE.currentActivePlayer && STATE.currentActivePlayer.name === data.name) {
            STATE.currentActivePlayer.currentPrice = data.price;
        }
        io.emit('player:bid', data);
        saveToFirebase();
    });

    socket.on('player:sold', (data) => {
        const team = STATE.teams.find(t => t.id === data.teamId);
        if (team) {
            // A. Deduct Money
            team.purse = Number(team.purse) - Number(data.price);
            team.purchases = team.purchases || {};
            team.purchases[data.category] = data.name;

            if (!STATE.soldPrices) STATE.soldPrices = {};
            STATE.soldPrices[`${data.category}:${data.name}`] = data.price;

            // B. Handle Impact Purse (The "One Player" Rule)
            const bonus = Number(STATE.config.impactAmount) || 0;
            STATE.teams.forEach(t => {
                if (t.impactActive) {
                    // If this team activated impact BUT did not win the player
                    if (t.id !== data.teamId) {
                        t.purse = Number(t.purse) - bonus; // TAKE BACK MONEY
                    }
                    // For both winner and loser, the card is now burned
                    t.impactUsed = true;
                    t.impactActive = false; 
                }
            });

            // C. Clear Popup
            STATE.currentActivePlayer = null;
            io.emit('popup:close');
            io.emit('player:sold', { payload: data, teams: STATE.teams });
            saveToFirebase();
        }
    });

    // 5. CONFIG & RESET
    socket.on('admin:updateConfig', (newConfig) => {
        if (newConfig.impactAmount !== undefined) {
            if (!STATE.config) STATE.config = {};
            STATE.config.impactAmount = Number(newConfig.impactAmount);
        }
        if (newConfig.teams) {
            STATE.teams = newConfig.teams.map(nt => {
                const ot = STATE.teams.find(t => t.id === nt.id);
                return {
                    ...nt,
                    logo: nt.logo || (ot ? ot.logo : null),
                    purchases: ot ? ot.purchases : {},
                    impactUsed: ot ? ot.impactUsed : false,
                    impactActive: ot ? ot.impactActive : false
                };
            });
        }
        if (newConfig.categories) STATE.categories = newConfig.categories;
        io.emit('state:updated', STATE);
        saveToFirebase();
    });

    socket.on('admin:setTeamLogo', ({ teamId, logoUrl }) => {
        const team = STATE.teams.find(t => t.id === teamId);
        if (team) {
            team.logo = logoUrl;
            io.emit('state:updated', STATE);
            saveToFirebase();
        }
    });

    // FIX: RESET PLAYER MATH BUG
    socket.on('admin:resetPlayer', ({ category, name }) => {
        STATE.teams.forEach(t => {
            if (t.purchases && t.purchases[category] === name) {
                const price = STATE.soldPrices[`${category}:${name}`] || 0;
                // Force Number type to prevent string concatenation
                t.purse = Number(t.purse) + Number(price);
                delete t.purchases[category];
            }
        });
        const k = `${category}:${name}`;
        if (STATE.soldPrices) delete STATE.soldPrices[k];
        if (STATE.activeBids) delete STATE.activeBids[k];
        io.emit('state:updated', STATE);
        saveToFirebase();
    });

    socket.on('admin:resetAll', () => {
        STATE.activeBids = {};
        STATE.soldPrices = {};
        STATE.teams.forEach(t => {
            t.purse = 500;
            t.purchases = {};
            t.impactUsed = false;
            t.impactActive = false;
        });
        io.emit('state:updated', STATE);
        saveToFirebase();
    });

    // 6. PLAYER DATA
    socket.on('players:save', ({ category, players }) => {
        if (!STATE.playersSnapshot) STATE.playersSnapshot = {};
        const existing = STATE.playersSnapshot[category] || [];
        const merged = players.map(np => {
            const op = existing.find(e => e.name === np.name);
            return { name: np.name, price: np.price, image: op ? op.image : null };
        });
        STATE.playersSnapshot[category] = merged;
        io.emit('state:updated', STATE);
        saveToFirebase();
    });

    socket.on('players:clear', ({ category }) => {
        if (STATE.playersSnapshot[category]) {
            delete STATE.playersSnapshot[category];
            io.emit('state:updated', STATE);
            saveToFirebase();
        }
    });

    socket.on('admin:deleteCategory', ({ id }) => {
        STATE.categories = STATE.categories.filter(c => c.id !== id);
        io.emit('state:updated', STATE);
        saveToFirebase();
    });
});

loadFromFirebase().then(() => {
    server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
});
