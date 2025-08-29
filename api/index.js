// Vercel serverless Socket.IO + Redis matcher (minimal, stable)
// ENV required: UPSTASH_REDIS_URL

const { Server } = require("socket.io");
const { createAdapter } = require("@socket.io/redis-adapter");
const Redis = require("ioredis");

const WAITING_KEY = "waiting_users";
const CHATTING_KEY = "chatting_users";

module.exports = async (req, res) => {
  const httpServer = res.socket.server;

  if (!httpServer.io) {
    console.log("Initializing Socket.io");

    const io = new Server(httpServer, {
      // IMPORTANT: default client path is "/socket.io" (no trailing slash)
      path: "/socket.io",
      cors: { origin: "*" },
      transports: ["websocket", "polling"],
    });

    // ---- Redis adapter (multi-instance safe) ----
    const pubClient = new Redis(process.env.UPSTASH_REDIS_URL);
    const subClient = pubClient.duplicate();

    const pubNodes = pubClient.nodes ? pubClient.nodes() : [pubClient];
    const subNodes = subClient.nodes ? subClient.nodes() : [subClient];
    pubNodes.forEach((n) => n.on("error", (e) => console.error("Redis Pub Error:", e)));
    subNodes.forEach((n) => n.on("error", (e) => console.error("Redis Sub Error:", e)));

    io.adapter(createAdapter(pubClient, subClient));

    // ---- Helpers ----
    async function updateUserCounts() {
      try {
        const [chatting, total] = await Promise.all([
          pubClient.scard(CHATTING_KEY),
          io.of("/").adapter.allSockets().then((set) => set.size),
        ]);
        const idle = Math.max(0, total - chatting);
        io.emit("user-counts", { idle, chatting });
      } catch (e) {
        console.error("updateUserCounts error:", e);
      }
    }

    // Try several pops to avoid pairing with disconnected sockets
    async function takeValidPartner(excludeId) {
      for (let i = 0; i < 6; i++) {
        const candidate = await pubClient.rpop(WAITING_KEY);
        if (!candidate) return null;
        if (candidate === excludeId) continue; // shouldn't happen, but skip just in case
        if (io.sockets.sockets.has(candidate)) return candidate; // still connected
        // else stale; keep looping
      }
      return null;
    }

    // ---- Socket handlers ----
    io.on("connection", (socket) => {
      updateUserCounts();

      socket.on("join-random", async () => {
        try {
          const partnerId = await takeValidPartner(socket.id);

          if (partnerId) {
            const room = `room-${socket.id}-${partnerId}`;

            io.to(socket.id).socketsJoin(room);
            io.to(partnerId).socketsJoin(room);

            await pubClient.sadd(CHATTING_KEY, socket.id, partnerId);

            io.to(socket.id).emit("matched", { room, initiator: true });
            io.to(partnerId).emit("matched", { room, initiator: false });
          } else {
            // nobody free; add to waiting pool
            await pubClient.lpush(WAITING_KEY, socket.id);
          }
          updateUserCounts();
        } catch (e) {
          console.error("join-random error:", e);
        }
      });

      // Signaling passthrough
      socket.on("offer", ({ room, offer }) => {
        socket.to(room).emit("offer", offer);
      });

      socket.on("answer", ({ room, answer }) => {
        socket.to(room).emit("answer", answer);
      });

      socket.on("ice-candidate", ({ room, candidate }) => {
        socket.to(room).emit("ice-candidate", { candidate });
      });

      socket.on("leave-room", async ({ room }) => {
        try {
          socket.to(room).emit("user-left");
          socket.leave(room);
          await pubClient.srem(CHATTING_KEY, socket.id);
          updateUserCounts();
        } catch (e) {
          console.error("leave-room error:", e);
        }
      });

      socket.on("disconnect", async () => {
        try {
          await pubClient.lrem(WAITING_KEY, 0, socket.id);
          const removed = await pubClient.srem(CHATTING_KEY, socket.id);

          // Notify any rooms the socket was in
          if (removed > 0) {
            for (const room of socket.rooms) {
              if (room !== socket.id) io.to(room).emit("user-left");
            }
          }

          updateUserCounts();
        } catch (e) {
          console.error("disconnect cleanup error:", e);
        }
      });
    });

    httpServer.io = io;
  }

  // IMPORTANT: match the default client path (no trailing slash)
  if (req.url.startsWith("/socket.io")) {
    res.socket.server.io.engine.handleRequest(req, res);
  } else {
    res.status(404).send("Not Found");
  }
};
