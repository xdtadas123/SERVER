const express = require('express');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server, {
    cors: { origin: '*' }
});

app.use(express.static(__dirname)); // Serve static files

let waitingUsers = []; // For random matching
let updateTimeout = null;

function updateUserCounts() {
    if (updateTimeout) clearTimeout(updateTimeout);
    updateTimeout = setTimeout(() => {
        const total = io.engine.clientsCount;
        let chatting = 0;
        io.sockets.sockets.forEach((soc) => {
            if (soc.rooms.size > 1) chatting++;
        });
        const idle = total - chatting;
        io.emit('user-counts', { idle, chatting });
    }, 100); // 100ms debounce for refresh handling
}

io.on('connection', (socket) => {
    console.log('User connected');
    updateUserCounts();

    socket.on('join-random', () => {
        if (waitingUsers.length > 0) {
            const partner = waitingUsers.pop();
            const room = `room-${socket.id}-${partner.id}`;
            socket.join(room);
            partner.join(room);
            socket.emit('matched', { room });
            partner.emit('matched', { room });
        } else {
            waitingUsers.push(socket);
        }
        updateUserCounts();
    });

    socket.on('chat-message', (data) => {
        socket.to(data.room).emit('chat-message', data.msg);
    });

    socket.on('leave-room', (data) => {
        socket.to(data.room).emit('user-left');
        socket.leave(data.room);
        updateUserCounts();
    });

    socket.on('disconnect', () => {
        waitingUsers = waitingUsers.filter(s => s.id !== socket.id);
        // If in room, notify partner
        for (const room of socket.rooms) {
            if (room !== socket.id) {
                socket.to(room).emit('user-left');
            }
        }
        updateUserCounts();
    });
});

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`Server on port ${port}`));