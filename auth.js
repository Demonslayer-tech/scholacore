// auth.js
// Connects the existing index.html login/signup card to Firebase Authentication.
//
// ASSUMED MARKUP — adjust the ELEMENT_IDS below (or your HTML) so they line up:
//   <form id="login-form">
//     <input id="login-email" type="email">
//     <input id="login-password" type="password">
//     <p id="login-error"></p>
//     <button type="submit">...</button>
//   </form>
//   <form id="signup-form">
//     <input id="signup-name" type="text">
//     <input id="signup-email" type="email">
//     <input id="signup-password" type="password">
//     <input id="signup-confirm-password" type="password">
//     <p id="signup-error"></p>
//     <button type="submit">...</button>
//   </form>
//   <button id="show-signup">...</button>   <!-- toggles to the signup panel -->
//   <button id="show-login">...</button>    <!-- toggles to the login panel -->
//   <div id="auth-card" class="glass-panel">...</div>  <!-- gets .signup-active toggled -->

import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const DASHBOARD_URL = "dashboard.html";

// ---- DOM refs (null-safe: code below no-ops if an element isn't found) ----
const loginForm = document.getElementById("login-form");
const loginEmailInput = document.getElementById("login-email");
const loginPasswordInput = document.getElementById("login-password");
const loginError = document.getElementById("login-error");

const signupForm = document.getElementById("signup-form");
const signupNameInput = document.getElementById("signup-name");
const signupEmailInput = document.getElementById("signup-email");
const signupPasswordInput = document.getElementById("signup-password");
const signupConfirmInput = document.getElementById("signup-confirm-password");
const signupError = document.getElementById("signup-error");

const showSignupBtn = document.getElementById("show-signup");
const showLoginBtn = document.getElementById("show-login");
const authCard = document.getElementById("auth-card");

// ---- Panel toggle ----
showSignupBtn?.addEventListener("click", () => {
  authCard?.classList.add("signup-active");
  clearErrors();
});
showLoginBtn?.addEventListener("click", () => {
  authCard?.classList.remove("signup-active");
  clearErrors();
});

function clearErrors() {
  if (loginError) loginError.textContent = "";
  if (signupError) signupError.textContent = "";
}

function setLoading(form, isLoading) {
  const button = form?.querySelector('button[type="submit"]');
  if (!button) return;
  button.disabled = isLoading;
  button.dataset.originalText ??= button.textContent;
  button.textContent = isLoading ? "Please wait…" : button.dataset.originalText;
}

// ---- Firebase error -> human-readable message ----
function friendlyErrorMessage(error) {
  switch (error.code) {
    case "auth/email-already-in-use":
      return "That email is already registered. Try logging in instead.";
    case "auth/invalid-email":
      return "Enter a valid email address.";
    case "auth/weak-password":
      return "Password must be at least 6 characters.";
    case "auth/user-not-found":
    case "auth/invalid-credential":
    case "auth/wrong-password":
      return "Incorrect email or password.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a moment and try again.";
    case "auth/network-request-failed":
      return "Network error — check your connection and try again.";
    default:
      return "Something went wrong. Please try again.";
  }
}

// ---- Signup ----
signupForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearErrors();

  const name = signupNameInput?.value.trim() ?? "";
  const email = signupEmailInput?.value.trim() ?? "";
  const password = signupPasswordInput?.value ?? "";
  const confirmPassword = signupConfirmInput?.value ?? "";

  if (!name || !email || !password) {
    if (signupError) signupError.textContent = "Fill in every field to continue.";
    return;
  }
  if (password.length < 6) {
    if (signupError) signupError.textContent = "Password must be at least 6 characters.";
    return;
  }
  if (signupConfirmInput && password !== confirmPassword) {
    if (signupError) signupError.textContent = "Passwords don't match.";
    return;
  }

  setLoading(signupForm, true);
  try {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(credential.user, { displayName: name });

    // Seed the student's Firestore profile. `paid` gates full course access
    // (see the Paystack unlock flow in app.js / verify-payment.php).
    await setDoc(doc(db, "users", credential.user.uid), {
      name,
      email,
      role: "student",
      paid: false,
      createdAt: serverTimestamp(),
    });

    window.location.href = DASHBOARD_URL;
  } catch (error) {
    console.error("Signup failed:", error);
    if (signupError) signupError.textContent = friendlyErrorMessage(error);
  } finally {
    setLoading(signupForm, false);
  }
});

// ---- Login ----
loginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearErrors();

  const email = loginEmailInput?.value.trim() ?? "";
  const password = loginPasswordInput?.value ?? "";

  if (!email || !password) {
    if (loginError) loginError.textContent = "Enter your email and password.";
    return;
  }

  setLoading(loginForm, true);
  try {
    await signInWithEmailAndPassword(auth, email, password);
    window.location.href = DASHBOARD_URL;
  } catch (error) {
    console.error("Login failed:", error);
    if (loginError) loginError.textContent = friendlyErrorMessage(error);
  } finally {
    setLoading(loginForm, false);
  }
});

// ---- Already logged in? Skip straight to the dashboard. ----
onAuthStateChanged(auth, (user) => {
  if (user && !window.location.pathname.endsWith(DASHBOARD_URL)) {
    window.location.href = DASHBOARD_URL;
  }
});
