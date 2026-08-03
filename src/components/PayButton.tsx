import { useState } from 'react';
import PaystackPop from '@paystack/inline-js';
import { useScholaCoreUser } from '../App';
import { getAuthToken } from '../lib/firebase';
import { hapticError, hapticSuccess } from '../lib/telegram';

interface PayButtonProps {
  email: string;
  amountInNaira: number;
  lessonId?: string;
  label: string;
  onSuccess?: (reference: string) => void;
}

export default function PayButton({ email, amountInNaira, lessonId, label, onSuccess }: PayButtonProps) {
  const { telegramUser } = useScholaCoreUser();
  const [status, setStatus] = useState<'idle' | 'initializing' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handlePay = async () => {
    if (!telegramUser) return;
    setStatus('initializing');
    setErrorMessage(null);

    try {
      const token = await getAuthToken();
      if (!token) {
        throw new Error('Your session expired — please close and reopen the app.');
      }

      const res = await fetch('/api/initialize-payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ email, lessonId })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Could not start payment');
      }

      const paystack = new PaystackPop();
      paystack.resumeTransaction(data.accessCode, {
        onSuccess: (transaction: { reference: string }) => {
          hapticSuccess();
          setStatus('idle');
          onSuccess?.(transaction.reference);
        },
        onCancel: () => {
          setStatus('idle');
        }
      });
    } catch (err) {
      hapticError();
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Payment failed to start');
    }
  };

  return (
    <div>
      <button
        onClick={handlePay}
        disabled={status === 'initializing'}
        className="w-full rounded-card bg-seal-500 px-4 py-3 text-sm font-semibold text-core-950 transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {status === 'initializing' ? 'Starting payment…' : `${label} — ₦${amountInNaira.toLocaleString('en-NG')}`}
      </button>
      {errorMessage && <p className="mt-2 text-xs text-signal-danger">{errorMessage}</p>}
    </div>
  );
}
