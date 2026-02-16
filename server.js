const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const admin = require('firebase-admin');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
// 1. Update CORS to accept connections from your Vercel frontend
const allowedOrigin = process.env.FRONTEND_URL || "*";

// FIX: Added manual CORS Headers for Express. 
// This stops the browser from blocking the HTTP image upload from Vercel to Render.
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    next();
});

const io = new Server(server, { cors: { origin: allowedOrigin, methods: ["GET", "POST"] }});

const PORT = process.env.PORT || 3000;
const uploadDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '_'))
});
const upload = multer({ storage: storage });

// 2. ONLY serve the uploads folder (Vercel handles the public HTML now)
app.use('/uploads', express.static(uploadDir));

// 3. Render Health Check Route
app.get('/', (req, res) => {
  res.status(200).send('Auction Socket Server is running smoothly!');
});

// 4. Secure Firebase Initialization
try {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY 
        ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') 
        : undefined,
    }),
  });
} catch (error) {
  console.error("Firebase initialization error:", error);
}
const db = admin.firestore();
const DOC_REF = db.collection('auction_data').doc('current_state');

// Initialized with empty structures to prevent undefined errors
let STATE = { teams: [], categories: [], playersSnapshot: {}, activeBids: {}, soldPrices: {}, managers: {}, currentActivePlayer: null, config: { impactAmount: 0 }};

async function saveToFirebase() { 
    try { await DOC_REF.set(STATE); } catch (e) { console.error("Firebase Save Error:", e); }
}

async function loadFromFirebase() { 
    try { 
        const doc = await DOC_REF.get(); 
        if (doc.exists) { 
            STATE = doc.data(); 
            // Bulletproof: Ensure nested objects always exist upon load
            if (!STATE.config) STATE.config = { impactAmount: 0 }; 
            if (!STATE.teams) STATE.teams = [];
            if (!STATE.categories) STATE.categories = [];
            if (!STATE.activeBids) STATE.activeBids = {};
            if (!STATE.soldPrices) STATE.soldPrices = {};
            if (!STATE.playersSnapshot) STATE.playersSnapshot = {};
        } else { 
            await saveToFirebase(); 
        } 
    } catch (e) { 
        console.log("Firebase Load Error:", e); 
    } 
}

app.post('/upload', upload.any(), (req, res) => { 
    if (!req.files || req.files.length === 0) return res.status(400).send('No file.'); 
    res.json({ url: `/uploads/${req.files[0].filename}` }); 
});

