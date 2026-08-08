#!/usr/bin/env python3
"""
ScholaCore: explicit sign-up flow (Student/Parent/Teacher), replacing
auto-provisioning as student.

Writes 7 files (2 new: api/signup.ts, src/components/SignUp.tsx),
DELETES the now-superseded src/components/TeacherPortal.tsx, then runs
git add / commit / push automatically.

Run with:
    python fix_scholacore_signup.py

If your project folder isn't at the path below, edit PROJECT_DIR first.
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
    """On Windows, npm/npx are .cmd shim files - subprocess.run() can't
    launch those the way it launches an .exe without extra help."""
    resolved = shutil.which(name)
    if resolved:
        return resolved
    if sys.platform == "win32":
        resolved = shutil.which(name + ".cmd")
        if resolved:
            return resolved
    return name


README_MD = r"""# ScholaCore Platform

A Telegram Mini App secondary school system (JSS1–SSS3) covering bursary
payments, live classrooms, admissions with a timed placement test, and
AI-assisted teacher recruitment.

- **ScholaCore Systems** — the enterprise platform (LMS, bursary engine, AI vetting, admin)
- **ScholaCore Academy** — the consumer-facing Telegram Mini App

## Stack

| Layer | Technology |
|---|---|
| Frontend | Vite, React, TypeScript, Tailwind CSS, `@telegram-apps/sdk-react` |
| Hosting / API | Vercel Serverless Functions (Node.js/TypeScript) |
| Database & Auth | Firebase Firestore + Firebase Admin SDK |
| Live video | LiveKit Cloud |
| Payments | Paystack |
| AI | Groq (`openai/gpt-oss-20b` tutor, `openai/gpt-oss-120b` screening) |

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in your keys
npm run dev                  # Vite dev server on :5173
```

`/api` routes run as Vercel Functions — use `vercel dev` instead of `vite`
alone if you need them live locally, or deploy to a Vercel preview.

## Auth model

Firestore's security rules (`firestore.rules`) gate access by
`request.auth.token.role`, a custom claim set on a Firebase Auth session.
That session is established by `POST /api/auth-telegram`:

1. Client sends Telegram's raw, signed `initData` string.
2. Server re-verifies its HMAC-SHA256 signature against `TELEGRAM_BOT_TOKEN`
   (never trust the parsed `user` object from the client alone).
3. Server looks up `/users/{telegramId}`. If it exists, mints a token
   carrying that user's real `role`. If it doesn't, mints a token with
   `role: 'unregistered'` and returns `user: null` — nobody is
   auto-provisioned an account.
4. Client signs in with `signInWithCustomToken`, then reads/writes Firestore
   as that authenticated identity.

**Sign-up** (`src/components/SignUp.tsx`) is what a `user: null` response
triggers. Every person signs up explicitly, and the path differs by role:

- **Student / Parent** — a name and a role choice, `POST /api/signup`
  creates `/users/{telegramId}` directly and returns a fresh token.
- **Teacher** — signing up *is* applying: the same specialties + essay
  form as before, screened by `POST /api/vet-teacher` (Groq). On an
  applicant's first submission, that endpoint also creates their account
  with `role: 'pending_teacher'` — enough to hold a session, but
  `firestore.rules` grants it no dashboard access. A principal reviews the
  AI score out-of-band and promotes `pending_teacher` → `teacher`
  (Firebase console or an internal admin tool), which takes effect the
  next time `/api/auth-telegram` mints a token for them. `bursar` and
  `principal` are never self-assigned at all.

## Payments

`/api/initialize-payment` starts a Paystack transaction; the actual
confirmation of funds is handled exclusively by `/api/paystack-webhook`,
which verifies Paystack's `x-paystack-signature` (HMAC-SHA512) before
writing to `/transactions` or unlocking a lesson. The client never marks a
payment as successful on its own — `PayButton.tsx` just opens the Paystack
popup and waits.

## Directory structure

```
api/                     Vercel serverless functions
  _lib/                  Shared server-side helpers (not routable endpoints)
    firebaseAdmin.ts      Firebase Admin SDK singleton
    telegramAuth.ts        Telegram initData HMAC verification
    verifyCaller.ts         Firebase ID token verification for the endpoints below
  auth-telegram.ts        Mints the Firebase session (see Auth model above)
  signup.ts               Student/parent self-registration
  initialize-payment.ts   Starts a Paystack transaction
  paystack-webhook.ts     Verifies + records payments, sends Telegram receipt
  livekit-token.ts        Issues role-scoped LiveKit JWTs
  ai-tutor.ts             Groq-powered student Q&A
  vet-teacher.ts          Groq-powered applicant screening + teacher sign-up
