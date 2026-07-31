import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
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
