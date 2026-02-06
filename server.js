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
const uploadDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '_'))
});
const upload = multer({ storage: storage });
app.use(express.static('public'));
app.use('/uploads', express.static(uploadDir));
let serviceAccount;
try { serviceAccount = process.env.FIREBASE_JSON ? JSON.parse(process.env.FIREBASE_JSON) : require('./firebase-service-account.json'); } catch (e) { console.error("No Firebase Key."); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
const DOC_REF = db.collection('auction_data').doc('current_state');
let STATE = { teams: [], categories: [], playersSnapshot: {}, activeBids: {}, soldPrices: {}, managers: {}, currentActivePlayer: null, config: { impactAmount: 0 }};
async function saveToFirebase() { try { await DOC_REF.set(STATE); } catch (e) { console.error(e); }}
async function loadFromFirebase() { try { const doc = await DOC_REF.get(); if (doc.exists) { STATE = doc.data(); if (!STATE.config) STATE.config = { impactAmount: 0 }; } else { await saveToFirebase(); } } catch (e) { console.log(e); } }
app.post('/upload', upload.any(), (req, res) => { if (!req.files || req.files.length === 0) return res.status(400).send('No file.'); res.json({ url: `/uploads/${req.files[0].filename}` }); });
io.on('connection', (socket) => {
    if (STATE.currentActivePlayer) socket.emit('popup:open', STATE.currentActivePlayer);
    socket.on('manager:login', ({ username, password }) => {
        if (STATE.managers && STATE.managers[username] === password) socket.emit('manager:logged_in', { username, state: STATE });
        else socket.emit('auth:portal_error', 'Invalid Creds');
    });
    socket.on('manager:register', ({ username, password }) => {
        if (!STATE.managers) STATE.managers = {};
        if (STATE.managers[username]) return socket.emit('auth:portal_error', 'Taken');
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
            if (team.impactActive) team.purse = Number(team.purse) - bonus;
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
            team.purse = 500;
            team.purchases = {};
            team.impactUsed = false;
            team.impactActive = false;
            team.impactTarget = null;
            io.emit('admin:toast', { msg: `Team ${team.name} Reset`, type: 'normal' });
            io.emit('state:updated', STATE);
            saveToFirebase();
        }
    });
    socket.on('admin:select_player', (playerData) => { STATE.currentActivePlayer = playerData; io.emit('popup:open', playerData); saveToFirebase(); });
    socket.on('admin:close_popup', () => { STATE.currentActivePlayer = null; io.emit('popup:close'); saveToFirebase(); });
    socket.on('admin:update_player_image', ({ category, name, imageUrl }) => {
        if (STATE.playersSnapshot[category]) { const p = STATE.playersSnapshot[category].find(x => x.name === name); if (p) p.image = imageUrl; }
        if (STATE.currentActivePlayer && STATE.currentActivePlayer.name === name) STATE.currentActivePlayer.image = imageUrl;
        io.emit('state:updated', STATE);
        io.emit('popup:update_image', { imageUrl });
        saveToFirebase();
    });
    socket.on('player:bid', (data) => {
        const key = `${data.category}:${data.name}`;
        if (!STATE.activeBids) STATE.activeBids = {};
        STATE.activeBids[key] = data.price;
        if (STATE.currentActivePlayer && STATE.currentActivePlayer.name === data.name) STATE.currentActivePlayer.currentPrice = data.price;
        io.emit('player:bid', data);
        saveToFirebase();
    });
    socket.on('bid:request', (data) => io.emit('admin:toast', { msg: `✋ Bid Req: ${data.teamName} for ${data.playerName}` }));
    socket.on('player:sold', (data) => {
        const team = STATE.teams.find(t => t.id === data.teamId);
        if (team) {
            team.purse = Number(team.purse) - Number(data.price);
            team.purchases = team.purchases || {};
            team.purchases[data.category] = data.name;
            if (!STATE.soldPrices) STATE.soldPrices = {};
            STATE.soldPrices[`${data.category}:${data.name}`] = data.price;
            const bonus = Number(STATE.config.impactAmount) || 0;
            const soldKey = `${data.category}:${data.name}`;
            STATE.teams.forEach(t => {
                if (t.impactActive) {
                    if(t.impactTarget === soldKey) {
                        if(t.id === data.teamId) { t.impactActive = false; } 
                        else { t.purse = Number(t.purse) - bonus; t.impactActive = false; }
                    }
                }
            });
            STATE.currentActivePlayer = null;
            io.emit('popup:close');
            io.emit('player:sold', { payload: data, teams: STATE.teams });
            saveToFirebase();
        }
    });
    socket.on('admin:updateConfig', (newConfig) => {
        if (newConfig.impactAmount !== undefined) { if (!STATE.config) STATE.config = {}; STATE.config.impactAmount = Number(newConfig.impactAmount); }
        if (newConfig.teams) {
            STATE.teams = newConfig.teams.map(nt => {
                const ot = STATE.teams.find(t => t.id === nt.id);
                return { ...nt, logo: nt.logo || (ot ? ot.logo : null), purchases: ot ? ot.purchases : {}, impactUsed: ot ? ot.impactUsed : false, impactActive: ot ? ot.impactActive : false, impactTarget: ot ? ot.impactTarget : null };
            });
        }
        if (newConfig.categories) STATE.categories = newConfig.categories;
        io.emit('state:updated', STATE);
        saveToFirebase();
    });
    socket.on('admin:setTeamLogo', ({ teamId, logoUrl }) => { const team = STATE.teams.find(t => t.id === teamId); if (team) { team.logo = logoUrl; io.emit('state:updated', STATE); saveToFirebase(); } });
    socket.on('admin:resetPlayer', ({ category, name }) => {
        STATE.teams.forEach(t => { if (t.purchases && t.purchases[category] === name) { const price = STATE.soldPrices[`${category}:${name}`] || 0; t.purse = Number(t.purse) + Number(price); delete t.purchases[category]; } });
        const k = `${category}:${name}`;
        if (STATE.soldPrices) delete STATE.soldPrices[k];
        if (STATE.activeBids) delete STATE.activeBids[k];
        io.emit('state:updated', STATE);
        saveToFirebase();
    });
    socket.on('admin:resetAll', () => { STATE.activeBids = {}; STATE.soldPrices = {}; STATE.teams.forEach(t => { t.purse = 500; t.purchases = {}; t.impactUsed = false; t.impactActive = false; t.impactTarget = null; }); io.emit('state:updated', STATE); io.emit('admin:toast', { msg: `System Full Reset` }); saveToFirebase(); });
    socket.on('players:save', ({ category, players }) => {
        if (!STATE.playersSnapshot) STATE.playersSnapshot = {};
        const existing = STATE.playersSnapshot[category] || [];
        const merged = players.map(np => { const op = existing.find(e => e.name === np.name); return { name: np.name, price: np.price, image: op ? op.image : null }; });
        STATE.playersSnapshot[category] = merged;
        io.emit('state:updated', STATE);
        saveToFirebase();
    });
    socket.on('players:clear', ({ category }) => { if (STATE.playersSnapshot[category]) { delete STATE.playersSnapshot[category]; io.emit('state:updated', STATE); saveToFirebase(); } });
    socket.on('admin:deleteCategory', ({ id }) => { STATE.categories = STATE.categories.filter(c => c.id !== id); io.emit('state:updated', STATE); saveToFirebase(); });
});
loadFromFirebase().then(() => { server.listen(PORT, () => console.log(`Running on ${PORT}`)); });