src/
  components/            Feature UI (bursary, classroom, admissions, sign-up)
  lib/                   Firebase + Telegram SDK wrappers
  App.tsx                Router, auth bootstrap, role-based nav
firestore.rules          RBAC security rules for all collections
```

## Environment variables

See `.env.example`. Required in Vercel for the API routes: `PAYSTACK_SECRET_KEY`,
`TELEGRAM_BOT_TOKEN`, `GROQ_API_KEY`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`,
`FIREBASE_SERVICE_ACCOUNT_KEY`. The `VITE_*` variables are public and get
bundled into the client at build time.

## Deploying Firestore rules

```bash
firebase deploy --only firestore:rules
```
"""

AUTH_TELEGRAM_TS = r"""import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyTelegramInitData } from './_lib/telegramAuth';
import { getAdminAuth, getAdminFirestore } from './_lib/firebaseAdmin';

// This endpoint is the bridge between "Telegram says this is user X" and
// "Firestore/firestore.rules trust this is user X". It is not in the
// original 5-endpoint spec, but firestore.rules reads
// request.auth.token.role on every request — nothing else in this codebase
// mints that token, so without this endpoint the security rules would
// reject all reads/writes. Every other component signs in through here
// before touching Firestore (see src/App.tsx `bootstrapSession`).
//
// A user with no /users/{telegramId} record is no longer auto-provisioned
// as 'student' — every person signs up explicitly (see api/signup.ts and
// src/components/SignUp.tsx), including teachers, who sign up by going
// through the AI-screened application. A brand new caller gets a token
// with role 'unregistered' — enough to be a valid Firebase Auth session
// (needed to call api/signup or submit a teacher application), but
// firestore.rules grants an 'unregistered' role no access to anything
// beyond what those two flows explicitly need.

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

  try {
    const db = getAdminFirestore();
    const userRef = db.collection('users').doc(telegramId);
    const snap = await userRef.get();

    if (!snap.exists) {
      // New Telegram user, no account yet. Mint a minimal-privilege token
      // and tell the client to show sign-up — we do NOT create a Firestore
      // record here anymore.
      const customToken = await getAdminAuth().createCustomToken(telegramId, { role: 'unregistered' });
      return res.status(200).json({ customToken, user: null });
    }

    const data = snap.data()!;
    const fallbackName = [verified.user.first_name, verified.user.last_name].filter(Boolean).join(' ');
    const userRecord = {
      name: data.name ?? fallbackName,
      role: data.role ?? 'student',
      studentId: data.studentId,
      classId: data.classId,
      guardianTelegramId: data.guardianTelegramId,
      unlockedLessons: data.unlockedLessons ?? {}
    };

    const customToken = await getAdminAuth().createCustomToken(telegramId, { role: userRecord.role });

    return res.status(200).json({
      customToken,
      user: { telegramId, ...userRecord }
    });
  } catch (err) {
    console.error('[auth-telegram] Failed to establish session', err);
    const message = err instanceof Error ? err.message : 'Unable to establish session';
    return res.status(500).json({ error: message });
  }
}
"""

SIGNUP_TS = r"""import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyCaller } from './_lib/verifyCaller';
import { getAdminAuth, getAdminFirestore } from './_lib/firebaseAdmin';

