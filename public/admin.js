const socket = window.io ? io({ transports: ["websocket", "polling"] }) : null;

const $ = (id) => document.getElementById(id);
const loader = $("loader");
const sessionList = $("sessionList");
const activeUsers = $("activeUsers");
const liveSessions = $("liveSessions");
const remoteVideo = $("remoteVideo");
const adminEmpty = $("adminEmpty");
const watchingTitle = $("watchingTitle");
const viewerStatus = $("viewerStatus");
const refreshBtn = $("refreshBtn");
const warnBtn = $("warnBtn");
const endBtn = $("endBtn");
const disconnectBtn = $("disconnectBtn");
const warningModal = $("warningModal");
const warningForm = $("warningForm");
const warningText = $("warningText");
const cancelWarn = $("cancelWarn");
const toast = $("toast");

let sessions = [];
let selectedSessionId = null;
let peer = null;
let timers = new Map();

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:global.stun.twilio.com:3478" }
  ]
};

function hideLoader() {
  setTimeout(() => loader.classList.add("hidden"), 250);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 3200);
}

function formatDuration(start) {
  const total = Math.max(0, Math.floor((Date.now() - start) / 1000));
  const minutes = String(Math.floor(total / 60)).padStart(2, "0");
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function badgeClass(status) {
  if (status === "connected") return "connected";
  if (status === "live") return "live";
  if (status === "waiting") return "waiting";
  return "offline";
}

function closePeer() {
  peer?.close();
  peer = null;
  remoteVideo.srcObject = null;
  adminEmpty.classList.remove("hidden");
  viewerStatus.className = "status-badge offline";
  viewerStatus.textContent = "OFFLINE";
}

function setControls(enabled) {
  warnBtn.disabled = !enabled;
  endBtn.disabled = !enabled;
  disconnectBtn.disabled = !enabled;
}

function renderSessions() {
  timers.forEach((timer) => clearInterval(timer));
  timers.clear();

  if (!sessions.length) {
    sessionList.innerHTML = `<div class="session-item"><strong>No active sessions</strong><span class="session-meta">The list updates automatically.</span></div>`;
    if (selectedSessionId) {
      selectedSessionId = null;
      watchingTitle.textContent = "No session selected";
      setControls(false);
      closePeer();
    }
    return;
  }

  sessionList.innerHTML = sessions.map((session) => `
    <button class="session-item ${session.id === selectedSessionId ? "active" : ""}" type="button" data-session="${session.id}">
      <div class="session-line">
        <strong>${session.label}</strong>
        <span class="status-badge ${badgeClass(session.status)}">${session.status.toUpperCase()}</span>
      </div>
      <div class="session-meta">
        <span>ID ${session.id}</span>
        <span>${session.device}</span>
        <span>${session.connectedViewers} viewer${session.connectedViewers === 1 ? "" : "s"}</span>
        <span data-duration="${session.id}">${formatDuration(session.createdAt)}</span>
      </div>
    </button>
  `).join("");

  sessions.forEach((session) => {
    const timer = setInterval(() => {
      const el = document.querySelector(`[data-duration="${session.id}"]`);
      if (el) el.textContent = formatDuration(session.createdAt);
    }, 1000);
    timers.set(session.id, timer);
  });
}

async function watchSession(sessionId) {
  if (!socket) {
    showToast("Run the Node.js server for live admin controls. GitHub Pages is static only.");
    return;
  }

  if (selectedSessionId === sessionId && peer) return;
  closePeer();
  selectedSessionId = sessionId;
  const session = sessions.find((item) => item.id === sessionId);
  watchingTitle.textContent = session ? `${session.label} (${session.id})` : sessionId;
  viewerStatus.className = "status-badge waiting";
  viewerStatus.textContent = "CONNECTING";
  setControls(true);
  renderSessions();

  peer = new RTCPeerConnection(rtcConfig);
  peer.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
    adminEmpty.classList.add("hidden");
    viewerStatus.className = "status-badge connected";
    viewerStatus.textContent = "CONNECTED";
  };
  peer.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("webrtc:ice-candidate", {
        to: sessions.find((item) => item.id === sessionId)?.socketId,
        sessionId,
        candidate: event.candidate
      });
    }
  };
  peer.onconnectionstatechange = () => {
    if (peer.connectionState === "failed" || peer.connectionState === "disconnected") {
      viewerStatus.className = "status-badge offline";
      viewerStatus.textContent = "OFFLINE";
    }
  };

  socket.emit("viewer:watch", { sessionId }, (response) => {
    if (!response?.ok) {
      showToast(response?.message || "Could not watch session");
      selectedSessionId = null;
      setControls(false);
      closePeer();
      renderSessions();
    }
  });
}

socket?.on("admin:sessions", (payload) => {
  sessions = payload.sessions || [];
  activeUsers.textContent = payload.totals?.activeUsers ?? sessions.length;
  liveSessions.textContent = payload.totals?.liveSessions ?? sessions.length;

  if (selectedSessionId && !sessions.some((session) => session.id === selectedSessionId)) {
    showToast("Selected session ended");
    selectedSessionId = null;
    watchingTitle.textContent = "No session selected";
    setControls(false);
    closePeer();
  }

  renderSessions();

  const targetFromUrl = new URLSearchParams(location.search).get("session");
  if (targetFromUrl && !selectedSessionId && sessions.some((session) => session.id === targetFromUrl)) {
    watchSession(targetFromUrl);
  }
});

socket?.on("webrtc:offer", async ({ from, sessionId, description }) => {
  if (sessionId !== selectedSessionId || !peer) return;
  try {
    await peer.setRemoteDescription(description);
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    socket.emit("webrtc:answer", {
      to: from,
      sessionId,
      description: peer.localDescription
    });
  } catch {
    showToast("Could not answer screen stream");
  }
});

socket?.on("webrtc:ice-candidate", async ({ candidate }) => {
  if (!peer || !candidate) return;
  try {
    await peer.addIceCandidate(candidate);
  } catch {
    showToast("Network candidate failed");
  }
});

socket?.on("viewer:session-ended", ({ reason }) => {
  showToast(reason || "Session ended");
  selectedSessionId = null;
  watchingTitle.textContent = "No session selected";
  setControls(false);
  closePeer();
});

sessionList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-session]");
  if (button) watchSession(button.dataset.session);
});

refreshBtn.addEventListener("click", () => {
  socket?.emit("admin:join");
  showToast("Dashboard refreshed");
});

warnBtn.addEventListener("click", () => {
  if (!selectedSessionId) return;
  warningModal.classList.add("open");
  warningText.focus();
});

cancelWarn.addEventListener("click", () => warningModal.classList.remove("open"));

warningForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!selectedSessionId) return;
  socket.emit("admin:warning", {
    sessionId: selectedSessionId,
    message: warningText.value.trim()
  });
  warningModal.classList.remove("open");
  showToast("Warning sent");
});

endBtn.addEventListener("click", () => {
  if (!selectedSessionId) return;
  socket.emit("admin:end-session", { sessionId: selectedSessionId });
});

disconnectBtn.addEventListener("click", () => {
  if (!selectedSessionId) return;
  socket.emit("admin:disconnect-user", { sessionId: selectedSessionId });
});

window.addEventListener("load", hideLoader);
if (socket) {
  socket.emit("admin:join");
} else {
  activeUsers.textContent = "0";
  liveSessions.textContent = "0";
  sessionList.innerHTML = `<div class="session-item"><strong>Node server offline</strong><span class="session-meta">GitHub Pages can show the UI, but live sessions require the Express/Socket.io backend.</span></div>`;
  setControls(false);
}
