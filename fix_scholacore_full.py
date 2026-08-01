#!/usr/bin/env python3
"""
ScholaCore: Groq swap + full security audit fixes.

Writes 11 files (2 new, 9 modified) and runs git add / commit / push
automatically. See the printed summary at the end for what changed and
the one manual step (adding GROQ_API_KEY in Vercel) this script can't do
for you.

Run with:
    python fix_scholacore_full.py

If your project folder isn't at the path below, edit PROJECT_DIR first.
"""
import subprocess
import sys
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except AttributeError:
    pass

PROJECT_DIR = Path(r"C:\Users\Bosslady\SCHOLACORE\scholacore")

VERIFY_CALLER_TS = r'''import type { VercelRequest } from '@vercel/node';
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
'''

AI_TUTOR_TS = r'''import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyCaller } from './_lib/verifyCaller';

interface AiTutorBody {
  studentQuestion: string;
  lessonContext: string;
}

function isValidBody(body: unknown): body is AiTutorBody {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.studentQuestion === 'string' &&
    b.studentQuestion.trim().length > 0 &&
    typeof b.lessonContext === 'string'
  );
}

const SYSTEM_INSTRUCTION = `You are the ScholaCore AI Tutor, a patient and encouraging teaching
assistant for Nigerian secondary school students (JSS1 through SSS3).

Rules:
- Explain concepts simply, using relatable, locally-relevant examples where helpful.
- Be warm and empathetic — many students asking are stuck or frustrated. Never make a
  student feel bad for not knowing something.
- Ground every answer in the provided lesson context first; if the question goes beyond
  it, answer helpfully but note it's outside today's lesson.
- Break down multi-step answers (especially Math and Science) into clear numbered steps.
- Keep answers focused — a paragraph or two, plus steps/examples where relevant. Avoid
  overwhelming a teenager with a wall of text.
- Never do a student's homework or exam question for them wholesale; guide them to the
  answer with explanation and a worked example, then a similar practice prompt.
- If a question is inappropriate, off-topic, or unsafe, gently redirect to the lesson.`;

interface GroqChatResponse {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.error('[ai-tutor] Missing GROQ_API_KEY');
    return res.status(500).json({ error: 'AI tutor service misconfigured' });
  }

  // Without this, anyone who finds this URL (it's public, no secret in the
  // path) could hammer it for free and burn through Groq's rate-limited
  // free tier without ever opening the app.
  const caller = await verifyCaller(req);
  if (!caller) {
    return res.status(401).json({ error: 'Not signed in' });
  }

  if (!isValidBody(req.body)) {
    return res.status(400).json({ error: 'Invalid payload. Required: studentQuestion, lessonContext.' });
  }

  const { studentQuestion, lessonContext } = req.body;

  try {
    // Groq's Chat Completions API is OpenAI-shaped: POST to
    // /openai/v1/chat/completions with a Bearer token — no SDK needed,
    // matching the plain-fetch style already used for Paystack/Telegram
    // elsewhere in this codebase. openai/gpt-oss-20b is Groq's fast
    // general-purpose model (roughly 1000 tok/s on their LPU hardware),
    // plenty for a conversational tutor, and available on Groq's free tier.
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-20b',
        messages: [
          { role: 'system', content: SYSTEM_INSTRUCTION },
          {
            role: 'user',
            content: `LESSON CONTEXT:\n${lessonContext}\n\nSTUDENT QUESTION:\n${studentQuestion}`
          }
        ],
        temperature: 0.6,
        max_completion_tokens: 800
      })
    });

    const data = (await groqRes.json()) as GroqChatResponse;

    if (!groqRes.ok) {
      console.error('[ai-tutor] Groq rejected the request', data);
      return res.status(502).json({ error: data.error?.message || 'AI tutor request failed' });
    }

    const answer = data.choices?.[0]?.message?.content?.trim();

    if (!answer) {
      return res.status(502).json({ error: 'AI tutor returned an empty response' });
    }

    return res.status(200).json({ answer });
  } catch (err) {
    console.error('[ai-tutor] Groq request failed', err);
    return res.status(500).json({ error: 'Unable to reach the AI tutor right now' });
  }
}
'''

