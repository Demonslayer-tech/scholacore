import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAdminAuth, getAdminFirestore } from './_lib/firebaseAdmin';

// The web sign-in path itself is plain Firebase email/password, handled
// entirely client-side (src/lib/firebase.ts signUpWithEmail/signInWithEmail)
// — Firebase Auth already verifies identity for that. What a client-issued
// ID token DOESN'T carry yet is a role custom claim, since only the Admin
// SDK can set those. This endpoint does that reconciliation, mirroring
// auth-telegram.ts so both paths land in the exact same response shape and
// App.tsx doesn't need to know which one a user came through.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Not signed in' });
  }
  const idToken = authHeader.slice('Bearer '.length).trim();

  let uid: string;
  try {
    const decoded = await getAdminAuth().verifyIdToken(idToken);
    uid = decoded.uid;
  } catch (err) {
    console.warn('[auth-web] ID token verification failed:', err instanceof Error ? err.message : err);
    return res.status(401).json({ error: 'Invalid session' });
  }

  try {
    const db = getAdminFirestore();
    const userRef = db.collection('users').doc(uid);
    const snap = await userRef.get();

    if (!snap.exists) {
      const customToken = await getAdminAuth().createCustomToken(uid, { role: 'unregistered' });
      return res.status(200).json({ customToken, user: null });
    }

    const data = snap.data()!;
    const userRecord = {
      name: data.name ?? '',
      role: data.role ?? 'student',
      studentId: data.studentId,
      classId: data.classId,
      guardianUid: data.guardianUid,
      subscriptionActive: data.subscriptionActive ?? false,
      unlockedLessons: data.unlockedLessons ?? {}
    };

    const customToken = await getAdminAuth().createCustomToken(uid, { role: userRecord.role });

    return res.status(200).json({
      customToken,
      user: { uid, ...userRecord }
    });
  } catch (err) {
    console.error('[auth-web] Failed to establish session', err);
    const message = err instanceof Error ? err.message : 'Unable to establish session';
    return res.status(500).json({ error: message });
  }
}
