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
    teams: [], categories: [], playersSnapshot: {}, activeBids: {}, activeBidders: {}, previousOwners: {}, soldPrices: {}, directSigns: {}, rtmEvents: {}, managers: {}, currentActivePlayer: null, config: { impactAmount: 0 }, rtmState: null,
    lotteryQueue: [], unsoldPlayers: {}, biddingActive: false
};
let TIMER_STATE = { paused: false, time: 30 };
let serverTimerInterval = null;

function codeSeed(category, name) {
    return `${category || ''}:${name || ''}`.toUpperCase();
}

function hashCode(input) {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
        hash = ((hash << 5) - hash + input.charCodeAt(i)) >>> 0;
    }
    return hash.toString(36).toUpperCase();
}

function makePlayerCode(category, name, usedCodes) {
    const catPart = String(category || 'XX').replace(/[^A-Z0-9]/gi, '').toUpperCase().padEnd(2, 'X').slice(0, 2);
    const seed = codeSeed(category, name);
    let attempt = 0;
    let code = '';
    do {
        const suffix = hashCode(`${seed}:${attempt}`).padStart(3, '0');
        code = `${catPart}${suffix}`.slice(0, 4);
        attempt++;
    } while (usedCodes.has(code) && attempt < 100);
    usedCodes.add(code);
    return code;
}