VET_TEACHER_TS = r'''import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAdminFirestore } from './_lib/firebaseAdmin';
import { verifyCaller } from './_lib/verifyCaller';

interface VetTeacherBody {
  fullName: string;
  specialties: string[];
  essayAnswers: Record<string, string>;
}

interface VetResult {
  score: number;
  summary: string;
  recommendation: 'HIRE' | 'INTERVIEW' | 'REJECT';
}

function isValidBody(body: unknown): body is VetTeacherBody {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.fullName === 'string' &&
    Array.isArray(b.specialties) &&
    typeof b.essayAnswers === 'object' &&
    b.essayAnswers !== null
  );
}

const SYSTEM_INSTRUCTION = `You are ScholaCore's pedagogical screening AI, assisting the principal's
office in evaluating secondary school teacher applicants (JSS1–SSS3).

Assess essay answers for:
- Subject mastery and accuracy appropriate to secondary education.
- Pedagogical reasoning: does the applicant explain HOW they'd teach a concept, not just
  what it is?
- Classroom management and empathy for teenage learners.
- Clarity of communication (a teacher's writing reflects how they'll explain things).

Score 0-100. Calibrate roughly: 85+ HIRE-caliber, 60-84 INTERVIEW-caliber (promising but
needs a conversation), below 60 REJECT (significant gaps). Be fair and consistent — do not
inflate scores out of politeness. Provide a concise, specific summary a principal can act
on in under 30 seconds of reading.`;

interface GroqChatResponse {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.error('[vet-teacher] Missing GROQ_API_KEY');
    return res.status(500).json({ error: 'Vetting service misconfigured' });
  }

  // Previously `applicantId` came straight from the request body, meaning
  // anyone could overwrite a DIFFERENT applicant's score/status just by
  // sending their ID. It's now taken from the verified token instead.
  const caller = await verifyCaller(req);
  if (!caller) {
    return res.status(401).json({ error: 'Not signed in' });
  }
  const applicantId = caller.telegramId;

  if (!isValidBody(req.body)) {
    return res.status(400).json({
      error: 'Invalid payload. Required: fullName, specialties, essayAnswers.'
    });
  }

  const { fullName, specialties, essayAnswers } = req.body;

  const essayBlock = Object.entries(essayAnswers)
    .map(([question, answer]) => `Q: ${question}\nA: ${answer}`)
    .join('\n\n');

  try {
    // Groq's Structured Outputs (json_schema + strict: true) uses
    // constrained decoding, so the response is guaranteed to match this
    // schema exactly — same reliability guarantee the Gemini version had
    // via responseSchema, no retry/re-parse logic needed. Using
    // openai/gpt-oss-120b (the larger of Groq's two general-purpose
    // models) here rather than the -20b used in ai-tutor.ts, since this
    // task is a judgment call on a real hiring decision and is worth the
    // extra quality — it's not a latency-sensitive live chat.
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        messages: [
          { role: 'system', content: SYSTEM_INSTRUCTION },
          {
            role: 'user',
            content:
              `Applicant: ${fullName}\n` +
              `Declared specialties: ${specialties.join(', ')}\n\n` +
              `Essay responses:\n${essayBlock}`
          }
        ],
        temperature: 0.3,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'teacher_vetting_result',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                score: { type: 'integer', minimum: 0, maximum: 100 },
                summary: { type: 'string' },
                recommendation: { type: 'string', enum: ['HIRE', 'INTERVIEW', 'REJECT'] }
              },
              required: ['score', 'summary', 'recommendation'],
              additionalProperties: false
            }
          }
        }
      })
    });

    const data = (await groqRes.json()) as GroqChatResponse;

    if (!groqRes.ok) {
      console.error('[vet-teacher] Groq rejected the request', data);
      return res.status(502).json({ error: data.error?.message || 'Vetting request failed' });
    }

    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) {
      return res.status(502).json({ error: 'Vetting AI returned an empty response' });
    }

    let result: VetResult;
    try {
      result = JSON.parse(raw) as VetResult;
    } catch {
      console.error('[vet-teacher] Failed to parse Groq JSON output', raw);
      return res.status(502).json({ error: 'Vetting AI returned malformed output' });
    }

    // Clamp defensively even under strict schema mode — cheap insurance.
    result.score = Math.max(0, Math.min(100, Math.round(result.score)));

    const db = getAdminFirestore();
    await db.collection('teacherApplications').doc(applicantId).update({
      aiScore: result.score,
      aiSummary: result.summary,
      status: result.recommendation
    });

    return res.status(200).json(result);
  } catch (err) {
    console.error('[vet-teacher] Groq request failed', err);
    return res.status(500).json({ error: 'Unable to complete AI vetting right now' });
  }
}
'''

