#!/usr/bin/env python3
"""
ScholaCore quick-fix script.

Writes the corrected tsconfig.json, src/lib/firebase.ts, and src/App.tsx,
then runs git add / commit / push automatically.

Run with:
    python fix_scholacore.py

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
'''

APP_TSX = r'''import { createContext, useContext, useEffect, useState, Suspense, lazy } from 'react';
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

  /**
   * Trades Telegram-signed initData for a Firebase session. This is the
   * ONLY place a Firebase custom token is minted — it always goes through
   * /api/auth-telegram, which re-verifies initData's HMAC signature against
   * the bot token server-side before issuing a token with a `role` claim.
   * Without this step request.auth is null and firestore.rules refuses
   * every read/write, so nothing below runs until this resolves.
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

FILES = {
    PROJECT_DIR / "tsconfig.json": TSCONFIG_JSON,
    PROJECT_DIR / "src" / "lib" / "firebase.ts": FIREBASE_TS,
    PROJECT_DIR / "src" / "App.tsx": APP_TSX,
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
        print("Run 'git init' there first, or point PROJECT_DIR at the right folder.")
        sys.exit(1)

    write_files()

    print("\n== git add ==")
    run_git(["add", "-A"])

    print("\n== git commit ==")
    run_git(
        ["commit", "-m", "Fix Firebase sign-in error surfacing and tsconfig baseUrl issue"],
        allow_fail_msg="nothing new to commit, files already matched",
    )

    print("\n== git push ==")
    code = run_git(["push"])
    if code != 0:
        print("\ngit push reported an error above (auth prompt needed? no upstream set?).")
        print("Everything else is done - just run 'git push' yourself to finish.")
        sys.exit(1)

    print("\nDone. Vercel should auto-redeploy in about 1-2 minutes.")
    print("Then fully close Telegram (swipe it away, don't just background it)")
    print("before reopening the mini app - it can otherwise cache the old version.")


if __name__ == "__main__":
    main()
