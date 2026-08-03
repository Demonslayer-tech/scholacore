#!/usr/bin/env python3
"""
ScholaCore: final consolidated fix.

Re-writes every file that's changed across this whole debugging session
(so it's correct regardless of which earlier scripts did or didn't fully
land), THEN deletes and regenerates package-lock.json via `npm install` -
that lockfile was out of sync with package.json (still listed the removed
@google/genai dependency), which breaks `npm ci`, which is what Vercel
actually runs to install dependencies. That mismatch has very likely been
silently failing every build since the Groq swap.

Run with:
    python fix_scholacore_final.py

If your project folder isn't at the path below, edit PROJECT_DIR first.
This one takes longer than the others (npm install runs for real) - let
it finish, it can take a minute or two.
"""
import subprocess
import sys
import shutil
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except AttributeError:
    pass

PROJECT_DIR = Path(r"C:\Users\Bosslady\SCHOLACORE\scholacore")


def find_executable(name):
    """On Windows, npm/npx are .cmd shim files, not directly-executable
    binaries - subprocess.run() can't launch those the way it launches an
    .exe without extra help. shutil.which() resolves the real path
    (checking PATHEXT, which includes .CMD by default on Windows); this
    is what actually broke last run (FileNotFoundError: WinError 2)."""
    resolved = shutil.which(name)
    if resolved:
        return resolved
    if sys.platform == "win32":
        resolved = shutil.which(name + ".cmd")
        if resolved:
            return resolved
    return name

VERIFY_CALLER_TS = r'''import type { VercelRequest } from '@vercel/node';
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

  const caller = await verifyCaller(req);
  if (!caller) {
    return res.status(401).json({ error: 'Not signed in' });
  }

  if (!isValidBody(req.body)) {
    return res.status(400).json({ error: 'Invalid payload. Required: studentQuestion, lessonContext.' });
  }

  const { studentQuestion, lessonContext } = req.body;

  try {
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
'''

FIREBASE_TS = r'''import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getAuth, signInWithCustomToken, type Auth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

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
  console.error('[firebase] initialization failed:', err);
}

export const app = appInstance! as FirebaseApp;
export const db = dbInstance! as Firestore;
export const auth = authInstance! as Auth;

export async function signInWithTelegramToken(customToken: string) {
  return signInWithCustomToken(auth, customToken);
}

export async function getAuthToken(): Promise<string | null> {
  if (!auth.currentUser) return null;
  return auth.currentUser.getIdToken();
}
'''

TELEGRAM_TS = r'''import {
  init,
  retrieveLaunchParams,
  backButton,
  mainButton,
  viewport,
  hapticFeedback,
  type User
} from '@telegram-apps/sdk-react';

export interface ScholaCoreTelegramUser {
  telegramId: string;
  firstName: string;
  lastName?: string;
  username?: string;
  photoUrl?: string;
  languageCode?: string;
}

let initialized = false;

export function initTelegramApp(): void {
  if (initialized) return;

  try {
    init();
  } catch {
    initialized = true;
    return;
  }

  initialized = true;

  if (viewport.mount.isAvailable()) {
    viewport.mount();
    viewport.expand();
  }
  if (backButton.mount.isAvailable()) {
    backButton.mount();
  }
}

export function getTelegramUser(): ScholaCoreTelegramUser | null {
  try {
    const { initData } = retrieveLaunchParams();
    const user = initData?.user as User | undefined;
    if (!user) return null;

    return {
      telegramId: String(user.id),
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.username,
      photoUrl: user.photoUrl,
      languageCode: user.languageCode
    };
  } catch {
    return null;
  }
}

export function getRawInitData(): string | null {
  try {
    const { initDataRaw } = retrieveLaunchParams();
    return initDataRaw ?? null;
  } catch {
    return null;
  }
}

export function showMainButton(text: string, onClick: () => void): void {
  if (!mainButton.mount.isAvailable()) return;
  mainButton.mount();
  mainButton.setParams({ text, isVisible: true, isEnabled: true });
  mainButton.onClick(onClick);
}

export function hideMainButton(): void {
  if (mainButton.isMounted()) {
    mainButton.setParams({ isVisible: false });
  }
}

export function hapticSuccess(): void {
  if (hapticFeedback.notificationOccurred.isAvailable()) {
    hapticFeedback.notificationOccurred('success');
  }
}

export function hapticError(): void {
  if (hapticFeedback.notificationOccurred.isAvailable()) {
    hapticFeedback.notificationOccurred('error');
  }
}
'''

