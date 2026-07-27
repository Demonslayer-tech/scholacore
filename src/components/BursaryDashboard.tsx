import { useEffect, useState } from 'react';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useScholaCoreUser } from '../App';
import PayButton from './PayButton';

interface FeeSchedule {
  term: string;
  tuition: number;
  mandatoryFees: { name: string; amount: number }[];
  lessonMicroFee: number;
}

interface Transaction {
  reference: string;
  amount: number;
  status: string;
  paymentMethod: string;
  timestamp: string;
}

export default function BursaryDashboard() {
  const { telegramUser, userRecord } = useScholaCoreUser();
  const [feeSchedule, setFeeSchedule] = useState<FeeSchedule | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      if (!telegramUser || !userRecord?.classId) {
        setLoading(false);
        return;
      }

      const [feeSnap, txSnap] = await Promise.all([
        getDoc(doc(db, 'feeSchedules', userRecord.classId)),
        getDocs(
          query(collection(db, 'transactions'), where('studentId', '==', userRecord.studentId ?? telegramUser.telegramId))
        )
      ]);

      if (feeSnap.exists()) setFeeSchedule(feeSnap.data() as FeeSchedule);
      setTransactions(txSnap.docs.map((d) => d.data() as Transaction));
      setLoading(false);
    }

    load();
  }, [telegramUser, userRecord]);

  if (loading) {
    return <p className="text-sm text-core-600">Loading fee schedule…</p>;
  }

  if (!feeSchedule) {
    return (
      <div className="rounded-card border border-core-100 bg-white p-4">
        <p className="text-sm text-core-700">
          No fee schedule is on file for your class yet. Please check back once the term begins, or contact the bursary.
        </p>
      </div>
    );
  }

  const totalFees = feeSchedule.mandatoryFees.reduce((sum, f) => sum + f.amount, 0);
  const totalDue = feeSchedule.tuition + totalFees;
  const totalPaid = transactions
    .filter((t) => t.status === 'success')
    .reduce((sum, t) => sum + t.amount, 0);
  const balance = Math.max(0, totalDue - totalPaid);

  return (
    <div className="space-y-4">
      <div className="rounded-card bg-core-900 p-4 text-white">
        <p className="font-mono text-[10px] uppercase tracking-widest text-seal-400">{feeSchedule.term}</p>
        <p className="mt-1 text-2xl font-display">₦{balance.toLocaleString('en-NG')}</p>
        <p className="text-xs text-core-100/70">
          outstanding of ₦{totalDue.toLocaleString('en-NG')} total
        </p>
      </div>

      <div className="rounded-card border border-core-100 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-core-900">Fee breakdown</h2>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between text-core-700">
            <span>Tuition</span>
            <span>₦{feeSchedule.tuition.toLocaleString('en-NG')}</span>
          </div>
          {feeSchedule.mandatoryFees.map((fee) => (
            <div key={fee.name} className="flex justify-between text-core-700">
              <span>{fee.name}</span>
              <span>₦{fee.amount.toLocaleString('en-NG')}</span>
            </div>
          ))}
        </div>
      </div>

      {balance > 0 && (
        <PayButton
          email={`${telegramUser?.telegramId}@scholacore.telegram`}
          amountInNaira={balance}
          label="Pay full balance"
        />
      )}

      <div className="rounded-card border border-core-100 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-core-900">Payment history</h2>
        {transactions.length === 0 ? (
          <p className="text-sm text-core-500">No payments recorded yet.</p>
        ) : (
          <ul className="space-y-2">
            {transactions.map((tx) => (
              <li key={tx.reference} className="flex items-center justify-between text-sm">
                <div>
                  <p className="text-core-900">₦{tx.amount.toLocaleString('en-NG')}</p>
                  <p className="text-[11px] text-core-500">{new Date(tx.timestamp).toLocaleDateString('en-NG')}</p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    tx.status === 'success'
                      ? 'bg-signal-success/10 text-signal-success'
                      : 'bg-signal-pending/10 text-signal-pending'
                  }`}
                >
                  {tx.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
