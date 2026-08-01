import type { VercelRequest } from '@vercel/node';
import { getAdminAuth } from './firebaseAdmin';

export interface VerifiedCaller {
  telegramId: string;
  role: string;
}

/**
 * Verifies the Firebase ID token in the Authorization header and returns
 * the caller's real identity (telegramId == Firebase uid, plus their role
 * claim) — or null if there's no valid token.
 *
 * Several endpoints (initialize-payment, livekit-token, vet-teacher,
 * ai-tutor) originally trusted a `telegramId`/`studentId`/`applicantId`
 * field straight out of the request body with no verification at all,
 * meaning anyone who could see the network request could call them as any
 * user. This closes that gap: callers must send
 * `Authorization: Bearer <idToken>` (obtained via
 * `auth.currentUser.getIdToken()` client-side, see src/lib/firebase.ts),
 * and every identity-sensitive field is derived from the VERIFIED token,
 * never trusted from the body.
 */
export async function verifyCaller(req: VercelRequest): Promise<VerifiedCaller | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;

  const idToken = authHeader.slice('Bearer '.length).trim();
  if (!idToken) return null;

  try {
    const decoded = await getAdminAuth().verifyIdToken(idToken);
    return { telegramId: decoded.uid, role: typeof decoded.role === 'string' ? decoded.role : 'student' };
  } catch (err) {
    console.warn('[verifyCaller] Token verification failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
