// app.js
// Powers the Scholacore student dashboard: LiveKit video stage, the Groq-backed
// AI Study Librarian chat, and the Paystack "unlock full course" flow.

import { auth, db } from "./firebase-config.js";
import {
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// ---- Config ----
const LIVEKIT_ROOM_NAME = "main-classroom"; // swap for a per-course room name if needed
const PAYSTACK_PUBLIC_KEY = "REPLACE_WITH_YOUR_PAYSTACK_PUBLIC_KEY";
const COURSE_PRICE_KOBO = 500000; // ₦5,000.00 — MUST match COURSE_PRICE_KOBO in verify-payment.php

let currentUser = null;
let idToken = null;
let liveKitRoom = null;
const activeParticipants = new Set();

// ---- DOM refs ----
const videoContainer = document.getElementById("video-container");
const liveBadge = document.getElementById("live-badge");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const chatMessages = document.getElementById("chat-messages");
const unlockOverlay = document.getElementById("unlock-overlay");
const unlockButton = document.getElementById("unlock-button");
const logoutButton = document.getElementById("logout-button");
const userNameEl = document.getElementById("user-name");

// ---- Auth guard ----
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  currentUser = user;
  idToken = await user.getIdToken();
  if (userNameEl) userNameEl.textContent = user.displayName || user.email;

  // Firebase ID tokens expire hourly — refresh before that happens.
  setInterval(async () => {
    idToken = await user.getIdToken(true);
  }, 50 * 60 * 1000);

  listenToUserDoc(user.uid);
  initLiveKit();
});

function listenToUserDoc(uid) {
  onSnapshot(doc(db, "users", uid), (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    toggleUnlockOverlay(!data.paid);
  });
}

function toggleUnlockOverlay(show) {
  unlockOverlay?.classList.toggle("visible", show);
}

logoutButton?.addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "index.html";
});

// ---- LiveKit ----
async function initLiveKit() {
  try {
    const res = await fetch("/api/generate-livekit-token.php", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ room: LIVEKIT_ROOM_NAME }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Token request failed (${res.status})`);
    }
    const { token, url } = await res.json();

    const { Room, RoomEvent, Track } = LivekitClient;
    liveKitRoom = new Room({ adaptiveStream: true, dynacast: true });

    liveKitRoom.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === Track.Kind.Video || track.kind === Track.Kind.Audio) {
        const el = track.attach();
        el.classList.add(track.kind === Track.Kind.Video ? "lk-video" : "lk-audio");
        videoContainer.innerHTML = ""; // clear the placeholder text
        videoContainer.appendChild(el);
      }
    });

    liveKitRoom.on(RoomEvent.TrackUnsubscribed, (track) => {
      track.detach().forEach((el) => el.remove());
    });

    liveKitRoom.on(RoomEvent.ParticipantConnected, (participant) => {
      activeParticipants.add(participant.identity);
      setLiveStatus(true);
    });

    liveKitRoom.on(RoomEvent.ParticipantDisconnected, (participant) => {
      activeParticipants.delete(participant.identity);
      setLiveStatus(activeParticipants.size > 0);
    });

    liveKitRoom.on(RoomEvent.Disconnected, () => setLiveStatus(false));

    await liveKitRoom.connect(url, token);

    // Account for a teacher who was already streaming before this student joined.
    const existing = liveKitRoom.remoteParticipants
      ? Array.from(liveKitRoom.remoteParticipants.values())
      : [];
    existing.forEach((p) => activeParticipants.add(p.identity));
    setLiveStatus(activeParticipants.size > 0);
  } catch (err) {
    console.error("LiveKit connection failed:", err);
    showStreamError("Unable to connect to the live class. Please refresh the page.");
  }
}

function setLiveStatus(isLive) {
  if (!liveBadge) return;
  liveBadge.textContent = isLive ? "LIVE" : "Waiting for teacher…";
  liveBadge.classList.toggle("is-live", isLive);
}

function showStreamError(message) {
  if (!videoContainer) return;
  videoContainer.innerHTML = `<p class="stream-error">${message}</p>`;
}

// ---- AI Study Librarian (Groq) ----
chatForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const question = chatInput.value.trim();
  if (!question) return;

  appendChatMessage("user", question);
  chatInput.value = "";
  const typingBubble = appendChatMessage("ai", "…", true);

  try {
    const res = await fetch("/api/ask-librarian.php", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ prompt: question }),
    });
    const data = await res.json();
    typingBubble.remove();

    if (!res.ok) {
      appendChatMessage("ai", data.error || "The librarian is unavailable right now. Try again shortly.");
      return;
    }
    appendChatMessage("ai", data.reply);
  } catch (err) {
    console.error("Librarian request failed:", err);
    typingBubble.remove();
    appendChatMessage("ai", "Something went wrong reaching the librarian. Check your connection and try again.");
  }
});

function appendChatMessage(sender, text, isTyping = false) {
  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${sender}${isTyping ? " typing" : ""}`;
  bubble.textContent = text;
  chatMessages.appendChild(bubble);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return bubble;
}

// ---- Paystack ----
unlockButton?.addEventListener("click", () => {
  if (!currentUser) return;

  const handler = PaystackPop.setup({
    key: PAYSTACK_PUBLIC_KEY,
    email: currentUser.email,
    amount: COURSE_PRICE_KOBO,
    currency: "NGN",
    ref: `SCHOLACORE-${currentUser.uid}-${Date.now()}`,
    metadata: { uid: currentUser.uid },
    callback: (response) => verifyPayment(response.reference),
    onClose: () => console.log("Payment window closed"),
  });
  handler.openIframe();
});

async function verifyPayment(reference) {
  try {
    const res = await fetch("/api/verify-payment.php", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ reference }),
    });
    const data = await res.json();

    if (res.ok && data.verified) {
      toggleUnlockOverlay(false);
    } else {
      alert(
        (data.error || "Payment could not be verified.") +
          `\nReference: ${reference} (contact support if you were charged)`
      );
    }
  } catch (err) {
    console.error("Payment verification failed:", err);
    alert(`Could not confirm payment. Contact support with your reference: ${reference}`);
  }
}
