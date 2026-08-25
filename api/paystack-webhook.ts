import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { getAdminFirestore } from './_lib/firebaseAdmin';

// Vercel parses JSON bodies by default, but HMAC verification requires the
// exact raw bytes Paystack signed.
export const config = {
  api: {
    bodyParser: false
  }
};

interface PaystackEvent {
  event: string;
  data: Record<string, unknown>;
}

async function readRawBody(req: VercelRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

async function sendTelegramReceipt(chatId: string, amountNaira: number, reference: string) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken || !chatId) return;

  const text =
    `✅ *Payment confirmed — ScholaCore*\n\n` +
    `Amount: ₦${amountNaira.toLocaleString('en-NG')}\n` +
    `Reference: \`${reference}\``;

  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
  });
  if (!res.ok) {
    console.error('[paystack-webhook] Telegram receipt failed', res.status, await res.text());
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) {
    console.error('[paystack-webhook] Missing PAYSTACK_SECRET_KEY');
    return res.status(500).json({ error: 'Webhook misconfigured' });
  }

  const rawBody = await readRawBody(req);
  const signature = req.headers['x-paystack-signature'];

  if (typeof signature !== 'string') {
    return res.status(400).json({ error: 'Missing signature' });
  }

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

  let event: PaystackEvent;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Malformed JSON payload' });
  }

  const db = getAdminFirestore();

  try {
    // charge.success fires for EVERY successful charge — first payment AND
    // every recurring renewal on a subscription. We distinguish by
    // presence of `plan`/`subscription_code` on the event data, per
    // Paystack's own guidance (don't assume charge.success == one-off).
    if (event.event === 'charge.success') {
      const data = event.data;
      const reference = data.reference as string;
      const amount = data.amount as number;
      const amountNaira = amount / 100;

      // Idempotency: Paystack can and does redeliver events. If we've
      // already recorded this reference, acknowledge without re-applying
      // side effects (crediting an account twice on a duplicate delivery
      // would be a real bug, not a theoretical one).
      const txRef = db.collection('transactions').doc(reference);
      const existing = await txRef.get();
      if (existing.exists) {
        return res.status(200).json({ received: true, duplicate: true });
      }

      const metadata = (data.metadata ?? {}) as { studentId?: string; classId?: string };
      const subscriptionCode = (data.subscription_code ?? data.subscription ?? null) as string | null;
      const planCode = (data.plan_object as { plan_code?: string } | undefined)?.plan_code ?? (data.plan as string | undefined) ?? null;

      let studentId = metadata.studentId ?? null;

      // Renewal charges may not carry the original metadata through in
      // every Paystack API version — fall back to the subscription->student
      // mapping written on first payment, below, if metadata is absent.
      if (!studentId && subscriptionCode) {
        const subDoc = await db.collection('subscriptions').doc(subscriptionCode).get();
        studentId = (subDoc.data()?.studentId as string | undefined) ?? null;
      }

      await db.runTransaction(async (tx) => {
        tx.set(txRef, {
          amount: amountNaira,
          studentId: studentId ?? null,
          status: 'success',
          paymentMethod: subscriptionCode ? 'subscription' : 'one-off',
          subscriptionCode: subscriptionCode ?? null,
          timestamp: new Date().toISOString()
        });

        if (studentId) {
          tx.set(
            db.collection('users').doc(studentId),
            { subscriptionActive: true, lastPaymentAt: new Date().toISOString() },
            { merge: true }
          );
        }

        if (subscriptionCode && studentId) {
          tx.set(
            db.collection('subscriptions').doc(subscriptionCode),
            {
              studentId,
              classId: metadata.classId ?? null,
              planCode,
              status: 'active',
              lastChargedAt: new Date().toISOString()
            },
            { merge: true }
          );
        }
      });

      const chatId = process.env.TELEGRAM_BOT_TOKEN ? (studentId ?? '') : '';
      if (chatId) {
        // Best-effort — a Telegram-originated student's uid IS their chat
        // ID. Web-only accounts have no Telegram chat to notify; that's
        // expected, not an error.
        await sendTelegramReceipt(chatId, amountNaira, reference).catch((err) =>
          console.error('[paystack-webhook] Receipt send failed (non-fatal)', err)
        );
      }

      return res.status(200).json({ received: true });
    }

    // Customer cancelled, but Paystack's own guidance is explicit: don't
    // revoke access immediately — the current billing period they already
    // paid for hasn't ended yet. We just record that it won't renew.
    if (event.event === 'subscription.not_renew') {
      const subscriptionCode = event.data.subscription_code as string | undefined;
      if (subscriptionCode) {
        await db.collection('subscriptions').doc(subscriptionCode).set(
          { status: 'not_renewing' },
          { merge: true }
        );
      }
      return res.status(200).json({ received: true });
    }

    // Subscription fully disabled/cancelled — this is where access should
    // actually come away, unlike not_renew above.
    if (event.event === 'subscription.disable') {
      const subscriptionCode = event.data.subscription_code as string | undefined;
      if (subscriptionCode) {
        const subDoc = await db.collection('subscriptions').doc(subscriptionCode).get();
        const studentId = subDoc.data()?.studentId as string | undefined;
        await db.collection('subscriptions').doc(subscriptionCode).set({ status: 'cancelled' }, { merge: true });
        if (studentId) {
          await db.collection('users').doc(studentId).set({ subscriptionActive: false }, { merge: true });
        }
      }
      return res.status(200).json({ received: true });
    }

    // Any other event type (invoice.create, invoice.update,
    // invoice.payment_failed, subscription.expiring_cards, etc.) — 200 so
    // Paystack doesn't treat an event we don't act on as a failed delivery
    // and keep retrying it.
    return res.status(200).json({ received: true, ignored: event.event });
  } catch (err) {
    console.error('[paystack-webhook] Failed to process event', event.event, err);
    // 500 so Paystack retries — we want the ledger write to eventually
    // succeed rather than silently drop a confirmed payment.
    return res.status(500).json({ error: 'Failed to process event' });
  }
}
