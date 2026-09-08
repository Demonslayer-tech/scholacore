import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { getAdminFirestore } from './_lib/firebaseAdmin';
import { createSingleUseInviteLink, sendTelegramMessage } from './_lib/telegramBot';

// Disable Vercel's automatic JSON body parsing — HMAC verification needs
// the exact raw request bytes Paystack signed, not a re-serialized object.
export const config = {
  api: { bodyParser: false }
};

async function readRawBody(req: VercelRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

function verifySignature(rawBody: Buffer, signature: string | undefined, secret: string): boolean {
  if (!signature) return false;
  const expected = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');
  // Constant-time comparison to avoid timing side-channels.
  const sigBuf = Buffer.from(signature, 'hex');
  const expBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expBuf);
}

interface PaystackChargeEvent {
  event: string;
  data: {
    reference: string;
    amount: number;
    status: string;
    customer: { email: string };
    metadata?: { studentUid?: string };
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) {
    console.error('[paystack-webhook] Missing PAYSTACK_SECRET_KEY');
    res.status(500).json({ error: 'Webhook misconfigured' });
    return;
  }

  const rawBody = await readRawBody(req);
  const signature = req.headers['x-paystack-signature'] as string | undefined;

  if (!verifySignature(rawBody, signature, secret)) {
    console.error('[paystack-webhook] Invalid signature');
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  let event: PaystackChargeEvent;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    res.status(400).json({ error: 'Invalid JSON payload' });
    return;
  }

  const db = getAdminFirestore();
  const eventId = event.data?.reference ?? `unknown-${Date.now()}`;
  const webhookEventRef = db.collection('webhook_events').doc(eventId);

  // Acknowledge and ignore any event type we don't care about, but still
  // return 200 so Paystack doesn't keep retrying an event we'll never act on.
  if (event.event !== 'charge.success') {
    res.status(200).json({ received: true, ignored: event.event });
    return;
  }

  const { reference, amount, customer, metadata } = event.data;
  const studentUid = metadata?.studentUid;

  if (!studentUid) {
    console.error('[paystack-webhook] Missing studentUid in metadata', reference);
    const existingEvent = await webhookEventRef.get();
    await webhookEventRef.set(
      {
        source: 'paystack',
        payload: event,
        processed: false,
        attempts: existingEvent.exists ? (existingEvent.data()?.attempts ?? 0) + 1 : 1,
        lastAttemptAt: new Date(),
        error: 'Missing studentUid in charge metadata'
      },
      { merge: true }
    );
    // 200, not 500: this is a data problem on our initialization side, not
    // a transient failure — retrying will never fix it, so don't make
    // Paystack hammer the endpoint.
    res.status(200).json({ received: true, error: 'missing studentUid' });
    return;
  }

  // Idempotency: if we've already recorded a successful transaction for
  // this reference, don't re-process (Paystack may deliver the same event
  // more than once).
  const transactionRef = db.collection('transactions').doc(reference);
  const existing = await transactionRef.get();
  if (existing.exists && existing.data()?.status === 'success') {
    res.status(200).json({ received: true, alreadyProcessed: true });
    return;
  }

  try {
    await transactionRef.set({
      paystackReference: reference,
      studentId: studentUid,
      amount,
      status: 'success',
      retryCount: existing.exists ? (existing.data()?.retryCount ?? 0) + 1 : 0,
      lastError: null,
      createdAt: existing.exists ? existing.data()?.createdAt ?? new Date() : new Date()
    });

    // Payment is confirmed at this point. Everything below (Telegram
    // delivery) is best-effort — a Telegram failure must NOT undo or
    // block the student's paid status.
    await db.collection('users').doc(studentUid).update({ paymentStatus: 'active_paid' });
  } catch (err) {
    console.error('[paystack-webhook] Failed to record payment', err);
    await webhookEventRef.set(
      {
        source: 'paystack',
        payload: event,
        processed: false,
        attempts: existing.exists ? (existing.data()?.retryCount ?? 0) + 1 : 1,
        lastAttemptAt: new Date(),
        error: err instanceof Error ? err.message : 'Unknown error recording payment'
      },
      { merge: true }
    );
    // 500 here IS a transient/infra failure — let Paystack retry.
    res.status(500).json({ error: 'Failed to record payment' });
    return;
  }

  let telegramError: string | null = null;
  try {
    const groupChatId = process.env.TELEGRAM_CLASS_GROUP_CHAT_ID;
    if (!groupChatId) {
      throw new Error('Missing TELEGRAM_CLASS_GROUP_CHAT_ID environment variable');
    }
    const userSnap = await db.collection('users').doc(studentUid).get();
    const telegramUserId = userSnap.data()?.telegramUserId as string | null | undefined;

    const inviteLink = await createSingleUseInviteLink(groupChatId);

    if (telegramUserId) {
      await sendTelegramMessage(
        telegramUserId,
        `Payment confirmed! Join your class group here: ${inviteLink}`
      );
    } else {
      console.warn(
        `[paystack-webhook] Student ${studentUid} paid but has no telegramUserId — invite link generated but not delivered: ${inviteLink}`
      );
    }
  } catch (err) {
    telegramError = err instanceof Error ? err.message : 'Unknown Telegram delivery error';
    console.error('[paystack-webhook] Telegram invite delivery failed', telegramError);
  }

  await webhookEventRef.set(
    {
      source: 'paystack',
      payload: event,
      processed: telegramError === null,
      attempts: 1,
      lastAttemptAt: new Date(),
      error: telegramError
    },
    { merge: true }
  );

  // Always 200 once payment is recorded — the student is paid regardless
  // of whether the Telegram invite made it out. A logged, unresolved
  // Telegram failure can be replayed manually from webhook_events without
  // ever touching paymentStatus again.
  res.status(200).json({ received: true, telegramDelivered: telegramError === null });
}