// Handles the Student/Parent branch of sign-up (see src/components/SignUp.tsx).
// Teachers sign up through a different path — submitting an application via
// /api/vet-teacher, which creates their account as 'pending_teacher' after
// AI screening rather than immediately, since becoming a teacher is gated
// on that review.

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
  // in. What matters is that the token is real (verified against Firebase
  // Auth), not what role it currently carries.
  const caller = await verifyCaller(req);
  if (!caller) {
    return res.status(401).json({ error: 'Not signed in' });
  }

  if (!isValidBody(req.body)) {
    return res.status(400).json({ error: 'Invalid payload. Required: name, role (student or parent).' });
  }

  const { name, role } = req.body;
  const telegramId = caller.telegramId;

  try {
    const db = getAdminFirestore();
    const userRef = db.collection('users').doc(telegramId);

    const existing = await userRef.get();
    if (existing.exists) {
      // Already signed up — don't let a repeat call silently change role.
      return res.status(409).json({ error: 'This account is already signed up.' });
    }

    const userRecord = { name: name.trim(), role, unlockedLessons: {} };
    await userRef.set({
      ...userRecord,
      createdAt: new Date().toISOString()
    });

    // The caller's existing token still says role: 'unregistered' — mint a
    // fresh one reflecting their real role so firestore.rules recognizes
    // them immediately, without needing to fully close and reopen the app.
    const customToken = await getAdminAuth().createCustomToken(telegramId, { role });

    return res.status(200).json({
      customToken,
      user: { telegramId, ...userRecord }
    });
  } catch (err) {
    console.error('[signup] Failed to create account', err);
    const message = err instanceof Error ? err.message : 'Unable to complete sign-up';
    return res.status(500).json({ error: message });
  }
}
"""

VET_TEACHER_TS = r"""import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAdminAuth, getAdminFirestore } from './_lib/firebaseAdmin';
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

    // Teacher sign-up works differently from student/parent: submitting
    // this application IS the sign-up action, gated on AI screening rather
    // than granting access immediately. Only create the account if one
    // doesn't already exist — an existing student/parent/teacher/etc.
    // hitting this endpoint should never have their role silently
    // overwritten to pending_teacher.
    const userRef = db.collection('users').doc(applicantId);
    const existingUser = await userRef.get();

    let customToken: string | undefined;
    if (!existingUser.exists) {
      await userRef.set({
        name: fullName,
        role: 'pending_teacher',
        unlockedLessons: {},
        createdAt: new Date().toISOString()
      });
      // Their current token still says role: 'unregistered' — mint a fresh
      // one so the client can move past the sign-up screen without a full
      // app restart.
      customToken = await getAdminAuth().createCustomToken(applicantId, { role: 'pending_teacher' });
    }

    return res.status(200).json({ ...result, customToken });
  } catch (err) {
    console.error('[vet-teacher] Groq request failed', err);
    return res.status(500).json({ error: 'Unable to complete AI vetting right now' });
  }
}
"""

FIRESTORE_RULES = r"""rules_version = '2';

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

service cloud.firestore {
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

      // An applicant can re-save their own application (e.g. SignUp.tsx's
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
}
"""

APP_TSX = r"""import { createContext, useContext, useEffect, useState, Suspense, lazy } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db, signInWithTelegramToken, firebaseConfigError } from './lib/firebase';
import { initTelegramApp, getTelegramUser, getRawInitData, type ScholaCoreTelegramUser } from './lib/telegram';

// Lazy-loaded: LiveClassroom pulls in the full LiveKit client SDK and
// BursaryDashboard pulls in Paystack's inline-js, both of which are large
// and only needed once a user actually opens that tab. Splitting these out
// keeps the first paint fast on a mobile Telegram WebView, which is where
// this app lives.
const BursaryDashboard = lazy(() => import('./components/BursaryDashboard'));
const LiveClassroom = lazy(() => import('./components/LiveClassroom'));
const AdmissionForm = lazy(() => import('./components/AdmissionForm'));
const SignUp = lazy(() => import('./components/SignUp'));

export type ScholaCoreRole = 'student' | 'parent' | 'teacher' | 'bursar' | 'principal';

