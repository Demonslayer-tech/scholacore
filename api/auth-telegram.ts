import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyTelegramInitData } from './_lib/telegramAuth';
import { getAdminAuth, getAdminFirestore } from './_lib/firebaseAdmin';
import { getEnv } from './_lib/env';

// This endpoint is the bridge between "Telegram says this is user X" and
// "Firestore/firestore.rules trust this is user X". It is not in the
// original 5-endpoint spec, but firestore.rules reads
// request.auth.token.role on every request — nothing else in this codebase
// mints that token, so without this endpoint the security rules would
// reject all reads/writes. Every other component signs in through here
// before touching Firestore (see src/App.tsx `bootstrapSession`).
//
// A user with no /users/{telegramId} record is no longer auto-provisioned
// as 'student' — every person signs up explicitly (see api/signup.ts and
// src/components/SignUp.tsx), including teachers, who sign up by going
// through the AI-screened application. A brand new caller gets a token
// with role 'unregistered' — enough to be a valid Firebase Auth session
// (needed to call api/signup or submit a teacher application), but
// firestore.rules grants an 'unregistered' role no access to anything
// beyond what those two flows explicitly need.

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

  const botToken = getEnv('TELEGRAM_BOT_TOKEN');
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

  const telegramId = String(verified.user.id);

  try {
    const db = getAdminFirestore();
    const userRef = db.collection('users').doc(telegramId);
    const snap = await userRef.get();

    if (!snap.exists) {
      // New Telegram user, no account yet. Mint a minimal-privilege token
      // and tell the client to show sign-up — we do NOT create a Firestore
      // record here anymore.
      const customToken = await getAdminAuth().createCustomToken(telegramId, { role: 'unregistered' });
      return res.status(200).json({ customToken, user: null });
    }

    const data = snap.data()!;
    const fallbackName = [verified.user.first_name, verified.user.last_name].filter(Boolean).join(' ');
    const userRecord = {
      name: data.name ?? fallbackName,
      role: data.role ?? 'student',
      studentId: data.studentId,
      classId: data.classId,
      guardianTelegramId: data.guardianTelegramId,
      unlockedLessons: data.unlockedLessons ?? {}
    };

    const customToken = await getAdminAuth().createCustomToken(telegramId, { role: userRecord.role });

    return res.status(200).json({
      customToken,
      user: { telegramId, ...userRecord }
    });
  } catch (err) {
    console.error('[auth-telegram] Failed to establish session', err);
    const message = err instanceof Error ? err.message : 'Unable to establish session';
    return res.status(500).json({ error: message });
  }
}
