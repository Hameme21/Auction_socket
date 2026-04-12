
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const admin = require('firebase-admin');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const allowedOrigin = process.env.FRONTEND_URL || "*";

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

app.use('/uploads', express.static(uploadDir));

app.get('/', (req, res) => res.status(200).send('Auction Socket Server is running smoothly!'));

try {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
    }),
  });
} catch (error) { console.error("Firebase initialization error:", error); }

const db = admin.firestore();
const DOC_REF = db.collection('auction_data').doc('current_state');

let STATE = { 
    teams: [], categories: [], playersSnapshot: {}, activeBids: {}, activeBidders: {}, previousOwners: {}, soldPrices: {}, directSigns: {}, rtmEvents: {}, managers: {}, currentActivePlayer: null, config: { impactAmount: 0 }, rtmState: null
};
let TIMER_STATE = { paused: false, time: 30 };
let serverTimerInterval = null;

let firebaseSaveTimeout = null;
function debouncedSaveToFirebase() {
    if (firebaseSaveTimeout) clearTimeout(firebaseSaveTimeout);
    firebaseSaveTimeout = setTimeout(async () => {
        try { await DOC_REF.set(STATE); } catch (e) { console.error("Firebase Save Error:", e); }
    }, 2000); 
}

async function immediateSaveToFirebase() { try { await DOC_REF.set(STATE); } catch (e) {} }

async function loadFromFirebase() { 
    try { 
        const doc = await DOC_REF.get(); 
        if (doc.exists) { 
            STATE = doc.data(); 
            if (!STATE.config) STATE.config = { impactAmount: 0 }; 
            if (!STATE.teams) STATE.teams = [];
            if (!STATE.categories) STATE.categories = [];
            if (!STATE.activeBids) STATE.activeBids = {};
            if (!STATE.activeBidders) STATE.activeBidders = {};
            if (!STATE.previousOwners) STATE.previousOwners = {};
            if (!STATE.soldPrices) STATE.soldPrices = {};
            if (!STATE.directSigns) STATE.directSigns = {}; 
            if (!STATE.rtmEvents) STATE.rtmEvents = {}; 
            if (!STATE.playersSnapshot) STATE.playersSnapshot = {};
        } else { await immediateSaveToFirebase(); } 
    } catch (e) { console.log("Firebase Load Error:", e); } 
}

function executeSale(data) {
    const team = STATE.teams.find(t => t.id === data.teamId);
    const validPrice = Number(data.price) || 0;

    if (team) {
        if (team.purchases && team.purchases[data.category]) {
            io.emit('admin:toast', { msg: `❌ Sale Failed: ${team.name} already has a player from ${data.category}!` });
            return false;
        }

        let requiredReserve = 0;
        STATE.categories.forEach(cat => {
            if (cat.id !== data.category && (!team.purchases || !team.purchases[cat.id])) {
                requiredReserve += Number(cat.base) || 0;
            }
        });

        if ((Number(team.purse) - validPrice) < requiredReserve) {
            io.emit('admin:toast', { msg: `❌ Sale Failed: ${team.name} lacks reserve purse!` });
            return false;
        }
        if (Number(team.purse) < validPrice) {
            io.emit('admin:toast', { msg: `❌ Sale Failed: ${team.name} has insufficient funds!` });
            return false;
        }
        
        if (data.isDirect && !data.isRTM) {
            if (team.directSignUsed) {
                io.emit('admin:toast', { msg: `❌ Sale Failed: ${team.name} already used Direct Sign!` });
                return false;
            }
            team.directSignUsed = true;
            if (!STATE.directSigns) STATE.directSigns = {};
            STATE.directSigns[`${data.category}:${data.name}`] = true;
        }

        if (data.isRTM) {
            team.rtmUsed = true; 
            if (!STATE.rtmEvents) STATE.rtmEvents = {};
            STATE.rtmEvents[`${data.category}:${data.name}`] = true;
        }

        team.purse = Number(team.purse) - validPrice;
        team.purchases = team.purchases || {};
        team.purchases[data.category] = data.name;
        if (!STATE.soldPrices) STATE.soldPrices = {};
        STATE.soldPrices[`${data.category}:${data.name}`] = validPrice;
        
        const bonus = Number(STATE.config.impactAmount) || 0;
        const soldKey = `${data.category}:${data.name}`;
        
        STATE.teams.forEach(t => {
            if (t.impactActive && t.impactTarget === soldKey) {
                if(t.id === data.teamId) { t.impactActive = false; } 
                else { t.purse = Math.max(0, Number(t.purse) - bonus); t.impactActive = false; }
            }
        });
        
        STATE.currentActivePlayer = null;
        TIMER_STATE = { paused: false, time: 30 }; 
        clearInterval(serverTimerInterval);
        io.emit('popup:close');
        io.emit('player:sold', { payload: { ...data, price: validPrice }, teams: STATE.teams });
        immediateSaveToFirebase();
        return true;
    }
    return false;
}

