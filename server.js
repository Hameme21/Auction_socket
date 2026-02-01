const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const admin = require('firebase-admin'); 
const path = require('path');
const multer = require('multer'); // NEW: For handling file uploads
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3000;

// --- FILE UPLOAD CONFIGURATION (NEW) ---
const uploadDir = path.join(__dirname, 'public/uploads');
// Ensure the upload directory exists
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir)
  },
  filename: function (req, file, cb) {
    // Save as timestamp-filename to avoid duplicates
    cb(null, Date.now() + '-' + file.originalname)
  }
});

const upload = multer({ storage: storage });

// Serve uploaded files statically so the frontend can access them
app.use('/uploads', express.static(uploadDir));
// ---------------------------------------

// --- SECURE FIREBASE CONNECTION ---
let serviceAccount;
try {
    if (process.env.FIREBASE_JSON) {
        serviceAccount = JSON.parse(process.env.FIREBASE_JSON);
    } else {
        serviceAccount = require('./firebase-service-account.json');
    }
} catch (e) {
    console.error("CRITICAL ERROR: Could not load Firebase Key. Check Environment Variables or local file.");
    process.exit(1);
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

// --- NEW: UPLOAD ENDPOINT ---
app.post('/upload', upload.single('playerImage'), (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }
    // Return the relative path for the frontend
    res.json({ url: `/uploads/${req.file.filename}` });
});

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

    // --- NEW: POP-UP SYNC EVENT ---
    socket.on('admin:reveal_player', (playerData) => {
        // Broadcast to everyone (teams, guests, and other admins)
        io.emit('popup:reveal', playerData);
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

    // NEW: Update Player Image and Broadcast to Popup
    socket.on('admin:updatePlayerImage', ({ category, name, imageUrl }) => {
        if (STATE.playersSnapshot && STATE.playersSnapshot[category]) {
            const player = STATE.playersSnapshot[category].find(p => p.name === name);
            if (player) {
                player.image = imageUrl;
                io.emit('state:updated', STATE); // Update list views
                // Also force update the popup if it is currently open on anyone's screen
                io.emit('popup:update_image', { category, name, imageUrl });
                saveToFirebase();
            }
        }
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
});