function buildShufflePool() {
    const usedCodes = new Set();
    const pool = [];
    const unsoldPool = [];
    STATE.categories.forEach(cat => {
        const players = STATE.playersSnapshot[cat.id] || [];
        players.forEach(p => {
            const key = `${cat.id}:${p.name}`;
            let isSold = false;
            STATE.teams.forEach(t => { if (t.purchases && t.purchases[cat.id] === p.name) isSold = true; });
            if (!isSold) {
                const entry = {
                    category: cat.id,
                    name: p.name,
                    base: cat.base,
                    image: p.image,
                    code: makePlayerCode(cat.id, p.name, usedCodes),
                    isUnsold: !!(STATE.unsoldPlayers && STATE.unsoldPlayers[key])
                };
                if (entry.isUnsold) unsoldPool.push(entry);
                else pool.push(entry);
            }
        });
    });
    return { pool, unsoldPool };
}

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
            if (!STATE.lotteryQueue) STATE.lotteryQueue = [];
            if (!STATE.unsoldPlayers) STATE.unsoldPlayers = {};
            if (STATE.biddingActive === undefined) STATE.biddingActive = false;
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
        STATE.biddingActive = false;
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
        if(STATE.biddingActive) socket.emit('bidding:started');
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
    
    // --- CODE SHUFFLE CONTROLS ---
    const shuffleCodes = () => {
        let { pool, unsoldPool } = buildShufflePool();
        pool = pool.sort(() => Math.random() - 0.5);
        unsoldPool = unsoldPool.sort(() => Math.random() - 0.5);
        STATE.lotteryQueue = [...pool, ...unsoldPool];
        io.emit('state:updated', STATE);
        immediateSaveToFirebase();
    };
    socket.on('admin:shuffle_codes', shuffleCodes);
    socket.on('admin:generate_lottery', shuffleCodes);

    socket.on('admin:start_bidding', () => {
        STATE.biddingActive = true;
        TIMER_STATE = { paused: false, time: 30 };
        clearInterval(serverTimerInterval);
        serverTimerInterval = setInterval(() => {
            TIMER_STATE.time--;
            io.emit('timer:sync', TIMER_STATE);
            if (TIMER_STATE.time <= 0) clearInterval(serverTimerInterval);
        }, 1000);
        io.emit('bidding:started');
        immediateSaveToFirebase();
    });
    
    socket.on('admin:mark_unsold', ({ category, name }) => {
        const key = `${category}:${name}`;
        if (!STATE.unsoldPlayers) STATE.unsoldPlayers = {};
        STATE.unsoldPlayers[key] = true;
        
        // Push the unsold player to the END of the lottery queue so they appear last
        if (STATE.lotteryQueue) {
            STATE.lotteryQueue = STATE.lotteryQueue.filter(p => !(p.category === category && p.name === name));
            const cat = STATE.categories.find(c => c.id === category);
            const pObj = (STATE.playersSnapshot[category] || []).find(p => p.name === name);
            if (cat && pObj) {
                const usedCodes = new Set(STATE.lotteryQueue.map(p => p.code).filter(Boolean));
                STATE.lotteryQueue.push({ category: cat.id, name: pObj.name, base: cat.base, image: pObj.image, code: makePlayerCode(cat.id, pObj.name, usedCodes), isUnsold: true });
            }
        }

        STATE.currentActivePlayer = null;
        STATE.biddingActive = false;
        TIMER_STATE = { paused: false, time: 30 };
        clearInterval(serverTimerInterval);
        io.emit('popup:close');
        io.emit('player:unsold', { category, name });
        io.emit('state:updated', STATE);
        immediateSaveToFirebase();
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
        STATE.biddingActive = false;
        TIMER_STATE = { paused: true, time: 30 }; 
        clearInterval(serverTimerInterval);
        io.emit('popup:open', playerData); 
        io.emit('timer:sync', TIMER_STATE);
        immediateSaveToFirebase(); 
    });

    socket.on('admin:close_popup', () => { 
        STATE.currentActivePlayer = null; 
        STATE.biddingActive = false;
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

    // --- RTM Phase 1: Team Sets Price + Match High Bidder ---
    socket.on('rtm:invoke', ({ category, name, rtmTeamId, manualHighBidderId }) => {
        const key = `${category}:${name}`;
        const highBidder = manualHighBidderId || (STATE.activeBidders ? STATE.activeBidders[key] : null);
        const currentBid = STATE.activeBids ? STATE.activeBids[key] : null;
        const cat = STATE.categories.find(c => c.id === category);
        const inc = Number(cat?.increment) || 0;
        
        const base = Number(cat?.base) || 0;
        const priceToMatch = (Number(currentBid) || 0) === 0 ? base : (Number(currentBid) + inc);

        // If no one else has bid, sell it directly to the RTM team at base
        if (!highBidder || highBidder === rtmTeamId) {
            executeSale({ category, name, price: priceToMatch, teamId: rtmTeamId, isDirect: true, isRTM: true });
            return;
        }

        // Send prompt to the high bidder to accept or decline the incremented RTM matching price
        STATE.rtmState = { category, name, rtmTeamId, originalTeamId: highBidder, newPrice: priceToMatch };
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
    socket.on('admin:setTeamLogo', ({ teamId, logoUrl }) => {
        if (!teamId || !logoUrl) return;
        const team = STATE.teams.find(t => t.id === teamId);
        if (!team) return;
        team.logo = logoUrl;
        io.emit('state:updated', STATE);
        immediateSaveToFirebase();
    });

    socket.on('players:save', ({ category, players }) => {
        if (!category || !Array.isArray(players)) return;
        if (!STATE.playersSnapshot) STATE.playersSnapshot = {};
        STATE.playersSnapshot[category] = players;
        STATE.lotteryQueue = (STATE.lotteryQueue || []).map(qp => {
            if (qp.category !== category) return qp;
            const updated = players.find(p => p.name === qp.name);
            return updated ? { ...qp, image: updated.image, name: updated.name, base: qp.base } : qp;
        });

        if (STATE.currentActivePlayer && STATE.currentActivePlayer.category === category) {
            const updatedActive = players.find(p => p.name === STATE.currentActivePlayer.name);
            if (updatedActive) {
                STATE.currentActivePlayer = { ...STATE.currentActivePlayer, ...updatedActive, image: updatedActive.image || STATE.currentActivePlayer.image };
                io.emit('popup:update_image', { imageUrl: STATE.currentActivePlayer.image });
            }
        }

        io.emit('state:updated', STATE);
        immediateSaveToFirebase();
    });

    socket.on('players:clear', ({ category }) => {
        if (!category) return;
        if (!STATE.playersSnapshot) STATE.playersSnapshot = {};
        STATE.playersSnapshot[category] = [];
        STATE.lotteryQueue = (STATE.lotteryQueue || []).filter(p => p.category !== category);
        io.emit('state:updated', STATE);
        immediateSaveToFirebase();
    });

    socket.on('admin:deleteCategory', ({ id }) => {
        if (!id) return;
        STATE.categories = (STATE.categories || []).filter(c => c.id !== id);
        if (STATE.playersSnapshot) delete STATE.playersSnapshot[id];
        STATE.lotteryQueue = (STATE.lotteryQueue || []).filter(p => p.category !== id);
        io.emit('state:updated', STATE);
        immediateSaveToFirebase();
    });

    socket.on('admin:updateConfig', (newConfig) => {
        if (newConfig.teams && Array.isArray(newConfig.teams)) {
            STATE.teams = newConfig.teams.map(nt => {
                const ot = (STATE.teams || []).find(t => t.id === nt.id); 
                return { ...nt, purchases: ot && ot.purchases ? ot.purchases : {}, impactActive: ot ? ot.impactActive : false, rtmUsed: ot ? ot.rtmUsed : false };
            });
        }
        if (newConfig.impactAmount !== undefined) {
            if (!STATE.config) STATE.config = {};
            STATE.config.impactAmount = Number(newConfig.impactAmount) || 0;
        }
        if (newConfig.categories) STATE.categories = newConfig.categories;
        io.emit('state:updated', STATE);
        immediateSaveToFirebase();
    });

    socket.on('admin:resetAll', () => { 
        STATE.activeBids = {}; STATE.activeBidders = {}; STATE.previousOwners = {}; STATE.soldPrices = {}; STATE.directSigns = {}; STATE.rtmEvents = {}; STATE.rtmState = null;
        STATE.lotteryQueue = []; STATE.unsoldPlayers = {}; STATE.biddingActive = false;
        STATE.teams.forEach(t => { t.purse = 500; t.purchases = {}; t.impactUsed = false; t.impactActive = false; t.directSignUsed = false; t.rtmUsed = false; }); 
        io.emit('state:updated', STATE); io.emit('admin:toast', { msg: `System Full Reset` }); immediateSaveToFirebase(); 
    });
});

loadFromFirebase().then(() => { server.listen(PORT, () => console.log(`Running on ${PORT}`)); });
