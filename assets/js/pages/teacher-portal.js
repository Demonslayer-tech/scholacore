import { auth, db } from '/api/firebase-config.php';
import { initTelegramWebApp, showAlert } from '/assets/js/telegram.js';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  orderBy,
  getDocs
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

initTelegramWebApp();

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

onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  const userSnap = await getDoc(doc(db, 'users', user.uid));
  const userData = userSnap.data();

  if (!userSnap.exists() || !userData || userData.role !== 'teacher') {
    showAlert(loginAlert, 'This account is not registered as a teacher.', 'error');
    await signOut(auth);
    return;
  }

  const teacherSnap = await getDoc(doc(db, 'teachers', user.uid));
  const teacherData = teacherSnap.data();
  const status = (teacherData && teacherData.status) || 'pending_vetting';

  el('login-card').classList.add('hidden');

  if (status === 'pending_vetting') {
    el('pending-card').classList.remove('hidden');
    return;
  }
  if (status === 'rejected') {
    el('rejected-card').classList.remove('hidden');
    return;
  }

  el('portal-card').classList.remove('hidden');
  el('teacher-name').textContent = userData.fullName || '';

  const scheduleBody = el('schedule-body');
  const scheduleQuery = query(
    collection(db, 'schedules'),
    where('teacherId', '==', user.uid),
    orderBy('startTime', 'asc')
  );
  const scheduleSnap = await getDocs(scheduleQuery);

  if (scheduleSnap.empty) {
    scheduleBody.innerHTML = "<tr><td colspan='5'>No classes scheduled yet.</td></tr>";
  } else {
    scheduleBody.innerHTML = '';
    scheduleSnap.forEach((docSnap) => {
      const d = docSnap.data();
      const recordingCell = d.recordingUrl
        ? '<a href="' + d.recordingUrl + '" target="_blank" rel="noopener" style="color:#C9A227;text-decoration:underline;">View</a>'
        : (d.recordingStatus || '&mdash;');
      const row = document.createElement('tr');
      row.innerHTML =
        '<td>' + d.subjectName + '</td>' +
        '<td>' + d.startTime.toDate().toLocaleString() + '</td>' +
        '<td>' + d.endTime.toDate().toLocaleString() + '</td>' +
        '<td>' + recordingCell + '</td>' +
        '<td><a href="/classroom.html?schedule=' + docSnap.id + '" class="sc-btn sc-btn--secondary sc-btn--inline">Start Class</a></td>';
      scheduleBody.appendChild(row);
    });
  }
});
