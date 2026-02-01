const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const admin = require('firebase-admin'); 
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3000;

// --- FIREBASE SETUP ---
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
    managers: {} 
};

// --- SYNC ---
async function saveToFirebase() {
    try { await DOC_REF.set(STATE); } catch (err) { console.error(err.message); }
}

async function loadFromFirebase() {
    try {
        const doc = await DOC_REF.get();
        if (doc.exists) STATE = doc.data();
        else await saveToFirebase();
    } catch (e) { console.log(e.message); }
}

// --- REAL-TIME LOGIC ---
io.on('connection', (socket) => {
    console.log('User:', socket.id);
    
    // Auth & Connect
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
        socket.emit('auth:portal_success', { msg: 'Created. Login now.' });
    });

    socket.on('participant:connect', (hostId) => {
        if (!STATE.managers || !STATE.managers[hostId]) return socket.emit('auth:portal_error', 'Host Not Found');
        socket.emit('init:teams_available', { hostId, teams: STATE.teams || [] });
    });

    socket.on('team:login', ({ teamId, password, role }) => {
        const team = STATE.teams.find(t => t.id === teamId);
        if (role === 'team' && (!team || team.password !== password)) {
            return socket.emit('auth:team_error', 'Wrong Password');
        }
        socket.emit('auction:enter', { role, teamId, state: STATE });
    });

    // --- AUCTION CORE ---
    socket.on('player:bid', (data) => {
        const key = `${data.category}:${data.name}`;
        if (!STATE.activeBids) STATE.activeBids = {};
        STATE.activeBids[key] = data.price;
        io.emit('player:bid', data);
        saveToFirebase();
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

    // --- NEW: SYNC POPUP ---
    socket.on('admin:select_player', (data) => {
        // Broadcast this player view to EVERYONE
        io.emit('auction:select_player', data);
    });

    socket.on('admin:close_player', () => {
        io.emit('auction:close_player');
    });
    // -----------------------

    socket.on('admin:updateConfig', (newConfig) => {
        if(newConfig.teams) STATE.teams = newConfig.teams;
        if(newConfig.categories) STATE.categories = newConfig.categories;
        io.emit('state:updated', STATE);
        saveToFirebase();
    });

    socket.on('players:save', ({ category, players }) => {
        if (!STATE.playersSnapshot) STATE.playersSnapshot = {};
        const existing = STATE.playersSnapshot[category] || [];
        const merged = players.map(newP => {
            const oldP = existing.find(e => e.name === newP.name);
            return { name: newP.name, price: newP.price, image: oldP ? oldP.image : null };
        });
        STATE.playersSnapshot[category] = merged;
        io.emit('state:updated', STATE);
        saveToFirebase();
    });

    socket.on('admin:updatePlayerImage', ({ category, name, imageUrl }) => {
        if (STATE.playersSnapshot && STATE.playersSnapshot[category]) {
            const player = STATE.playersSnapshot[category].find(p => p.name === name);
            if (player) {
                player.image = imageUrl;
                io.emit('state:updated', STATE);
                saveToFirebase();
            }
        }
    });

    socket.on('players:clear', ({ category }) => {
        if (STATE.playersSnapshot[category]) delete STATE.playersSnapshot[category];
        io.emit('state:updated', STATE);
        saveToFirebase();
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
        STATE.teams.forEach(t => { t.purse = 500; t.purchases = {}; });
        io.emit('state:updated', STATE);
        saveToFirebase();
    });
});

app.use(express.static('public'));

loadFromFirebase().then(() => {
    server.listen(PORT, () => console.log(`🚀 Auction Live: http://localhost:${PORT}`));
});
