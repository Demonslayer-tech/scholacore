# ScholaCore Platform

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
