import { auth } from '/api/firebase-config.php';
import { PAYSTACK_PUBLIC_KEY } from '/api/paystack-config.php';
import { initTelegramWebApp, showAlert } from '/assets/js/telegram.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

initTelegramWebApp();

function el(id) {
  const found = document.getElementById(id);
  if (!found) throw new Error('Missing element #' + id);
  return found;
}

const payCard = el('pay-card');
const loginRequiredCard = el('login-required-card');
const payBtn = el('pay-btn');
const alertEl = el('alert');

let currentUid = null;
let currentEmail = null;

onAuthStateChanged(auth, (user) => {
  if (!user || !user.email) {
    payCard.classList.add('hidden');
    loginRequiredCard.classList.remove('hidden');
    return;
  }
  currentUid = user.uid;
  currentEmail = user.email;
});

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