APP_TSX = r'''import { createContext, useContext, useEffect, useState, Suspense, lazy } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db, signInWithTelegramToken, firebaseConfigError } from './lib/firebase';
import { initTelegramApp, getTelegramUser, getRawInitData, type ScholaCoreTelegramUser } from './lib/telegram';

const BursaryDashboard = lazy(() => import('./components/BursaryDashboard'));
const LiveClassroom = lazy(() => import('./components/LiveClassroom'));
const AdmissionForm = lazy(() => import('./components/AdmissionForm'));
const TeacherPortal = lazy(() => import('./components/TeacherPortal'));

export type ScholaCoreRole = 'student' | 'parent' | 'teacher' | 'bursar' | 'principal';

export interface ScholaCoreUserRecord {
  name: string;
  role: ScholaCoreRole;
  studentId?: string;
  classId?: string;
  guardianTelegramId?: string;
  unlockedLessons?: Record<string, boolean>;
}

interface TelegramContextValue {
  telegramUser: ScholaCoreTelegramUser | null;
  userRecord: ScholaCoreUserRecord | null;
  loading: boolean;
  refreshUserRecord: () => Promise<void>;
}

const TelegramContext = createContext<TelegramContextValue>({
  telegramUser: null,
  userRecord: null,
  loading: true,
  refreshUserRecord: async () => {}
});

export const useScholaCoreUser = () => useContext(TelegramContext);

type Route = 'bursary' | 'classroom' | 'admissions' | 'teacher-portal';

const NAV_ITEMS: { route: Route; label: string; roles: ScholaCoreRole[] }[] = [
  { route: 'bursary', label: 'Bursary', roles: ['student', 'parent', 'bursar', 'principal'] },
  { route: 'classroom', label: 'Classroom', roles: ['student', 'teacher', 'principal'] },
  { route: 'admissions', label: 'Admissions', roles: ['parent', 'bursar', 'principal'] },
  { route: 'teacher-portal', label: 'Recruitment', roles: ['teacher', 'principal'] }
];

export default function App() {
  const [telegramUser, setTelegramUser] = useState<ScholaCoreTelegramUser | null>(null);
  const [userRecord, setUserRecord] = useState<ScholaCoreUserRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [route, setRoute] = useState<Route>('bursary');

  useEffect(() => {
    initTelegramApp();
    bootstrapSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function bootstrapSession() {
    const rawInitData = getRawInitData();
    const tgUser = getTelegramUser();
    setTelegramUser(tgUser);

    if (!rawInitData || !tgUser) {
      setLoading(false);
      return;
    }

    if (firebaseConfigError) {
      setAuthError(firebaseConfigError);
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/auth-telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData: rawInitData })
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Could not verify Telegram session');
      }

      await signInWithTelegramToken(data.customToken);
      setUserRecord(data.user);
    } catch (err) {
      console.error('[App] bootstrapSession failed', err);
      setAuthError(err instanceof Error ? err.message : 'Could not sign in');
    } finally {
      setLoading(false);
    }
  }

  const refreshUserRecord = async () => {
    if (!telegramUser) return;
    const snap = await getDoc(doc(db, 'users', telegramUser.telegramId));
    if (snap.exists()) setUserRecord(snap.data() as ScholaCoreUserRecord);
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-core-50">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-core-200 border-t-seal-500" />
          <p className="font-mono text-xs uppercase tracking-wider text-core-600">Loading ScholaCore…</p>
        </div>
      </div>
    );
  }

  if (!telegramUser) {
    return (
      <div className="flex h-screen items-center justify-center bg-core-50 p-6 text-center">
        <div>
          <h1 className="mb-2 text-xl font-semibold text-core-900">Open in Telegram</h1>
          <p className="text-sm text-core-700">
            ScholaCore Academy runs inside the Telegram app. Please open this link from your Telegram client.
          </p>
        </div>
      </div>
    );
  }

  if (authError || !userRecord) {
    return (
      <div className="flex h-screen items-center justify-center bg-core-50 p-6 text-center">
        <div>
          <h1 className="mb-2 text-xl font-semibold text-core-900">Couldn't sign you in</h1>
          <p className="text-sm text-core-700">{authError ?? 'Please close and reopen the app from Telegram.'}</p>
        </div>
      </div>
    );
  }

  const role = userRecord.role;
  const visibleNav = NAV_ITEMS.filter((item) => item.roles.includes(role));

  const renderRoute = () => {
    switch (route) {
      case 'bursary':
        return <BursaryDashboard />;
      case 'classroom':
        return <LiveClassroom />;
      case 'admissions':
        return <AdmissionForm />;
      case 'teacher-portal':
        return <TeacherPortal />;
      default:
        return null;
    }
  };

  return (
    <TelegramContext.Provider value={{ telegramUser, userRecord, loading, refreshUserRecord }}>
      <div className="flex min-h-screen flex-col bg-core-50">
        <header className="border-b border-core-100 bg-core-900 px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-display text-lg leading-none text-white">ScholaCore</p>
              <p className="font-mono text-[10px] uppercase tracking-widest text-seal-400">Academy</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-white">{userRecord.name || telegramUser.firstName}</p>
              <p className="text-[11px] capitalize text-core-100/70">{role}</p>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-4 py-5">
          <Suspense
            fallback={
              <div className="flex justify-center py-10">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-core-200 border-t-seal-500" />
              </div>
            }
          >
            {renderRoute()}
          </Suspense>
        </main>

        <nav className="sticky bottom-0 border-t border-core-100 bg-white px-2 py-2">
          <div className="flex justify-around">
            {visibleNav.map((item) => (
              <button
                key={item.route}
                onClick={() => setRoute(item.route)}
                className={`rounded-card px-3 py-2 text-xs font-medium transition-colors ${
                  route === item.route ? 'bg-core-900 text-white' : 'text-core-700 hover:bg-core-100'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </nav>
      </div>
    </TelegramContext.Provider>
  );
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

const LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL as string;

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
        <VideoConference chatMessageFormatter={formatChatMessageLinks} />
        <RoomAudioRenderer />
      </LiveKitRoom>
    </div>
  );
}
'''

