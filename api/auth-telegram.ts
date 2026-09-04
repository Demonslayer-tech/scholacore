import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyTelegramInitData } from './_lib/telegramAuth';
import { getAdminAuth, getAdminFirestore } from './_lib/firebaseAdmin';

// Bridges "Telegram says this is user X" to "Firestore trusts this is user
// X". firestore.rules reads request.auth.token.role on every request —
// nothing else mints that token, so without this endpoint the rules
// reject all reads/writes.
//
// Nobody is auto-provisioned an account here. A user with no
// /users/{uid} record gets a token with role 'unregistered' and
// user: null in the response — App.tsx shows sign-up in that state.

interface AuthRequestBody {
  initData: string;
}

function isValidBody(body: unknown): body is AuthRequestBody {
  return !!body && typeof body === 'object' && typeof (body as Record<string, unknown>).initData === 'string';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.error('[auth-telegram] Missing TELEGRAM_BOT_TOKEN');
    return res.status(500).json({ error: 'Auth service misconfigured' });
  }

  if (!isValidBody(req.body)) {
    return res.status(400).json({ error: 'Invalid payload. Required: initData.' });
  }

  let verified;
  try {
    verified = verifyTelegramInitData(req.body.initData, botToken);
  } catch (err) {
    console.warn('[auth-telegram] initData verification failed:', err instanceof Error ? err.message : err);
    return res.status(401).json({ error: 'Invalid Telegram session' });
  }

  const telegramId = String(verified.id);

  try {
    const db = getAdminFirestore();
    const userRef = db.collection('users').doc(telegramId);
    const snap = await userRef.get();

    if (!snap.exists) {
      const customToken = await getAdminAuth().createCustomToken(telegramId, { role: 'unregistered' });
      return res.status(200).json({ customToken, user: null });
    }

    const data = snap.data()!;
    const fallbackName = [verified.first_name, verified.last_name].filter(Boolean).join(' ');
    const userRecord = {
      name: data.name ?? fallbackName,
      role: data.role ?? 'student',
      studentId: data.studentId,
      classId: data.classId,
      guardianUid: data.guardianUid,
      subscriptionActive: data.subscriptionActive ?? false,
      unlockedLessons: data.unlockedLessons ?? {}
    };

    const customToken = await getAdminAuth().createCustomToken(telegramId, { role: userRecord.role });

    return res.status(200).json({
      customToken,
      user: { uid: telegramId, ...userRecord }
    });
  } catch (err) {
    console.error('[auth-telegram] Failed to establish session', err);
    const message = err instanceof Error ? err.message : 'Unable to establish session';
    return res.status(500).json({ error: message });
  }
}