INITIALIZE_PAYMENT_TS = r'''import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyCaller } from './_lib/verifyCaller';
import { getAdminFirestore } from './_lib/firebaseAdmin';

// Naira amounts under this threshold ride Paystack's micro-transaction fee
// waiver, per ScholaCore's pay-per-lesson pricing model.
const MICRO_FEE_THRESHOLD_NAIRA = 2500;

interface InitializePaymentBody {
  email: string;
  lessonId?: string;
}

interface PaystackInitializeResponse {
  status: boolean;
  message: string;
  data?: {
    authorization_url: string;
    access_code: string;
    reference: string;
  };
}

interface FeeSchedule {
  tuition: number;
  mandatoryFees?: { name: string; amount: number }[];
  lessonMicroFee?: number;
}

function isValidBody(body: unknown): body is InitializePaymentBody {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return typeof b.email === 'string' && (b.lessonId === undefined || typeof b.lessonId === 'string');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) {
    console.error('[initialize-payment] Missing PAYSTACK_SECRET_KEY');
    return res.status(500).json({ error: 'Payment service misconfigured' });
  }

  // Identity is verified server-side, never trusted from the request body —
  // this used to accept `amountInNaira` and `studentId` directly from the
  // client, which meant anyone could initiate a payment for an arbitrary
  // amount against an arbitrary student. Both are now derived below.
  const caller = await verifyCaller(req);
  if (!caller) {
    return res.status(401).json({ error: 'Not signed in' });
  }

  if (!isValidBody(req.body)) {
    return res.status(400).json({ error: 'Invalid payload. Required: email.' });
  }

  const { email, lessonId } = req.body;

  try {
    const db = getAdminFirestore();

    // A parent's own account links to their child via `studentId`; a
    // student paying for themselves has no such link, so their own
    // telegramId IS the studentId. Either way this is looked up from
    // Firestore, not taken from anything the client sent.
    let studentId = caller.telegramId;
    if (caller.role === 'parent') {
      const callerDoc = await db.collection('users').doc(caller.telegramId).get();
      const linkedStudentId = callerDoc.data()?.studentId as string | undefined;
      if (!linkedStudentId) {
        return res.status(403).json({ error: 'No linked student found for this account' });
      }
      studentId = linkedStudentId;
    }

    const studentDoc = await db.collection('users').doc(studentId).get();
    if (!studentDoc.exists) {
      return res.status(404).json({ error: 'Student record not found' });
    }
    const classId = studentDoc.data()?.classId as string | undefined;
    if (!classId) {
      return res.status(400).json({ error: 'Student has no class assigned yet' });
    }

    const feeDoc = await db.collection('feeSchedules').doc(classId).get();
    if (!feeDoc.exists) {
      return res.status(404).json({ error: 'No fee schedule found for this class' });
    }
    const feeData = feeDoc.data() as FeeSchedule;

    // The authoritative amount is computed here, from Firestore, not from
    // the client. For a specific lesson, it's that lesson's micro-fee. For
    // a full-balance payment, it's tuition + mandatory fees minus whatever
    // has already been paid successfully — recomputed fresh each time so a
    // stale client-side balance can't be replayed for a stale (lower) price.
    let amountInNaira: number;
    if (lessonId) {
      if (!feeData.lessonMicroFee) {
        return res.status(400).json({ error: 'No per-lesson pricing configured for this class' });
      }
      amountInNaira = feeData.lessonMicroFee;
    } else {
      const mandatoryTotal = (feeData.mandatoryFees ?? []).reduce((sum, fee) => sum + fee.amount, 0);
      const totalDue = feeData.tuition + mandatoryTotal;

      const paidSnap = await db
        .collection('transactions')
        .where('studentId', '==', studentId)
        .where('status', '==', 'success')
        .get();
      const totalPaid = paidSnap.docs.reduce((sum, d) => sum + (Number(d.data().amount) || 0), 0);

      amountInNaira = Math.max(0, totalDue - totalPaid);
      if (amountInNaira <= 0) {
        return res.status(400).json({ error: 'This student\'s balance is already fully paid' });
      }
    }

    // Paystack expects the smallest currency unit (kobo). 1 Naira = 100 Kobo.
    const amountInKobo = Math.round(amountInNaira * 100);
    const isMicroPayment = amountInNaira < MICRO_FEE_THRESHOLD_NAIRA;

    const paystackRes = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email,
        amount: amountInKobo,
        currency: 'NGN',
        // Metadata round-trips through the webhook, letting us reconcile the
        // charge back to the right student/lesson/chat without a second DB
        // lookup at webhook time. Every value here came from server-side
        // lookups above, not from the request body.
        metadata: {
          studentId,
          lessonId: lessonId ?? null,
          telegramChatId: caller.telegramId,
          isMicroPayment,
          custom_fields: [
            { display_name: 'Student ID', variable_name: 'student_id', value: studentId },
            { display_name: 'Lesson ID', variable_name: 'lesson_id', value: lessonId ?? 'N/A' }
          ]
        },
        callback_url: process.env.PAYSTACK_CALLBACK_URL
      })
    });

    const data = (await paystackRes.json()) as PaystackInitializeResponse;

    if (!paystackRes.ok || !data.status || !data.data) {
      console.error('[initialize-payment] Paystack rejected the request', data);
      return res.status(502).json({ error: data.message || 'Payment initialization failed' });
    }

    return res.status(200).json({
      authorizationUrl: data.data.authorization_url,
      accessCode: data.data.access_code,
      reference: data.data.reference,
      amountInNaira
    });
  } catch (err) {
    console.error('[initialize-payment] Unexpected error', err);
    return res.status(500).json({ error: 'Unable to initialize payment' });
  }
}
'''

LIVEKIT_TOKEN_TS = r'''import type { VercelRequest, VercelResponse } from '@vercel/node';
import { AccessToken } from 'livekit-server-sdk';
import { verifyCaller } from './_lib/verifyCaller';
import { getAdminFirestore } from './_lib/firebaseAdmin';

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

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!apiKey || !apiSecret) {
    console.error('[livekit-token] Missing LIVEKIT_API_KEY/LIVEKIT_API_SECRET');
    return res.status(500).json({ error: 'Live classroom service misconfigured' });
  }

  // Previously this trusted a `telegramId` field straight from the request
  // body to decide canPublish — meaning anyone could ask for a teacher's
  // publish permissions just by sending that teacher's ID. The identity
  // used below always comes from a verified Firebase ID token instead.
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

    // A student may only join the classroom for their own enrolled class.
    if (!isTeacher && userData.classId !== classId) {
      return res.status(403).json({ error: 'Not enrolled in this class' });
    }

    const roomName = `class-${classId}`;

    const token = new AccessToken(apiKey, apiSecret, {
      identity: caller.telegramId,
      name: userData.name ?? caller.telegramId,
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
'''

