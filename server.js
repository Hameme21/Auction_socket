const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const admin = require('firebase-admin');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] }});
const PORT = process.env.PORT || 3000;

// Setup Uploads
const uploadDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '_'))
});
const upload = multer({ storage: storage });

app.use(express.static('public'));
app.use('/uploads', express.static(uploadDir));

// Firebase Setup
let serviceAccount;
try {
    serviceAccount = process.env.FIREBASE_JSON ? JSON.parse(process.env.FIREBASE_JSON) : require('./firebase-service-account.json');
} catch (e) {
    console.error("No Firebase Key found. Please add firebase-service-account.json");
    process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
const DOC_REF = db.collection('auction_data').doc('current_state');

// Initial State
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

// --- Helper Functions ---
async function saveToFirebase() { 
    try { await DOC_REF.set(STATE); } catch (e) { console.error("Firebase Error:", e); }
}

async function loadFromFirebase() {
    try {
        const doc = await DOC_REF.get();
        if (doc.exists) { 
            STATE = doc.data(); 
            // Ensure structure exists
            if (!STATE.config) STATE.config = { impactAmount: 0 };
            if (!STATE.playersSnapshot) STATE.playersSnapshot = {};
        } else { 
            await saveToFirebase(); 
        }
    } catch (e) { console.log(e); }
}

// --- Routes ---
app.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).send('No file.');
    // Return full path for client usage
    res.json({ url: `/uploads/${req.file.filename}` });
});

