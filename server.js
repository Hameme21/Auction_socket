const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const admin = require('firebase-admin'); // Changed from googleapis
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Allow connections from anywhere
        methods: ["GET", "POST"]
    }
});

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3000;
// Make sure you upload this file from Firebase Console!
const SERVICE_ACCOUNT = require('./firebase-service-account.json');

// --- FIREBASE INIT ---
admin.initializeApp({
  credential: admin.credential.cert(SERVICE_ACCOUNT)
});

const db = admin.firestore();
const DOC_REF = db.collection('auction_data').doc('current_state');

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
    try {
        // We use set() with merge: true to avoid overwriting if fields define structure
        await DOC_REF.set(STATE);
        console.log('✅ State Saved to Firebase');
    } catch (err) { 
        console.error('❌ Save Error:', err.message); 
    }
}

async function loadFromFirebase() {
    try {
        const doc = await DOC_REF.get();
        if (doc.exists) {
            STATE = doc.data();
            console.log('✅ Loaded State from Firebase');
        } else {
            console.log('⚠️ No existing data found in Firebase. Starting Fresh.');
            // Create the initial doc
            await saveToFirebase();
        }
    } catch (e) { 
        console.log('⚠️ Error loading from Firebase:', e.message); 
    }
}

// --- REAL-TIME LOGIC ---
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    // 1. Manager Authentication
    socket.on('manager:login', ({ username, password }) => {
        if (STATE.managers && STATE.managers[username] === password) {
            socket.emit('manager:logged_in', { username, state: STATE });
        } else {
            socket.emit('auth:portal_error', 'Invalid Host ID or Password');
        }
    });

    socket.on('manager:register', ({ username, password }) => {
        // Ensure managers object exists
        if (!STATE.managers) STATE.managers = {};
        
        if (STATE.managers[username]) {
            return socket.emit('auth:portal_error', 'Username taken');
        }
        STATE.managers[username] = password;
        saveToFirebase(); // Updated function
        socket.emit('auth:portal_success', { msg: 'Account Created! Please Login.' });
    });

    // 2. Team/Participant Connection
    socket.on('participant:connect', (hostId) => {
        if (!STATE.managers || !STATE.managers[hostId]) {
            return socket.emit('auth:portal_error', 'Host ID not found');
        }
        socket.emit('init:teams_available', { hostId, teams: STATE.teams || [] });
    });

    socket.on('team:login', ({ teamId, password, role }) => {
        const team = STATE.teams.find(t => t.id === teamId);
        if (role === 'team' && (!team || team.password !== password)) {
            return socket.emit('auth:team_error', 'Invalid Team Password');
        }
        socket.emit('auction:enter', { role, teamId, state: STATE });
    });

    // 3. Auction Actions
    socket.on('player:bid', (data) => {
        const key = `${data.category}:${data.name}`;
        if (!STATE.activeBids) STATE.activeBids = {};
        
        STATE.activeBids[key] = data.price;
        io.emit('player:bid', data);
        saveToFirebase();
    });

    socket.on('bid:request', ({ category, playerName, teamName }) => {
        io.emit('admin:toast', { msg: `✋ Bid Request: ${teamName} for ${playerName}` });
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

    // 4. Admin Management
    socket.on('admin:updateConfig', (newConfig) => {
        if(newConfig.teams) STATE.teams = newConfig.teams;
        if(newConfig.categories) STATE.categories = newConfig.categories;
        io.emit('state:updated', STATE);
        saveToFirebase();
    });

    socket.on('players:save', ({ category, players }) => {
        if (!STATE.playersSnapshot) STATE.playersSnapshot = {};
        STATE.playersSnapshot[category] = players;
        io.emit('state:updated', STATE);
        saveToFirebase();
    });

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
                t.purse += price; // Refund
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
});