export interface ScholaCoreUserRecord {
  name: string;
  // A brand new applicant lands in 'pending_teacher' after submitting their
  // application (see SignUp.tsx) — not one of the five "real" operating
  // roles, since they don't get dashboard access until a principal
  // promotes them to 'teacher' after reviewing the AI screening result.
  role: ScholaCoreRole | 'pending_teacher';
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

type Route = 'bursary' | 'classroom' | 'admissions';

const NAV_ITEMS: { route: Route; label: string; roles: ScholaCoreRole[] }[] = [
  { route: 'bursary', label: 'Bursary', roles: ['student', 'parent', 'bursar', 'principal'] },
  { route: 'classroom', label: 'Classroom', roles: ['student', 'teacher', 'principal'] },
  { route: 'admissions', label: 'Admissions', roles: ['parent', 'bursar', 'principal'] }
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

  /**
   * Trades Telegram-signed initData for a Firebase session. This is the
   * ONLY place a Firebase custom token is minted — it always goes through
   * /api/auth-telegram, which re-verifies initData's HMAC signature against
   * the bot token server-side before issuing a token with a `role` claim.
   * Without this step request.auth is null and firestore.rules refuses
   * every read/write, so nothing below runs until this resolves.
   *
   * A successful sign-in with `user: null` in the response means a valid
   * Telegram session but no ScholaCore account yet — that's a normal,
   * expected state (not an error), handled by rendering <SignUp /> below,
   * not the authError screen.
   */
  async function bootstrapSession() {
    const rawInitData = getRawInitData();
    const tgUser = getTelegramUser();
    setTelegramUser(tgUser);

    if (!rawInitData || !tgUser) {
      setLoading(false);
      return;
    }

    // Catches malformed Vercel env vars instantly, with a specific
    // on-screen message — no need to attempt a network round-trip (or find
    // a way to open devtools on a phone inside Telegram) just to learn
    // Firebase's config is broken.
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

  if (authError) {
    return (
      <div className="flex h-screen items-center justify-center bg-core-50 p-6 text-center">
        <div>
          <h1 className="mb-2 text-xl font-semibold text-core-900">Couldn't sign you in</h1>
          <p className="text-sm text-core-700">{authError}</p>
        </div>
      </div>
    );
  }

  if (!userRecord) {
    return (
      <Suspense
        fallback={
          <div className="flex h-screen items-center justify-center bg-core-50">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-core-200 border-t-seal-500" />
          </div>
        }
      >
        <SignUp onSignedUp={setUserRecord} />
      </Suspense>
    );
  }

  if (userRecord.role === 'pending_teacher') {
    return (
      <div className="flex h-screen items-center justify-center bg-core-50 p-6 text-center">
        <div>
          <h1 className="mb-2 text-xl font-semibold text-core-900">Application under review</h1>
          <p className="text-sm text-core-700">
            Thanks, {userRecord.name.split(' ')[0]} — your teaching application is being reviewed by the principal's
            office. You'll be contacted with next steps.
          </p>
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
"""

SIGNUP_TSX = r"""import { useState } from 'react';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, getAuthToken, signInWithTelegramToken } from '../lib/firebase';
import { useScholaCoreUser, type ScholaCoreUserRecord } from '../App';
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

type Path = 'choose' | 'student' | 'parent' | 'teacher' | 'teacher-result';

interface SignUpProps {
  onSignedUp: (user: ScholaCoreUserRecord) => void;
}

export default function SignUp({ onSignedUp }: SignUpProps) {
  const { telegramUser } = useScholaCoreUser();
  const [path, setPath] = useState<Path>('choose');

  // student/parent
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // teacher
  const [cvUrl, setCvUrl] = useState('');
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [essayAnswers, setEssayAnswers] = useState<Record<string, string>>({});
  const [teacherResult, setTeacherResult] = useState<VetResult | null>(null);

  const toggleSpecialty = (subject: string) => {
    setSpecialties((prev) => (prev.includes(subject) ? prev.filter((s) => s !== subject) : [...prev, subject]));
  };

  const teacherFormValid =
    name.trim().length > 1 &&
    /^https?:\/\/\S+$/.test(cvUrl.trim()) &&
    specialties.length > 0 &&
    ESSAY_QUESTIONS.every((q) => (essayAnswers[q] ?? '').trim().length >= 40);

  const submitStudentOrParent = async (role: 'student' | 'parent') => {
    if (!telegramUser || name.trim().length < 2) return;
    setSubmitting(true);
    setErrorMessage(null);

    try {
      const token = await getAuthToken();
      if (!token) throw new Error('Your session expired — please close and reopen the app.');

      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: name.trim(), role })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not complete sign-up');

      await signInWithTelegramToken(data.customToken);
      hapticSuccess();
      onSignedUp(data.user);
    } catch (err) {
      hapticError();
      setErrorMessage(err instanceof Error ? err.message : 'Could not complete sign-up');
    } finally {
      setSubmitting(false);
    }
  };

  const submitTeacher = async () => {
    if (!telegramUser || !teacherFormValid) return;
    setSubmitting(true);
    setErrorMessage(null);

    const applicantId = telegramUser.telegramId;

    try {
      // Allowed by firestore.rules for any signed-in caller creating their
      // own application (isSelf(applicantId)), regardless of role — an
      // 'unregistered' token is enough at this point.
      await setDoc(doc(db, 'teacherApplications', applicantId), {
        fullName: name.trim(),
        cvUrl: cvUrl.trim(),
        specialties,
        essayAnswers,
        status: 'SUBMITTED',
        submittedAt: serverTimestamp()
      });

      const token = await getAuthToken();
      if (!token) throw new Error('Your session expired — please close and reopen the app.');

      const res = await fetch('/api/vet-teacher', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ fullName: name.trim(), specialties, essayAnswers })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'AI screening failed');

      // A fresh token (role: pending_teacher) comes back on first
      // application only — sign in with it so the account is fully
      // established, but deliberately don't call onSignedUp here: we want
      // to keep showing this result screen rather than immediately
      // jumping to the "under review" screen App.tsx shows on later visits.
      if (data.customToken) {
        await signInWithTelegramToken(data.customToken);
      }

      setTeacherResult(data as VetResult);
      setPath('teacher-result');
      hapticSuccess();
    } catch (err) {
      hapticError();
      setErrorMessage(err instanceof Error ? err.message : 'Could not submit application');
    } finally {
      setSubmitting(false);
    }
  };