// --- Socket Logic ---
io.on('connection', (socket) => {
    // Send initial active player if exists (for reloads)
    if (STATE.currentActivePlayer) socket.emit('popup:open', STATE.currentActivePlayer);

    // Auth
    socket.on('manager:login', ({ username, password }) => {
        if (STATE.managers && STATE.managers[username] === password) socket.emit('manager:logged_in', { username, state: STATE });
        else socket.emit('auth:portal_error', 'Invalid Credentials');
    });

    socket.on('manager:register', ({ username, password }) => {
        if (!STATE.managers) STATE.managers = {};
        if (STATE.managers[username]) return socket.emit('auth:portal_error', 'Username Taken');
        STATE.managers[username] = password;
        saveToFirebase();
        socket.emit('auth:portal_success', { msg: 'Account Created. Please Login.' });
    });

    socket.on('participant:connect', (hostId) => {
        if (!STATE.managers || !STATE.managers[hostId]) return socket.emit('auth:portal_error', 'Host Not Found');
        socket.emit('init:teams_available', { hostId, teams: STATE.teams || [] });
    });

    socket.on('team:login', ({ teamId, password, role }) => {
        const team = STATE.teams.find(t => t.id === teamId);
        if (role === 'team') {
            if (!team) return socket.emit('auth:team_error', 'Team not found');
            if (team.password !== password) return socket.emit('auth:team_error', 'Incorrect Password');
        }
        socket.emit('auction:enter', { role, teamId, state: STATE });
    });

    // --- Active Player Popup Logic ---
    socket.on('admin:setActivePlayer', ({ category, name, price, image }) => {
        STATE.currentActivePlayer = { category, name, price, image, currentPrice: price };
        io.emit('popup:open', STATE.currentActivePlayer);
        saveToFirebase();
    });

    socket.on('admin:updateActivePlayerImage', ({ category, name, imageUrl }) => {
        // Update in snapshot
        if (STATE.playersSnapshot[category]) {
            const p = STATE.playersSnapshot[category].find(x => x.name === name);
            if (p) p.image = imageUrl;
        }
        // Update active state
        if (STATE.currentActivePlayer && STATE.currentActivePlayer.name === name) {
            STATE.currentActivePlayer.image = imageUrl;
            io.emit('popup:update', STATE.currentActivePlayer);
        }
        io.emit('state:updated', STATE);
        saveToFirebase();
    });

    socket.on('admin:closePopup', () => {
        STATE.currentActivePlayer = null;
        io.emit('popup:close');
        saveToFirebase();
    });

    // --- Bidding Logic ---
    socket.on('player:bid', (data) => {
        const key = `${data.category}:${data.name}`;
        if (!STATE.activeBids) STATE.activeBids = {};
        STATE.activeBids[key] = data.price;
        
        // Update active player state for popup sync
        if (STATE.currentActivePlayer && STATE.currentActivePlayer.name === data.name) {
            STATE.currentActivePlayer.currentPrice = data.price;
            io.emit('popup:update', STATE.currentActivePlayer);
        }

        io.emit('player:bid', data);
        saveToFirebase();
    });

    socket.on('bid:request', (data) => {
        io.emit('admin:toast', { msg: `✋ Bid Request: ${data.teamName} for ${data.playerName}` });
    });

    socket.on('player:sold', (data) => {
        const team = STATE.teams.find(t => t.id === data.teamId);
        if (team) {
            team.purse = Number(team.purse) - Number(data.price);
            team.purchases = team.purchases || {};
            team.purchases[data.category] = data.name;
            if (!STATE.soldPrices) STATE.soldPrices = {};
            STATE.soldPrices[`${data.category}:${data.name}`] = data.price;

            // Impact Logic
            const bonus = Number(STATE.config.impactAmount) || 0;
            const soldKey = `${data.category}:${data.name}`;
            
            STATE.teams.forEach(t => {
                if (t.impactActive) {
                    // Winner keeps bonus, Losers lose bonus immediately from purse
                    if(t.impactTarget === soldKey) {
                        if(t.id !== data.teamId) {
                            t.purse = Number(t.purse) - bonus; // Deduction for losing
                        }
                        t.impactActive = false;
                        t.impactTarget = null;
                    }
                }
            });

            STATE.currentActivePlayer = null;
            io.emit('popup:close');
            io.emit('player:sold', { payload: data, teams: STATE.teams });
            saveToFirebase();
        }
    });

    // --- Admin Configuration & Resets ---
    socket.on('admin:updateConfig', (newConfig) => {
        let msg = "";
        if (newConfig.impactAmount !== undefined) {
            if (!STATE.config) STATE.config = {};
            STATE.config.impactAmount = Number(newConfig.impactAmount);
            msg = "Impact Amount Saved";
        }
        if (newConfig.categories) {
            STATE.categories = newConfig.categories;
        }
        if (newConfig.teams) {
            STATE.teams = newConfig.teams.map(nt => {
                const ot = STATE.teams.find(t => t.id === nt.id);
                return {
                    ...nt,
                    logo: nt.logo || (ot ? ot.logo : null),
                    purchases: ot ? ot.purchases : {},
                    impactUsed: ot ? ot.impactUsed : false,
                    impactActive: ot ? ot.impactActive : false,
                    impactTarget: ot ? ot.impactTarget : null
                };
            });
            msg = "Teams Configuration Saved";
        }
        
        io.emit('state:updated', STATE);
        if(msg) socket.emit('admin:toast', { msg });
        saveToFirebase();
    });

    socket.on('admin:resetTeam', ({ teamId }) => {
        const t = STATE.teams.find(x => x.id === teamId);
        if(t) {
            // Reset purse to 500 (or default) and clear purchases
            t.purse = 500; 
            t.purchases = {};
            t.impactUsed = false;
            t.impactActive = false;
            io.emit('state:updated', STATE);
            socket.emit('admin:toast', { msg: `Team ${t.name} Reset!` });
            saveToFirebase();
        }
    });

    socket.on('admin:resetImpact', ({ teamId }) => {
        const team = STATE.teams.find(t => t.id === teamId);
        const bonus = Number(STATE.config.impactAmount) || 0;
        if (team) {
            if (team.impactActive) {
                // If currently active, remove the bonus money before resetting
                team.purse = Number(team.purse) - bonus;
            }
            team.impactUsed = false;
            team.impactActive = false;
            team.impactTarget = null;
            io.emit('state:updated', STATE);
            socket.emit('admin:toast', { msg: `Impact Reset for ${team.name}` });
            saveToFirebase();
        }
    });

    socket.on('admin:resetAll', () => {
        STATE.activeBids = {};
        STATE.soldPrices = {};
        STATE.teams.forEach(t => {
            t.purse = 500; // Default Purse
            t.purchases = {};
            t.impactUsed = false;
            t.impactActive = false;
            t.impactTarget = null;
        });
        io.emit('state:updated', STATE);
        io.emit('admin:toast', { msg: 'SYSTEM RESET COMPLETE' });
        saveToFirebase();
    });

    socket.on('players:save', ({ category, players }) => {
        if (!STATE.playersSnapshot) STATE.playersSnapshot = {};
        const existing = STATE.playersSnapshot[category] || [];
        const merged = players.map(np => {
            const op = existing.find(e => e.name === np.name);
            return { name: np.name, price: np.price, image: op ? op.image : null };
        });
        STATE.playersSnapshot[category] = merged;
        io.emit('state:updated', STATE);
        socket.emit('admin:toast', { msg: 'Player List Saved' });
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
    server.listen(PORT, () => console.log(`Server running on port ${PORT}`)); 
});
