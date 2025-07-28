// api/index.js
const { Server } = require("socket.io");
const { createAdapter } = require("@socket.io/redis-adapter");
const Redis = require("ioredis");

module.exports = async (req, res) => {
  const httpServer = res.socket.server;

  if (!httpServer.io) {
    console.log("Initializing Socket.io");

    const io = new Server(httpServer, {
      path: "/socket.io/",
      cors: { origin: "*" }
    });

    // Set up Redis adapter for Socket.io (shares rooms and broadcasts across instances)
    const pubClient = new Redis(process.env.UPSTASH_REDIS_URL);
    const pubNodes = pubClient.nodes ? pubClient.nodes() : [pubClient];
    pubNodes.forEach(node => node.on('error', (err) => console.error('Redis Pub Node Error', err)));

    const subClient = pubClient.duplicate();
    const subNodes = subClient.nodes ? subClient.nodes() : [subClient];
    subNodes.forEach(node => node.on('error', (err) => console.error('Redis Sub Node Error', err)));

    io.adapter(createAdapter(pubClient, subClient));

    const WAITING_KEY = "waiting_users";
    const CHATTING_KEY = "chatting_users";

    io.on("connection", (socket) => {
      console.log("User connected");
      updateUserCounts(io, pubClient, CHATTING_KEY);

      socket.on("join-random", async () => {
        // Try to pop a partner from the waiting queue (shared via Redis)
        const partnerId = await pubClient.rpop(WAITING_KEY);
        if (partnerId) {
          // Match found
          const room = `room-${socket.id}-${partnerId}`;

          // Join both to room (works across instances via adapter)
          io.to(socket.id).socketsJoin(room);
          io.to(partnerId).socketsJoin(room);

          // Mark as chatting (shared count)
          await pubClient.sadd(CHATTING_KEY, socket.id, partnerId);

          // Emit matched to both (works across instances)
          io.to(socket.id).emit("matched", { room, initiator: true });
          io.to(partnerId).emit("matched", { room, initiator: false });
        } else {
          // No match, add to waiting queue
          await pubClient.lpush(WAITING_KEY, socket.id);
        }
        updateUserCounts(io, pubClient, CHATTING_KEY);
      });

      // Signaling handlers (forward to room)
      socket.on("offer", (data) => {
        socket.to(data.room).emit("offer", data.offer);
      });

      socket.on("answer", (data) => {
        socket.to(data.room).emit("answer", data.answer);
      });

      socket.on("ice-candidate", (data) => {
        socket.to(data.room).emit("ice-candidate", data);
      });

      socket.on("leave-room", async (data) => {
        io.to(data.room).emit("user-left");
        io.to(socket.id).socketsLeave(data.room);
        await pubClient.srem(CHATTING_KEY, socket.id);
        updateUserCounts(io, pubClient, CHATTING_KEY);
      });

      socket.on("disconnect", async () => {
        await pubClient.lrem(WAITING_KEY, 0, socket.id);
        const removed = await pubClient.srem(CHATTING_KEY, socket.id);
        if (removed > 0) {
          for (const room of socket.rooms) {
            if (room !== socket.id) {
              io.to(room).emit("user-left");
            }
          }
        }
        updateUserCounts(io, pubClient, CHATTING_KEY);
      });
    });

    httpServer.io = io;
  }

  // Handle Socket.io requests (polling or WebSocket upgrade)
  if (req.url.startsWith("/socket.io/")) {
    httpServer.io.engine.handleRequest(req, res);
  } else {
    // No other routes needed (static handled by Vercel)
    res.status(404).send("Not Found");
  }
};

let updateTimeout = null;
async function updateUserCounts(io, pubClient, CHATTING_KEY) {
  if (updateTimeout) clearTimeout(updateTimeout);
  updateTimeout = setTimeout(async () => {
    const [chatting, total] = await Promise.all([
      pubClient.scard(CHATTING_KEY),
      io.of("/").adapter.allSockets().then((set) => set.size),
    ]);
    const idle = total - chatting;
    io.emit("user-counts", { idle, chatting });
  }, 100);
}
