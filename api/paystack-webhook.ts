import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { getAdminFirestore } from './_lib/firebaseAdmin';
import { getEnv } from './_lib/env';

// Vercel parses JSON bodies by default, but HMAC verification requires the
// exact raw bytes Paystack signed — a re-serialized JSON.stringify(req.body)
// can differ in whitespace/key order and silently break verification. We
// disable the built-in parser and read the raw stream ourselves.
export const config = {
  api: {
    bodyParser: false
  }
};

interface PaystackChargeSuccessEvent {
  event: 'charge.success' | string;
  data: {
    reference: string;
    amount: number;
    status: string;
    paid_at: string;
    channel: string;
    customer: { email: string };
    metadata: {
      studentId: string;
      lessonId: string | null;
      telegramChatId: string;
      isMicroPayment: boolean;
    };
  };
}

async function readRawBody(req: VercelRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

async function sendTelegramReceipt(chatId: string, params: {
  amountNaira: number;
  reference: string;
  lessonId: string | null;
  paidAt: string;
}) {
  const botToken = getEnv('TELEGRAM_BOT_TOKEN');
  if (!botToken) {
    console.error('[paystack-webhook] Missing TELEGRAM_BOT_TOKEN, skipping receipt');
    return;
  }

  const lessonLine = params.lessonId
    ? `\n📘 Lesson unlocked: ${params.lessonId}`
    : '\n🎓 Term tuition payment received.';

  const text =
    `✅ *Payment confirmed — ScholaCore Academy*\n\n` +
    `Amount: ₦${params.amountNaira.toLocaleString('en-NG')}\n` +
    `Reference: \`${params.reference}\`\n` +
    `Date: ${new Date(params.paidAt).toLocaleString('en-NG')}` +
    lessonLine;

  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown'
    })
  });

  if (!res.ok) {
    const body = await res.text();
    console.error('[paystack-webhook] Telegram receipt failed', res.status, body);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secretKey = getEnv('PAYSTACK_SECRET_KEY');
  if (!secretKey) {
    console.error('[paystack-webhook] Missing PAYSTACK_SECRET_KEY');
    return res.status(500).json({ error: 'Webhook misconfigured' });
  }

  const rawBody = await readRawBody(req);
  const signature = req.headers['x-paystack-signature'];

  if (typeof signature !== 'string') {
    return res.status(400).json({ error: 'Missing signature' });
  }

  // Paystack signs the raw request body with HMAC-SHA512 using your secret
  // key. Recompute and compare with a constant-time check to avoid timing
  // side-channels — never use `===` on secrets/signatures.
  const expectedSignature = crypto.createHmac('sha512', secretKey).update(rawBody).digest('hex');

  const signatureBuffer = Buffer.from(signature, 'utf8');
  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');

  const isValidSignature =
    signatureBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(signatureBuffer, expectedBuffer);

  if (!isValidSignature) {
    console.warn('[paystack-webhook] Invalid signature — possible spoofed request');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let event: PaystackChargeSuccessEvent;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Malformed JSON payload' });
  }

  // Always 200 quickly for events we don't act on, so Paystack doesn't
  // treat an unrelated event type as a failed delivery and keep retrying.
  if (event.event !== 'charge.success') {
    return res.status(200).json({ received: true, ignored: event.event });
  }

  const { reference, amount, status, paid_at, metadata } = event.data;
  const { studentId, lessonId, telegramChatId, isMicroPayment } = metadata;
  const amountNaira = amount / 100;

  const db = getAdminFirestore();
  const transactionRef = db.collection('transactions').doc(reference);

  try {
    // Idempotency: Paystack may redeliver the same event, and can even
    // redeliver it twice in close succession. The existence check now runs
    // INSIDE the transaction (tx.get, not a plain .get() beforehand) so
    // Firestore's transaction isolation actually prevents two concurrent
    // deliveries from both passing the check and double-processing a
    // single payment (duplicate lesson unlock + duplicate Telegram
    // receipt).
    let alreadyProcessed = false;
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(transactionRef);
      if (existing.exists) {
        alreadyProcessed = true;
        return;
      }

      tx.set(transactionRef, {
        amount: amountNaira,
        studentId,
        status,
        paymentMethod: isMicroPayment ? 'micro-payment' : 'card',
        timestamp: paid_at
      });

      if (lessonId) {
        const userRef = db.collection('users').doc(studentId);
        tx.update(userRef, {
          [`unlockedLessons.${lessonId}`]: true
        });
      }
    });

    if (alreadyProcessed) {
      return res.status(200).json({ received: true, duplicate: true });
    }

    await sendTelegramReceipt(telegramChatId, {
      amountNaira,
      reference,
      lessonId,
      paidAt: paid_at
    });

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('[paystack-webhook] Failed to process charge.success', err);
    // Return 500 so Paystack retries delivery — we want the ledger write to
    // eventually succeed rather than silently drop a confirmed payment.
    return res.status(500).json({ error: 'Failed to process event' });
  }
}
