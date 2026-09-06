import '../style.css';
import { auth, db } from '../firebase';
import { showAlert } from '../telegram';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import {
  doc,
  getDoc,
  updateDoc,
  collection,
  query,
  orderBy,
  getDocs,
  serverTimestamp
} from 'firebase/firestore';
import type { UserDoc, TeacherDoc, TeacherStatus } from '../types';

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element #${id}`);
  return found as T;
}

const loginAlert = el<HTMLDivElement>('login-alert');
const loginForm = el<HTMLFormElement>('login-form');

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = el<HTMLInputElement>('email').value.trim();
  const password = el<HTMLInputElement>('password').value;
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    showAlert(loginAlert, err instanceof Error ? err.message : 'Log in failed', 'error');
  }
});

function badgeFor(status: TeacherStatus): string {
  const map: Record<TeacherStatus, string> = {
    pending_vetting: 'pending',
    approved: 'approved',
    rejected: 'rejected'
  };
  const label = status.replace('_', ' ');
  return `<span class="sc-badge sc-badge--${map[status]}">${label}</span>`;
}

async function loadApplications(): Promise<void> {
  const body = el<HTMLTableSectionElement>('applications-body');
  const applicationsQuery = query(collection(db, 'teachers'), orderBy('status'));
  const snap = await getDocs(applicationsQuery);

  if (snap.empty) {
    body.innerHTML = "<tr><td colspan='6'>No applications yet.</td></tr>";
    return;
  }

  body.innerHTML = '';
  snap.forEach((docSnap) => {
    const d = docSnap.data() as TeacherDoc;
    const docsLinks = d.verificationDocUrls
      .map((url, i) => `<a href="${url}" target="_blank" rel="noopener" class="text-sc-blue-dark underline">Doc ${i + 1}</a>`)
      .join(' · ');

    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${d.fullName}<br><span class="text-slate-400 text-xs">${d.email}</span></td>
      <td>${d.subjectSpecializations.join(', ')}</td>
      <td>${d.credentialsSummary}</td>
      <td>${docsLinks || '—'}</td>
      <td>${badgeFor(d.status)}</td>
      <td>
        <button class="sc-btn sc-btn--secondary inline-block w-auto m-0 mr-1 px-2.5 py-1.5" data-approve="${docSnap.id}">Approve</button>
        <button class="sc-btn sc-btn--secondary inline-block w-auto m-0 px-2.5 py-1.5 text-red-700 border-red-700" data-reject="${docSnap.id}">Reject</button>
      </td>
    `;
    body.appendChild(row);
  });

  body.querySelectorAll<HTMLButtonElement>('[data-approve]').forEach((btn) => {
    btn.addEventListener('click', () => setStatus(btn.dataset.approve as string, 'approved'));
  });
  body.querySelectorAll<HTMLButtonElement>('[data-reject]').forEach((btn) => {
    btn.addEventListener('click', () => setStatus(btn.dataset.reject as string, 'rejected'));
  });
}

async function setStatus(teacherId: string, status: TeacherStatus): Promise<void> {
  const adminUid = auth.currentUser?.uid;
  if (!adminUid) return;
  await updateDoc(doc(db, 'teachers', teacherId), {
    status,
    reviewedBy: adminUid,
    reviewedAt: serverTimestamp()
  });
  await loadApplications();
}

onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  const userSnap = await getDoc(doc(db, 'users', user.uid));
  const userData = userSnap.data() as UserDoc | undefined;

  if (!userSnap.exists() || userData?.role !== 'admin') {
    showAlert(loginAlert, 'This account does not have admin access.', 'error');
    await signOut(auth);
    return;
  }

  el<HTMLDivElement>('login-card').classList.add('hidden');
  el<HTMLDivElement>('dashboard-card').classList.remove('hidden');
  await loadApplications();
});
