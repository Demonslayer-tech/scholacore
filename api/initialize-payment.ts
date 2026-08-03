import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyCaller } from './_lib/verifyCaller';
import { getAdminFirestore } from './_lib/firebaseAdmin';

const MICRO_FEE_THRESHOLD_NAIRA = 2500;

interface InitializePaymentBody {
  email: string;
  lessonId?: string;
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
  tuition: number;
  mandatoryFees?: { name: string; amount: number }[];
  lessonMicroFee?: number;
}

function isValidBody(body: unknown): body is InitializePaymentBody {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return typeof b.email === 'string' && (b.lessonId === undefined || typeof b.lessonId === 'string');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) {
    console.error('[initialize-payment] Missing PAYSTACK_SECRET_KEY');
    return res.status(500).json({ error: 'Payment service misconfigured' });
  }

  const caller = await verifyCaller(req);
  if (!caller) {
    return res.status(401).json({ error: 'Not signed in' });
  }

  if (!isValidBody(req.body)) {
    return res.status(400).json({ error: 'Invalid payload. Required: email.' });
  }

  const { email, lessonId } = req.body;

  try {
    const db = getAdminFirestore();

    let studentId = caller.telegramId;
    if (caller.role === 'parent') {
      const callerDoc = await db.collection('users').doc(caller.telegramId).get();
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

    let amountInNaira: number;
    if (lessonId) {
      if (!feeData.lessonMicroFee) {
        return res.status(400).json({ error: 'No per-lesson pricing configured for this class' });
      }
      amountInNaira = feeData.lessonMicroFee;
    } else {
      const mandatoryTotal = (feeData.mandatoryFees ?? []).reduce((sum, fee) => sum + fee.amount, 0);
      const totalDue = feeData.tuition + mandatoryTotal;

      const paidSnap = await db
        .collection('transactions')
        .where('studentId', '==', studentId)
        .where('status', '==', 'success')
        .get();
      const totalPaid = paidSnap.docs.reduce((sum, d) => sum + (Number(d.data().amount) || 0), 0);

      amountInNaira = Math.max(0, totalDue - totalPaid);
      if (amountInNaira <= 0) {
        return res.status(400).json({ error: 'This student\'s balance is already fully paid' });
      }
    }

    const amountInKobo = Math.round(amountInNaira * 100);
    const isMicroPayment = amountInNaira < MICRO_FEE_THRESHOLD_NAIRA;

    const paystackRes = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email,
        amount: amountInKobo,
        currency: 'NGN',
        metadata: {
          studentId,
          lessonId: lessonId ?? null,
          telegramChatId: caller.telegramId,
          isMicroPayment,
          custom_fields: [
            { display_name: 'Student ID', variable_name: 'student_id', value: studentId },
            { display_name: 'Lesson ID', variable_name: 'lesson_id', value: lessonId ?? 'N/A' }
          ]
        },
        callback_url: process.env.PAYSTACK_CALLBACK_URL
      })
    });

    const data = (await paystackRes.json()) as PaystackInitializeResponse;

    if (!paystackRes.ok || !data.status || !data.data) {
      console.error('[initialize-payment] Paystack rejected the request', data);
      return res.status(502).json({ error: data.message || 'Payment initialization failed' });
    }

    return res.status(200).json({
      authorizationUrl: data.data.authorization_url,
      accessCode: data.data.access_code,
      reference: data.data.reference,
      amountInNaira
    });
  } catch (err) {
    console.error('[initialize-payment] Unexpected error', err);
    return res.status(500).json({ error: 'Unable to initialize payment' });
  }
}
