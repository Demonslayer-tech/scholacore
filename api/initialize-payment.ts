import type { VercelRequest, VercelResponse } from '@vercel/node';

// Naira amounts under this threshold ride Paystack's micro-transaction fee
// waiver, per ScholaCore's pay-per-lesson pricing model.
const MICRO_FEE_THRESHOLD_NAIRA = 2500;

interface InitializePaymentBody {
  email: string;
  amountInNaira: number;
  studentId: string;
  lessonId?: string;
  telegramChatId: string;
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

function isValidBody(body: unknown): body is InitializePaymentBody {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.email === 'string' &&
    typeof b.amountInNaira === 'number' &&
    b.amountInNaira > 0 &&
    typeof b.studentId === 'string' &&
    typeof b.telegramChatId === 'string' &&
    (b.lessonId === undefined || typeof b.lessonId === 'string')
  );
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

  if (!isValidBody(req.body)) {
    return res.status(400).json({
      error: 'Invalid payload. Required: email, amountInNaira, studentId, telegramChatId.'
    });
  }

  const { email, amountInNaira, studentId, lessonId, telegramChatId } = req.body;

  // Paystack expects the smallest currency unit (kobo). 1 Naira = 100 Kobo.
  const amountInKobo = Math.round(amountInNaira * 100);
  const isMicroPayment = amountInNaira < MICRO_FEE_THRESHOLD_NAIRA;

  try {
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
        // Metadata round-trips through the webhook, letting us reconcile the
        // charge back to the right student/lesson/chat without a second DB
        // lookup at webhook time.
        metadata: {
          studentId,
          lessonId: lessonId ?? null,
          telegramChatId,
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
      reference: data.data.reference
    });
  } catch (err) {
    console.error('[initialize-payment] Unexpected error', err);
    return res.status(500).json({ error: 'Unable to initialize payment' });
  }
}
