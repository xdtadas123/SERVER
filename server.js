const express = require('express');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server, {
    cors: { origin: '*' }
});

app.use(express.static(__dirname)); // Serve static files

let waitingUsers = []; // For random matching

io.on('connection', (socket) => {
    console.log('User connected');

    socket.on('join-random', () => {
        if (waitingUsers.length > 0) {
            const partner = waitingUsers.pop();
            const room = `room-${socket.id}-${partner.id}`;
            socket.join(room);
            partner.join(room);
            io.to(room).emit('matched', room);
        } else {
            waitingUsers.push(socket);
        }
    });

    socket.on('offer', (data) => socket.to(data.room).emit('offer', data.offer));
    socket.on('answer', (data) => socket.to(data.room).emit('answer', data.answer));
    socket.on('ice-candidate', (data) => socket.to(data.room).emit('ice-candidate', data.candidate));

    socket.on('disconnect', () => {
        // Remove from waiting if disconnected
        waitingUsers = waitingUsers.filter(s => s.id !== socket.id);
    });
});

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`Server on port ${port}`));