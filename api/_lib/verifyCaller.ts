import type { VercelRequest } from '@vercel/node';
import { getAdminAuth } from './firebaseAdmin';

export interface VerifiedCaller {
  uid: string;
  role: string;
}

/**
 * Verifies the Firebase ID token in the Authorization header and returns
 * the caller's real identity — uid works the same whether it came from a
 * Telegram-derived custom token or a normal Firebase email/password
 * account, so every endpoint downstream of this is auth-method-agnostic.
 */
export async function verifyCaller(req: VercelRequest): Promise<VerifiedCaller | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;

  const idToken = authHeader.slice('Bearer '.length).trim();
  if (!idToken) return null;

  try {
    const decoded = await getAdminAuth().verifyIdToken(idToken);
    return { uid: decoded.uid, role: typeof decoded.role === 'string' ? decoded.role : 'unregistered' };
  } catch (err) {
    console.warn('[verifyCaller] Token verification failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
