const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const admin = require('firebase-admin'); 
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// --- SECURE FIREBASE CONNECTION ---
// If running on Render (Cloud), use the Environment Variable
// If running locally (Laptop), try to use the file if it exists
let serviceAccount;
try {
    if (process.env.FIREBASE_JSON) {
        serviceAccount = JSON.parse(process.env.FIREBASE_JSON);
    } else {
        serviceAccount = require('./firebase-service-account.json');
    }
} catch (e) {
    console.error("CRITICAL ERROR: Could not load Firebase Key. Check Environment Variables or local file.");
    process.exit(1); // Stop server if no key
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
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
        if (!STATE.managers) STATE.managers = {};
        
        if (STATE.managers[username]) {
            return socket.emit('auth:portal_error', 'Username taken');
        }
        STATE.managers[username] = password;
        saveToFirebase(); 
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
        io.emit('admin:toast', { msg: `✋ Bid Request: ${teamName} for ${playerName}`, type: 'normal' });
    });

    socket.on('impact:request', ({ category, playerName, teamName }) => {
        io.emit('admin:toast', { msg: `🟣 IMPACT REQUEST: ${teamName} for ${playerName}`, type: 'impact' });
    });

    socket.on('player:sold', (data) => {
        const team = STATE.teams.find(t => t.id === data.teamId);
        if (team) {
            // --- UPDATED LOGIC HERE ---
            if (data.useImpact) {
                if (team.impactUsed) {
                    return console.error("Cheat attempt: Impact already used.");
                }
                
                // Logic: Combined Purse = Main + Impact
                // New Main = (Main + Impact) - Price
                const currentMain = team.purse || 0;
                const impactBonus = team.impactPurse || 0;
                
                team.purse = (currentMain + impactBonus) - data.price;
                team.impactUsed = true;
                
            } else {
                // Regular Sale: Just minus from main purse
                team.purse -= data.price;
            }

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
                
                // Simple Refund (Adds back to Main)
                // Note: If they used Impact, we don't automatically "un-use" it
                // because that logic gets complicated. Admin can manually fix purse if needed.
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
            t.impactPurse = 0; 
            t.impactUsed = false;
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
