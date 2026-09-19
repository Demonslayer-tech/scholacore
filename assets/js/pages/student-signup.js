import { auth, db } from '/api/firebase-config.php';
import { initTelegramWebApp, showAlert } from '/assets/js/telegram.js';
import {
  createUserWithEmailAndPassword,
  sendEmailVerification
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

const signupCard = el('signup-card');
const verifyCard = el('verify-card');
const alertEl = el('alert');
const signupForm = el('signup-form');
const submitBtn = el('submit-btn');

signupForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const fullName = el('fullName').value.trim();
  const gradeLevel = el('gradeLevel').value;
  const email = el('email').value.trim();
  const phone = el('phone').value.trim();
  const password = el('password').value;
  const confirmPassword = el('confirmPassword').value;

  if (password !== confirmPassword) {
    showAlert(alertEl, 'Passwords do not match.', 'error');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Creating account...';

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await setDoc(doc(db, 'users', cred.user.uid), {
      fullName,
      email,
      phone,
      role: 'student',
      gradeLevel,
      paymentStatus: 'unpaid',
      telegramUserId: tgUser ? String(tgUser.id) : null,
      aiQueryCount: 0,
      createdAt: serverTimestamp()
    });
    await sendEmailVerification(cred.user);

    el('verify-email').textContent = email;
    signupCard.classList.add('hidden');
    verifyCard.classList.remove('hidden');
  } catch (err) {
    showAlert(alertEl, err && err.message ? err.message : 'Sign-up failed', 'error');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Create Account';
  }
});

el('resend-btn').addEventListener('click', async () => {
  const verifyAlert = el('verify-alert');
  if (!auth.currentUser) {
    showAlert(verifyAlert, 'Please log in first to resend the email.', 'error');
    return;
  }
  try {
    await sendEmailVerification(auth.currentUser);
    showAlert(verifyAlert, 'Verification email resent.', 'success');
  } catch (err) {
    showAlert(verifyAlert, err && err.message ? err.message : 'Could not resend email.', 'error');
  }
});
