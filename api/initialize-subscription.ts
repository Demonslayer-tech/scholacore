import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyCaller } from './_lib/verifyCaller';
import { getAdminFirestore } from './_lib/firebaseAdmin';

interface InitializeSubscriptionBody {
  email: string;
}

interface PaystackInitializeResponse {
  status: boolean;
  message: string;
  data?: {
    authorization_url: string;
    access_code: string;
    reference: string;
  };
}

interface FeeSchedule {
  paystackPlanCode?: string;
  billingInterval?: string;
  tuition?: number;
}

function isValidBody(body: unknown): body is InitializeSubscriptionBody {
  if (!body || typeof body !== 'object') return false;
  return typeof (body as Record<string, unknown>).email === 'string';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) {
    console.error('[initialize-subscription] Missing PAYSTACK_SECRET_KEY');
    return res.status(500).json({ error: 'Payment service misconfigured' });
  }

  const caller = await verifyCaller(req);
  if (!caller) {
    return res.status(401).json({ error: 'Not signed in' });
  }

  if (!isValidBody(req.body)) {
    return res.status(400).json({ error: 'Invalid payload. Required: email.' });
  }

  const { email } = req.body;

  try {
    const db = getAdminFirestore();

    // A parent's own account links to their child via studentId; a
    // student subscribing for themselves has no such link, so their own
    // uid IS the studentId.
    let studentId = caller.uid;
    if (caller.role === 'parent') {
      const callerDoc = await db.collection('users').doc(caller.uid).get();
      const linkedStudentId = callerDoc.data()?.studentId as string | undefined;
      if (!linkedStudentId) {
        return res.status(403).json({ error: 'No linked student found for this account' });
      }
      studentId = linkedStudentId;
    }

    const studentDoc = await db.collection('users').doc(studentId).get();
    if (!studentDoc.exists) {
      return res.status(404).json({ error: 'Student record not found' });
    }
    const classId = studentDoc.data()?.classId as string | undefined;
    if (!classId) {
      return res.status(400).json({ error: 'Student has no class assigned yet' });
    }

    const feeDoc = await db.collection('feeSchedules').doc(classId).get();
    if (!feeDoc.exists) {
      return res.status(404).json({ error: 'No fee schedule found for this class' });
    }
    const feeData = feeDoc.data() as FeeSchedule;

    if (!feeData.paystackPlanCode) {
      return res.status(400).json({
        error: 'No subscription plan configured for this class yet. Create a Plan in the Paystack dashboard and add its code to this feeSchedule.'
      });
    }

    // Passing `plan` (not `amount`) is what turns this into a subscription:
    // Paystack charges the plan's configured price, and on successful
    // first payment automatically creates the recurring subscription
    // against the customer's saved card — no separate "create subscription"
    // call needed. See Paystack's Subscriptions docs, "Method 1".
    const paystackRes = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email,
        plan: feeData.paystackPlanCode,
        metadata: {
          studentId,
          classId,
          custom_fields: [
            { display_name: 'Student ID', variable_name: 'student_id', value: studentId },
            { display_name: 'Class', variable_name: 'class_id', value: classId }
          ]
        },
        callback_url: process.env.PAYSTACK_CALLBACK_URL
      })
    });

    const data = (await paystackRes.json()) as PaystackInitializeResponse;

    if (!paystackRes.ok || !data.status || !data.data) {
      console.error('[initialize-subscription] Paystack rejected the request', data);
      return res.status(502).json({ error: data.message || 'Subscription initialization failed' });
    }

    return res.status(200).json({
      authorizationUrl: data.data.authorization_url,
      accessCode: data.data.access_code,
      reference: data.data.reference,
      billingInterval: feeData.billingInterval ?? null
    });
  } catch (err) {
    console.error('[initialize-subscription] Unexpected error', err);
    return res.status(500).json({ error: 'Unable to start subscription' });
  }
}
