import { auth, db } from '/api/firebase-config.php';
import { initTelegramWebApp, showAlert } from '/assets/js/telegram.js';
import {
  signInWithEmailAndPassword,
  signOut
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

initTelegramWebApp();

function el(id) {
  const found = document.getElementById(id);
  if (!found) throw new Error('Missing element #' + id);
  return found;
}

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

    const userSnap = await getDoc(doc(db, 'users', cred.user.uid));
    const userData = userSnap.data();
    if (!userSnap.exists() || !userData || userData.role !== 'teacher') {
      showAlert(alertEl, 'This account is not registered as a teacher.', 'error');
      await signOut(auth);
      return;
    }

    window.location.href = '/teacher-portal.html';
  } catch (err) {
    showAlert(alertEl, err && err.message ? err.message : 'Log in failed', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Log In';
  }
});
