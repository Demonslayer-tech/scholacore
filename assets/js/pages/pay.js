import { auth, db } from '/api/firebase-config.php';
import { PAYSTACK_PUBLIC_KEY } from '/api/paystack-config.php';
import { initTelegramWebApp, showAlert } from '/assets/js/telegram.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  doc,
  getDoc,
  collection,
  query,
  orderBy,
  getDocs
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

initTelegramWebApp();

function el(id) {
  const found = document.getElementById(id);
  if (!found) throw new Error('Missing element #' + id);
  return found;
}

const loadingCard = el('loading-card');
const payCard = el('pay-card');
const loginRequiredCard = el('login-required-card');
const classesCard = el('classes-card');
const payBtn = el('pay-btn');
const alertEl = el('alert');

let currentUid = null;
let currentEmail = null;

function showOnly(card) {
  [loadingCard, payCard, loginRequiredCard, classesCard].forEach((c) => c.classList.add('hidden'));
  card.classList.remove('hidden');
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    showOnly(loginRequiredCard);
    return;
  }
  currentUid = user.uid;

  const userSnap = await getDoc(doc(db, 'users', user.uid));
  const userData = userSnap.data() || {};

  // Telegram sign-in (custom token) doesn't carry an email -- Paystack
  // still needs one, so fall back to a synthetic address tied to the
  // account. It's never shown to the student; it's only Paystack's
  // receipt/lookup field.
  currentEmail = user.email || userData.email || (user.uid + '@telegram.scholacore.ng');

  if (userData.paymentStatus === 'active_paid') {
    showOnly(classesCard);
    await loadClasses();
  } else {
    showOnly(payCard);
  }
});

async function loadClasses() {
  const body = el('classes-body');
  const schedulesQuery = query(collection(db, 'schedules'), orderBy('startTime', 'asc'));
  const snap = await getDocs(schedulesQuery);

  if (snap.empty) {
    body.innerHTML = "<tr><td colspan='4'>No classes scheduled yet.</td></tr>";
    return;
  }

  body.innerHTML = '';
  snap.forEach((docSnap) => {
    const d = docSnap.data();
    const row = document.createElement('tr');
    row.innerHTML =
      '<td>' + d.subjectName + '</td>' +
      '<td>' + d.startTime.toDate().toLocaleString() + '</td>' +
      '<td>' + d.endTime.toDate().toLocaleString() + '</td>' +
      '<td><a href="/classroom.html?schedule=' + docSnap.id + '" class="sc-btn sc-btn--secondary sc-btn--inline">Join Class</a></td>';
    body.appendChild(row);
  });
}

payBtn.addEventListener('click', () => {
  if (!currentUid || !currentEmail) {
    showAlert(alertEl, 'Please sign in first.', 'error');
    return;
  }

  if (!PAYSTACK_PUBLIC_KEY) {
    showAlert(alertEl, 'Payments are not configured yet.', 'error');
    return;
  }

  const nairaAmount = Number(el('amount').value);
  if (!nairaAmount || nairaAmount < 500) {
    showAlert(alertEl, 'Enter a valid amount.', 'error');
    return;
  }

  const handler = window.PaystackPop.setup({
    key: PAYSTACK_PUBLIC_KEY,
    email: currentEmail,
    amount: Math.round(nairaAmount * 100), // Paystack expects kobo
    metadata: { studentUid: currentUid },
    callback: function () {
      // api/paystack-webhook.php (server-side) is the source of truth for
      // marking the student as paid; this callback only tells the student
      // their payment went through, it does not itself grant access.
      showAlert(
        alertEl,
        'Payment received! Your class group invite will arrive on Telegram shortly.',
        'success'
      );
    },
    onClose: function () {
      showAlert(alertEl, 'Payment window closed.', 'error');
    }
  });

  handler.openIframe();
});
