import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getAuth, signInWithCustomToken, type Auth } from 'firebase/auth';

// .trim() on every value here is deliberate: the uploaded env.env showed
// nearly every var written as `KEY= value` (space right after `=`), which
// makes a leading space part of the value. If Vercel's env vars were ever
// set the same way, that stray space is exactly what makes Firebase Auth's
// SDK build a malformed URL on Safari/WebKit (Telegram-iOS's in-app
// browser) — surfacing as the generic "The string did not match the
// expected pattern" error. Trimming here means it can never happen again,
// no matter how the value is stored in Vercel.
function trimEnv(value: string | undefined): string | undefined {
  return typeof value === 'string' ? value.trim() : value;
}

const firebaseConfig = {
  apiKey: trimEnv(import.meta.env.VITE_FIREBASE_API_KEY),
  authDomain: trimEnv(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN),
  projectId: trimEnv(import.meta.env.VITE_FIREBASE_PROJECT_ID),
  storageBucket: trimEnv(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET),
  messagingSenderId: trimEnv(import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID),
  appId: trimEnv(import.meta.env.VITE_FIREBASE_APP_ID)
};

type FirebaseConfigKey = keyof typeof firebaseConfig;

const FIELD_LABELS: Record<FirebaseConfigKey, string> = {
  apiKey: 'VITE_FIREBASE_API_KEY',
  authDomain: 'VITE_FIREBASE_AUTH_DOMAIN',
  projectId: 'VITE_FIREBASE_PROJECT_ID',
  storageBucket: 'VITE_FIREBASE_STORAGE_BUCKET',
  messagingSenderId: 'VITE_FIREBASE_MESSAGING_SENDER_ID',
  appId: 'VITE_FIREBASE_APP_ID'
};

// Generic checks applied to every field we require. Vercel's env var UI is
// the source of nearly every one of these: a stray paste of quotes around
// the value, a trailing newline copied from a .env file, or the literal
// text "undefined" when a var reference didn't resolve at build time.
function findGenericProblem(key: FirebaseConfigKey, value: string): string | null {
  const label = FIELD_LABELS[key];

  if (/["']/.test(value)) {
    return `${label} has quote marks in it. Vercel doesn't need quotes around values — remove them, then redeploy.`;
  }
  if (/\s/.test(value)) {
    return `${label} has a stray space or line break in the middle of it. Re-paste it in Vercel, then redeploy.`;
  }
  if (value === 'undefined' || value === 'null') {
    return `${label} is literally the string "${value}" — this usually means a build-time variable reference didn't resolve. Check it's set for the right environment (Production/Preview) in Vercel, then redeploy.`;
  }
  return null;
}

function findFirebaseConfigProblem(config: typeof firebaseConfig): string | null {
  const required: FirebaseConfigKey[] = ['apiKey', 'authDomain', 'projectId', 'appId'];
  const missing = required.filter((key) => !config[key]);
  if (missing.length > 0) {
    return `Missing Firebase config in this deployment: ${missing
      .map((key) => FIELD_LABELS[key])
      .join(', ')}. Add these in Vercel → Settings → Environment Variables, then redeploy.`;
  }

  // Run the generic checks across every field that's actually present,
  // not just authDomain -- a malformed apiKey or appId throws this exact
  // WebKit "did not match the expected pattern" error just as easily.
  for (const key of Object.keys(FIELD_LABELS) as FirebaseConfigKey[]) {
    const value = config[key];
    if (!value) continue;
    const problem = findGenericProblem(key, value);
    if (problem) return problem;
  }

  const authDomain = config.authDomain!;
  if (/^https?:\/\//i.test(authDomain)) {
    return `VITE_FIREBASE_AUTH_DOMAIN shouldn't include "https://" (got "${authDomain}"). It should look like your-project-id.firebaseapp.com.`;
  }
  if (!authDomain.includes('.')) {
    return `VITE_FIREBASE_AUTH_DOMAIN looks incomplete ("${authDomain}"). It should look like your-project-id.firebaseapp.com.`;
  }

  const appId = config.appId!;
  if (!/^\d+:\d+:web:[a-f0-9]+$/i.test(appId)) {
    return `VITE_FIREBASE_APP_ID doesn't look like a Firebase web app ID ("${appId}"). It should look like 1:1234567890:web:abcdef1234567890. Copy it again from Firebase Console → Project Settings → General → Your apps.`;
  }

  return null;
}

export const firebaseConfigError = findFirebaseConfigProblem(firebaseConfig);

let appInstance: FirebaseApp;
let dbInstance: Firestore;
let authInstance: Auth;

// Previously this catch only logged to console and swallowed the error,
// so a bad config value would fail silently here and only surface much
// later as an opaque WebKit error inside signInWithCustomToken. Now it's
// exported so App.tsx can show it immediately, before ever attempting to
// sign in.
export let firebaseInitError: string | null = null;

if (!firebaseConfigError) {
  try {
    appInstance = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
    dbInstance = getFirestore(appInstance);
    authInstance = getAuth(appInstance);
  } catch (err) {
    firebaseInitError =
      err instanceof Error
        ? `Firebase failed to initialize: ${err.message}`
        : 'Firebase failed to initialize.';
    console.error('[firebase] initialization failed:', err);
  }
}

export const app = appInstance! as FirebaseApp;
export const db = dbInstance! as Firestore;
export const auth = authInstance! as Auth;

function maskApiKey(key: string | undefined): string {
  if (!key) return '(empty)';
  if (key.length <= 8) return `${key.slice(0, 2)}…(${key.length} chars)`;
  return `${key.slice(0, 6)}…(${key.length} chars)`;
}

export async function signInWithTelegramToken(customToken: string) {
  try {
    return await signInWithCustomToken(auth, customToken);
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : String(err);
    // Safari/WebKit (Telegram-iOS's in-app browser) throws a generic
    // "The string did not match the expected pattern" DOMException when
    // Firebase Auth's SDK builds a request URL from a malformed config
    // value. Chrome/desktop often doesn't hit this same code path, which
    // is why it can look fine everywhere except iPhone. Re-throwing with
    // the actual values (masked) attached turns that dead end into an
    // actionable message.
    console.error('[firebase] signInWithCustomToken failed', {
      rawMessage,
      authDomain: firebaseConfig.authDomain,
      apiKey: maskApiKey(firebaseConfig.apiKey),
      projectId: firebaseConfig.projectId,
      appId: firebaseConfig.appId
    });
    throw new Error(
      `Firebase sign-in failed talking to "${firebaseConfig.authDomain ?? '(no authDomain)'}". ` +
        `This is almost always a malformed VITE_FIREBASE_* value in Vercel (stray character, wrong project, or copy/paste error). ` +
        `Raw error: ${rawMessage}`
    );
  }
}

export async function getAuthToken(): Promise<string | null> {
  if (!auth.currentUser) return null;
  return auth.currentUser.getIdToken();
}
