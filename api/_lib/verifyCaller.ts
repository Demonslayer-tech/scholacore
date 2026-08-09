import type { VercelRequest } from '@vercel/node';
import { getAdminAuth } from './firebaseAdmin';

export interface VerifiedCaller {
  telegramId: string;
  role: string;
}

export async function verifyCaller(req: VercelRequest): Promise<VerifiedCaller | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;

  const idToken = authHeader.slice('Bearer '.length).trim();
  if (!idToken) return null;

  try {
    const decoded = await getAdminAuth().verifyIdToken(idToken);
    // Fail closed: if a verified token is ever missing its role claim,
    // default to the same least-privilege role brand-new users get
    // ('unregistered'), not 'student'. A real role should only ever come
    // from an explicit claim minted by our own signup/auth endpoints.
    return { telegramId: decoded.uid, role: typeof decoded.role === 'string' ? decoded.role : 'unregistered' };
  } catch (err) {
    console.warn('[verifyCaller] Token verification failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
