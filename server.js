const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

app.use(express.static('public'));

// Store current auction state in memory for new connectors
let currentAuctionState = {
    activePlayer: null,
    currentBid: 0,
    isPopupOpen: false
};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Send current state to new user immediately
    socket.emit('sync_state', currentAuctionState);

    // --- Admin Actions ---

    // 1. Open Bidding Popup
    socket.on('open_bid_popup', (playerData) => {
        currentAuctionState.activePlayer = playerData;
        currentAuctionState.currentBid = parseInt(playerData.basePrice);
        currentAuctionState.isPopupOpen = true;
        
        // Broadcast to everyone (Admin, Teams, Viewers)
        io.emit('auction_opened', currentAuctionState);
    });

    // 2. Increment/Decrement Bid
    socket.on('update_bid', (newAmount) => {
        currentAuctionState.currentBid = newAmount;
        io.emit('bid_updated', newAmount);
    });

    // 3. Mark Sold (Trigger Team Selection Popup for Admin)
    socket.on('trigger_sell_options', () => {
        // Only the admin needs to see the team selection box
        // We don't broadcast this. The client side admin handles logic.
    });

    // 4. Finalize Sale (Hammer Animation)
    socket.on('player_sold', (saleData) => {
        // saleData contains: { teamName, price, player, impactUsed }
        currentAuctionState = { activePlayer: null, currentBid: 0, isPopupOpen: false };
        io.emit('animate_hammer', saleData);
    });

    // 5. Close Popup (Unsold or Cancel)
    socket.on('close_popup', () => {
        currentAuctionState = { activePlayer: null, currentBid: 0, isPopupOpen: false };
        io.emit('close_auction_window');
    });
});

server.listen(3000, () => {
    console.log('listening on *:3000');
});
