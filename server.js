const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const admin = require('firebase-admin'); 
const path = require('path');
const multer = require('multer'); 

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3000;

// --- SECURE FIREBASE CONNECTION ---
let serviceAccount;
try {
    if (process.env.FIREBASE_JSON) {
        serviceAccount = JSON.parse(process.env.FIREBASE_JSON);
    } else {
        serviceAccount = require('./firebase-service-account.json');
    }
} catch (e) {
    console.error("CRITICAL ERROR: Could not load Firebase Key.");
    process.exit(1);
}

// ⚠️ REPLACE WITH YOUR BUCKET URL IF NOT SET IN ENV
const STORAGE_BUCKET = process.env.STORAGE_BUCKET || "your-project-id.appspot.com";

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: STORAGE_BUCKET 
});

const db = admin.firestore();
const bucket = admin.storage().bucket(); 
const DOC_REF = db.collection('auction_data').doc('current_state');

// --- FILE UPLOAD CONFIG (MEMORY STORAGE) ---
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB Limit
});

// --- INITIAL STATE ---
let STATE = {
    teams: [],
    categories: [],
    playersSnapshot: {}, 
    activeBids: {},
    soldPrices: {},
    managers: {} 
};

// --- FIREBASE SYNC FUNCTIONS ---
async function saveToFirebase() {
    try { await DOC_REF.set(STATE); } catch (err) { console.error('❌ Save Error:', err.message); }
}

async function loadFromFirebase() {
    try {
        const doc = await DOC_REF.get();
        if (doc.exists) {
            STATE = doc.data();
            console.log('✅ Loaded State from Firebase');
        } else {
            await saveToFirebase();
        }
    } catch (e) { console.log('⚠️ Error loading from Firebase:', e.message); }
}

