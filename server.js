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

app.get('/', (req, res) => {
  res.status(200).send('Auction Socket Server is running smoothly!');
});

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

// Added: previousOwners and activeBidders
let STATE = { 
    teams: [], categories: [], playersSnapshot: {}, activeBids: {}, 
    activeBidders: {}, previousOwners: {}, soldPrices: {}, directSigns: {}, 
    managers: {}, currentActivePlayer: null, config: { impactAmount: 0 },
    rtmState: null
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

async function immediateSaveToFirebase() { 
    try { await DOC_REF.set(STATE); } catch (e) { console.error("Firebase Save Error:", e); }
}

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
            if (!STATE.playersSnapshot) STATE.playersSnapshot = {};
        } else { 
            await immediateSaveToFirebase(); 
        } 
    } catch (e) { 
        console.log("Firebase Load Error:", e); 
    } 
}

app.post('/upload', upload.any(), (req, res) => { 
    if (!req.files || req.files.length === 0) return res.status(400).send('No file.'); 
    res.json({ url: `/uploads/${req.files[0].filename}` }); 
});

// Helper for Centralized Selling Logic
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
            if (cat.id !== data.category) {
                if (!team.purchases || !team.purchases[cat.id]) {
                    requiredReserve += Number(cat.base) || 0;
                }
            }
        });

        if ((Number(team.purse) - validPrice) < requiredReserve) {
            io.emit('admin:toast', { msg: `❌ Sale Failed: ${team.name} lacks reserve purse for remaining categories!` });
            return false;
        }

        if (Number(team.purse) < validPrice) {
            io.emit('admin:toast', { msg: `❌ Sale Failed: ${team.name} has insufficient funds!` });
            return false;
        }
        
        if (data.isDirect && !data.isRTM) {
            if (team.directSignUsed) {
                io.emit('admin:toast', { msg: `❌ Sale Failed: ${team.name} has already used their Direct Sign!` });
                return false;
            }
            team.directSignUsed = true;
            if (!STATE.directSigns) STATE.directSigns = {};
            STATE.directSigns[`${data.category}:${data.name}`] = true;
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
                if(t.id === data.teamId) { 
                    t.impactActive = false; 
                } else { 
                    t.purse = Math.max(0, Number(t.purse) - bonus); 
                    t.impactActive = false; 
                }
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

    // --- NEW: Import Previous Owners (RTM Eligibility Tagging) ---
    socket.on('admin:import_previous', ({ teamId, players }) => {
        if (!STATE.previousOwners) STATE.previousOwners = {};
        players.forEach(p => {
            STATE.previousOwners[`${p.catId}:${p.name}`] = teamId;
        });
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
            if (STATE.directSigns) {
                for (const cat in team.purchases) {
                    delete STATE.directSigns[`${cat}:${team.purchases[cat]}`];
                }
            }
            team.purchases = {};
            team.impactUsed = false;
            team.impactActive = false;
            team.impactTarget = null;
            team.directSignUsed = false; 
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

    socket.on('admin:update_player_image', ({ category, name, imageUrl }) => {
        if (STATE.playersSnapshot[category]) { 
            const p = STATE.playersSnapshot[category].find(x => x.name === name); 
            if (p) p.image = imageUrl; 
        }
        if (STATE.currentActivePlayer && STATE.currentActivePlayer.name === name) STATE.currentActivePlayer.image = imageUrl;
        io.emit('state:updated', STATE);
        io.emit('popup:update_image', { imageUrl });
        immediateSaveToFirebase();
    });

    // --- UPDATED: Track Bidding Teams ---
    socket.on('player:bid', (data) => {
        const validPrice = Number(data.price);
        if (isNaN(validPrice) || validPrice < 0) return; 

        const key = `${data.category}:${data.name}`;
        if (!STATE.activeBids) STATE.activeBids = {};
        if (!STATE.activeBidders) STATE.activeBidders = {};

        STATE.activeBids[key] = validPrice;
        if (data.teamId) {
            STATE.activeBidders[key] = data.teamId;
        } else {
            // If admin forces a bid manually, it wipes the team ID until a team bids again
            STATE.activeBidders[key] = null;
        }
        
        if (STATE.currentActivePlayer && STATE.currentActivePlayer.name === data.name) {
            STATE.currentActivePlayer.currentPrice = validPrice;
        }
        
        io.emit('player:bid', { ...data, price: validPrice });
        debouncedSaveToFirebase(); 
    });

    socket.on('bid:request', (data) => io.emit('admin:toast', { msg: `✋ Bid Req: ${data.teamName} for ${data.playerName}` }));

    // Standard Gavel Drop
    socket.on('player:sold', (data) => {
        executeSale(data);
    });

    // --- NEW: RTM Invoke Flow ---
    socket.on('rtm:invoke', ({ category, name, rtmTeamId, manualHighBidderId }) => {
        const key = `${category}:${name}`;
        const currentBid = STATE.activeBids[key] || 0;
        const highBidder = manualHighBidderId || (STATE.activeBidders ? STATE.activeBidders[key] : null);

        const catConfig = STATE.categories.find(c => c.id === category);
        const base = Number(catConfig?.base) || 0;
        const increment = Number(catConfig?.increment) || 0;
        
        // RTM requires min 1 bid increment increase over the current winning bid
        let newPrice = currentBid === 0 ? base : (currentBid + increment);

        // If no one else has bid, sell it directly to the RTM team at Base price
        if (!highBidder || highBidder === rtmTeamId) {
            executeSale({ category, name, price: newPrice, teamId: rtmTeamId, isDirect: true, isRTM: true });
            return;
        }

        STATE.rtmState = { category, name, rtmTeamId, originalTeamId: highBidder, newPrice };
        io.emit('state:updated', STATE);
        io.emit('rtm:prompt', STATE.rtmState);
        immediateSaveToFirebase();
    });

    // --- NEW: RTM Response Flow ---
    socket.on('rtm:respond', ({ accept }) => {
        if (!STATE.rtmState) return;
        const { category, name, rtmTeamId, originalTeamId, newPrice } = STATE.rtmState;
        
        // Clear state immediately
        STATE.rtmState = null;
        io.emit('state:updated', STATE);
        io.emit('rtm:cleared');

        if (accept) {
            // Original high bidder matched the price
            executeSale({ category, name, price: newPrice, teamId: originalTeamId, isDirect: false, isRTM: false });
        } else {
            // Original bidder declined, RTM Team wins it at the new price
            executeSale({ category, name, price: newPrice, teamId: rtmTeamId, isDirect: true, isRTM: true });
        }
    });

    socket.on('admin:updateConfig', (newConfig) => {
        if (newConfig.impactAmount !== undefined) { 
            if (!STATE.config) STATE.config = {}; 
            STATE.config.impactAmount = Number(newConfig.impactAmount) || 0; 
        }
        if (newConfig.teams && Array.isArray(newConfig.teams)) {
            STATE.teams = newConfig.teams.map(nt => {
                const ot = (STATE.teams || []).find(t => t.id === nt.id); 
                return { 
                    ...nt, 
                    logo: nt.logo || (ot ? ot.logo : null), 
                    purchases: ot && ot.purchases ? ot.purchases : {}, 
                    impactUsed: ot ? ot.impactUsed : false, 
                    impactActive: ot ? ot.impactActive : false, 
                    impactTarget: ot ? ot.impactTarget : null,
                    directSignUsed: ot ? ot.directSignUsed : false 
                };
            });
        }
        if (newConfig.categories && Array.isArray(newConfig.categories)) STATE.categories = newConfig.categories;
        io.emit('state:updated', STATE);
        immediateSaveToFirebase();
    });

    socket.on('admin:setTeamLogo', ({ teamId, logoUrl }) => { 
        const team = (STATE.teams || []).find(t => t.id === teamId); 
        if (team) { 
            team.logo = logoUrl; 
            io.emit('state:updated', STATE); 
            immediateSaveToFirebase(); 
        } 
    });

    socket.on('admin:resetPlayer', ({ category, name }) => {
        const k = `${category}:${name}`;
        const wasDirectSigned = STATE.directSigns && STATE.directSigns[k];

        STATE.teams.forEach(t => { 
            if (t.purchases && t.purchases[category] === name) { 
                const price = STATE.soldPrices[k] || 0; 
                t.purse = Number(t.purse) + Number(price); 
                delete t.purchases[category]; 
                if (wasDirectSigned) t.directSignUsed = false;
            } 
        });
        
        if (STATE.soldPrices) delete STATE.soldPrices[k];
        if (STATE.activeBids) delete STATE.activeBids[k];
        if (STATE.activeBidders) delete STATE.activeBidders[k];
        if (STATE.directSigns) delete STATE.directSigns[k];
        
        io.emit('state:updated', STATE);
        io.emit('admin:toast', { msg: `Player ${name} Reset` }); 
        immediateSaveToFirebase();
    });

    socket.on('admin:resetAll', () => { 
        STATE.activeBids = {}; 
        STATE.activeBidders = {};
        STATE.previousOwners = {};
        STATE.soldPrices = {}; 
        STATE.directSigns = {};
        STATE.rtmState = null;
        STATE.teams.forEach(t => { 
            t.purse = 500; 
            t.purchases = {}; 
            t.impactUsed = false; 
            t.impactActive = false; 
            t.impactTarget = null; 
            t.directSignUsed = false;
        }); 
        io.emit('state:updated', STATE); 
        io.emit('admin:toast', { msg: `System Full Reset` }); 
        immediateSaveToFirebase(); 
    });

    socket.on('players:save', ({ category, players }) => {
        if (!STATE.playersSnapshot) STATE.playersSnapshot = {};
        const existing = STATE.playersSnapshot[category] || [];
        const merged = players.map(np => { 
            const op = existing.find(e => e.name === np.name); 
            return { 
                name: np.name, 
                price: Number(np.price) || 0, 
                image: np.image !== undefined ? np.image : (op ? op.image : null) 
            }; 
        });
        STATE.playersSnapshot[category] = merged;
        io.emit('state:updated', STATE);
        immediateSaveToFirebase();
    });

    socket.on('players:clear', ({ category }) => { 
        if (STATE.playersSnapshot[category]) { 
            delete STATE.playersSnapshot[category]; 
            io.emit('state:updated', STATE); 
            immediateSaveToFirebase(); 
        } 
    });

    socket.on('admin:deleteCategory', ({ id }) => { 
        STATE.categories = STATE.categories.filter(c => c.id !== id); 
        io.emit('state:updated', STATE); 
        immediateSaveToFirebase(); 
    });
});

loadFromFirebase().then(() => { 
    server.listen(PORT, () => console.log(`Running on ${PORT}`)); 
});
