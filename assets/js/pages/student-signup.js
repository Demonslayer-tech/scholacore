import { auth, db } from '/api/firebase-config.php';
import { initTelegramWebApp, showAlert } from '/assets/js/telegram.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  doc,
  setDoc,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const tgUser = initTelegramWebApp();

function el(id) {
  const found = document.getElementById(id);
  if (!found) throw new Error('Missing element #' + id);
  return found;
}

const alertEl = el('alert');
const signupForm = el('signup-form');
const loginForm = el('login-form');
const showLoginLink = el('show-login');

showLoginLink.addEventListener('click', (e) => {
  e.preventDefault();
  signupForm.classList.add('hidden');
  loginForm.classList.remove('hidden');
});

signupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fullName = el('fullName').value.trim();
  const gradeLevel = el('gradeLevel').value;
  const email = el('email').value.trim();
  const password = el('password').value;

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await setDoc(doc(db, 'users', cred.user.uid), {
      fullName,
      email,
      role: 'student',
      gradeLevel,
      paymentStatus: 'unpaid',
      telegramUserId: tgUser ? String(tgUser.id) : null,
      aiQueryCount: 0,
      createdAt: serverTimestamp()
    });
    showAlert(alertEl, 'Account created. Redirecting...', 'success');
    window.location.href = '/pay.html';
  } catch (err) {
    showAlert(alertEl, err && err.message ? err.message : 'Sign-up failed', 'error');
  }
});

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = el('loginEmail').value.trim();
  const password = el('loginPassword').value;
  try {
    await signInWithEmailAndPassword(auth, email, password);
    window.location.href = '/pay.html';
  } catch (err) {
    showAlert(alertEl, err && err.message ? err.message : 'Log in failed', 'error');
  }
});