// --- UPLOAD ENDPOINT (Handles Players AND Team Logos) ---
app.post('/upload', upload.single('playerImage'), (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded.');

    const filename = `uploads/${Date.now()}-${req.file.originalname}`;
    const file = bucket.file(filename);

    const blobStream = file.createWriteStream({
        metadata: { contentType: req.file.mimetype }
    });

    blobStream.on('error', (err) => {
        console.error(err);
        res.status(500).send({ error: 'Upload failed' });
    });

    blobStream.on('finish', async () => {
        try {
            await file.makePublic();
            const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filename}`;
            res.json({ url: publicUrl });
        } catch (error) {
            console.error("Error making file public:", error);
            res.status(500).send({ error: 'Could not make file public' });
        }
    });

    blobStream.end(req.file.buffer);
});

// --- REAL-TIME LOGIC ---
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    // 1. Auth
    socket.on('manager:login', ({ username, password }) => {
        if (STATE.managers && STATE.managers[username] === password) {
            socket.emit('manager:logged_in', { username, state: STATE });
        } else {
            socket.emit('auth:portal_error', 'Invalid Host ID or Password');
        }
    });

    socket.on('manager:register', ({ username, password }) => {
        if (!STATE.managers) STATE.managers = {};
        if (STATE.managers[username]) return socket.emit('auth:portal_error', 'Username taken');
        STATE.managers[username] = password;
        saveToFirebase(); 
        socket.emit('auth:portal_success', { msg: 'Account Created! Please Login.' });
    });

    socket.on('participant:connect', (hostId) => {
        if (!STATE.managers || !STATE.managers[hostId]) return socket.emit('auth:portal_error', 'Host ID not found');
        socket.emit('init:teams_available', { hostId, teams: STATE.teams || [] });
    });

    socket.on('team:login', ({ teamId, password, role }) => {
        const team = STATE.teams.find(t => t.id === teamId);
        if (role === 'team' && (!team || team.password !== password)) return socket.emit('auth:team_error', 'Invalid Team Password');
        socket.emit('auction:enter', { role, teamId, state: STATE });
    });

    // 2. Bidding
    socket.on('player:bid', (data) => {
        const key = `${data.category}:${data.name}`;
        if (!STATE.activeBids) STATE.activeBids = {};
        STATE.activeBids[key] = data.price;
        io.emit('player:bid', data);
        saveToFirebase();
    });

    socket.on('bid:request', ({ category, playerName, teamName }) => {
        io.emit('admin:toast', { msg: `✋ Bid Request: ${teamName} for ${playerName}`, type: 'normal' });
    });

    socket.on('player:sold', (data) => {
        const team = STATE.teams.find(t => t.id === data.teamId);
        if (team) {
            team.purse -= data.price;
            team.purchases = team.purchases || {};
            team.purchases[data.category] = data.name;
            if (!STATE.soldPrices) STATE.soldPrices = {};
            STATE.soldPrices[`${data.category}:${data.name}`] = data.price;
            io.emit('player:sold', { payload: data, teams: STATE.teams });
            saveToFirebase();
        }
    });

    // 3. Popups
    socket.on('admin:reveal_player', (playerData) => {
        io.emit('popup:reveal', playerData);
    });

    // 4. Admin Config
    socket.on('admin:updateConfig', (newConfig) => {
        if(newConfig.teams) STATE.teams = newConfig.teams;
        if(newConfig.categories) STATE.categories = newConfig.categories;
        io.emit('state:updated', STATE);
        saveToFirebase();
    });

    // NEW: Update Team Logo
    socket.on('admin:updateTeamLogo', ({ teamId, logoUrl }) => {
        const team = STATE.teams.find(t => t.id === teamId);
        if (team) {
            team.logo = logoUrl;
            io.emit('state:updated', STATE);
            saveToFirebase();
        }
    });

    // Update Player List & Images
    socket.on('players:save', ({ category, players }) => {
        if (!STATE.playersSnapshot) STATE.playersSnapshot = {};
        const existing = STATE.playersSnapshot[category] || [];
        const mergedPlayers = players.map(newP => {
            const oldP = existing.find(e => e.name === newP.name);
            return {
                name: newP.name,
                price: newP.price,
                image: oldP ? oldP.image : null
            };
        });
        STATE.playersSnapshot[category] = mergedPlayers;
        io.emit('state:updated', STATE);
        saveToFirebase();
    });

    socket.on('admin:updatePlayerImage', ({ category, name, imageUrl }) => {
        if (STATE.playersSnapshot && STATE.playersSnapshot[category]) {
            const player = STATE.playersSnapshot[category].find(p => p.name === name);
            if (player) {
                player.image = imageUrl;
                io.emit('state:updated', STATE);
                io.emit('popup:update_image', { category, name, imageUrl });
                saveToFirebase();
            }
        }
    });

    // 5. Resets
    socket.on('players:clear', ({ category }) => {
        if (STATE.playersSnapshot && STATE.playersSnapshot[category]) {
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

    socket.on('admin:resetPlayer', ({ category, name }) => {
        STATE.teams.forEach(t => {
            if (t.purchases && t.purchases[category] === name) {
                const price = STATE.soldPrices[`${category}:${name}`] || 0;
                t.purse += price; 
                delete t.purchases[category];
            }
        });
        const key = `${category}:${name}`;
        if (STATE.soldPrices) delete STATE.soldPrices[key];
        if (STATE.activeBids) delete STATE.activeBids[key];
        io.emit('state:updated', STATE);
        saveToFirebase();
    });
    
    socket.on('admin:resetAll', () => {
        STATE.activeBids = {};
        STATE.soldPrices = {};
        STATE.teams.forEach(t => {
            t.purse = 500; 
            t.purchases = {};
        });
        io.emit('state:updated', STATE);
        saveToFirebase();
    });
});

app.use(express.static('public'));

loadFromFirebase().then(() => {
    server.listen(PORT, () => console.log(`🚀 Auction System Live at http://localhost:${PORT}`));
});const express = require('express');
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
    // NEW: Global Impact Purse Settings
    config: {
        impactAmount: 0 // Default amount extra purse
    }
};

async function saveToFirebase() {
    try { await DOC_REF.set(STATE); } catch (err) { console.error(err); }
}

async function loadFromFirebase() {
    try {
        const doc = await DOC_REF.get();
        if (doc.exists) {
            const data = doc.data();
            // Ensure config object exists for legacy data
            if (!data.config) data.config = { impactAmount: 0 };
            STATE = data;
        } else {
            await saveToFirebase();
        }
    } catch (e) { console.log(e); }
}

// --- ROUTES ---
app.post('/upload', upload.any(), (req, res) => {
    if (!req.files || req.files.length === 0) return res.status(400).send('No file.');
    res.json({ url: `/uploads/${req.files[0].filename}` });
});

// --- SOCKETS ---
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    if (STATE.currentActivePlayer) {
        socket.emit('popup:open', STATE.currentActivePlayer);
    }

    // --- AUTH ---
    socket.on('manager:login', ({ username, password }) => {
        if (STATE.managers && STATE.managers[username] === password) {
            socket.emit('manager:logged_in', { username, state: STATE });
        } else {
            socket.emit('auth:portal_error', 'Invalid Host ID or Password');
        }
    });

    socket.on('manager:register', ({ username, password }) => {
        if (!STATE.managers) STATE.managers = {};
        if (STATE.managers[username]) return socket.emit('auth:portal_error', 'Taken');
        STATE.managers[username] = password;
        saveToFirebase(); 
        socket.emit('auth:portal_success', { msg: 'Created!' });
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

    // --- IMPACT PURSE LOGIC (NEW) ---
    socket.on('team:activateImpact', ({ teamId }) => {
        const team = STATE.teams.find(t => t.id === teamId);
        const bonus = Number(STATE.config.impactAmount) || 0;

        if (team && !team.impactUsed && bonus > 0) {
            team.purse = Number(team.purse) + bonus;
            team.impactUsed = true;
            
            io.emit('admin:toast', { msg: `⚡ IMPACT: ${team.name} activated +${bonus} purse!`, type: 'impact' });
            io.emit('state:updated', STATE);
            saveToFirebase();
        }
    });

    // --- ACTIVE PLAYER POPUP ---
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
        if(STATE.playersSnapshot[category]) {
            const p = STATE.playersSnapshot[category].find(x => x.name === name);
            if(p) p.image = imageUrl;
        }
        if (STATE.currentActivePlayer && 
            STATE.currentActivePlayer.name === name && 
            STATE.currentActivePlayer.category === category) {
            STATE.currentActivePlayer.image = imageUrl;
        }
        io.emit('state:updated', STATE);
        io.emit('popup:update_image', { imageUrl });
        saveToFirebase();
    });

    // --- BIDDING & SALES ---
    socket.on('player:bid', (data) => {
        const key = `${data.category}:${data.name}`;
        if (!STATE.activeBids) STATE.activeBids = {};
        STATE.activeBids[key] = data.price;
        if(STATE.currentActivePlayer && STATE.currentActivePlayer.name === data.name) {
            STATE.currentActivePlayer.currentPrice = data.price;
        }
        io.emit('player:bid', data);
        saveToFirebase();
    });

    socket.on('bid:request', ({ category, playerName, teamName }) => {
        io.emit('admin:toast', { msg: `✋ Bid Request: ${teamName} for ${playerName}`, type: 'normal' });
    });

    socket.on('player:sold', (data) => {
        const team = STATE.teams.find(t => t.id === data.teamId);
        if (team) {
            team.purse -= data.price;
            team.purchases = team.purchases || {};
            team.purchases[data.category] = data.name;
            
            if (!STATE.soldPrices) STATE.soldPrices = {};
            STATE.soldPrices[`${data.category}:${data.name}`] = data.price;
            
            STATE.currentActivePlayer = null;
            io.emit('popup:close');
            io.emit('player:sold', { payload: data, teams: STATE.teams });
            saveToFirebase();
        }
    });

    // --- CONFIG ---
    socket.on('admin:updateConfig', (newConfig) => {
        // Update Impact Amount if provided
        if(newConfig.impactAmount !== undefined) {
            if(!STATE.config) STATE.config = {};
            STATE.config.impactAmount = Number(newConfig.impactAmount);
        }

        if(newConfig.teams) {
            STATE.teams = newConfig.teams.map(newTeam => {
                const oldTeam = STATE.teams.find(t => t.id === newTeam.id);
                return {
                    ...newTeam,
                    logo: newTeam.logo || (oldTeam ? oldTeam.logo : null),
                    purchases: oldTeam ? oldTeam.purchases : {},
                    impactUsed: oldTeam ? oldTeam.impactUsed : false, // Preserve impact status
                    password: newTeam.password 
                };
            });
        }
        if(newConfig.categories) STATE.categories = newConfig.categories;
        io.emit('state:updated', STATE);
        saveToFirebase();
    });

    socket.on('admin:setTeamLogo', ({ teamId, logoUrl }) => {
        const team = STATE.teams.find(t => t.id === teamId);
        if(team) { team.logo = logoUrl; io.emit('state:updated', STATE); saveToFirebase(); }
    });

    socket.on('players:save', ({ category, players }) => {
        if (!STATE.playersSnapshot) STATE.playersSnapshot = {};
        const existing = STATE.playersSnapshot[category] || [];
        const mergedPlayers = players.map(newP => {
            const oldP = existing.find(e => e.name === newP.name);
            return { name: newP.name, price: newP.price, image: oldP ? oldP.image : null };
        });
        STATE.playersSnapshot[category] = mergedPlayers;
        io.emit('state:updated', STATE);
        saveToFirebase();
    });

    socket.on('players:clear', ({ category }) => {
        if (STATE.playersSnapshot[category]) { delete STATE.playersSnapshot[category]; io.emit('state:updated', STATE); saveToFirebase(); }
    });

    socket.on('admin:deleteCategory', ({ id }) => {
        STATE.categories = STATE.categories.filter(c => c.id !== id);
        io.emit('state:updated', STATE);
        saveToFirebase();
    });

    socket.on('admin:resetAll', () => {
        STATE.activeBids = {}; STATE.soldPrices = {};
        STATE.teams.forEach(t => { 
            t.purse = 500; 
            t.purchases = {}; 
            t.impactUsed = false; // Reset impact usage
        });
        io.emit('state:updated', STATE); saveToFirebase();
    });
});

loadFromFirebase().then(() => {
    server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
});
