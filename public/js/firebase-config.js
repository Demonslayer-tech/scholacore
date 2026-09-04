// Loaded via Firebase compat CDN scripts on each page before this file.
// These values are safe to expose client-side (they are not secrets);
// real access control happens in firestore.rules / storage.rules.
const firebaseConfig = {
  apiKey: "__FIREBASE_API_KEY__",
  authDomain: "__FIREBASE_AUTH_DOMAIN__",
  projectId: "__FIREBASE_PROJECT_ID__",
  storageBucket: "__FIREBASE_STORAGE_BUCKET__",
  messagingSenderId: "__FIREBASE_MESSAGING_SENDER_ID__",
  appId: "__FIREBASE_APP_ID__"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

// Best-effort Telegram Mini App bootstrap. Safe to call outside Telegram.
function initTelegramWebApp() {
  try {
    if (window.Telegram && window.Telegram.WebApp) {
      window.Telegram.WebApp.ready();
      window.Telegram.WebApp.expand();
      return window.Telegram.WebApp.initDataUnsafe || null;
    }
  } catch (err) {
    console.warn("Telegram WebApp not available:", err);
  }
  return null;
}

function showAlert(el, message, type) {
  el.textContent = message;
  el.className = "sc-alert sc-alert--" + type;
  el.style.display = "block";
}
