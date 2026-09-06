import '../style.css';
import { auth, db } from '../firebase';
import { initTelegramWebApp, showAlert } from '../telegram';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, getDoc, collection, query, where, orderBy, getDocs } from 'firebase/firestore';
import type { UserDoc, TeacherDoc, ScheduleDoc } from '../types';

initTelegramWebApp();

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

onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  const userSnap = await getDoc(doc(db, 'users', user.uid));
  const userData = userSnap.data() as UserDoc | undefined;

  if (!userSnap.exists() || userData?.role !== 'teacher') {
    showAlert(loginAlert, 'This account is not registered as a teacher.', 'error');
    await signOut(auth);
    return;
  }

  const teacherSnap = await getDoc(doc(db, 'teachers', user.uid));
  const teacherData = teacherSnap.data() as TeacherDoc | undefined;
  const status = teacherData?.status ?? 'pending_vetting';

  el<HTMLDivElement>('login-card').classList.add('hidden');

  if (status === 'pending_vetting') {
    el<HTMLDivElement>('pending-card').classList.remove('hidden');
    return;
  }
  if (status === 'rejected') {
    el<HTMLDivElement>('rejected-card').classList.remove('hidden');
    return;
  }

  const portalCard = el<HTMLDivElement>('portal-card');
  portalCard.classList.remove('hidden');
  el<HTMLSpanElement>('teacher-name').textContent = userData?.fullName ?? '';

  const scheduleBody = el<HTMLTableSectionElement>('schedule-body');
  const scheduleQuery = query(
    collection(db, 'schedules'),
    where('teacherId', '==', user.uid),
    orderBy('startTime', 'asc')
  );
  const scheduleSnap = await getDocs(scheduleQuery);

  if (scheduleSnap.empty) {
    scheduleBody.innerHTML = "<tr><td colspan='4'>No classes scheduled yet.</td></tr>";
  } else {
    scheduleBody.innerHTML = '';
    scheduleSnap.forEach((docSnap) => {
      const d = docSnap.data() as ScheduleDoc;
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${d.subjectName}</td>
        <td>${d.startTime.toDate().toLocaleString()}</td>
        <td>${d.endTime.toDate().toLocaleString()}</td>
        <td><a href="/classroom.html?schedule=${docSnap.id}" class="sc-btn sc-btn--secondary inline-block w-auto m-0 px-3 py-1.5">Start Class</a></td>
      `;
      scheduleBody.appendChild(row);
    });
  }
});
