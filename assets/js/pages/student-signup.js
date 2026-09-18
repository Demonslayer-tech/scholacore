import { auth, db } from '/api/firebase-config.php';
import { initTelegramWebApp, showAlert } from '/assets/js/telegram.js';
import { silentTelegramSignIn } from '/assets/js/telegram-auth.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  doc,
  setDoc,
  updateDoc,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

initTelegramWebApp();

function el(id) {
  const found = document.getElementById(id);
  if (!found) throw new Error('Missing element #' + id);
  return found;
}

const loadingCard = el('loading-card');
const gradeCard = el('grade-card');
const fallbackCard = el('fallback-card');

function showOnly(card) {
  [loadingCard, gradeCard, fallbackCard].forEach((c) => c.classList.add('hidden'));
  card.classList.remove('hidden');
}

async function boot() {
  try {
    const result = await silentTelegramSignIn();

    if (result === null) {
      // Not opened inside Telegram -- show the normal email/password flow.
      showOnly(fallbackCard);
      wireFallbackForms();
      return;
    }

    if (result.needsGradeLevel) {
      showOnly(gradeCard);
      wireGradeForm();
      return;
    }

    // Returning Telegram user with a complete profile: no interaction
    // needed at all, straight through.
    window.location.href = '/pay.html';
  } catch (err) {
    // Telegram context existed but verification failed server-side --
    // fall back to the form rather than stranding the user on a spinner.
    showOnly(fallbackCard);
    wireFallbackForms();
    showAlert(el('fallback-alert'), err && err.message ? err.message : 'Could not sign you in automatically.', 'error');
  }
}

function wireGradeForm() {
  const gradeForm = el('grade-form');
  const gradeAlert = el('grade-alert');
  gradeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const gradeLevel = el('gradeLevel').value;
    if (!auth.currentUser) {
      showAlert(gradeAlert, 'Session expired, please reopen the app.', 'error');
      return;
    }
    try {
      await updateDoc(doc(db, 'users', auth.currentUser.uid), { gradeLevel });
      window.location.href = '/pay.html';
    } catch (err) {
      showAlert(gradeAlert, err && err.message ? err.message : 'Could not save your grade.', 'error');
    }
  });
}

function wireFallbackForms() {
  const alertEl = el('fallback-alert');
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
    const gradeLevel = el('signupGradeLevel').value;
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
        telegramUserId: null,
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
}

boot();
