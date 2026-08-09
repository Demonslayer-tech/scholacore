import type { VercelRequest, VercelResponse } from '@vercel/node';
import { AccessToken } from 'livekit-server-sdk';
import { verifyCaller } from './_lib/verifyCaller';
import { getAdminFirestore } from './_lib/firebaseAdmin';
import { getEnv } from './_lib/env';

interface TokenRequestBody {
  classId: string;
}

function isValidBody(body: unknown): body is TokenRequestBody {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return typeof b.classId === 'string';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = getEnv('LIVEKIT_API_KEY');
  const apiSecret = getEnv('LIVEKIT_API_SECRET');
  if (!apiKey || !apiSecret) {
    console.error('[livekit-token] Missing LIVEKIT_API_KEY/LIVEKIT_API_SECRET');
    return res.status(500).json({ error: 'Live classroom service misconfigured' });
  }

  const caller = await verifyCaller(req);
  if (!caller) {
    return res.status(401).json({ error: 'Not signed in' });
  }

  if (!isValidBody(req.body)) {
    return res.status(400).json({ error: 'Invalid payload. Required: classId.' });
  }

  const { classId } = req.body;

  try {
    const db = getAdminFirestore();
    const userSnap = await db.collection('users').doc(caller.telegramId).get();

    if (!userSnap.exists) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userData = userSnap.data()!;
    const isTeacher = userData.role === 'teacher' || userData.role === 'principal';

    if (!isTeacher && userData.classId !== classId) {
      return res.status(403).json({ error: 'Not enrolled in this class' });
    }

    const roomName = `class-${classId}`;

    const token = new AccessToken(apiKey, apiSecret, {
      identity: caller.telegramId,
      name: userData.name ?? caller.telegramId,
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
