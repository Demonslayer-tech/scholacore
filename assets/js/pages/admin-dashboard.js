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
  addDoc,
  collection,
  query,
  where,
  orderBy,
  getDocs,
  Timestamp,
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
      .map((url, i) => '<a href="' + url + '" target="_blank" rel="noopener" style="color:#C9A227;text-decoration:underline;">Doc ' + (i + 1) + '</a>')
      .join(' &middot; ');

    const row = document.createElement('tr');
    row.innerHTML =
      '<td>' + d.fullName + '<br><span style="color:#A9B7CC;font-size:0.75rem;">' + d.email + '</span></td>' +
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
  await loadTeacherOptions();
}

let approvedTeachers = [];

async function loadTeacherOptions() {
  const select = el('scheduleTeacher');
  const usersQuery = query(collection(db, 'users'), where('role', '==', 'teacher'));
  const usersSnap = await getDocs(usersQuery);

  approvedTeachers = [];
  for (const userSnap of usersSnap.docs) {
    const teacherSnap = await getDoc(doc(db, 'teachers', userSnap.id));
    const teacherData = teacherSnap.data();
    if (teacherData && teacherData.status === 'approved') {
      approvedTeachers.push({ id: userSnap.id, name: userSnap.data().fullName || userSnap.id });
    }
  }

  if (approvedTeachers.length === 0) {
    select.innerHTML = '<option value="">No approved teachers yet</option>';
    return;
  }
  select.innerHTML = approvedTeachers
    .map((t) => '<option value="' + t.id + '">' + t.name + '</option>')
    .join('');
}

const recordingBadgeMap = {
  recording: 'approved',
  processing: 'pending',
  ended: 'approved'
};

async function loadSchedules() {
  const body = el('schedules-body');
  const schedulesQuery = query(collection(db, 'schedules'), orderBy('startTime', 'desc'));
  const snap = await getDocs(schedulesQuery);

  if (snap.empty) {
    body.innerHTML = "<tr><td colspan='5'>No classes scheduled yet.</td></tr>";
    return;
  }

  body.innerHTML = '';
  snap.forEach((docSnap) => {
    const d = docSnap.data();
    const teacher = approvedTeachers.find((t) => t.id === d.teacherId);
    const recordingCell = d.recordingUrl
      ? '<a href="' + d.recordingUrl + '" target="_blank" rel="noopener" style="color:#C9A227;text-decoration:underline;">View</a>'
      : (d.recordingStatus
        ? '<span class="sc-badge sc-badge--' + (recordingBadgeMap[d.recordingStatus] || 'pending') + '">' + d.recordingStatus + '</span>'
        : '&mdash;');

    const row = document.createElement('tr');
    row.innerHTML =
      '<td>' + (d.subjectName || '') + '</td>' +
      '<td>' + (teacher ? teacher.name : (d.teacherId || '')) + '</td>' +
      '<td>' + (d.startTime && d.startTime.toDate ? d.startTime.toDate().toLocaleString() : '') + '</td>' +
      '<td>' + (d.status || 'scheduled') + '</td>' +
      '<td>' + recordingCell + '</td>';
    body.appendChild(row);
  });
}

const scheduleForm = el('schedule-form');
const scheduleAlert = el('schedule-alert');

scheduleForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const subjectName = el('scheduleSubject').value.trim();
  const teacherId = el('scheduleTeacher').value;
  const startValue = el('scheduleStart').value;
  const endValue = el('scheduleEnd').value;

  if (!teacherId) {
    showAlert(scheduleAlert, 'Select a teacher.', 'error');
    return;
  }
  const startDate = new Date(startValue);
  const endDate = new Date(endValue);
  if (endDate <= startDate) {
    showAlert(scheduleAlert, 'End time must be after start time.', 'error');
    return;
  }

  try {
    await addDoc(collection(db, 'schedules'), {
      subjectName,
      teacherId,
      startTime: Timestamp.fromDate(startDate),
      endTime: Timestamp.fromDate(endDate),
      status: 'scheduled',
      createdAt: serverTimestamp()
    });
    showAlert(scheduleAlert, 'Class scheduled.', 'success');
    scheduleForm.reset();
    await loadSchedules();
  } catch (err) {
    showAlert(scheduleAlert, err && err.message ? err.message : 'Could not create class.', 'error');
  }
});

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
  await loadTeacherOptions();
  await loadSchedules();
});
