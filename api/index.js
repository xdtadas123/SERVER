// Socket.IO matcher with Redis (Upstash) when available, in-memory fallback otherwise.

const { Server } = require("socket.io");
const { createAdapter } = require("@socket.io/redis-adapter");
const Redis = require("ioredis");

// Accept common env var names. Must be a Redis CONNECTION URL like: rediss://default:PASS@host:port
const REDIS_URL =
  process.env.UPSTASH_REDIS_URL ||
  process.env.UPSTASH_REDIS_CONNECTION_URL ||
  process.env.REDIS_URL ||
  "";

// Redis keys (used only when Redis is enabled)
const WAITING_KEY = "waiting_users";
const CHATTING_KEY = "chatting_users";

// In-memory fallback (single instance only)
const mem = {
  waiting: new Set(),
  chatting: new Set(),
};

module.exports = async (req, res) => {
  const httpServer = res.socket.server;

  if (!httpServer.io) {
    console.log("Initializing Socket.io");

    const io = new Server(httpServer, {
      path: "/socket.io", // default client path (no trailing slash)
      cors: { origin: "*" },
      transports: ["websocket", "polling"],
    });

    let useRedis = Boolean(REDIS_URL);
    let pubClient, subClient;

    if (useRedis) {
      try {
        // Upstash gives a rediss:// URL. ioredis understands it as a single argument.
        pubClient = new Redis(REDIS_URL, { maxRetriesPerRequest: 3 });
        subClient = pubClient.duplicate();

        // Helpful error logs
        const nodes = (c) => (c.nodes ? c.nodes() : [c]);
        nodes(pubClient).forEach((n) =>
          n.on("error", (e) => console.error("Redis Pub Node Error", e))
        );
        nodes(subClient).forEach((n) =>
          n.on("error", (e) => console.error("Redis Sub Node Error", e))
        );

        io.adapter(createAdapter(pubClient, subClient));
        console.log("Redis adapter enabled");
      } catch (err) {
        console.error("Failed to init Redis adapter, falling back to memory:", err);
        useRedis = false;
      }
    } else {
      console.warn(
        "No REDIS_URL found. Running in single-instance memory mode. Set UPSTASH_REDIS_URL to enable multi-instance matching."
      );
    }

    // ---- helpers shared by both modes ----
    async function updateUserCounts() {
      try {
        let chattingCount = 0;

        if (useRedis) {
          chattingCount = await pubClient.scard(CHATTING_KEY);
        } else {
          chattingCount = mem.chatting.size;
        }

        const total = await io.of("/").adapter.allSockets().then((s) => s.size);
        const idle = Math.max(0, total - chattingCount);
        io.emit("user-counts", { idle, chatting: chattingCount });
      } catch (e) {
        console.error("updateUserCounts error:", e);
      }
    }

    async function addToWaiting(id) {
      if (useRedis) {
        await pubClient.sadd(WAITING_KEY, id);
      } else {
        mem.waiting.add(id);
      }
    }

    async function removeFromWaiting(id) {
      if (useRedis) {
        await pubClient.srem(WAITING_KEY, id);
      } else {
        mem.waiting.delete(id);
      }
    }

    async function popValidPartner(excludeId) {
      if (useRedis) {
        // Try a few pops to filter out stale IDs
        for (let i = 0; i < 6; i++) {
          const candidate = await pubClient.spop(WAITING_KEY);
          if (!candidate) return null;
          if (candidate === excludeId) continue;
          if (io.sockets.sockets.has(candidate)) return candidate;
        }
        return null;
      } else {
        // In-memory: pick any connected socket from the set
        for (const candidate of mem.waiting) {
          if (candidate !== excludeId && io.sockets.sockets.has(candidate)) {
            mem.waiting.delete(candidate);
            return candidate;
          }
        }
        return null;
      }
    }

    async function markChattingAdd(...ids) {
      if (useRedis) {
        if (ids.length) await pubClient.sadd(CHATTING_KEY, ...ids);
      } else {
        ids.forEach((id) => mem.chatting.add(id));
      }
    }

    async function markChattingRemove(id) {
      if (useRedis) {
        await pubClient.srem(CHATTING_KEY, id);
      } else {
        mem.chatting.delete(id);
      }
    }

    // ---- socket handlers ----
    io.on("connection", (socket) => {
      console.log("User connected");
      updateUserCounts();

      socket.on("join-random", async () => {
        try {
          // Try to find a partner; if none, add self to waiting
          const partnerId = await popValidPartner(socket.id);

          if (partnerId) {
            const room = `room-${socket.id}-${partnerId}`;

            io.to(socket.id).socketsJoin(room);
            io.to(partnerId).socketsJoin(room);

            await markChattingAdd(socket.id, partnerId);

            io.to(socket.id).emit("matched", { room, initiator: true });
            io.to(partnerId).emit("matched", { room, initiator: false });
          } else {
            await addToWaiting(socket.id);
          }

          updateUserCounts();
        } catch (e) {
          console.error("join-random error:", e);
        }
      });

      // WebRTC signaling passthrough
      socket.on("offer", ({ room, offer }) => socket.to(room).emit("offer", offer));
      socket.on("answer", ({ room, answer }) => socket.to(room).emit("answer", answer));
      socket.on("ice-candidate", ({ room, candidate }) =>
        socket.to(room).emit("ice-candidate", { candidate })
      );

      socket.on("leave-room", async ({ room }) => {
        try {
          socket.to(room).emit("user-left");
          socket.leave(room);
          await markChattingRemove(socket.id);
          updateUserCounts();
        } catch (e) {
          console.error("leave-room error:", e);
        }
      });

      socket.on("disconnect", async () => {
        try {
          await removeFromWaiting(socket.id);
          const before = useRedis ? null : mem.chatting.has(socket.id);
          await markChattingRemove(socket.id);

          // If they were chatting, notify their rooms
          if (useRedis || before) {
            for (const r of socket.rooms) {
              if (r !== socket.id) io.to(r).emit("user-left");
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

  // Route Socket.IO engine requests
  if (req.url.startsWith("/socket.io")) {
    res.socket.server.io.engine.handleRequest(req, res);
  } else {
    res.status(404).send("Not Found");
  }
};