  if (path === 'teacher-result' && teacherResult) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-core-50 p-6">
        <div className="w-full space-y-4">
          <div className="rounded-card border border-core-100 bg-white p-6 text-center">
            <p className="font-mono text-[10px] uppercase tracking-widest text-core-500">AI screening result</p>
            <p className="mt-2 font-display text-4xl text-core-900">{teacherResult.score}</p>
            <p className="text-xs text-core-500">out of 100</p>
            <span
              className={`mt-3 inline-block rounded-full px-3 py-1 text-xs font-semibold ${RECOMMENDATION_STYLE[teacherResult.recommendation]}`}
            >
              {teacherResult.recommendation}
            </span>
            <p className="mt-4 text-left text-sm text-core-700">{teacherResult.summary}</p>
          </div>
          <p className="text-center text-xs text-core-500">
            Thanks for applying. The principal's office will follow up with next steps — you can close the app now.
          </p>
        </div>
      </div>
    );
  }

  if (path === 'teacher') {
    return (
      <div className="min-h-screen bg-core-50 px-4 py-6">
        <div className="space-y-4">
          <div>
            <h2 className="font-display text-xl text-core-900">Teacher application</h2>
            <p className="text-sm text-core-600">
              This is your interview — an AI screening reviews your answers, then the principal's office follows up.
            </p>
          </div>

          <div className="space-y-3 rounded-card border border-core-100 bg-white p-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-core-700">Full name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
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
            onClick={submitTeacher}
            disabled={!teacherFormValid || submitting}
            className="w-full rounded-card bg-core-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
          >
            {submitting ? 'Submitting for AI screening…' : 'Submit application'}
          </button>
          {errorMessage && <p className="text-xs text-signal-danger">{errorMessage}</p>}
          <button onClick={() => setPath('choose')} className="w-full text-center text-xs text-core-500">
            ← Back
          </button>
        </div>
      </div>
    );
  }

  if (path === 'student' || path === 'parent') {
    const role = path;
    return (
      <div className="flex min-h-screen items-center justify-center bg-core-50 p-6">
        <div className="w-full space-y-4">
          <div className="text-center">
            <h2 className="font-display text-xl text-core-900">{role === 'student' ? "You're a student" : "You're a parent"}</h2>
            <p className="text-sm text-core-600">Just your name to get started.</p>
          </div>

          <div className="rounded-card border border-core-100 bg-white p-4">
            <label className="mb-1 block text-xs font-medium text-core-700">Full name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-card border border-core-100 px-3 py-2 text-sm focus:border-seal-500"
              placeholder={role === 'student' ? 'e.g. Amara Chukwu' : 'e.g. Mrs. Ifeoma Chukwu'}
              autoFocus
            />
          </div>

          <button
            onClick={() => submitStudentOrParent(role)}
            disabled={name.trim().length < 2 || submitting}
            className="w-full rounded-card bg-seal-500 px-4 py-3 text-sm font-semibold text-core-950 disabled:opacity-40"
          >
            {submitting ? 'Setting up your account…' : 'Continue'}
          </button>
          {errorMessage && <p className="text-center text-xs text-signal-danger">{errorMessage}</p>}
          <button onClick={() => setPath('choose')} className="w-full text-center text-xs text-core-500">
            ← Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-core-50 p-6">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div>
          <p className="font-display text-2xl text-core-900">Welcome to ScholaCore</p>
          <p className="mt-1 text-sm text-core-600">Let's get you set up. Which are you?</p>
        </div>

        <div className="space-y-3">
          <button
            onClick={() => setPath('student')}
            className="w-full rounded-card border border-core-100 bg-white px-4 py-4 text-left transition-colors hover:bg-core-50"
          >
            <p className="text-sm font-semibold text-core-900">Student</p>
            <p className="text-xs text-core-500">Access your classes, lessons, and fees</p>
          </button>
          <button
            onClick={() => setPath('parent')}
            className="w-full rounded-card border border-core-100 bg-white px-4 py-4 text-left transition-colors hover:bg-core-50"
          >
            <p className="text-sm font-semibold text-core-900">Parent / Guardian</p>
            <p className="text-xs text-core-500">Track fees and your child's progress</p>
          </button>
          <button
            onClick={() => setPath('teacher')}
            className="w-full rounded-card border border-core-100 bg-white px-4 py-4 text-left transition-colors hover:bg-core-50"
          >
            <p className="text-sm font-semibold text-core-900">Teacher</p>
            <p className="text-xs text-core-500">Apply to teach — AI-screened application</p>
          </button>
        </div>
      </div>
    </div>
  );
}
"""

FILES = {
    PROJECT_DIR / "README.md": README_MD,
    PROJECT_DIR / "api" / "auth-telegram.ts": AUTH_TELEGRAM_TS,
    PROJECT_DIR / "api" / "signup.ts": SIGNUP_TS,
    PROJECT_DIR / "api" / "vet-teacher.ts": VET_TEACHER_TS,
    PROJECT_DIR / "firestore.rules": FIRESTORE_RULES,
    PROJECT_DIR / "src" / "App.tsx": APP_TSX,
    PROJECT_DIR / "src" / "components" / "SignUp.tsx": SIGNUP_TSX,
}

FILE_TO_DELETE = PROJECT_DIR / "src" / "components" / "TeacherPortal.tsx"


def write_files():
    print("== Writing files ==")
    for path, content in FILES.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        print("  wrote " + str(path.relative_to(PROJECT_DIR)))

    if FILE_TO_DELETE.exists():
        FILE_TO_DELETE.unlink()
        print("  deleted " + str(FILE_TO_DELETE.relative_to(PROJECT_DIR)) + " (superseded by SignUp.tsx)")


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

    print("\n== git add ==")
    run(["git", "add", "-A"], PROJECT_DIR)

    print("\n== git commit ==")
    run(
        ["git", "commit", "-m", "Require explicit sign-up instead of auto-provisioning as student"],
        PROJECT_DIR,
        allow_fail_msg="nothing new to commit, files already matched",
    )

    print("\n== git push ==")
    code = run(["git", "push"], PROJECT_DIR)
    if code != 0:
        print("\ngit push reported an error above (auth prompt needed? no upstream set?).")
        print("Everything else is done - just run 'git push' yourself to finish.")
        sys.exit(1)

    print("\nDone. Vercel should auto-redeploy in about 1-2 minutes.")
    print("\nWhat changed: new Telegram users no longer get an account created")
    print("automatically. First launch now shows a Student / Parent / Teacher")
    print("choice. Student/Parent just need a name. Teacher goes through the AI-")
    print("screened application (same specialties+essay form as before) and")
    print("lands in a pending-review state until a principal promotes them to")
    print("'teacher' in Firebase console.")
    print("\nFully close Telegram (swipe away) before testing, then sign up as")
    print("a fresh account to see the new flow.")


if __name__ == "__main__":
    main()
