import '../style.css';
import { auth, db, storage } from '../firebase';
import { initTelegramWebApp, showAlert } from '../telegram';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import type { UserDoc, TeacherDoc } from '../types';

initTelegramWebApp();

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element #${id}`);
  return found as T;
}

const alertEl = el<HTMLDivElement>('alert');
const form = el<HTMLFormElement>('vetting-form');
const submitBtn = el<HTMLButtonElement>('submit-btn');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  submitBtn.disabled = true;
  submitBtn.textContent = 'Submitting…';

  const fullName = el<HTMLInputElement>('fullName').value.trim();
  const email = el<HTMLInputElement>('email').value.trim();
  const password = el<HTMLInputElement>('password').value;
  const subjects = el<HTMLInputElement>('subjects').value
    .split(',').map((s) => s.trim()).filter(Boolean);
  const credentialsSummary = el<HTMLInputElement>('credentials').value.trim();
  const fileInput = el<HTMLInputElement>('docs');
  const files = fileInput.files ? Array.from(fileInput.files) : [];

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const uid = cred.user.uid;

    const uploadedUrls: string[] = [];
    for (const file of files) {
      const storageRef = ref(storage, `teacher-verifications/${uid}/${Date.now()}_${file.name}`);
      const snap = await uploadBytes(storageRef, file);
      uploadedUrls.push(await getDownloadURL(snap.ref));
    }

    const userDoc: UserDoc = {
      fullName,
      email,
      role: 'teacher',
      gradeLevel: null,
      paymentStatus: 'unpaid',
      telegramUserId: null,
      aiQueryCount: 0,
      createdAt: serverTimestamp()
    };
    await setDoc(doc(db, 'users', uid), userDoc);

    const teacherDoc: TeacherDoc = {
      fullName,
      email,
      credentialsSummary,
      subjectSpecializations: subjects,
      verificationDocUrls: uploadedUrls,
      status: 'pending_vetting',
      reviewedBy: null,
      reviewedAt: null
    };
    await setDoc(doc(db, 'teachers', uid), teacherDoc);

    showAlert(alertEl, "Application submitted. We'll email you once it's reviewed.", 'success');
    form.reset();
  } catch (err) {
    showAlert(alertEl, err instanceof Error ? err.message : 'Submission failed', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit Application';
  }
});
