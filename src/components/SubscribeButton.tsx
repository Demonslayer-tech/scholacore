import { useState } from 'react';
import PaystackPop from '@paystack/inline-js';
import { getAuthToken } from '../lib/firebase';
import { hapticError, hapticSuccess } from '../lib/telegram';

interface SubscribeButtonProps {
  email: string;
  label: string;
  onSuccess?: (reference: string) => void;
}

export default function SubscribeButton({ email, label, onSuccess }: SubscribeButtonProps) {
  const [status, setStatus] = useState<'idle' | 'initializing' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubscribe = async () => {
    setStatus('initializing');
    setErrorMessage(null);

    try {
      const token = await getAuthToken();
      if (!token) throw new Error('Your session expired — please refresh and sign in again.');

      // studentId and the plan/price are deliberately NOT sent here — the
      // server derives both from the verified token + Firestore
      // (api/initialize-subscription.ts), so this client can't influence
      // what plan actually gets subscribed.
      const res = await fetch('/api/initialize-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start subscription');

      // resumeTransaction() picks up the transaction already initialized
      // server-side — passing `plan` there is what makes this recurring;
      // this popup just completes the card authorization.
      const paystack = new PaystackPop();
      paystack.resumeTransaction(data.accessCode, {
        onSuccess: (transaction: { reference: string }) => {
          hapticSuccess();
          setStatus('idle');
          onSuccess?.(transaction.reference);
        },
        onCancel: () => setStatus('idle')
      });
    } catch (err) {
      hapticError();
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Subscription failed to start');
    }
  };

  return (
    <div>
      <button
        onClick={handleSubscribe}
        disabled={status === 'initializing'}
        className="w-full rounded-card bg-brand-500 px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {status === 'initializing' ? 'Starting subscription…' : label}
      </button>
      {errorMessage && <p className="mt-2 text-xs text-signal-danger">{errorMessage}</p>}
    </div>
  );
}
