<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Players Auction System</title>
  <style>
    :root{--bg:#071026;--card:#0b1220;--muted:#94a3b8;--accent:#7c3aed;--glass:rgba(255,255,255,0.03)}
    *{box-sizing:border-box;font-family:Inter, system-ui, -apple-system, Roboto, Arial}
    body{margin:0;background:linear-gradient(180deg,#071020 0%,#071827 60%);color:#e6eef8;min-height:100vh;}
    
    /* --- Main Layout --- */
    .container{max-width:1200px;margin:0 auto; padding: 18px;}
    h1{margin:0 0 10px;font-size:20px}
    .flex{display:flex;gap:12px;align-items:center}
    .card{background:var(--card);padding:12px;border-radius:10px;box-shadow:0 6px 20px rgba(2,6,23,0.6); margin-bottom: 12px;}
    .grid{display:grid;grid-template-columns:1fr 340px;gap:12px}
    label{display:block;margin-bottom:6px;color:var(--muted);font-size:13px}
    textarea{width:100%;min-height:90px;background:var(--glass);border:1px solid rgba(255,255,255,0.03);padding:10px;border-radius:8px;color:inherit}
    
    /* --- Portal & Overlays --- */
    #portal, #teamAuthOverlay { position: fixed; inset: 0; z-index: 5000; background: var(--bg); display: flex; align-items: center; justify-content: center; flex-direction: column; }
    .portal-card { background: var(--card); padding: 30px; border-radius: 12px; width: 350px; border: 1px solid rgba(255,255,255,0.1); box-shadow: 0 20px 50px rgba(0,0,0,0.5); text-align: center; }
    .tab-nav { display: flex; margin-bottom: 20px; border-bottom: 1px solid rgba(255,255,255,0.1); }
    .tab { flex: 1; padding: 10px; cursor: pointer; color: var(--muted); border-bottom: 2px solid transparent; }
    .tab.active { color: white; border-color: var(--accent); font-weight: bold; }
    
    /* --- Buttons & Inputs --- */
    button{background:linear-gradient(90deg,var(--accent),#4f46e5);border:0;padding:8px 12px;color:white;border-radius:6px;cursor:pointer; font-size:13px; font-weight:600;}
    button:hover{filter:brightness(1.1)}
    button.ghost{background:transparent;border:1px solid rgba(255,255,255,0.1)}
    button.green{background:#10b981;}
    button.red{background:#ef4444;}
    button.yellow{background:#f59e0b;}
    button.blue{background:#3b82f6;}
    button.small{padding: 5px 10px; font-size: 11px;}
    
    input, select { background:var(--glass); border:1px solid rgba(255,255,255,0.1); color: white; padding: 10px; border-radius: 6px; width: 100%; margin-bottom: 10px; }

    /* --- Player Card --- */
    .players{margin-top:10px}
    .player{display:flex;align-items:center;justify-content:space-between;padding:8px;border-radius:8px;background:linear-gradient(180deg,rgba(255,255,255,0.02),transparent);margin-bottom:8px; border:1px solid transparent; transition:0.2s}
    .player.sold{opacity: 0.5; border-color: #7c3aed;}
    .player.bidding{border-color: #fbbf24; background: rgba(251, 191, 36, 0.1);}
    .player.has-bid .price { color: #fbbf24; text-shadow: 0 0 5px rgba(251, 191, 36, 0.5); }
    
    .left{display:flex;align-items:center;gap:12px}
    .badge{background:rgba(255,255,255,0.03);padding:6px 8px;border-radius:8px;font-weight:700}
    .name{font-weight:600}
    .price{font-size:18px;font-weight:700;}
    
    /* --- Team Settings Grid --- */
    .team-config-row { display: grid; grid-template-columns: 0.5fr 1.5fr 1fr 0.8fr 50px 60px 40px; gap: 6px; margin-bottom: 8px; align-items: center; }
    .team-config-header { font-weight: bold; color: var(--muted); font-size: 12px; margin-bottom: 5px; }
    
    /* --- Scoreboard --- */
    .team-row{display:flex;align-items:center;justify-content:space-between;padding:10px;border-radius:8px;background:rgba(255,255,255,0.02); margin-bottom: 8px;}
    .team-info-grp { display:flex; align-items:center; }
    .team-logo-small { width: 32px; height: 32px; border-radius: 50%; object-fit: cover; margin-right: 10px; border: 1px solid rgba(255,255,255,0.2); }

    /* --- Modals / Popups --- */
    .overlay{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.8);z-index:4000;backdrop-filter:blur(5px);}
    .modal{background:#0f172a;padding:25px;border-radius:12px;width:400px;max-width:90%;border:1px solid #1e293b; box-shadow: 0 20px 50px rgba(0,0,0,0.5);}
    .hidden{display:none !important;}

    /* --- Active Player Control Popup --- */
    #activePlayerPopup {
        position: fixed; top: 100px; left: 50%; transform: translateX(-50%);
        width: 320px; background: #1e293b; border: 2px solid #7c3aed;
        border-radius: 12px; padding: 20px; z-index: 4500;
        box-shadow: 0 0 30px rgba(124, 58, 237, 0.3);
        display: none;
    }
    #activePlayerPopup.show { display: block; animation: popIn 0.3s ease; }
    
    .drop-zone {
        width: 100%; height: 150px; border: 2px dashed #475569;
        border-radius: 8px; display: flex; align-items: center; justify-content: center;
        margin-bottom: 15px; background: rgba(0,0,0,0.2);
        color: var(--muted); cursor: pointer; position: relative; overflow: hidden;
    }
    .drop-zone:hover { border-color: var(--accent); color: white; }
    .drop-zone img { width: 100%; height: 100%; object-fit: contain; }

    /* --- Toast --- */
    #toastContainer {position: fixed; top: 20px; right: 20px; z-index: 6000; display: flex; flex-direction: column; gap: 10px;}
    .toast {background: #1e293b; color: #fff; padding: 12px 16px; border-radius: 8px; border-left: 4px solid #7c3aed; box-shadow: 0 5px 15px rgba(0,0,0,0.3); animation: slideIn 0.3s ease-out;}
    @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
    @keyframes popIn { from{transform:translate(-50%) scale(0.9);opacity:0;} to{transform:translate(-50%) scale(1);opacity:1;} }

    /* --- Hammer --- */
    #hammer{ 
      width:120px; height:120px; 
      transform-origin:20% 20%; pointer-events:none; 
      position:fixed; left:50%; margin-left:-60px; top:40px; z-index:5000;
      display: none; 
    }
    #hammer.swing{ display: block; animation: hammerSwing 0.6s ease-in-out forwards; }
    @keyframes hammerSwing {
      0% { transform: rotate(-35deg); opacity: 0; }
      10% { opacity: 1; }
      50% { transform: rotate(35deg); }
      100% { transform: rotate(-15deg); opacity: 0; }
    }

    .login-logo-preview { 
        width: 60px; height: 60px; border-radius: 50%; object-fit: cover; 
        border: 2px solid var(--accent); margin-bottom: 10px; display: block; margin-left: auto; margin-right: auto;
    }
  </style>
</head>
<body>

  <div id="portal">
    <h1 style="margin-bottom: 20px; color:white;">Players Auction System</h1>
    <div class="portal-card">
      <div class="tab-nav">
        <div class="tab active" onclick="switchTab('manager')">Manager</div>
        <div class="tab" onclick="switchTab('participant')">Join</div>
      </div>
      <div id="managerForm">
        <input id="mUser" placeholder="Username (Host ID)">
        <input id="mPass" type="password" placeholder="Password">
        <button onclick="managerLogin()" style="width:100%">Login</button>
        <button onclick="managerRegister()" class="ghost" style="width:100%; margin-top:5px; font-size:12px">Register</button>
      </div>
      <div id="participantForm" class="hidden">
        <input id="pHostId" placeholder="Host ID">
        <button onclick="connectToHost()" style="width:100%">Connect</button>
      </div>
      <div id="portalMsg" style="color:#ef4444; margin-top:10px; font-size:13px;"></div>
    </div>
  </div>

  <div id="teamAuthOverlay" class="hidden">
    <div class="portal-card">
      <div id="teamLogoLoginArea" class="hidden">
         <img id="loginTeamLogoImg" src="" class="login-logo-preview">
      </div>
      <h3>Auction Login</h3>
      <div style="margin-bottom:15px;">
        <label>Role</label>
        <select id="loginRole" onchange="toggleTeamPass()">
          <option value="listener">Viewer</option>
          <option value="team">Team Representative</option>
        </select>
      </div>
      <div id="teamSelectGroup" class="hidden" style="margin-bottom:15px;">
        <label>Select Your Team</label>
        <select id="loginTeamId" onchange="previewTeamLogo()"></select> 
      </div>
      <div id="passGroup" class="hidden" style="margin-bottom:15px;">
        <label>Team Password</label>
        <input type="password" id="loginPass">
      </div>
      <button onclick="enterAuction()" style="width:100%">Enter</button>
      <div id="teamAuthMsg" style="color:#ef4444; font-size:12px; margin-top:10px;"></div>
    </div>
  </div>

  <div id="appContainer" class="hidden">
    
    <div id="toastContainer"></div>

    <div id="activePlayerPopup">
       <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
           <strong>Current Player</strong>
           <button class="ghost small" onclick="closePopup()">Close</button>
       </div>
       <div class="drop-zone" id="popupDropZone">
           <span id="dropText">Drag Image Here</span>
           <img id="popupImg" class="hidden">
           <input type="file" id="popupFileInput" hidden accept="image/*">
       </div>
       <div style="text-align:center">
           <h2 id="popupName" style="margin:5px 0">Name</h2>
           <div class="badge" id="popupCat" style="display:inline-block">CAT</div>
           <h1 id="popupPrice" style="color:#fbbf24; margin:10px 0">0</h1>
       </div>
       <div class="flex" style="justify-content:center; margin-top:15px;">
           <button class="red" onclick="adjustPrice(-1)">-</button>
           <button class="green" onclick="adjustPrice(1)">+</button>
       </div>
       <div style="margin-top:15px; text-align:center">
           <button class="blue" onclick="openSoldModalFromPopup()" style="width:100%">Mark Sold</button>
       </div>
    </div>

    <div class="overlay hidden" id="soldActionOverlay">
      <div class="modal">
        <h3>Mark Player Sold</h3>
        <div id="soldActionDetails" style="margin-bottom:15px; color:#fbbf24; font-weight:bold;"></div>
        <label>Select Winning Team</label>
        <select id="soldActionTeam" style="margin-bottom:15px;"></select>
        <div class="flex" style="justify-content:flex-end">
          <button id="btnCancelSold" class="ghost">Cancel</button>
          <button id="btnConfirmSold" class="green">Confirm Sale</button>
        </div>
      </div>
    </div>

    <div class="overlay hidden" id="soldAnimationOverlay">
      <div class="card" style="text-align:center; padding:40px; border:2px solid #ffd166;">
        <h1 style="color:#ffd166; font-size:40px; margin:0;">SOLD!</h1>
        <h2 id="animPlayer">Player</h2>
        <p>Sold to <strong id="animTeam">Team</strong> for <span id="animPrice">0</span></p>
      </div>
    </div>
    
    <img id="hammer" src="/hammer.png">
    <audio id="hammerAudio" src="/hammer.wav"></audio>

    <div class="container">
      <div class="banner" style="display:flex; justify-content:space-between; align-items:start;">
        <div>
          <h1>Players Auction System</h1>
          <div class="small" id="roleDisplay" style="color:var(--muted)"></div>
        </div>
        <div class="flex">
          <button id="btnResetSystem" class="red hidden" style="font-size:11px;">Reset System</button>
          <button onclick="location.reload()" class="ghost" style="font-size:11px;">Logout</button>
        </div>
      </div>

      <div class="grid">
        <div>
          <div class="card hidden" id="adminConfigCard">
            <strong>Admin Configuration</strong>
            <div style="margin-top:10px; background:rgba(255,255,255,0.05); padding:8px; border-radius:6px;">
                 <label>Global Impact Amount</label>
                 <div class="flex">
                    <input type="number" id="inpImpactAmount" placeholder="Amount (e.g. 200)" style="margin:0">
                    <button class="small blue" onclick="saveImpactConfig()">Save Rule</button>
                 </div>
            </div>

            <div style="margin-top:15px; border-top:1px solid rgba(255,255,255,0.1); padding-top:10px;">
              <label>Team Settings (Drag Logo onto Icon)</label>
              <div class="team-config-row team-config-header">
                <span>ID</span> <span>Name</span> <span>Pass</span> <span>Purse</span> <span>Logo</span> <span>Imp</span> <span>Del</span>
              </div>
              <div id="teamsConfigContainer"></div>
              <button id="btnAddTeamRow" class="ghost small" style="margin-top:8px; width:100%">+ Add Team</button>
              <button id="btnSaveTeams" class="green small" style="margin-top:8px; width:100%">Save Teams</button>
            </div>
          </div>

          <div class="card hidden" id="catConfigCard">
             <div class="flex">
                <input id="newCatId" placeholder="ID (A)" style="width:80px; margin:0">
                <input id="newCatBase" placeholder="Base" type="number" style="margin:0">
                <input id="newCatInc" placeholder="Inc" type="number" style="margin:0">
                <button id="btnAddCat" class="small">Add Cat</button>
             </div>
          </div>

          <div class="card">
            <strong>Players & Categories</strong>
            <div id="categoriesContainer" style="display:grid;grid-template-columns:repeat(auto-fill, minmax(300px, 1fr));gap:12px;margin-top:10px"></div>
          </div>
        </div>

        <div>
          <div class="card">
            <strong>Live Scoreboard</strong>
            <div id="scoreboard" style="margin-top:10px"></div>
          </div>
          
          <div class="card hidden" id="myTeamCard">
            <strong>My Team Dashboard</strong>
            <div id="myTeamContent" style="margin-top:10px"></div>
          </div>

          <div class="card">
             <strong>Log</strong>
             <div id="log" style="height:100px; overflow-y:auto; font-size:10px; color:var(--muted)"></div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script src="/socket.io/socket.io.js"></script>
  <script>
    const socket = io();
    
    // -- State --
    let CURRENT_USER = { role: null, teamId: null, hostId: null };
    let STATE = { teams: [], categories: [], playersSnapshot: {}, activeBids: {}, soldPrices: {}, config: {} };
    let tempLogoFile = null;

    // -- Elements --
    const elements = {
        portal: document.getElementById('portal'),
        teamAuth: document.getElementById('teamAuthOverlay'),
        app: document.getElementById('appContainer'),
        teamsConfig: document.getElementById('teamsConfigContainer'),
        cats: document.getElementById('categoriesContainer'),
        score: document.getElementById('scoreboard'),
        popup: document.getElementById('activePlayerPopup'),
        popupImg: document.getElementById('popupImg'),
        popupDrop: document.getElementById('popupDropZone'),
        hammer: document.getElementById('hammer'),
        hammerAudio: document.getElementById('hammerAudio')
    };

    // --- Socket Events ---
    socket.on('auth:portal_success', (d) => { 
        document.getElementById('portalMsg').textContent = d.msg; 
        document.getElementById('portalMsg').style.color = '#10b981'; 
    });
    
    socket.on('manager:logged_in', (data) => {
        CURRENT_USER.hostId = data.username;
        CURRENT_USER.role = 'admin';
        STATE = data.state;
        initApp();
    });

    socket.on('init:teams_available', (data) => {
        CURRENT_USER.hostId = data.hostId;
        const sel = document.getElementById('loginTeamId');
        sel.innerHTML = '<option value="">Select Team</option>';
        STATE.teams = data.teams; // Temp store for login logic
        data.teams.forEach(t => sel.innerHTML += `<option value="${t.id}">${t.name}</option>`);
        elements.portal.classList.add('hidden');
        elements.teamAuth.classList.remove('hidden');
    });

    socket.on('auction:enter', (data) => {
        CURRENT_USER.role = data.role;
        CURRENT_USER.teamId = data.teamId;
        STATE = data.state;
        initApp();
    });

    socket.on('state:updated', (newState) => {
        STATE = newState;
        renderAll();
    });

    socket.on('admin:toast', (data) => showToast(data.msg));

    // --- Active Player Popup Events ---
    socket.on('popup:open', (player) => {
        if(CURRENT_USER.role !== 'admin') return; // Only admin sees controls
        updatePopupUI(player);
        elements.popup.classList.add('show');
    });

    socket.on('popup:update', (player) => {
        if(CURRENT_USER.role !== 'admin') return;
        updatePopupUI(player);
    });

    socket.on('popup:close', () => {
        elements.popup.classList.remove('show');
    });

    socket.on('player:sold', (data) => {
        const { name, price, teamId } = data.payload;
        const teamName = STATE.teams.find(t=>t.id===teamId)?.name || teamId;
        
        document.getElementById('animPlayer').textContent = name;
        document.getElementById('animTeam').textContent = teamName;
        document.getElementById('animPrice').textContent = price;
        
        const overlay = document.getElementById('soldAnimationOverlay');
        overlay.classList.remove('hidden');
        
        // Audio & Hammer
        elements.hammerAudio.pause();
        elements.hammerAudio.currentTime = 0;
        elements.hammerAudio.play().catch(e=>console.log(e));
        
        elements.hammer.style.display = 'block';
        elements.hammer.classList.remove('swing');
        void elements.hammer.offsetWidth; // trigger reflow
        elements.hammer.classList.add('swing');

        setTimeout(() => {
            overlay.classList.add('hidden');
            elements.hammer.style.display = 'none';
        }, 3500);
        
        renderAll();
    });

    // --- Logic ---

    function initApp() {
        elements.portal.classList.add('hidden');
        elements.teamAuth.classList.add('hidden');
        elements.app.classList.remove('hidden');
        document.getElementById('roleDisplay').textContent = `${CURRENT_USER.role.toUpperCase()}`;
        
        if(CURRENT_USER.role === 'admin') {
            document.getElementById('adminConfigCard').classList.remove('hidden');
            document.getElementById('catConfigCard').classList.remove('hidden');
            document.getElementById('btnResetSystem').classList.remove('hidden');
            if(STATE.config && STATE.config.impactAmount) {
                document.getElementById('inpImpactAmount').value = STATE.config.impactAmount;
            }
        } else if (CURRENT_USER.role === 'team') {
            document.getElementById('myTeamCard').classList.remove('hidden');
        }
        renderAll();
    }

    function renderAll() {
        renderTeamsConfig();
        renderCategories();
        renderScoreboard();
        renderMyTeam();
    }

    // --- Team Config with File Upload ---
    function renderTeamsConfig() {
        if(CURRENT_USER.role !== 'admin') return;
        elements.teamsConfig.innerHTML = '';
        STATE.teams.forEach(t => {
            const row = document.createElement('div');
            row.className = 'team-config-row';
            row.innerHTML = `
                <input class="t-id" value="${t.id}" placeholder="ID">
                <input class="t-name" value="${t.name}" placeholder="Name">
                <input class="t-pass" value="${t.password||''}" placeholder="Pass">
                <input class="t-purse" type="number" value="${t.purse}" placeholder="Purse">
                
                <div class="upload-icon" style="position:relative; width:30px; height:30px; background:rgba(255,255,255,0.1); border-radius:4px; display:flex; align-items:center; justify-content:center; cursor:pointer" title="Drag Logo Here">
                   <img src="${t.logo || ''}" style="width:100%; height:100%; object-fit:cover; display:${t.logo?'block':'none'}" class="row-logo-preview">
                   <span style="display:${t.logo?'none':'block'}">+</span>
                   <input type="file" onchange="uploadTeamLogo(this, '${t.id}')" style="position:absolute;inset:0;opacity:0;cursor:pointer">
                </div>

                <button class="yellow small" onclick="resetImpact('${t.id}')" title="Reset Impact">↺I</button>
                <button class="red small" onclick="resetTeamFunds('${t.id}')" title="Reset Team">↺T</button>
            `;
            elements.teamsConfig.appendChild(row);
        });
    }

    async function uploadTeamLogo(input, teamId) {
        if(!input.files[0]) return;
        const formData = new FormData();
        formData.append('file', input.files[0]);
        
        try {
            const res = await fetch('/upload', { method:'POST', body: formData });
            const data = await res.json();
            // Find inputs in DOM to update immediately or just emit
            const newTeams = getTeamsFromDOM();
            const t = newTeams.find(x => x.id === teamId);
            if(t) t.logo = data.url;
            socket.emit('admin:updateConfig', { teams: newTeams }); // Save immediately
        } catch(e) { alert('Upload failed'); }
    }

    // --- Scoreboard ---
    function renderScoreboard() {
        elements.score.innerHTML = '';
        STATE.teams.forEach(t => {
            const row = document.createElement('div');
            row.className = 'team-row';
            const count = t.purchases ? Object.keys(t.purchases).length : 0;
            const logoHtml = t.logo ? `<img src="${t.logo}" class="team-logo-small">` : `<div class="team-logo-small" style="background:#333"></div>`;
            
            row.innerHTML = `
                <div class="team-info-grp">
                    ${logoHtml}
                    <div>
                        <div style="font-weight:bold">${t.name}</div>
                        <div class="small" style="color:var(--muted)">${t.id}</div>
                    </div>
                </div>
                <div style="text-align:right">
                    <div style="font-size:16px; color:#10b981">৳ ${t.purse}</div>
                    <div class="small">${count} Players</div>
                    ${t.impactActive ? '<span class="small badge" style="color:#fbbf24">IMPACT</span>' : ''}
                </div>
            `;
            elements.score.appendChild(row);
        });
    }

    // --- Popup Logic ---
    function updatePopupUI(player) {
        document.getElementById('popupName').textContent = player.name;
        document.getElementById('popupCat').textContent = player.category;
        document.getElementById('popupPrice').textContent = player.currentPrice;
        
        if(player.image) {
            elements.popupImg.src = player.image;
            elements.popupImg.classList.remove('hidden');
            document.getElementById('dropText').classList.add('hidden');
        } else {
            elements.popupImg.classList.add('hidden');
            document.getElementById('dropText').classList.remove('hidden');
        }
        
        // Setup Drag Drop for Popup
        const zone = elements.popupDrop;
        zone.ondragover = (e) => { e.preventDefault(); zone.style.borderColor = '#7c3aed'; };
        zone.ondragleave = () => { zone.style.borderColor = '#475569'; };
        zone.ondrop = async (e) => {
            e.preventDefault();
            if(e.dataTransfer.files[0]) {
               await uploadPlayerImage(e.dataTransfer.files[0], player.category, player.name);
            }
        };
        // Setup Click Upload
        document.getElementById('popupFileInput').onchange = (e) => {
            if(e.target.files[0]) uploadPlayerImage(e.target.files[0], player.category, player.name);
        };
        zone.onclick = () => document.getElementById('popupFileInput').click();
    }

    async function uploadPlayerImage(file, category, name) {
        const fd = new FormData();
        fd.append('file', file);
        try {
            const r = await fetch('/upload', { method:'POST', body: fd });
            const d = await r.json();
            socket.emit('admin:updateActivePlayerImage', { category, name, imageUrl: d.url });
        } catch(e) { alert('Err'); }
    }

    function adjustPrice(dir) {
        if(!STATE.currentActivePlayer) return;
        const p = STATE.currentActivePlayer;
        const cat = STATE.categories.find(c => c.id === p.category);
        const inc = cat ? cat.increment : 5;
        const newPrice = Number(p.currentPrice) + (dir * inc);
        socket.emit('player:bid', { category: p.category, name: p.name, price: newPrice });
    }

    function closePopup() {
        socket.emit('admin:closePopup');
    }

    // --- Portal Logic ---
    function switchTab(t) {
        document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
        if(t==='manager') {
            document.querySelector('.tab:first-child').classList.add('active');
            document.getElementById('managerForm').classList.remove('hidden');
            document.getElementById('participantForm').classList.add('hidden');
        } else {
            document.querySelector('.tab:last-child').classList.add('active');
            document.getElementById('managerForm').classList.add('hidden');
            document.getElementById('participantForm').classList.remove('hidden');
        }
    }
    window.managerLogin = () => socket.emit('manager:login', { username: document.getElementById('mUser').value, password: document.getElementById('mPass').value });
    window.managerRegister = () => socket.emit('manager:register', { username: document.getElementById('mUser').value, password: document.getElementById('mPass').value });
    window.connectToHost = () => socket.emit('participant:connect', document.getElementById('pHostId').value);
    
    // Team Login
    window.toggleTeamPass = () => {
        const role = document.getElementById('loginRole').value;
        const isTeam = role === 'team';
        document.getElementById('teamSelectGroup').classList.toggle('hidden', !isTeam);
        document.getElementById('passGroup').classList.toggle('hidden', !isTeam);
    };
    
    window.previewTeamLogo = () => {
        const id = document.getElementById('loginTeamId').value;
        const t = STATE.teams.find(x => x.id === id);
        const img = document.getElementById('loginTeamLogoImg');
        const area = document.getElementById('teamLogoLoginArea');
        if(t && t.logo) {
            img.src = t.logo;
            area.classList.remove('hidden');
        } else {
            area.classList.add('hidden');
        }
    };
    
    window.enterAuction = () => {
        const role = document.getElementById('loginRole').value;
        const teamId = document.getElementById('loginTeamId').value;
        const pass = document.getElementById('loginPass').value;
        socket.emit('team:login', { teamId, password: pass, role });
    };

    // --- Actions ---
    function openSoldModalFromPopup() {
        if(!STATE.currentActivePlayer) return;
        const { category, name, currentPrice } = STATE.currentActivePlayer;
        openSoldConfirmation(category, name, currentPrice);
    }

    window.openSoldConfirmation = (cat, name, price) => {
        const modal = document.getElementById('soldActionOverlay');
        document.getElementById('soldActionDetails').textContent = `${name} (${cat}) @ ৳${price}`;
        const sel = document.getElementById('soldActionTeam');
        sel.innerHTML = '';
        STATE.teams.forEach(t => {
            const canAfford = t.purse >= Number(price);
            sel.innerHTML += `<option value="${t.id}" ${!canAfford?'disabled':''}>${t.name} (৳${t.purse})</option>`;
        });
        
        document.getElementById('btnConfirmSold').onclick = () => {
            socket.emit('player:sold', { category: cat, name, price, teamId: sel.value });
            modal.classList.add('hidden');
        };
        document.getElementById('btnCancelSold').onclick = () => modal.classList.add('hidden');
        modal.classList.remove('hidden');
    };

    // --- Render Categories ---
    function renderCategories() {
        if(CURRENT_USER.role !== 'admin') {
             elements.cats.innerHTML = ''; 
             // Participant view logic if needed, usually just list
        }
        if(CURRENT_USER.role === 'admin') {
            elements.cats.innerHTML = '';
            STATE.categories.forEach(cat => {
                const div = document.createElement('div');
                div.innerHTML = `
                   <div style="background:rgba(255,255,255,0.05); padding:8px; margin-bottom:10px; border-radius:6px; display:flex; justify-content:space-between">
                      <b>${cat.id} (Base: ${cat.base})</b>
                      <div>
                        <button class="small red" onclick="deleteCat('${cat.id}')">X</button>
                      </div>
                   </div>
                   <textarea id="ta-${cat.id}" class="cat-ta" placeholder="Names..."></textarea>
                   <button class="small ghost" onclick="saveCatList('${cat.id}', ${cat.base})">Save List</button>
                   <div id="list-${cat.id}" class="players"></div>
                `;
                elements.cats.appendChild(div);
                
                // Render Players
                const list = div.querySelector(`#list-${cat.id}`);
                const players = STATE.playersSnapshot[cat.id] || [];
                const ta = div.querySelector('textarea');
                if(document.activeElement !== ta) ta.value = players.map(p => p.name).join('\n');

                players.forEach(p => {
                    const el = document.createElement('div');
                    const isSold = STATE.soldPrices[`${cat.id}:${p.name}`];
                    el.className = `player ${isSold?'sold':''}`;
                    el.innerHTML = `
                       <span>${p.name}</span>
                       <div>
                         ${!isSold ? `<button class="small green" onclick="activatePlayer('${cat.id}','${p.name}', ${cat.base}, '${p.image||''}')">Open</button>` : '<span class="small">Sold</span>'}
                         <button class="small yellow" onclick="resetPlayer('${cat.id}', '${p.name}')">↺</button>
                       </div>
                    `;
                    list.appendChild(el);
                });
            });
        }
    }

    // --- Helper Buttons ---
    window.activatePlayer = (cat, name, base, img) => {
        const currentBid = STATE.activeBids[`${cat}:${name}`] || base;
        socket.emit('admin:setActivePlayer', { category: cat, name, price: currentBid, image: img || null });
    };

    window.saveCatList = (id, base) => {
        const ta = document.getElementById(`ta-${id}`);
        const names = ta.value.split('\n').map(s=>s.trim()).filter(Boolean);
        socket.emit('players:save', { category: id, players: names.map(n=>({ name: n, price: base })) });
    };

    document.getElementById('btnAddTeamRow').onclick = () => {
        const div = document.createElement('div'); 
        // Simple append for now, full render happens on save/state update usually
        // But to make it interactive immediately:
        STATE.teams.push({ id:'', name:'', purse: 500 });
        renderTeamsConfig();
    };

    document.getElementById('btnSaveTeams').onclick = () => {
        socket.emit('admin:updateConfig', { teams: getTeamsFromDOM() });
    };
    
    window.saveImpactConfig = () => {
        const val = document.getElementById('inpImpactAmount').value;
        socket.emit('admin:updateConfig', { impactAmount: val });
    }

    function getTeamsFromDOM() {
        const rows = document.querySelectorAll('.team-config-row:not(.team-config-header)');
        const res = [];
        rows.forEach((r, index) => {
             const id = r.querySelector('.t-id').value;
             const name = r.querySelector('.t-name').value;
             const pass = r.querySelector('.t-pass').value;
             const purse = r.querySelector('.t-purse').value;
             // Keep existing logo if not changed, we handle new uploads via direct fetch
             const existingTeam = STATE.teams.find(t => t.id === id) || STATE.teams[index];
             const logo = existingTeam ? existingTeam.logo : null;
             
             if(id && name) res.push({ id, name, password: pass, purse: Number(purse), logo });
        });
        return res;
    }

    window.resetTeamFunds = (id) => {
        if(confirm('Reset this team\'s funds and players?')) socket.emit('admin:resetTeam', { teamId: id });
    };

    window.resetImpact = (id) => socket.emit('admin:resetImpact', { teamId: id });
    window.resetPlayer = (c, n) => socket.emit('admin:resetPlayer', { category: c, name: n });
    window.deleteCat = (id) => socket.emit('admin:deleteCategory', { id });

    document.getElementById('btnAddCat').onclick = () => {
        const id = document.getElementById('newCatId').value;
        const base = document.getElementById('newCatBase').value;
        const inc = document.getElementById('newCatInc').value;
        if(id && base) {
             STATE.categories.push({ id, base:Number(base), increment:Number(inc) });
             socket.emit('admin:updateConfig', { categories: STATE.categories });
        }
    }
    
    document.getElementById('btnResetSystem').onclick = () => {
        if(confirm("RESET ENTIRE SYSTEM?")) socket.emit('admin:resetAll');
    }

    function renderMyTeam() {
        if(CURRENT_USER.role !== 'team') return;
        const t = STATE.teams.find(x => x.id === CURRENT_USER.teamId);
        const div = document.getElementById('myTeamContent');
        if(!t) return;
        div.innerHTML = `
           <h3>Purse: ৳ ${t.purse}</h3>
           ${t.impactActive ? '<div style="background:#fbbf24; color:black; padding:5px; border-radius:4px; text-align:center; font-weight:bold; margin-bottom:10px">IMPACT CARD ACTIVE</div>' : ''}
           <div>Purchases:</div>
        `;
        if(t.purchases) {
            Object.values(t.purchases).forEach(n => {
                div.innerHTML += `<div style="padding:4px; border-bottom:1px solid #333">${n}</div>`;
            });
        }
    }

    function showToast(msg) {
        const t = document.createElement('div');
        t.className = 'toast';
        t.innerText = msg;
        document.getElementById('toastContainer').appendChild(t);
        setTimeout(() => t.remove(), 3000);
    }
  </script>
</body>
</html>