TSCONFIG_JSON = r'''{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src", "api"]
}
'''

VERCEL_JSON = r'''{
  "headers": [
    {
      "source": "/",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "no-cache, no-store, must-revalidate"
        }
      ]
    },
    {
      "source": "/index.html",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "no-cache, no-store, must-revalidate"
        }
      ]
    },
    {
      "source": "/assets/(.*)",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=31536000, immutable"
        }
      ]
    }
  ]
}
'''

FIRESTORE_RULES = r'''rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {

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

    match /users/{telegramId} {
      allow read: if isSelf(telegramId) || isGuardianOf(resource) || isStaff();

      allow create: if isSelf(telegramId) &&
        request.resource.data.role in ['student', 'parent'] &&
        request.resource.data.unlockedLessons == null;

      allow update: if (isSelf(telegramId) &&
          request.resource.data.diff(resource.data).affectedKeys()
            .hasOnly(['name'])) ||
        hasAnyRole(['bursar', 'principal']);

      allow delete: if hasRole('principal');
    }

    match /feeSchedules/{classId} {
      allow read: if isSignedIn();
      allow write: if hasAnyRole(['bursar', 'principal']);
    }

    match /transactions/{reference} {
      allow read: if isSignedIn() && (
        resource.data.studentId == uid() ||
        hasAnyRole(['bursar', 'principal']) ||
        (role() == 'parent' && exists(/databases/$(database)/documents/users/$(resource.data.studentId)) &&
          get(/databases/$(database)/documents/users/$(resource.data.studentId)).data.guardianTelegramId == uid())
      );
      allow write: if false;
    }

    match /teacherApplications/{applicantId} {
      allow read: if isSelf(applicantId) || hasAnyRole(['teacher', 'principal']);

      allow create: if isSelf(applicantId) &&
        !('aiScore' in request.resource.data) &&
        !('aiSummary' in request.resource.data) &&
        request.resource.data.status == 'SUBMITTED';

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

    match /classes/{classId}/lessons/{lessonId} {
      allow read: if isSignedIn() && (
        resource.data.isPremium == false ||
        isStaff() ||
        get(/databases/$(database)/documents/users/$(uid())).data.unlockedLessons[lessonId] == true
      );
      allow write: if hasAnyRole(['teacher', 'principal']);
    }

    match /{document=**} {
      allow read, write: if false;
    }
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
    PROJECT_DIR / "src" / "lib" / "telegram.ts": TELEGRAM_TS,
    PROJECT_DIR / "src" / "App.tsx": APP_TSX,
    PROJECT_DIR / "src" / "components" / "PayButton.tsx": PAY_BUTTON_TSX,
    PROJECT_DIR / "src" / "components" / "TeacherPortal.tsx": TEACHER_PORTAL_TSX,
    PROJECT_DIR / "src" / "components" / "LiveClassroom.tsx": LIVE_CLASSROOM_TSX,
    PROJECT_DIR / "tsconfig.json": TSCONFIG_JSON,
    PROJECT_DIR / "vercel.json": VERCEL_JSON,
    PROJECT_DIR / "firestore.rules": FIRESTORE_RULES,
    PROJECT_DIR / "package.json": PACKAGE_JSON,
}


def write_files():
    print("== Writing files ==")
    for path, content in FILES.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        print("  wrote " + str(path.relative_to(PROJECT_DIR)))


def run(cmd, cwd, allow_fail_msg=None, timeout=300):
    cmd = [find_executable(cmd[0])] + cmd[1:]
    result = subprocess.run(cmd, cwd=str(cwd), capture_output=True, text=True, timeout=timeout)
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

    lockfile = PROJECT_DIR / "package-lock.json"
    print("\n== Regenerating package-lock.json (this is the critical fix) ==")
    if lockfile.exists():
        lockfile.unlink()
        print("  deleted stale package-lock.json")

    print("  running npm install (this can take a minute or two)...")
    code = run(["npm", "install"], PROJECT_DIR, timeout=600)
    if code != 0:
        print("\nERROR: npm install failed. See output above. Fix that first, then re-run this script.")
        sys.exit(1)
    print("  npm install finished, lockfile regenerated")

    print("\n== git add ==")
    run(["git", "add", "-A"], PROJECT_DIR)

    print("\n== git commit ==")
    run(
        ["git", "commit", "-m", "Final consolidated fix: correct files + regenerated lockfile"],
        PROJECT_DIR,
        allow_fail_msg="nothing new to commit, files already matched",
    )

    print("\n== git push ==")
    code = run(["git", "push"], PROJECT_DIR)
    if code != 0:
        print("\ngit push reported an error above (auth prompt needed? no upstream set?).")
        print("Everything else is done - just run 'git push' yourself to finish.")
        sys.exit(1)

    print("\n" + "=" * 60)
    print("Done. Vercel should auto-redeploy in about 1-2 minutes.")
    print("=" * 60)
    print("\nCheck Vercel -> your project -> Deployments -> the newest one.")
    print("It should say 'Ready' with a green check. If it's red, click in")
    print("and send me the error - but this should now actually succeed,")
    print("since the thing that was almost certainly breaking every build")
    print("(the mismatched lockfile) is now fixed.")
    print("\nAfter it's green: fully close Telegram (swipe away, not just")
    print("background it) before testing, since it can cache the old broken")
    print("version otherwise.")


if __name__ == "__main__":
    main()
