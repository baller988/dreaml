const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  pingInterval: 10000,
  pingTimeout: 20000,
  maxHttpBufferSize: 1e6
});

const PORT = process.env.PORT || 3000;
const sessions = new Map();
const admins = new Set();

app.use(express.static(path.join(__dirname, "public"), {
  etag: true,
  maxAge: "1h"
}));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

function makeSessionId() {
  return Math.random().toString(36).slice(2, 7).toUpperCase() + "-" + Date.now().toString(36).toUpperCase();
}

function deviceType(userAgent = "") {
  return /Android|iPhone|iPad|iPod|Mobile|IEMobile|Opera Mini/i.test(userAgent) ? "Mobile" : "Desktop";
}

function publicSession(session) {
  return {
    id: session.id,
    socketId: session.socketId,
    status: session.status,
    createdAt: session.createdAt,
    connectedViewers: session.connectedViewers.size,
    userAgent: session.userAgent,
    device: session.device,
    label: session.label,
    warning: session.warning || ""
  };
}

function allSessions() {
  return Array.from(sessions.values()).map(publicSession);
}

function emitAdminState() {
  io.to("admins").emit("admin:sessions", {
    sessions: allSessions(),
    totals: {
      activeUsers: sessions.size,
      liveSessions: Array.from(sessions.values()).filter((s) => s.status === "live" || s.status === "connected").length
    }
  });
}

function endSession(sessionId, reason = "Session ended by admin") {
  const session = sessions.get(sessionId);
  if (!session) return;
  io.to(session.socketId).emit("session:force-stop", { reason });
  session.connectedViewers.forEach((viewerSocketId) => {
    io.to(viewerSocketId).emit("viewer:session-ended", { sessionId, reason });
  });
  sessions.delete(sessionId);
  emitAdminState();
}

io.on("connection", (socket) => {
  socket.on("admin:join", () => {
    admins.add(socket.id);
    socket.join("admins");
    socket.emit("admin:sessions", {
      sessions: allSessions(),
      totals: {
        activeUsers: sessions.size,
        liveSessions: Array.from(sessions.values()).filter((s) => s.status === "live" || s.status === "connected").length
      }
    });
  });

  socket.on("session:create", ({ label } = {}, callback) => {
    const id = makeSessionId();
    const session = {
      id,
      socketId: socket.id,
      status: "waiting",
      createdAt: Date.now(),
      connectedViewers: new Set(),
      userAgent: socket.handshake.headers["user-agent"] || "Unknown",
      device: deviceType(socket.handshake.headers["user-agent"]),
      label: label || `Player ${id.slice(0, 5)}`,
      warning: ""
    };
    sessions.set(id, session);
    socket.data.sessionId = id;
    socket.join(`session:${id}`);
    callback?.({ ok: true, session: publicSession(session) });
    emitAdminState();
  });

  socket.on("session:live", ({ sessionId } = {}) => {
    const session = sessions.get(sessionId || socket.data.sessionId);
    if (!session || session.socketId !== socket.id) return;
    session.status = session.connectedViewers.size ? "connected" : "live";
    emitAdminState();
  });

  socket.on("session:stop", ({ sessionId } = {}) => {
    const id = sessionId || socket.data.sessionId;
    const session = sessions.get(id);
    if (!session || session.socketId !== socket.id) return;
    endSession(id, "Broadcaster stopped sharing");
  });

  socket.on("viewer:watch", ({ sessionId } = {}, callback) => {
    const session = sessions.get(sessionId);
    if (!session) {
      callback?.({ ok: false, message: "Session is offline" });
      return;
    }
    session.connectedViewers.add(socket.id);
    socket.data.viewingSessionId = sessionId;
    socket.join(`session:${sessionId}`);
    if (session.status === "live" || session.status === "waiting") session.status = "connected";
    io.to(session.socketId).emit("viewer:joined", { viewerSocketId: socket.id, sessionId });
    callback?.({ ok: true, session: publicSession(session) });
    emitAdminState();
  });

  socket.on("webrtc:offer", ({ to, sessionId, description }) => {
    io.to(to).emit("webrtc:offer", { from: socket.id, sessionId, description });
  });

  socket.on("webrtc:answer", ({ to, sessionId, description }) => {
    io.to(to).emit("webrtc:answer", { from: socket.id, sessionId, description });
  });

  socket.on("webrtc:ice-candidate", ({ to, sessionId, candidate }) => {
    io.to(to).emit("webrtc:ice-candidate", { from: socket.id, sessionId, candidate });
  });

  socket.on("admin:end-session", ({ sessionId }) => {
    if (!admins.has(socket.id)) return;
    endSession(sessionId, "Session ended by admin");
  });

  socket.on("admin:disconnect-user", ({ sessionId }) => {
    if (!admins.has(socket.id)) return;
    endSession(sessionId, "Disconnected by admin");
  });

  socket.on("admin:warning", ({ sessionId, message }) => {
    if (!admins.has(socket.id)) return;
    const session = sessions.get(sessionId);
    if (!session) return;
    const cleanMessage = String(message || "Admin warning: please follow the tournament rules.").slice(0, 180);
    session.warning = cleanMessage;
    io.to(session.socketId).emit("session:warning", { message: cleanMessage });
    emitAdminState();
  });

  socket.on("disconnect", () => {
    admins.delete(socket.id);
    const sessionId = socket.data.sessionId;
    if (sessionId && sessions.has(sessionId)) {
      endSession(sessionId, "Broadcaster disconnected");
      return;
    }

    const viewingSessionId = socket.data.viewingSessionId;
    const session = sessions.get(viewingSessionId);
    if (session) {
      session.connectedViewers.delete(socket.id);
      if (session.connectedViewers.size === 0 && session.status === "connected") session.status = "live";
      emitAdminState();
    }
  });
});

server.listen(PORT, () => {
  console.log(`Dream League Live Screen Sharing Platform running at http://localhost:${PORT}`);
  console.log(`Admin dashboard available at http://localhost:${PORT}/admin`);
});
