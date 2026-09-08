# ScholaCore

Online school platform running natively inside the Telegram ecosystem, plus
a normal web fallback. Rebuilt from a clean slate — see `firebase/schema.md`
for the data model and `firebase/firestore.rules` / `firebase/storage.rules`
for the (single, authoritative) security rules.

## Stack
- Frontend: Vite + TypeScript + Tailwind CSS, vanilla (no framework),
  deployed as static pages to Vercel.
- Backend: Node serverless functions under `api/`, on Vercel.
- Data: Firebase Firestore + Storage + Auth.
- Live classes: LiveKit (+ Egress for recordings).
- AI Library: Groq API.
- Payments: Paystack.
- Ecosystem: Telegram Bot API + Telegram Mini Apps.

## Roles
`student` | `teacher` | `admin` — this is the only role model in the repo.
If you see `parent`, `bursar`, `principal`, `developer`, or `pending_teacher`
referenced anywhere, that's leftover from a scrapped earlier version and
should be removed.

## Environment variables
Copy `.env.example` to `.env.local` and fill in real values. Anything meant
to run in the browser (Paystack public key, LiveKit ws URL, Firebase web
config) MUST be prefixed `VITE_` or Vite will not include it in the client
bundle — this bit us in a previous version, don't repeat it.

## Deploying Firestore/Storage rules
`firebase.json` points the Firebase CLI at `firebase/firestore.rules` and
`firebase/storage.rules`. Deploy with:
```
firebase deploy --only firestore:rules,storage
```

## Build status
- **Phase 1 (done):** Firestore schema, security rules, `.env.example`,
  project scaffold.
- **Phase 2 (done):** Student/teacher auth pages, teacher vetting form,
  teacher portal, admin dashboard, privacy/terms pages.
- **Phase 3 (done):** Paystack payment page (`pay.html`), HMAC-verified
  idempotent webhook, single-use Telegram invite delivery, webhook
  fallback logging.
- **Phase 4 (next):** Groq AI Library, LiveKit classroom + Egress
  recording, scheduled class reminders.

## Payment flow (Phase 3)
1. Student signs in, goes to `pay.html`, pays via Paystack Inline JS.
2. Paystack calls `POST /api/paystack-webhook` (HMAC-signed).
3. Webhook verifies the signature, checks `transactions/{reference}` for
   idempotency, marks the student `paymentStatus: active_paid`, then
   creates a single-use Telegram invite link and DMs it to the student.
4. Telegram delivery failures are logged to `webhook_events` but never
   undo or block the student's paid status — payment and invite delivery
   are decoupled on purpose.
