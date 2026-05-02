const BACKEND_URL = window.DREAM_LEAGUE_CONFIG?.backendUrl || window.location.origin;
const socket = window.io ? io(BACKEND_URL, { transports: ["websocket", "polling"] }) : null;

const $ = (id) => document.getElementById(id);
const shareBtn = $("shareBtn");
const stopBtn = $("stopBtn");
const copyBtn = $("copyBtn");
const statusBadge = $("statusBadge");
const statusText = $("statusText");
const sessionIdEl = $("sessionId");
const shareLink = $("shareLink");
const localPreview = $("localPreview");
const emptyPreview = $("emptyPreview");
const toast = $("toast");
const loader = $("loader");
const leaderboard = $("leaderboard");

let localStream = null;
let sessionId = null;
let peers = new Map();

function isMobileBrowser() {
  return /Android|iPhone|iPad|iPod|Mobile|IEMobile|Opera Mini/i.test(navigator.userAgent || "");
}

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:global.stun.twilio.com:3478" }
  ]
};

const players = [
  "Aiden Cross", "Malik Stone", "Rafael King", "Noah Blaze", "Leo Carter",
  "Zion Brooks", "Mason Vale", "Kai Morgan", "Ethan Fox", "Omar Santos",
  "Luca Hayes", "Jayden Cole", "Theo Price", "Arlo Reed", "Nico Lane",
  "Ibrahim Noor", "Mateo Silva", "Andre Knox", "Caleb Shaw", "Roman Wells",
  "Ezra Hart", "Finn West", "Jude Ellis", "Amir Grant", "Tyler Quinn",
  "Eli Rhodes", "Kian Ford", "Dante Cruz", "Oscar Hale", "Ryan Park",
  "Samir Ali", "Hugo Marsh", "Miles Ray", "Jonah Pierce", "Adam Wolf",
  "Enzo Vega", "Isaac North", "Cole Nash", "Louis Gray", "Aaron Pike",
  "Rayan Holt", "Jasper Moon", "Sami Woods", "Victor Chen", "Diego Costa",
  "Tariq James", "Bruno Diaz", "Milo Young", "Evan Scott", "Kobe Rivers"
].map((name, index) => ({ name, rating: 996 - index * 7 - (index % 4) }));

function hideLoader() {
  if (!loader) return;
  setTimeout(() => loader.classList.add("hidden"), 250);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 3200);
}

function setStatus(status, text) {
  statusBadge.className = `status-badge ${status}`;
  statusBadge.textContent = status.toUpperCase();
  statusText.textContent = text;
}

function renderLeaderboard() {
  leaderboard.innerHTML = players
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 50)
    .map((player, index) => `
      <article class="leader-row">
        <div class="leader-rank">#${index + 1}</div>
        <div class="leader-name">${player.name}</div>
        <div class="leader-rating">${player.rating}</div>
      </article>
    `)
    .join("");
}

async function copyShareLink() {
  if (!shareLink.value || !sessionId) return;
  try {
    await navigator.clipboard.writeText(shareLink.value);
    showToast("Share link copied");
  } catch {
    shareLink.select();
    document.execCommand("copy");
    showToast("Share link copied");
  }
}

function createPeer(viewerSocketId) {
  const peer = new RTCPeerConnection(rtcConfig);
  peers.set(viewerSocketId, peer);

  localStream.getTracks().forEach((track) => peer.addTrack(track, localStream));

  peer.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("webrtc:ice-candidate", {
        to: viewerSocketId,
        sessionId,
        candidate: event.candidate
      });
    }
  };

  peer.onconnectionstatechange = () => {
    if (["failed", "closed", "disconnected"].includes(peer.connectionState)) {
      peer.close();
      peers.delete(viewerSocketId);
    }
  };

  return peer;
}

