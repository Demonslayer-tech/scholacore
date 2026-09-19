import { auth, db } from '/api/firebase-config.php';
import { initTelegramWebApp, showAlert } from '/assets/js/telegram.js';
import {
  signInWithEmailAndPassword,
  sendEmailVerification,
  signOut
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

initTelegramWebApp();

function el(id) {
  const found = document.getElementById(id);
  if (!found) throw new Error('Missing element #' + id);
  return found;
}

const loginCard = el('login-card');
const verifyCard = el('verify-card');
const alertEl = el('alert');
const loginForm = el('login-form');
const submitBtn = el('submit-btn');

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = el('email').value.trim();
  const password = el('password').value;

  submitBtn.disabled = true;
  submitBtn.textContent = 'Logging in...';

  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);

    if (!cred.user.emailVerified) {
      el('verify-email').textContent = email;
      loginCard.classList.add('hidden');
      verifyCard.classList.remove('hidden');
      return;
    }

    const userSnap = await getDoc(doc(db, 'users', cred.user.uid));
    const userData = userSnap.data();
    if (!userSnap.exists() || !userData || userData.role !== 'student') {
      showAlert(alertEl, 'This account is not registered as a student.', 'error');
      await signOut(auth);
      return;
    }

    window.location.href = '/pay.html';
  } catch (err) {
    showAlert(alertEl, err && err.message ? err.message : 'Log in failed', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Log In';
  }
});

el('resend-btn').addEventListener('click', async () => {
  const verifyAlert = el('verify-alert');
  if (!auth.currentUser) {
    showAlert(verifyAlert, 'Session expired, please log in again.', 'error');
    return;
  }
  try {
    await sendEmailVerification(auth.currentUser);
    showAlert(verifyAlert, 'Verification email resent.', 'success');
  } catch (err) {
    showAlert(verifyAlert, err && err.message ? err.message : 'Could not resend email.', 'error');
  }
});