io.on('connection', (socket) => {
    if (STATE.currentActivePlayer) socket.emit('popup:open', STATE.currentActivePlayer);

    socket.on('manager:login', ({ username, password }) => {
        if (STATE.managers && STATE.managers[username] === password) socket.emit('manager:logged_in', { username, state: STATE });
        else socket.emit('auth:portal_error', 'Invalid Creds');
    });

    socket.on('manager:register', ({ username, password }) => {
        if (!STATE.managers) STATE.managers = {};
        if (STATE.managers[username]) return socket.emit('auth:portal_error', 'Taken');
        if (!username || !password) return socket.emit('auth:portal_error', 'Missing Data'); // Bulletproof check
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
        if (role === 'team' && (!team || team.password !== password)) return socket.emit('auth:team_error', 'Bad Pass');
        socket.emit('auction:enter', { role, teamId, state: STATE });
    });

    socket.on('team:activateImpact', ({ teamId, category, playerName }) => {
        const team = STATE.teams.find(t => t.id === teamId);
        const bonus = Number(STATE.config.impactAmount) || 0;
        if (team && !team.impactUsed && !team.impactActive && bonus > 0) {
            team.purse = Number(team.purse) + bonus;
            team.impactActive = true;
            team.impactUsed = true; 
            team.impactTarget = `${category}:${playerName}`; 
            io.emit('admin:toast', { msg: `⚡ IMPACT: ${team.name} on ${playerName}`, type: 'impact' });
            io.emit('state:updated', STATE);
            saveToFirebase();
        }
    });

    socket.on('admin:resetImpact', ({ teamId }) => {
        const team = STATE.teams.find(t => t.id === teamId);
        const bonus = Number(STATE.config.impactAmount) || 0;
        if (team) {
            if (team.impactActive) team.purse = Math.max(0, Number(team.purse) - bonus); // Bulletproof: Prevent negative purse
            team.impactUsed = false;
            team.impactActive = false;
            team.impactTarget = null;
            io.emit('admin:toast', { msg: `↩️ Impact Reset for ${team.name}`, type: 'normal' });
            io.emit('state:updated', STATE);
            saveToFirebase();
        }
    });

    socket.on('admin:resetTeam', ({ teamId }) => {
        const team = STATE.teams.find(t => t.id === teamId);
        if (team) {
            team.purse = 500; // Assuming 500 is default base, could be dynamic
            team.purchases = {};
            team.impactUsed = false;
            team.impactActive = false;
            team.impactTarget = null;
            io.emit('admin:toast', { msg: `Team ${team.name} Reset`, type: 'normal' });
            io.emit('state:updated', STATE);
            saveToFirebase();
        }
    });

    socket.on('admin:select_player', (playerData) => { 
        STATE.currentActivePlayer = playerData; 
        io.emit('popup:open', playerData); 
        saveToFirebase(); 
    });

    socket.on('admin:close_popup', () => { 
        STATE.currentActivePlayer = null; 
        io.emit('popup:close'); 
        saveToFirebase(); 
    });

    socket.on('admin:update_player_image', ({ category, name, imageUrl }) => {
        if (STATE.playersSnapshot[category]) { 
            const p = STATE.playersSnapshot[category].find(x => x.name === name); 
            if (p) p.image = imageUrl; 
        }
        if (STATE.currentActivePlayer && STATE.currentActivePlayer.name === name) STATE.currentActivePlayer.image = imageUrl;
        io.emit('state:updated', STATE);
        io.emit('popup:update_image', { imageUrl });
        saveToFirebase();
    });

    socket.on('player:bid', (data) => {
        const validPrice = Number(data.price);
        if (isNaN(validPrice) || validPrice < 0) return; // Bulletproof: Ignore invalid prices

        const key = `${data.category}:${data.name}`;
        if (!STATE.activeBids) STATE.activeBids = {};
        STATE.activeBids[key] = validPrice;
        
        if (STATE.currentActivePlayer && STATE.currentActivePlayer.name === data.name) {
            STATE.currentActivePlayer.currentPrice = validPrice;
        }
        io.emit('player:bid', { ...data, price: validPrice });
        saveToFirebase();
    });

    socket.on('bid:request', (data) => io.emit('admin:toast', { msg: `✋ Bid Req: ${data.teamName} for ${data.playerName}` }));

    socket.on('player:sold', (data) => {
        const team = STATE.teams.find(t => t.id === data.teamId);
        const validPrice = Number(data.price) || 0;

        if (team) {
            // Bulletproof: Server-side validation for sufficient funds
            if (Number(team.purse) < validPrice) {
                socket.emit('admin:toast', { msg: `❌ Sale Failed: ${team.name} has insufficient funds!` });
                return;
            }

            team.purse = Number(team.purse) - validPrice;
            team.purchases = team.purchases || {};
            team.purchases[data.category] = data.name;
            if (!STATE.soldPrices) STATE.soldPrices = {};
            STATE.soldPrices[`${data.category}:${data.name}`] = validPrice;
            
            const bonus = Number(STATE.config.impactAmount) || 0;
            const soldKey = `${data.category}:${data.name}`;
            
            STATE.teams.forEach(t => {
                if (t.impactActive) {
                    if(t.impactTarget === soldKey) {
                        if(t.id === data.teamId) { 
                            t.impactActive = false; 
                        } else { 
                            t.purse = Math.max(0, Number(t.purse) - bonus); 
                            t.impactActive = false; 
                        }
                    }
                }
            });
            
            STATE.currentActivePlayer = null;
            io.emit('popup:close');
            io.emit('player:sold', { payload: { ...data, price: validPrice }, teams: STATE.teams });
            saveToFirebase();
        }
    });

    socket.on('admin:updateConfig', (newConfig) => {
        if (newConfig.impactAmount !== undefined) { 
            if (!STATE.config) STATE.config = {}; 
            STATE.config.impactAmount = Number(newConfig.impactAmount) || 0; 
        }
        // Bulletproof: Ensure teams is an array before processing
        if (newConfig.teams && Array.isArray(newConfig.teams)) {
            STATE.teams = newConfig.teams.map(nt => {
                const ot = (STATE.teams || []).find(t => t.id === nt.id); // Safe fallback added here
                return { 
                    ...nt, 
                    logo: nt.logo || (ot ? ot.logo : null), 
                    purchases: ot && ot.purchases ? ot.purchases : {}, 
                    impactUsed: ot ? ot.impactUsed : false, 
                    impactActive: ot ? ot.impactActive : false, 
                    impactTarget: ot ? ot.impactTarget : null 
                };
            });
        }
        if (newConfig.categories && Array.isArray(newConfig.categories)) STATE.categories = newConfig.categories;
        io.emit('state:updated', STATE);
        saveToFirebase();
    });

    socket.on('admin:setTeamLogo', ({ teamId, logoUrl }) => { 
        const team = (STATE.teams || []).find(t => t.id === teamId); // Safe fallback added here
        if (team) { 
            team.logo = logoUrl; 
            io.emit('state:updated', STATE); 
            saveToFirebase(); 
        } 
    });

    socket.on('admin:resetPlayer', ({ category, name }) => {
        STATE.teams.forEach(t => { 
            if (t.purchases && t.purchases[category] === name) { 
                const price = STATE.soldPrices[`${category}:${name}`] || 0; 
                t.purse = Number(t.purse) + Number(price); 
                delete t.purchases[category]; 
            } 
        });
        const k = `${category}:${name}`;
        if (STATE.soldPrices) delete STATE.soldPrices[k];
        if (STATE.activeBids) delete STATE.activeBids[k];
        io.emit('state:updated', STATE);
        io.emit('admin:toast', { msg: `Player ${name} Reset` }); 
        saveToFirebase();
    });

    socket.on('admin:resetAll', () => { 
        STATE.activeBids = {}; 
        STATE.soldPrices = {}; 
        STATE.teams.forEach(t => { 
            t.purse = 500; // Reset to default base
            t.purchases = {}; 
            t.impactUsed = false; 
            t.impactActive = false; 
            t.impactTarget = null; 
        }); 
        io.emit('state:updated', STATE); 
        io.emit('admin:toast', { msg: `System Full Reset` }); 
        saveToFirebase(); 
    });

    socket.on('players:save', ({ category, players }) => {
        if (!STATE.playersSnapshot) STATE.playersSnapshot = {};
        const existing = STATE.playersSnapshot[category] || [];
        // Bulletproof: Ensure mapped data holds correct types
        const merged = players.map(np => { 
            const op = existing.find(e => e.name === np.name); 
            return { name: np.name, price: Number(np.price) || 0, image: op ? op.image : null }; 
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
    server.listen(PORT, () => console.log(`Running on ${PORT}`)); 
});