FIREBASE_TS = r'''import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getAuth, signInWithCustomToken, type Auth } from 'firebase/auth';

// Firebase client config is public by design (it identifies the project,
// not a secret) — real access control lives in firestore.rules + custom
// auth claims, not in hiding these values. Populate with your ScholaCore
// Firebase project's web app config.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

/**
 * Firebase's own SDK fails with cryptic native browser errors when a config
 * value is missing or malformed — e.g. WebKit's
 * `TypeError: The string did not match the expected pattern.` when
 * authDomain isn't shaped like a real domain. That's almost always a Vercel
 * env var that's blank, or was pasted with a stray "https://" prefix,
 * quotes, or trailing whitespace.
 *
 * We check the obvious cases up front and surface them through
 * `firebaseConfigError` (read by App.tsx before it attempts sign-in)
 * instead of letting the SDK throw mid-call. This deliberately does NOT
 * throw at module scope — throwing here would happen before React mounts
 * anything, which on a phone inside Telegram just means a blank screen
 * with no way to read the message.
 */
function findFirebaseConfigProblem(config: typeof firebaseConfig): string | null {
  const required = ['apiKey', 'authDomain', 'projectId', 'appId'] as const;
  const missing = required.filter((key) => !config[key]);
  if (missing.length > 0) {
    return `Missing Firebase config in this deployment: ${missing.join(', ')}. Add these in Vercel → Settings → Environment Variables, then redeploy.`;
  }

  const authDomain = config.authDomain!;
  if (/^https?:\/\//i.test(authDomain)) {
    return `VITE_FIREBASE_AUTH_DOMAIN shouldn't include "https://" (got "${authDomain}"). It should look like your-project-id.firebaseapp.com.`;
  }
  if (/\s/.test(authDomain)) {
    return 'VITE_FIREBASE_AUTH_DOMAIN has a stray space or line break in it. Re-paste it in Vercel, then redeploy.';
  }
  if (/["']/.test(authDomain)) {
    return "VITE_FIREBASE_AUTH_DOMAIN has quote marks in it. Vercel doesn't need quotes around values — remove them, then redeploy.";
  }
  if (!authDomain.includes('.')) {
    return `VITE_FIREBASE_AUTH_DOMAIN looks incomplete ("${authDomain}"). It should look like your-project-id.firebaseapp.com.`;
  }

  return null;
}

export const firebaseConfigError = findFirebaseConfigProblem(firebaseConfig);

let appInstance: FirebaseApp;
let dbInstance: Firestore;
let authInstance: Auth;

try {
  appInstance = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  dbInstance = getFirestore(appInstance);
  authInstance = getAuth(appInstance);
} catch (err) {
  // Falls through to firebaseConfigError (or a fresh one, below) — App.tsx
  // never touches app/db/auth when an error is set, so leaving these
  // unassigned here is safe. The `as` casts just keep every OTHER file's
  // types simple (plain Firestore, not Firestore | undefined) since they
  // can never actually be reached in this failure path.
  console.error('[firebase] initialization failed:', err);
}

export const app = appInstance! as FirebaseApp;
export const db = dbInstance! as Firestore;
export const auth = authInstance! as Auth;

/**
 * Exchanges a server-minted Firebase custom token (produced from verified
 * Telegram initData — see lib/telegram.ts + api/auth-telegram.ts) for a
 * signed-in Firebase Auth session. This is what lets firestore.rules read
 * request.auth.token.role.
 */
export async function signInWithTelegramToken(customToken: string) {
  return signInWithCustomToken(auth, customToken);
}

/**
 * ID token for the currently signed-in user, to send as
 * `Authorization: Bearer <token>` on calls to endpoints that verify the
 * caller server-side (initialize-payment, livekit-token, vet-teacher,
 * ai-tutor — see api/_lib/verifyCaller.ts). Returns null if nobody's
 * signed in yet.
 */
export async function getAuthToken(): Promise<string | null> {
  if (!auth.currentUser) return null;
  return auth.currentUser.getIdToken();
}
'''

PAY_BUTTON_TSX = r'''import { useState } from 'react';
import PaystackPop from '@paystack/inline-js';
import { useScholaCoreUser } from '../App';
import { getAuthToken } from '../lib/firebase';
import { hapticError, hapticSuccess } from '../lib/telegram';

interface PayButtonProps {
  email: string;
  amountInNaira: number;
  lessonId?: string;
  label: string;
  onSuccess?: (reference: string) => void;
}

export default function PayButton({ email, amountInNaira, lessonId, label, onSuccess }: PayButtonProps) {
  const { telegramUser } = useScholaCoreUser();
  const [status, setStatus] = useState<'idle' | 'initializing' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handlePay = async () => {
    if (!telegramUser) return;
    setStatus('initializing');
    setErrorMessage(null);

    try {
      const token = await getAuthToken();
      if (!token) {
        throw new Error('Your session expired — please close and reopen the app.');
      }

      // studentId and the amount are deliberately NOT sent here — the
      // server derives both from the verified token + Firestore (see
      // api/initialize-payment.ts), so this client can't influence what
      // actually gets charged. amountInNaira above is only used for the
      // button's displayed label.
      const res = await fetch('/api/initialize-payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ email, lessonId })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Could not start payment');
      }

      // resumeTransaction() picks up a transaction that was already
      // initialized server-side (api/initialize-payment.ts) via the access
      // code — it doesn't need the Paystack public key, and critically it
      // means the amount charged is whatever the server set, not whatever
      // this client happens to send.
      const paystack = new PaystackPop();
      paystack.resumeTransaction(data.accessCode, {
        onSuccess: (transaction: { reference: string }) => {
          hapticSuccess();
          setStatus('idle');
          onSuccess?.(transaction.reference);
        },
        onCancel: () => {
          setStatus('idle');
        }
      });
    } catch (err) {
      hapticError();
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Payment failed to start');
    }
  };

  return (
    <div>
      <button
        onClick={handlePay}
        disabled={status === 'initializing'}
        className="w-full rounded-card bg-seal-500 px-4 py-3 text-sm font-semibold text-core-950 transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {status === 'initializing' ? 'Starting payment…' : `${label} — ₦${amountInNaira.toLocaleString('en-NG')}`}
      </button>
      {errorMessage && <p className="mt-2 text-xs text-signal-danger">{errorMessage}</p>}
    </div>
  );
}
'''

