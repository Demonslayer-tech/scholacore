import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyCaller } from './_lib/verifyCaller';
import { getAdminAuth, getAdminFirestore } from './_lib/firebaseAdmin';

// Handles the Student/Parent branch of sign-up (see src/components/SignUp.tsx),
// for a caller from either auth path (Telegram or web) — verifyCaller
// returns the same shape either way. Teachers sign up through a different
// path: submitting an application via /api/vet-teacher, which creates
// their account as 'pending_teacher' after AI screening rather than
// immediately, since becoming a teacher is gated on that review.

interface SignupBody {
  name: string;
  role: 'student' | 'parent';
}

function isValidBody(body: unknown): body is SignupBody {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.name === 'string' &&
    b.name.trim().length > 1 &&
    (b.role === 'student' || b.role === 'parent')
  );
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Any signed-in caller can sign up — including one holding an
  // 'unregistered' token, which is exactly the state a brand-new user is
  // in. What matters is that the token is real, not what role it
  // currently carries.
  const caller = await verifyCaller(req);
  if (!caller) {
    return res.status(401).json({ error: 'Not signed in' });
  }

  if (!isValidBody(req.body)) {
    return res.status(400).json({ error: 'Invalid payload. Required: name, role (student or parent).' });
  }

  const { name, role } = req.body;
  const uid = caller.uid;

  try {
    const db = getAdminFirestore();
    const userRef = db.collection('users').doc(uid);

    const existing = await userRef.get();
    if (existing.exists) {
      return res.status(409).json({ error: 'This account is already signed up.' });
    }

    const userRecord = { name: name.trim(), role, subscriptionActive: false, unlockedLessons: {} };
    await userRef.set({
      ...userRecord,
      createdAt: new Date().toISOString()
    });

    // The caller's existing token still says role: 'unregistered' — mint a
    // fresh one reflecting their real role so firestore.rules recognizes
    // them immediately.
    const customToken = await getAdminAuth().createCustomToken(uid, { role });

    return res.status(200).json({
      customToken,
      user: { uid, ...userRecord }
    });
  } catch (err) {
    console.error('[signup] Failed to create account', err);
    const message = err instanceof Error ? err.message : 'Unable to complete sign-up';
    return res.status(500).json({ error: message });
  }
}
