# ScholaCore

Online school platform running natively inside the Telegram ecosystem, plus
a normal web fallback. See `firebase/schema.md` for the data model and
`firebase/firestore.rules` / `firebase/storage.rules` for the single,
authoritative security rules.

## Stack
- Frontend: plain HTML, CSS, and JavaScript. No build step, no bundler,
  no TypeScript. Pages load Firebase directly from Google's CDN via
  native ES module `<script type="module">` imports. Tailwind is loaded
  via its CDN script (`cdn.tailwindcss.com`) for the same reason.
- Backend: PHP serverless functions under `api/`, on Vercel via the
  community `vercel-php` runtime (`vercel-community/php`). Vercel has no
  official first-party PHP runtime.
- Data: Firebase Firestore + Storage + Auth, accessed server-side from
  PHP via the community `kreait/firebase-php` SDK (there is no official
  Google Firebase Admin SDK for PHP).
- Live classes: LiveKit (+ Egress for recordings); not yet wired up.
- AI Library: Groq API; not yet wired up.
- Payments: Paystack, via Inline JS on the client and a PHP webhook.
- Ecosystem: Telegram Bot API + Telegram Mini Apps.

## Roles
`student` | `teacher` | `admin`. This is the only role model in the repo.

## Environment variables
Copy `.env.example` and fill in real values in Vercel's Environment
Variables settings. Because there's no build step, client-facing config
(Firebase web config, Paystack public key) is served at request time by
`api/firebase-config.php` and `api/paystack-config.php`, which read
`getenv()` and emit it as a JS module; nothing is hardcoded into a
static committed file.

## PHP dependencies
Run `composer install` before deploying so `vendor/` exists (or let
Vercel's build step run it; `vercel-php` supports Composer natively).

## Deploying Firestore/Storage rules
```
firebase deploy --only firestore:rules,storage
```
(requires `firebase.json` pointing at `firebase/firestore.rules` and
`firebase/storage.rules`; not included in this stack switch since it's
Firebase CLI config, unrelated to the frontend/backend language.)

## Payment flow
1. Student signs in, goes to `pay.html`, pays via Paystack Inline JS.
2. Paystack calls `POST /api/paystack-webhook.php` (HMAC-signed).
3. The PHP webhook verifies the signature, checks `transactions/{reference}`
   for idempotency, marks the student `paymentStatus: active_paid`, then
   creates a single-use Telegram invite link (`createChatInviteLink` with
   `member_limit: 1`, not `exportChatInviteLink`, which can't be
   single-use) and DMs it to the student.
4. Telegram delivery failures are logged to `webhook_events` but never
   undo or block the student's paid status.

## Build status
- Homepage, student sign-up, teacher vetting, teacher portal, admin
  dashboard, payment page, privacy/terms pages: done.
- Paystack webhook + Telegram invite delivery: done.
- Not yet built: LiveKit classroom + Egress recording, Groq AI Library,
  scheduled Telegram class reminders.
