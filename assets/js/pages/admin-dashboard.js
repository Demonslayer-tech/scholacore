import { auth, db } from '/api/firebase-config.php';
import { showAlert } from '/assets/js/telegram.js';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  doc,
  getDoc,
  updateDoc,
  collection,
  query,
  orderBy,
  getDocs,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

function el(id) {
  const found = document.getElementById(id);
  if (!found) throw new Error('Missing element #' + id);
  return found;
}

const loginAlert = el('login-alert');
const loginForm = el('login-form');

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = el('email').value.trim();
  const password = el('password').value;
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    showAlert(loginAlert, err && err.message ? err.message : 'Log in failed', 'error');
  }
});

const badgeMap = { pending_vetting: 'pending', approved: 'approved', rejected: 'rejected' };

function badgeFor(status) {
  const label = status.replace('_', ' ');
  return '<span class="sc-badge sc-badge--' + (badgeMap[status] || 'pending') + '">' + label + '</span>';
}

async function loadApplications() {
  const body = el('applications-body');
  const applicationsQuery = query(collection(db, 'teachers'), orderBy('status'));
  const snap = await getDocs(applicationsQuery);

  if (snap.empty) {
    body.innerHTML = "<tr><td colspan='6'>No applications yet.</td></tr>";
    return;
  }

  body.innerHTML = '';
  snap.forEach((docSnap) => {
    const d = docSnap.data();
    const docsLinks = (d.verificationDocUrls || [])
      .map((url, i) => '<a href="' + url + '" target="_blank" rel="noopener" style="color:#0F52BA;text-decoration:underline;">Doc ' + (i + 1) + '</a>')
      .join(' &middot; ');

    const row = document.createElement('tr');
    row.innerHTML =
      '<td>' + d.fullName + '<br><span style="color:#94A3B8;font-size:0.75rem;">' + d.email + '</span></td>' +
      '<td>' + (d.subjectSpecializations || []).join(', ') + '</td>' +
      '<td>' + (d.credentialsSummary || '') + '</td>' +
      '<td>' + (docsLinks || 'None uploaded') + '</td>' +
      '<td>' + badgeFor(d.status) + '</td>' +
      '<td>' +
        '<button class="sc-btn sc-btn--secondary sc-btn--inline" data-approve="' + docSnap.id + '">Approve</button>' +
        '<button class="sc-btn sc-btn--secondary sc-btn--inline" style="color:#B91C1C;border-color:#B91C1C;" data-reject="' + docSnap.id + '">Reject</button>' +
      '</td>';
    body.appendChild(row);
  });

  body.querySelectorAll('[data-approve]').forEach((btn) => {
    btn.addEventListener('click', () => setStatus(btn.dataset.approve, 'approved'));
  });
  body.querySelectorAll('[data-reject]').forEach((btn) => {
    btn.addEventListener('click', () => setStatus(btn.dataset.reject, 'rejected'));
  });
}

async function setStatus(teacherId, status) {
  const adminUid = auth.currentUser ? auth.currentUser.uid : null;
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
  const userData = userSnap.data();

  if (!userSnap.exists() || !userData || userData.role !== 'admin') {
    showAlert(loginAlert, 'This account does not have admin access.', 'error');
    await signOut(auth);
    return;
  }

  el('login-card').classList.add('hidden');
  el('dashboard-card').classList.remove('hidden');
  await loadApplications();
});
