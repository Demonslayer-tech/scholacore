import { auth, db, storage } from '/api/firebase-config.php';
import { initTelegramWebApp, showAlert } from '/assets/js/telegram.js';
import { createUserWithEmailAndPassword } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  doc,
  setDoc,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import {
  ref,
  uploadBytes,
  getDownloadURL
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js';

initTelegramWebApp();

function el(id) {
  const found = document.getElementById(id);
  if (!found) throw new Error('Missing element #' + id);
  return found;
}

const alertEl = el('alert');
const form = el('vetting-form');
const submitBtn = el('submit-btn');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  submitBtn.disabled = true;
  submitBtn.textContent = 'Submitting...';

  const fullName = el('fullName').value.trim();
  const email = el('email').value.trim();
  const password = el('password').value;
  const subjects = el('subjects').value.split(',').map((s) => s.trim()).filter(Boolean);
  const credentialsSummary = el('credentials').value.trim();
  const files = el('docs').files ? Array.from(el('docs').files) : [];

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const uid = cred.user.uid;

    const uploadedUrls = [];
    for (const file of files) {
      const storageRef = ref(storage, 'teacher-verifications/' + uid + '/' + Date.now() + '_' + file.name);
      const snap = await uploadBytes(storageRef, file);
      uploadedUrls.push(await getDownloadURL(snap.ref));
    }

    await setDoc(doc(db, 'users', uid), {
      fullName,
      email,
      role: 'teacher',
      gradeLevel: null,
      paymentStatus: 'unpaid',
      telegramUserId: null,
      aiQueryCount: 0,
      createdAt: serverTimestamp()
    });

    await setDoc(doc(db, 'teachers', uid), {
      fullName,
      email,
      credentialsSummary,
      subjectSpecializations: subjects,
      verificationDocUrls: uploadedUrls,
      status: 'pending_vetting',
      reviewedBy: null,
      reviewedAt: null
    });

    showAlert(alertEl, "Application submitted. We'll email you once it's reviewed, then you can log in.", 'success');
    form.reset();
  } catch (err) {
    showAlert(alertEl, err && err.message ? err.message : 'Submission failed', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit Application';
  }
});