TEACHER_PORTAL_TSX = r'''import { useState } from 'react';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, getAuthToken } from '../lib/firebase';
import { useScholaCoreUser } from '../App';
import { hapticError, hapticSuccess } from '../lib/telegram';

const SUBJECTS = [
  'Mathematics',
  'English Language',
  'Biology',
  'Chemistry',
  'Physics',
  'Economics',
  'Government',
  'Literature in English',
  'Geography',
  'Further Mathematics',
  'Computer Studies',
  'Agricultural Science'
];

const ESSAY_QUESTIONS = [
  'Pick one of your specialties. How would you explain a concept students commonly struggle with to a JSS student who is lost?',
  "A student is falling behind and seems disengaged in class. What's your approach in the first two weeks?",
  'How do you check that students have genuinely understood a topic, beyond a quiz score?'
];

interface VetResult {
  score: number;
  summary: string;
  recommendation: 'HIRE' | 'INTERVIEW' | 'REJECT';
}

const RECOMMENDATION_STYLE: Record<VetResult['recommendation'], string> = {
  HIRE: 'bg-signal-success/10 text-signal-success',
  INTERVIEW: 'bg-signal-pending/10 text-signal-pending',
  REJECT: 'bg-signal-danger/10 text-signal-danger'
};

export default function TeacherPortal() {
  const { telegramUser } = useScholaCoreUser();
  const [fullName, setFullName] = useState('');
  const [cvUrl, setCvUrl] = useState('');
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [essayAnswers, setEssayAnswers] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<'form' | 'submitting' | 'result'>('form');
  const [result, setResult] = useState<VetResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const toggleSpecialty = (subject: string) => {
    setSpecialties((prev) => (prev.includes(subject) ? prev.filter((s) => s !== subject) : [...prev, subject]));
  };

  const isValid =
    fullName.trim().length > 1 &&
    /^https?:\/\/\S+$/.test(cvUrl.trim()) &&
    specialties.length > 0 &&
    ESSAY_QUESTIONS.every((q) => (essayAnswers[q] ?? '').trim().length >= 40);

  const handleSubmit = async () => {
    if (!telegramUser || !isValid) return;
    setStatus('submitting');
    setErrorMessage(null);

    const applicantId = telegramUser.telegramId;

    try {
      // The client writes the raw application — allowed because it's
      // self-created, contains no aiScore/aiSummary, and status is
      // SUBMITTED (see firestore.rules). The score gets filled in
      // immediately after via the Admin SDK in /api/vet-teacher, which a
      // client can never write to directly.
      await setDoc(doc(db, 'teacherApplications', applicantId), {
        fullName: fullName.trim(),
        cvUrl: cvUrl.trim(),
        specialties,
        essayAnswers,
        status: 'SUBMITTED',
        submittedAt: serverTimestamp()
      });

      const token = await getAuthToken();
      if (!token) {
        throw new Error('Your session expired — please close and reopen the app.');
      }

      const res = await fetch('/api/vet-teacher', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ fullName: fullName.trim(), specialties, essayAnswers })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'AI screening failed');
      }

      setResult(data as VetResult);
      setStatus('result');
      hapticSuccess();
    } catch (err) {
      hapticError();
      setErrorMessage(err instanceof Error ? err.message : 'Could not submit application');
      setStatus('form');
    }
  };

  if (status === 'result' && result) {
    return (
      <div className="space-y-4">
        <div className="rounded-card border border-core-100 bg-white p-6 text-center">
          <p className="font-mono text-[10px] uppercase tracking-widest text-core-500">AI screening result</p>
          <p className="mt-2 font-display text-4xl text-core-900">{result.score}</p>
          <p className="text-xs text-core-500">out of 100</p>
          <span
            className={`mt-3 inline-block rounded-full px-3 py-1 text-xs font-semibold ${RECOMMENDATION_STYLE[result.recommendation]}`}
          >
            {result.recommendation}
          </span>
          <p className="mt-4 text-left text-sm text-core-700">{result.summary}</p>
        </div>
        <p className="text-center text-xs text-core-500">
          The principal's office will follow up with next steps based on this recommendation.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-xl text-core-900">Teacher recruitment</h2>
        <p className="text-sm text-core-600">Apply to teach at ScholaCore Academy.</p>
      </div>

      <div className="space-y-3 rounded-card border border-core-100 bg-white p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-core-700">Full name</label>
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full rounded-card border border-core-100 px-3 py-2 text-sm focus:border-seal-500"
            placeholder="e.g. Mr. Tunde Bakare"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-core-700">CV link</label>
          <input
            value={cvUrl}
            onChange={(e) => setCvUrl(e.target.value)}
            className="w-full rounded-card border border-core-100 px-3 py-2 text-sm focus:border-seal-500"
            placeholder="Link to your CV (Google Drive, Dropbox, etc.)"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-core-700">Specialties</label>
          <div className="flex flex-wrap gap-2">
            {SUBJECTS.map((subject) => (
              <button
                type="button"
                key={subject}
                onClick={() => toggleSpecialty(subject)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  specialties.includes(subject)
                    ? 'border-seal-500 bg-seal-500/10 text-core-900'
                    : 'border-core-100 text-core-600 hover:bg-core-50'
                }`}
              >
                {subject}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {ESSAY_QUESTIONS.map((q) => (
          <div key={q} className="rounded-card border border-core-100 bg-white p-4">
            <label className="mb-2 block text-xs font-medium text-core-700">{q}</label>
            <textarea
              value={essayAnswers[q] ?? ''}
              onChange={(e) => setEssayAnswers((prev) => ({ ...prev, [q]: e.target.value }))}
              rows={4}
              className="w-full rounded-card border border-core-100 px-3 py-2 text-sm focus:border-seal-500"
              placeholder="At least a few sentences…"
            />
          </div>
        ))}
      </div>

      <button
        onClick={handleSubmit}
        disabled={!isValid || status === 'submitting'}
        className="w-full rounded-card bg-core-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
      >
        {status === 'submitting' ? 'Submitting for AI screening…' : 'Submit application'}
      </button>
      {errorMessage && <p className="text-xs text-signal-danger">{errorMessage}</p>}
    </div>
  );
}
'''

