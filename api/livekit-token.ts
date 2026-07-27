import type { VercelRequest, VercelResponse } from '@vercel/node';
import { AccessToken } from 'livekit-server-sdk';
import { getAdminFirestore } from './_lib/firebaseAdmin';

interface TokenRequestBody {
  telegramId: string;
  classId: string;
}

function isValidBody(body: unknown): body is TokenRequestBody {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return typeof b.telegramId === 'string' && typeof b.classId === 'string';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!apiKey || !apiSecret) {
    console.error('[livekit-token] Missing LIVEKIT_API_KEY/LIVEKIT_API_SECRET');
    return res.status(500).json({ error: 'Live classroom service misconfigured' });
  }

  if (!isValidBody(req.body)) {
    return res.status(400).json({ error: 'Invalid payload. Required: telegramId, classId.' });
  }

  const { telegramId, classId } = req.body;

  try {
    // Role is looked up server-side from Firestore rather than trusted from
    // the client — a student sending { role: "teacher" } in the request
    // body must never be able to grant themselves publish permissions.
    const db = getAdminFirestore();
    const userSnap = await db.collection('users').doc(telegramId).get();

    if (!userSnap.exists) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userData = userSnap.data()!;
    const isTeacher = userData.role === 'teacher' || userData.role === 'principal';

    // A student may only join the classroom for their own enrolled class.
    if (!isTeacher && userData.classId !== classId) {
      return res.status(403).json({ error: 'Not enrolled in this class' });
    }

    const roomName = `class-${classId}`;

    const token = new AccessToken(apiKey, apiSecret, {
      identity: telegramId,
      name: userData.name ?? telegramId,
      // Short-lived — a student re-requests a fresh token each time they
      // join, rather than holding a long-lived credential.
      ttl: '15m'
    });

    token.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: isTeacher,
      canPublishData: true,
      canSubscribe: true
    });

    const jwt = await token.toJwt();

    return res.status(200).json({ token: jwt, room: roomName, canPublish: isTeacher });
  } catch (err) {
    console.error('[livekit-token] Failed to issue token', err);
    return res.status(500).json({ error: 'Unable to issue classroom token' });
  }
}
