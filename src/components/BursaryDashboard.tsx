import { useEffect, useState } from 'react';
import { collection, doc, getDoc, getDocs, orderBy, query, where } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { useScholaCoreUser } from '../App';
import SubscribeButton from './SubscribeButton';

interface FeeSchedule {
  tuition?: number;
  billingInterval?: string;
  paystackPlanCode?: string;
}

interface Transaction {
  reference: string;
  amount: number;
  status: string;
  paymentMethod: string;
  timestamp: string;
}

export default function BursaryDashboard() {
  const { userRecord, refreshUserRecord } = useScholaCoreUser();
  const [feeSchedule, setFeeSchedule] = useState<FeeSchedule | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  const studentId = userRecord?.role === 'parent' ? userRecord.studentId : userRecord?.uid;

  useEffect(() => {
    async function load() {
      if (!studentId) {
        setLoading(false);
        return;
      }

      const studentDoc = await getDoc(doc(db, 'users', studentId));
      const classId = studentDoc.data()?.classId as string | undefined;

      const [feeSnap, txSnap] = await Promise.all([
        classId ? getDoc(doc(db, 'feeSchedules', classId)) : Promise.resolve(null),
        getDocs(query(collection(db, 'transactions'), where('studentId', '==', studentId), orderBy('timestamp', 'desc')))
      ]);

      if (feeSnap?.exists()) setFeeSchedule(feeSnap.data() as FeeSchedule);
      setTransactions(txSnap.docs.map((d) => d.data() as Transaction));
      setLoading(false);
    }

    load();
  }, [studentId]);

  if (loading) {
    return <p className="text-sm text-core-600">Loading subscription…</p>;
  }

  const subscriptionActive = userRecord?.subscriptionActive ?? false;
  const email = auth.currentUser?.email ?? `${userRecord?.uid}@scholacore.app`;

  return (
    <div className="space-y-4">
      <div className={`rounded-card p-4 ${subscriptionActive ? 'bg-brand-500' : 'bg-core-950'}`}>
        <p className="font-mono text-[10px] uppercase tracking-widest text-white/70">Subscription status</p>
        <p className="mt-1 text-2xl font-bold text-white">{subscriptionActive ? 'Active' : 'Not subscribed'}</p>
        {feeSchedule?.tuition && (
          <p className="text-xs text-white/70">
            ₦{feeSchedule.tuition.toLocaleString('en-NG')} / {feeSchedule.billingInterval ?? 'billing period'}
          </p>
        )}
      </div>

      {!subscriptionActive && (
        <>
          {feeSchedule?.paystackPlanCode ? (
            <SubscribeButton
              email={email}
              label={`Subscribe — ₦${(feeSchedule.tuition ?? 0).toLocaleString('en-NG')} / ${feeSchedule.billingInterval ?? 'period'}`}
              onSuccess={refreshUserRecord}
            />
          ) : (
            <div className="rounded-card border border-core-100 bg-white p-4">
              <p className="text-sm text-core-600">
                No subscription plan is set up for your class yet. Please check back once billing is configured.
              </p>
            </div>
          )}
        </>
      )}

      <div className="rounded-card border border-core-100 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-core-950">Payment history</h2>
        {transactions.length === 0 ? (
          <p className="text-sm text-core-400">No payments recorded yet.</p>
        ) : (
          <ul className="space-y-2">
            {transactions.map((tx) => (
              <li key={tx.reference} className="flex items-center justify-between text-sm">
                <div>
                  <p className="text-core-950">₦{tx.amount.toLocaleString('en-NG')}</p>
                  <p className="text-[11px] text-core-400">{new Date(tx.timestamp).toLocaleDateString('en-NG')}</p>
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