LIVE_CLASSROOM_TSX = r'''import { useState } from 'react';
import { LiveKitRoom, VideoConference, RoomAudioRenderer, formatChatMessageLinks } from '@livekit/components-react';
import '@livekit/components-styles';
import { useScholaCoreUser } from '../App';
import { getAuthToken } from '../lib/firebase';

const LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL as string; // wss://<project>.livekit.cloud

interface ClassroomSession {
  token: string;
  room: string;
  canPublish: boolean;
}

export default function LiveClassroom() {
  const { telegramUser, userRecord } = useScholaCoreUser();
  const [session, setSession] = useState<ClassroomSession | null>(null);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const classId = userRecord?.classId;

  const joinClass = async () => {
    if (!telegramUser || !classId) return;
    setStatus('connecting');
    setErrorMessage(null);

    try {
      const token = await getAuthToken();
      if (!token) {
        throw new Error('Your session expired — please close and reopen the app.');
      }

      const res = await fetch('/api/livekit-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ classId })
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Could not join classroom');
      }

      setSession(data);
      setStatus('idle');
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Could not join classroom');
    }
  };

  if (!classId) {
    return (
      <div className="rounded-card border border-core-100 bg-white p-4">
        <p className="text-sm text-core-700">
          You're not yet assigned to a class. This unlocks once admissions confirms your placement.
        </p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-card border border-core-100 bg-white p-8 text-center">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-core-500">Live classroom</p>
          <h2 className="mt-1 font-display text-lg text-core-900">Class {classId}</h2>
        </div>
        <p className="text-sm text-core-600">Join when your teacher starts the session.</p>
        <button
          onClick={joinClass}
          disabled={status === 'connecting'}
          className="rounded-card bg-core-900 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {status === 'connecting' ? 'Connecting…' : 'Join class'}
        </button>
        {errorMessage && <p className="text-xs text-signal-danger">{errorMessage}</p>}
      </div>
    );
  }

  return (
    <div className="h-[75vh] overflow-hidden rounded-card border border-core-100">
      <LiveKitRoom
        serverUrl={LIVEKIT_URL}
        token={session.token}
        connect
        video={session.canPublish}
        audio={session.canPublish}
        data-lk-theme="default"
        onDisconnected={() => setSession(null)}
        style={{ height: '100%' }}
      >
        {/*
          Prebuilt LiveKit UI: grid layout, device controls, screen share,
          and chat all come for free here. Whether a participant's own
          publish controls actually do anything is enforced server-side by
          the `canPublish` grant baked into the token (see
          api/livekit-token.ts) — a student toggling their camera on in this
          UI still can't broadcast, since the room itself rejects the
          publish. This is UI-level courtesy, not the security boundary.
        */}
        <VideoConference chatMessageFormatter={formatChatMessageLinks} />
        <RoomAudioRenderer />
      </LiveKitRoom>
    </div>
  );
}
'''

