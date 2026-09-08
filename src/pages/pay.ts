import '../style.css';
import { auth } from '../firebase';
import { initTelegramWebApp, showAlert } from '../telegram';
import { onAuthStateChanged } from 'firebase/auth';

initTelegramWebApp();

interface PaystackHandler {
  openIframe(): void;
}

interface PaystackPopSetupOptions {
  key: string;
  email: string;
  amount: number;
  metadata: { studentUid: string };
  callback: (transaction: { reference: string }) => void;
  onClose: () => void;
}

interface PaystackPop {
  setup(options: PaystackPopSetupOptions): PaystackHandler;
}

declare global {
  interface Window {
    PaystackPop: PaystackPop;
  }
}

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element #${id}`);
  return found as T;
}

const payCard = el<HTMLDivElement>('pay-card');
const loginRequiredCard = el<HTMLDivElement>('login-required-card');
const payBtn = el<HTMLButtonElement>('pay-btn');
const alertEl = el<HTMLDivElement>('alert');

let currentUid: string | null = null;
let currentEmail: string | null = null;

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

  const publicKey = import.meta.env.VITE_PAYSTACK_PUBLIC_KEY as string | undefined;
  if (!publicKey) {
    showAlert(alertEl, 'Payments are not configured yet.', 'error');
    return;
  }

  const nairaAmount = Number(el<HTMLInputElement>('amount').value);
  if (!nairaAmount || nairaAmount < 500) {
    showAlert(alertEl, 'Enter a valid amount.', 'error');
    return;
  }

  const handler = window.PaystackPop.setup({
    key: publicKey,
    email: currentEmail,
    amount: Math.round(nairaAmount * 100), // Paystack expects kobo
    metadata: { studentUid: currentUid },
    callback: () => {
      // The Paystack webhook (server-side, api/paystack-webhook.ts) is the
      // source of truth for marking the student as paid; this callback
      // only tells the student their payment went through; it does not
      // itself grant access or wait for the webhook to complete.
      showAlert(
        alertEl,
        'Payment received! Your class group invite will arrive on Telegram shortly.',
        'success'
      );
    },
    onClose: () => {
      showAlert(alertEl, 'Payment window closed.', 'error');
    }
  });

  handler.openIframe();
});
