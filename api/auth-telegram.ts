import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyTelegramInitData } from './_lib/telegramAuth';
import { getAdminAuth, getAdminFirestore } from './_lib/firebaseAdmin';

// This endpoint is the bridge between "Telegram says this is user X" and
// "Firestore/firestore.rules trust this is user X". It is not in the
// original 5-endpoint spec, but firestore.rules reads
// request.auth.token.role on every request — nothing else in this codebase
// mints that token, so without this endpoint the security rules would
// reject all reads/writes. Every other component signs in through here
// before touching Firestore (see src/App.tsx `bootstrapSession`).

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

  const telegramId = String(verified.user.id);
  const db = getAdminFirestore();
  const userRef = db.collection('users').doc(telegramId);

  try {
    const snap = await userRef.get();
    const fallbackName = [verified.user.first_name, verified.user.last_name].filter(Boolean).join(' ');

    let userRecord: {
      name: string;
      role: string;
      studentId?: string;
      classId?: string;
      guardianTelegramId?: string;
      unlockedLessons: Record<string, boolean>;
    };

    if (snap.exists) {
      const data = snap.data()!;
      userRecord = {
        name: data.name ?? fallbackName,
        role: data.role ?? 'student',
        studentId: data.studentId,
        classId: data.classId,
        guardianTelegramId: data.guardianTelegramId,
        unlockedLessons: data.unlockedLessons ?? {}
      };
    } else {
      // First launch: provision a minimal student-role profile. Elevated
      // roles (teacher/bursar/principal) are never self-assigned — a
      // principal promotes a user out-of-band (Firebase console / an admin
      // tool), which naturally takes effect next time this endpoint mints
      // a fresh token for them.
      userRecord = { name: fallbackName, role: 'student', unlockedLessons: {} };
      await userRef.set({
        ...userRecord,
        createdAt: new Date().toISOString()
      });
    }

    const customToken = await getAdminAuth().createCustomToken(telegramId, { role: userRecord.role });

    return res.status(200).json({
      customToken,
      user: { telegramId, ...userRecord }
    });
  } catch (err) {
    console.error('[auth-telegram] Failed to establish session', err);
    return res.status(500).json({ error: 'Unable to establish session' });
  }
}