FIRESTORE_RULES = r'''rules_version = '2';

// ScholaCore Systems — Firestore RBAC
//
// Roles: student, parent, teacher, bursar, principal
//
// Identity model: Firebase Auth users are signed in via a custom token minted
// server-side (api/*.ts, using firebase-admin) from the verified Telegram
// initData. The custom token's uid == the user's Telegram ID (string), and a
// custom claim `role` is attached at mint time. We trust request.auth.token.role
// rather than re-reading /users/{uid} on every rule (cheaper, avoids rule
// recursion), but role changes require re-minting the token, which the auth
// endpoint does whenever a user's Firestore role document changes.

match /databases/{database}/documents {

  // ---- helpers ----
  function isSignedIn() {
    return request.auth != null;
  }

  function uid() {
    return request.auth.uid;
  }

  function role() {
    return request.auth.token.role;
  }

  function hasRole(r) {
    return isSignedIn() && role() == r;
  }

  function hasAnyRole(roles) {
    return isSignedIn() && role() in roles;
  }

  function isStaff() {
    // Teachers, bursars, and principals all count as internal staff for
    // read access to operational collections.
    return hasAnyRole(['teacher', 'bursar', 'principal']);
  }

  function isSelf(telegramId) {
    return isSignedIn() && uid() == telegramId;
  }

  function isGuardianOf(userDoc) {
    return isSignedIn() &&
      role() == 'parent' &&
      userDoc.data.guardianTelegramId == uid();
  }

  // ---------------------------------------------------------------------
  // /users/{telegramId}
  // Profile + role + unlockedLessons map. Students/parents can read their
  // own linked record; staff can read broadly for admin purposes. Writes
  // to `role` and `unlockedLessons` are staff/webhook-only — a student must
  // never be able to grant themselves a paid lesson or promote their role.
  // ---------------------------------------------------------------------
  match /users/{telegramId} {
    allow read: if isSelf(telegramId) || isGuardianOf(resource) || isStaff();

    allow create: if isSelf(telegramId) &&
      request.resource.data.role in ['student', 'parent'] &&
      request.resource.data.unlockedLessons == null;

    // A student/parent may only touch their own non-sensitive profile
    // fields (name); role and unlockedLessons are locked down to staff
    // or the trusted webhook (which writes via the Admin SDK and bypasses
    // these rules entirely).
    allow update: if (isSelf(telegramId) &&
        request.resource.data.diff(resource.data).affectedKeys()
          .hasOnly(['name'])) ||
      hasAnyRole(['bursar', 'principal']);

    allow delete: if hasRole('principal');
  }

  // ---------------------------------------------------------------------
  // /feeSchedules/{classId}
  // Public-ish reference data for the school's fee structure. Any signed-in
  // user can read (needed to render the Bursary Dashboard); only bursar/
  // principal can define or change fees.
  // ---------------------------------------------------------------------
  match /feeSchedules/{classId} {
    allow read: if isSignedIn();
    allow write: if hasAnyRole(['bursar', 'principal']);
  }

  // ---------------------------------------------------------------------
  // /transactions/{reference}
  // Payment ledger. Written exclusively by the Paystack webhook via the
  // Admin SDK (service-account, bypasses rules). Client reads are
  // restricted to the owning student (or their guardian) and finance staff.
  // No client-side create/update/delete — this must always be
  // server-attested, since it's the source of truth for unlocking content.
  // ---------------------------------------------------------------------
  match /transactions/{reference} {
    allow read: if isSignedIn() && (
      resource.data.studentId == uid() ||
      hasAnyRole(['bursar', 'principal']) ||
      (role() == 'parent' && exists(/databases/$(database)/documents/users/$(resource.data.studentId)) &&
        get(/databases/$(database)/documents/users/$(resource.data.studentId)).data.guardianTelegramId == uid())
    );
    allow write: if false;
  }

  // ---------------------------------------------------------------------
  // /teacherApplications/{applicantId}
  // AI-vetted recruitment pipeline. Applicants create their own record and
  // may read it back to see status; only principal/teacher (reviewers) can
  // read the full pool, and only server-side (vet-teacher.ts, Admin SDK)
  // writes aiScore/aiSummary — a client must never be able to set their own
  // score. Principal may update status (HIRE/INTERVIEW/REJECT -> final).
  // ---------------------------------------------------------------------
  match /teacherApplications/{applicantId} {
    allow read: if isSelf(applicantId) || hasAnyRole(['teacher', 'principal']);

    allow create: if isSelf(applicantId) &&
      !('aiScore' in request.resource.data) &&
      !('aiSummary' in request.resource.data) &&
      request.resource.data.status == 'SUBMITTED';

    // An applicant can re-save their own application (e.g. TeacherPortal's
    // setDoc runs a second time after a network hiccup) only while it's
    // still in SUBMITTED — i.e. before AI scoring or a principal's
    // decision has landed. vet-teacher.ts writes aiScore/aiSummary/status
    // via the Admin SDK immediately after create, which bypasses rules
    // entirely, so this window only matters if that call never completed.
    // Once status moves to HIRE/INTERVIEW/REJECT, only principal can touch
    // the record — the applicant can no longer edit a decision that's
    // already been made.
    allow update: if (
        isSelf(applicantId) &&
        resource.data.status == 'SUBMITTED' &&
        request.resource.data.status == 'SUBMITTED' &&
        !('aiScore' in request.resource.data) &&
        !('aiSummary' in request.resource.data)
      ) ||
      (hasRole('principal') &&
        request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status']));

    allow delete: if hasRole('principal');
  }

  // ---------------------------------------------------------------------
  // /applications/{applicationId}
  // Student admissions pipeline (placement test -> PENDING_FEE -> ENROLLED).
  // A prospective family creates their own application; principal/bursar
  // manage status transitions (e.g. marking ENROLLED once fees clear).
  // ---------------------------------------------------------------------
  match /applications/{applicationId} {
    allow read: if isSignedIn() && (
      resource.data.parentContact.telegramId == uid() ||
      hasAnyRole(['bursar', 'principal'])
    );

    allow create: if isSignedIn() &&
      request.resource.data.status == 'PENDING_FEE' &&
      request.resource.data.parentContact.telegramId == uid();

    allow update: if hasAnyRole(['bursar', 'principal']);
    allow delete: if hasRole('principal');
  }

  // ---------------------------------------------------------------------
  // /classes/{classId}/lessons/{lessonId}
  // Curriculum content. Metadata (title, isPremium) is readable by any
  // signed-in user so the UI can render locked/unlocked states; the actual
  // `content`/`videoUrl` fields for premium lessons should be fetched via a
  // server endpoint that checks unlockedLessons rather than direct client
  // reads, but we still gate the document read itself as defense in depth.
  // Only teaching staff can author lessons.
  // ---------------------------------------------------------------------
  match /classes/{classId}/lessons/{lessonId} {
    allow read: if isSignedIn() && (
      resource.data.isPremium == false ||
      isStaff() ||
      get(/databases/$(database)/documents/users/$(uid())).data.unlockedLessons[lessonId] == true
    );
    allow write: if hasAnyRole(['teacher', 'principal']);
  }

  // Deny everything else by default.
  match /{document=**} {
    allow read, write: if false;
  }
}
'''