io.on('connection', (socket) => {
    if (STATE.currentActivePlayer) {
        socket.emit('popup:open', STATE.currentActivePlayer);
        socket.emit('timer:sync', TIMER_STATE); 
    }
    if (STATE.rtmState) socket.emit('rtm:prompt', STATE.rtmState);

    socket.on('manager:login', ({ username, password }) => {
        if (STATE.managers && STATE.managers[username] === password) socket.emit('manager:logged_in', { username, state: STATE });
        else socket.emit('auth:portal_error', 'Invalid Creds');
    });

    socket.on('manager:register', ({ username, password }) => {
        if (!STATE.managers) STATE.managers = {};
        if (STATE.managers[username]) return socket.emit('auth:portal_error', 'Taken');
        if (!username || !password) return socket.emit('auth:portal_error', 'Missing Data'); 
        STATE.managers[username] = password;
        immediateSaveToFirebase();
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

    socket.on('admin:timer_control', (data) => {
        TIMER_STATE = data;
        clearInterval(serverTimerInterval);
        if (!data.paused && data.time > 0) {
            serverTimerInterval = setInterval(() => {
                TIMER_STATE.time--;
                io.emit('timer:sync', TIMER_STATE);
                if (TIMER_STATE.time <= 0) clearInterval(serverTimerInterval);
            }, 1000);
        } else {
            io.emit('timer:sync', TIMER_STATE);
        }
    });

    socket.on('admin:import_previous', ({ teamId, players }) => {
        if (!STATE.previousOwners) STATE.previousOwners = {};
        players.forEach(p => { STATE.previousOwners[`${p.catId}:${p.name}`] = teamId; });
        io.emit('state:updated', STATE);
        debouncedSaveToFirebase();
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
            immediateSaveToFirebase();
        }
    });

    socket.on('admin:resetImpact', ({ teamId }) => {
        const team = STATE.teams.find(t => t.id === teamId);
        const bonus = Number(STATE.config.impactAmount) || 0;
        if (team) {
            if (team.impactActive) team.purse = Math.max(0, Number(team.purse) - bonus); 
            team.impactUsed = false;
            team.impactActive = false;
            team.impactTarget = null;
            io.emit('admin:toast', { msg: `↩️ Impact Reset for ${team.name}`, type: 'normal' });
            io.emit('state:updated', STATE);
            immediateSaveToFirebase();
        }
    });

    socket.on('admin:resetTeam', ({ teamId }) => {
        const team = STATE.teams.find(t => t.id === teamId);
        if (team) {
            team.purse = 500;
            if (STATE.directSigns) { for (const cat in team.purchases) { delete STATE.directSigns[`${cat}:${team.purchases[cat]}`]; } }
            if (STATE.rtmEvents) { for (const cat in team.purchases) { delete STATE.rtmEvents[`${cat}:${team.purchases[cat]}`]; } }
            team.purchases = {};
            team.impactUsed = false;
            team.impactActive = false;
            team.impactTarget = null;
            team.directSignUsed = false; 
            team.rtmUsed = false;
            io.emit('admin:toast', { msg: `Team ${team.name} Reset`, type: 'normal' });
            io.emit('state:updated', STATE);
            immediateSaveToFirebase();
        }
    });

    socket.on('admin:select_player', (playerData) => { 
        STATE.currentActivePlayer = playerData; 
        io.emit('popup:open', playerData); 
        immediateSaveToFirebase(); 
    });

    socket.on('admin:close_popup', () => { 
        STATE.currentActivePlayer = null; 
        TIMER_STATE = { paused: false, time: 30 }; 
        clearInterval(serverTimerInterval);
        io.emit('popup:close'); 
        immediateSaveToFirebase(); 
    });

    socket.on('player:bid', (data) => {
        const validPrice = Number(data.price);
        if (isNaN(validPrice) || validPrice < 0) return; 

        const key = `${data.category}:${data.name}`;
        if (!STATE.activeBids) STATE.activeBids = {};
        if (!STATE.activeBidders) STATE.activeBidders = {};

        STATE.activeBids[key] = validPrice;
        STATE.activeBidders[key] = data.teamId ? data.teamId : null;
        
        if (STATE.currentActivePlayer && STATE.currentActivePlayer.name === data.name) {
            STATE.currentActivePlayer.currentPrice = validPrice;
        }
        io.emit('player:bid', { ...data, price: validPrice });
        debouncedSaveToFirebase(); 
    });

    socket.on('player:sold', (data) => { executeSale(data); });

    // --- RTM Phase 1: Team Sets Price ---
    socket.on('rtm:set_price', ({ category, name, rtmTeamId, newPrice, manualHighBidderId }) => {
        const key = `${category}:${name}`;
        const highBidder = manualHighBidderId || (STATE.activeBidders ? STATE.activeBidders[key] : null);

        // If no one else has bid, sell it directly to the RTM team at the price they entered
        if (!highBidder || highBidder === rtmTeamId) {
            executeSale({ category, name, price: newPrice, teamId: rtmTeamId, isDirect: true, isRTM: true });
            return;
        }

        // Send prompt to the high bidder to accept or decline the new price
        STATE.rtmState = { category, name, rtmTeamId, originalTeamId: highBidder, newPrice };
        io.emit('state:updated', STATE);
        io.emit('rtm:prompt', STATE.rtmState);
        immediateSaveToFirebase();
    });

    // --- RTM Phase 2: High Bidder Responds ---
    socket.on('rtm:respond', ({ accept }) => {
        if (!STATE.rtmState) return;
        const { category, name, rtmTeamId, originalTeamId, newPrice } = STATE.rtmState;
        
        STATE.rtmState = null;
        io.emit('state:updated', STATE);
        io.emit('rtm:cleared');

        if (accept) {
            // Original high bidder matched the new price
            executeSale({ category, name, price: newPrice, teamId: originalTeamId, isDirect: false, isRTM: false });
        } else {
            // Original bidder declined, RTM Team wins it at the new price
            executeSale({ category, name, price: newPrice, teamId: rtmTeamId, isDirect: true, isRTM: true });
        }
    });

    // Clean up
    socket.on('admin:updateConfig', (newConfig) => {
        if (newConfig.teams && Array.isArray(newConfig.teams)) {
            STATE.teams = newConfig.teams.map(nt => {
                const ot = (STATE.teams || []).find(t => t.id === nt.id); 
                return { ...nt, purchases: ot && ot.purchases ? ot.purchases : {}, impactActive: ot ? ot.impactActive : false, rtmUsed: ot ? ot.rtmUsed : false };
            });
        }
        if (newConfig.categories) STATE.categories = newConfig.categories;
        io.emit('state:updated', STATE);
        immediateSaveToFirebase();
    });

    socket.on('admin:resetAll', () => { 
        STATE.activeBids = {}; STATE.activeBidders = {}; STATE.previousOwners = {}; STATE.soldPrices = {}; STATE.directSigns = {}; STATE.rtmEvents = {}; STATE.rtmState = null;
        STATE.teams.forEach(t => { t.purse = 500; t.purchases = {}; t.impactUsed = false; t.impactActive = false; t.directSignUsed = false; t.rtmUsed = false; }); 
        io.emit('state:updated', STATE); io.emit('admin:toast', { msg: `System Full Reset` }); immediateSaveToFirebase(); 
    });
});

loadFromFirebase().then(() => { server.listen(PORT, () => console.log(`Running on ${PORT}`)); });
