// Vercel serverless Socket.IO + Redis matcher (stable)
io.on('connection', (socket) => {
userCounts().catch(() => {});


socket.on('find-partner', async () => {
try {
const partnerId = await findMatch(socket.id);
if (partnerId) {
const room = randomRoom();
io.to(socket.id).socketsJoin(room);
io.to(partnerId).socketsJoin(room);
await pub.sadd(CHATTING_SET, socket.id, partnerId);
io.to(socket.id).emit('matched', { room, initiator: true });
io.to(partnerId).emit('matched', { room, initiator: false });
} else {
// None available; add to waiting pool
await pub.sadd(WAITING_SET, socket.id);
}
userCounts().catch(() => {});
} catch (e) {
console.error('find-partner error', e);
}
});


socket.on('cancel-find', async () => {
await pub.srem(WAITING_SET, socket.id);
userCounts().catch(() => {});
});


// WebRTC signaling passthrough
socket.on('offer', ({ room, offer }) => socket.to(room).emit('offer', offer));
socket.on('answer', ({ room, answer }) => socket.to(room).emit('answer', answer));
socket.on('ice-candidate', ({ room, candidate }) => socket.to(room).emit('ice-candidate', { candidate }));


socket.on('leave-room', async ({ room }) => {
socket.to(room).emit('user-left');
socket.leave(room);
await pub.srem(CHATTING_SET, socket.id);
userCounts().catch(() => {});
});


socket.on('disconnect', async () => {
await pub.srem(WAITING_SET, socket.id);
const removed = await pub.srem(CHATTING_SET, socket.id);
if (removed > 0) {
// Notify any room the socket was part of
for (const r of socket.rooms) {
if (r !== socket.id) io.to(r).emit('user-left');
}
}
userCounts().catch(() => {});
});
});


server.io = io;
}


// Handle Socket.IO polling / upgrade
if (req.url.startsWith('/socket.io/')) {
res.socket.server.io.engine.handleRequest(req, res);
} else {
res.status(404).send('Not Found');
}
};