PACKAGE_JSON = r'''{
  "name": "scholacore-platform",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "lint": "eslint . --ext ts,tsx"
  },
  "dependencies": {
    "@livekit/components-react": "^2.6.7",
    "@livekit/components-styles": "^1.1.4",
    "@paystack/inline-js": "^2.22.0",
    "@telegram-apps/sdk-react": "^2.0.15",
    "firebase": "^10.13.0",
    "firebase-admin": "^12.4.0",
    "livekit-client": "^2.5.7",
    "livekit-server-sdk": "^2.7.2",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vercel/node": "^3.2.0",
    "@vitejs/plugin-react": "^4.3.1",
    "autoprefixer": "^10.4.19",
    "postcss": "^8.4.39",
    "tailwindcss": "^3.4.4",
    "typescript": "^5.5.3",
    "vite": "^5.3.1"
  }
}
'''

FILES = {
    PROJECT_DIR / "api" / "_lib" / "verifyCaller.ts": VERIFY_CALLER_TS,
    PROJECT_DIR / "api" / "ai-tutor.ts": AI_TUTOR_TS,
    PROJECT_DIR / "api" / "vet-teacher.ts": VET_TEACHER_TS,
    PROJECT_DIR / "api" / "initialize-payment.ts": INITIALIZE_PAYMENT_TS,
    PROJECT_DIR / "api" / "livekit-token.ts": LIVEKIT_TOKEN_TS,
    PROJECT_DIR / "src" / "lib" / "firebase.ts": FIREBASE_TS,
    PROJECT_DIR / "src" / "components" / "PayButton.tsx": PAY_BUTTON_TSX,
    PROJECT_DIR / "src" / "components" / "TeacherPortal.tsx": TEACHER_PORTAL_TSX,
    PROJECT_DIR / "src" / "components" / "LiveClassroom.tsx": LIVE_CLASSROOM_TSX,
    PROJECT_DIR / "firestore.rules": FIRESTORE_RULES,
    PROJECT_DIR / "package.json": PACKAGE_JSON,
}


def write_files():
    print("== Writing files ==")
    for path, content in FILES.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        print("  wrote " + str(path.relative_to(PROJECT_DIR)))


def run_git(args, allow_fail_msg=None):
    result = subprocess.run(
        ["git"] + args, cwd=str(PROJECT_DIR), capture_output=True, text=True
    )
    output = (result.stdout + result.stderr).strip()
    if output:
        print(output)
    if result.returncode != 0 and allow_fail_msg:
        print("  (ok - " + allow_fail_msg + ")")
    return result.returncode


def main():
    if not PROJECT_DIR.exists():
        print("ERROR: " + str(PROJECT_DIR) + " does not exist.")
        print("Edit PROJECT_DIR at the top of this script to match your actual folder, then re-run.")
        sys.exit(1)

    if not (PROJECT_DIR / ".git").exists():
        print("ERROR: " + str(PROJECT_DIR) + " is not a git repo (no .git folder found).")
        sys.exit(1)

    write_files()

    print("\n== git add ==")
    run_git(["add", "-A"])

    print("\n== git commit ==")
    run_git(
        ["commit", "-m", "Swap Gemini for Groq + close identity/price-spoofing gaps"],
        allow_fail_msg="nothing new to commit, files already matched",
    )

    print("\n== git push ==")
    code = run_git(["push"])
    if code != 0:
        print("\ngit push reported an error above (auth prompt needed? no upstream set?).")
        print("Everything else is done - just run 'git push' yourself to finish.")
        sys.exit(1)

    print("\n" + "=" * 60)
    print("Done. Vercel should auto-redeploy in about 1-2 minutes.")
    print("=" * 60)
    print("\nWhat changed:")
    print("  - ai-tutor.ts, vet-teacher.ts: now call Groq instead of Gemini")
    print("  - initialize-payment.ts, livekit-token.ts, vet-teacher.ts,")
    print("    ai-tutor.ts: now verify WHO is calling instead of trusting")
    print("    an ID field in the request body (see git log for details)")
    print("  - initialize-payment.ts: price is now looked up server-side")
    print("    from Firestore instead of trusted from the client")
    print("  - firestore.rules: fixed a bug where re-submitting a teacher")
    print("    application would fail with a permission error")
    print("\nIMPORTANT - one manual step this script can't do for you:")
    print("  In Vercel -> your project -> Settings -> Environment Variables:")
    print("    1. Add GROQ_API_KEY (get a free key at https://console.groq.com/keys)")
    print("    2. GEMINI_API_KEY can stay or be removed - it's just unused now")
    print("  Then redeploy if you added the key after this push already landed.")
    print("\nAlso: if you deploy firestore.rules separately (not just via git push),")
    print("  run 'firebase deploy --only firestore:rules' too.")


if __name__ == "__main__":
    main()
