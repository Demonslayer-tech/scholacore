import '../style.css';
import { auth, db } from '../firebase';
import { initTelegramWebApp, showAlert } from '../telegram';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword
} from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import type { UserDoc } from '../types';

const tgUser = initTelegramWebApp();

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element #${id}`);
  return found as T;
}

const alertEl = el<HTMLDivElement>('alert');
const signupForm = el<HTMLFormElement>('signup-form');
const loginForm = el<HTMLFormElement>('login-form');
const showLoginLink = el<HTMLAnchorElement>('show-login');

showLoginLink.addEventListener('click', (e) => {
  e.preventDefault();
  signupForm.classList.add('hidden');
  loginForm.classList.remove('hidden');
});

signupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fullName = el<HTMLInputElement>('fullName').value.trim();
  const gradeLevel = el<HTMLSelectElement>('gradeLevel').value;
  const email = el<HTMLInputElement>('email').value.trim();
  const password = el<HTMLInputElement>('password').value;

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const userDoc: UserDoc = {
      fullName,
      email,
      role: 'student',
      gradeLevel,
      paymentStatus: 'unpaid',
      telegramUserId: tgUser ? String(tgUser.id) : null,
      aiQueryCount: 0,
      createdAt: serverTimestamp()
    };
    await setDoc(doc(db, 'users', cred.user.uid), userDoc);
    showAlert(alertEl, 'Account created. Redirecting…', 'success');
    window.location.href = '/index.html';
  } catch (err) {
    showAlert(alertEl, err instanceof Error ? err.message : 'Sign-up failed', 'error');
  }
});

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = el<HTMLInputElement>('loginEmail').value.trim();
  const password = el<HTMLInputElement>('loginPassword').value;
  try {
    await signInWithEmailAndPassword(auth, email, password);
    window.location.href = '/index.html';
  } catch (err) {
    showAlert(alertEl, err instanceof Error ? err.message : 'Log in failed', 'error');
  }
});