async function startSharing() {
  if (!socket) {
    showToast("Run the Node.js server for live screen sharing. GitHub Pages is static only.");
    return;
  }

  if (!navigator.mediaDevices?.getDisplayMedia) {
    const message = isMobileBrowser()
      ? "Mobile browsers cannot share the phone screen from a website. Use desktop Chrome, Edge, or Firefox to broadcast."
      : "Screen sharing is not supported in this browser. Try desktop Chrome, Edge, or Firefox.";
    setStatus("offline", "Screen sharing is unavailable on this browser");
    showToast(message);
    return;
  }

  try {
    shareBtn.disabled = true;
    setStatus("waiting", "Choose your screen or game window");
    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: { ideal: 24, max: 30 },
        width: { ideal: 1280, max: 1920 },
        height: { ideal: 720, max: 1080 }
      },
      audio: false
    });

    localPreview.srcObject = localStream;
    emptyPreview.classList.add("hidden");

    localStream.getVideoTracks()[0].addEventListener("ended", () => stopSharing());

    socket.emit("session:create", { label: "Dream League Player" }, (response) => {
      if (!response?.ok) {
        showToast("Could not create session");
        stopSharing();
        return;
      }
      sessionId = response.session.id;
      sessionIdEl.textContent = sessionId;
      shareLink.value = `${location.origin}${location.pathname.replace(/index\.html$/, "")}admin.html?session=${encodeURIComponent(sessionId)}`;
      copyBtn.disabled = false;
      stopBtn.disabled = false;
      setStatus("live", "Live and ready for admin viewing");
      socket.emit("session:live", { sessionId });
      showToast("Screen sharing is live");
    });
  } catch (error) {
    shareBtn.disabled = false;
    setStatus("waiting", "Tap share to start a live session");
    showToast(error.name === "NotAllowedError" ? "Screen share permission was cancelled" : "Unable to start screen sharing");
  }
}

function stopSharing(reason = "Screen sharing stopped") {
  if (sessionId) socket.emit("session:stop", { sessionId });
  localStream?.getTracks().forEach((track) => track.stop());
  peers.forEach((peer) => peer.close());
  peers.clear();
  localStream = null;
  sessionId = null;
  localPreview.srcObject = null;
  emptyPreview.classList.remove("hidden");
  shareBtn.disabled = false;
  stopBtn.disabled = true;
  copyBtn.disabled = true;
  sessionIdEl.textContent = "Not live";
  shareLink.value = "Share link will appear after you go live";
  setStatus("waiting", "Tap share to start a live session");
  showToast(reason);
}

socket?.on("viewer:joined", async ({ viewerSocketId }) => {
  if (!localStream || !sessionId) return;
  try {
    setStatus("connected", "Admin connected and watching");
    const peer = createPeer(viewerSocketId);
    const offer = await peer.createOffer({
      offerToReceiveAudio: false,
      offerToReceiveVideo: false
    });
    await peer.setLocalDescription(offer);
    socket.emit("webrtc:offer", {
      to: viewerSocketId,
      sessionId,
      description: peer.localDescription
    });
  } catch {
    showToast("Could not connect viewer");
  }
});

socket?.on("webrtc:answer", async ({ from, description }) => {
  const peer = peers.get(from);
  if (!peer) return;
  await peer.setRemoteDescription(description);
});

socket?.on("webrtc:ice-candidate", async ({ from, candidate }) => {
  const peer = peers.get(from);
  if (!peer || !candidate) return;
  try {
    await peer.addIceCandidate(candidate);
  } catch {
    showToast("Network candidate failed");
  }
});

socket?.on("session:force-stop", ({ reason }) => {
  stopSharing(reason || "Session stopped by admin");
});

socket?.on("session:warning", ({ message }) => {
  window.alert(message);
  showToast("Admin warning received");
});

shareBtn.addEventListener("click", startSharing);
stopBtn.addEventListener("click", () => stopSharing());
copyBtn.addEventListener("click", copyShareLink);

renderLeaderboard();

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", hideLoader, { once: true });
} else {
  hideLoader();
}

window.addEventListener("load", hideLoader, { once: true });
setTimeout(hideLoader, 1800);
