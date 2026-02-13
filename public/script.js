import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, push, onValue, update, set } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// --- FIREBASE CONFIG ---
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    databaseURL: "YOUR_DATABASE_URL",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "SENDER_ID",
    appId: "APP_ID"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const socket = io();

// --- STATE ---
let currentUser = { role: 'viewer', name: '' };
let currentBidAmount = 0;
let activePlayerId = null;

// --- EXPOSE FUNCTIONS TO WINDOW (For HTML onclicks) ---
window.appLogin = () => {
    const role = document.getElementById('userRole').value;
    const teamName = document.getElementById('teamNameInput').value;
    
    currentUser.role = role;
    currentUser.name = teamName;
    
    document.getElementById('loginOverlay').style.display = 'none';
    document.getElementById('mainDashboard').style.display = 'block';

    if(role === 'admin') {
        document.getElementById('adminPanel').style.display = 'block';
        document.getElementById('adminControls').style.display = 'block'; // Inside popup
    }
};

window.addPlayerToDB = () => {
    const name = document.getElementById('newPlayerName').value;
    const base = document.getElementById('newBasePrice').value;
    const img = document.getElementById('newPlayerImg').value;
    
    push(ref(db, 'players'), {
        name: name,
        basePrice: base,
        img: img,
        status: 'unsold'
    });
};

// --- DATA LISTENERS (FIREBASE) ---

// Load Players
onValue(ref(db, 'players'), (snapshot) => {
    const list = document.getElementById('playerList');
    list.innerHTML = '';
    snapshot.forEach(childSnapshot => {
        const p = childSnapshot.val();
        const key = childSnapshot.key;
        
        if(p.status === 'unsold') {
            const div = document.createElement('div');
            div.className = "d-flex justify-content-between border-bottom p-2";
            div.innerHTML = `
                <span><img src="${p.img}" width="30" class="rounded me-2"> ${p.name} (${p.basePrice})</span>
                ${currentUser.role === 'admin' ? `<button class="btn btn-sm btn-success" onclick="startAuction('${key}', '${p.name}', '${p.basePrice}', '${p.img}')">Bid</button>` : ''}
            `;
            list.appendChild(div);
        }
    });
});

// Load Teams
onValue(ref(db, 'teams'), (snapshot) => {
    const list = document.getElementById('teamList');
    const select = document.getElementById('winnerTeamSelect');
    list.innerHTML = '';
    select.innerHTML = ''; // Reset admin select box
    
    snapshot.forEach(childSnapshot => {
        const t = childSnapshot.val();
        const key = childSnapshot.key;
        
        // List in dashboard
        const div = document.createElement('div');
        div.className = "p-2 border-bottom";
        div.innerHTML = `
            <strong>${t.name}</strong><br>
            Budget: $${t.budget} | Impact: ${t.impactUsed ? '<span class="text-danger">USED</span>' : '<span class="text-success">AVAIL</span>'}
        `;
        list.appendChild(div);
        
        // Add to admin dropdown
        const opt = document.createElement('option');
        opt.value = key; // Store DB Key
        opt.text = t.name;
        opt.dataset.budget = t.budget; // Store current budget in data attribute
        select.appendChild(opt);
    });
});

// --- ADMIN CONTROLS (SOCKET TRIGGERS) ---

window.startAuction = (key, name, base, img) => {
    activePlayerId = key;
    socket.emit('open_bid_popup', { id:key, name, basePrice: base, img });
};

window.adjustBid = (amount) => {
    const newPrice = currentBidAmount + amount;
    socket.emit('update_bid', newPrice);
};

window.openSoldModal = () => {
    document.getElementById('sellModal').style.display = 'block';
};

window.confirmSale = () => {
    const select = document.getElementById('winnerTeamSelect');
    const teamKey = select.value;
    const teamName = select.options[select.selectedIndex].text;
    const impactUsed = document.getElementById('impactUsedCheck').checked;
    
    // 1. Update Firebase (Deduct money, move player)
    update(ref(db, `players/${activePlayerId}`), { status: 'sold', soldTo: teamName, price: currentBidAmount });
    
    // Calculate new budget
    // Note: In a real app, do this math on the server to prevent hacking.
    getDatabase(app); 
    // For simplicity, we assume we fetch current budget, but here we just emit the event
    // You must write the logic to fetch specific team budget and subtract currentBidAmount
    
    // Update Team Impact Status if checked
    if(impactUsed) {
        update(ref(db, `teams/${teamKey}`), { impactUsed: true });
        // NOTE: If you want to deduct Impact Purse "outside main budget", 
        // you would handle the math logic here differently.
    }

    // 2. Trigger Socket Animation
    socket.emit('player_sold', { teamName, price: currentBidAmount, impactUsed });
    document.getElementById('sellModal').style.display = 'none';
};

// --- SOCKET LISTENERS (ALL USERS) ---

socket.on('auction_opened', (data) => {
    document.getElementById('biddingPopup').style.display = 'flex';
    document.getElementById('popupPlayerName').innerText = data.activePlayer.name;
    document.getElementById('popupPlayerImg').src = data.activePlayer.img;
    document.getElementById('popupBidValue').innerText = data.currentBid;
    currentBidAmount = parseInt(data.currentBid);
    activePlayerId = data.activePlayer.id;
});

socket.on('bid_updated', (newAmount) => {
    currentBidAmount = newAmount;
    document.getElementById('popupBidValue').innerText = newAmount;
    
    // Optional: Add a flash effect
    const priceText = document.getElementById('popupBidValue');
    priceText.style.transform = "scale(1.2)";
    setTimeout(() => priceText.style.transform = "scale(1)", 200);
});

socket.on('animate_hammer', (data) => {
    // Hide popup
    document.getElementById('biddingPopup').style.display = 'none';
    
    // Show Main Board Animation
    const board = document.getElementById('liveBoard');
    board.innerHTML = `
        <h2 class="text-success">SOLD to ${data.teamName}</h2>
        <h1>$${data.price}</h1>
    `;
    
    const hammerCont = document.getElementById('hammerContainer');
    const hammerImg = document.getElementById('hammerImg');
    hammerCont.style.display = 'block';
    
    // Play Audio
    const audio = new Audio('hammer.wav');
    audio.play();
    
    // Add swing class
    hammerImg.classList.add('hammer-swing');
    
    setTimeout(() => {
        hammerImg.classList.remove('hammer-swing');
        hammerCont.style.display = 'none';
        board.innerHTML = '<h3>Waiting for next player...</h3>';
    }, 4000);
});