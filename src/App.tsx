import { createContext, useContext, useEffect, useState, Suspense, lazy } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db, signInWithTelegramToken, getAuthToken, firebaseConfigError } from './lib/firebase';
import { initTelegramApp, getTelegramUser, getRawInitData, type ScholaCoreTelegramUser } from './lib/telegram';
import Logo from './components/Logo';

const BursaryDashboard = lazy(() => import('./components/BursaryDashboard'));
const LiveClassroom = lazy(() => import('./components/LiveClassroom'));
const AdmissionForm = lazy(() => import('./components/AdmissionForm'));
const SignUp = lazy(() => import('./components/SignUp'));
const WebAuth = lazy(() => import('./components/auth/WebAuth'));

export type ScholaCoreRole = 'developer' | 'teacher' | 'student' | 'parent' | 'bursary';

export interface ScholaCoreUserRecord {
  uid: string;
  name: string;
  role: ScholaCoreRole | 'pending_teacher';
  studentId?: string;
  classId?: string;
  guardianUid?: string;
  subscriptionActive?: boolean;
  unlockedLessons?: Record<string, boolean>;
}

interface ScholaCoreContextValue {
  uid: string | null;
  displayName: string;
  userRecord: ScholaCoreUserRecord | null;
  isTelegram: boolean;
  refreshUserRecord: () => Promise<void>;
}

const ScholaCoreContext = createContext<ScholaCoreContextValue>({
  uid: null,
  displayName: '',
  userRecord: null,
  isTelegram: false,
  refreshUserRecord: async () => {}
});

export const useScholaCoreUser = () => useContext(ScholaCoreContext);

type Route = 'bursary' | 'classroom' | 'admissions';

const NAV_ITEMS: { route: Route; label: string; roles: ScholaCoreRole[] }[] = [
  { route: 'bursary', label: 'Subscription', roles: ['student', 'parent', 'bursary', 'developer'] },
  { route: 'classroom', label: 'Classroom', roles: ['student', 'teacher', 'developer'] },
  { route: 'admissions', label: 'Admissions', roles: ['parent', 'bursary', 'developer'] }
];

export default function App() {
  const [telegramUser, setTelegramUser] = useState<ScholaCoreTelegramUser | null>(null);
  const [isTelegram, setIsTelegram] = useState(false);
  const [userRecord, setUserRecord] = useState<ScholaCoreUserRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [route, setRoute] = useState<Route>('bursary');

  useEffect(() => {
    initTelegramApp();
    const tgUser = getTelegramUser();
    setTelegramUser(tgUser);

    if (tgUser) {
      setIsTelegram(true);
      bootstrapTelegramSession();
      return;
    }

    // Not in Telegram: this is the normal-web path. Firebase Auth restores
    // a persisted browser session asynchronously — onAuthStateChanged
    // fires once with whatever it finds (a signed-in user, or null).
    if (firebaseConfigError) {
      setAuthError(firebaseConfigError);
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        await bootstrapWebSession();
      } else {
        setLoading(false); // show WebAuth
      }
    });
    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function bootstrapTelegramSession() {
    const rawInitData = getRawInitData();
    if (!rawInitData) {
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
      if (!res.ok) throw new Error(data.error || 'Could not verify Telegram session');

      await signInWithTelegramToken(data.customToken);
      setUserRecord(data.user);
    } catch (err) {
      console.error('[App] Telegram bootstrap failed', err);
      setAuthError(err instanceof Error ? err.message : 'Could not sign in');
    } finally {
      setLoading(false);
    }
  }

  async function bootstrapWebSession() {
    try {
      const idToken = await getAuthToken();
      if (!idToken) throw new Error('No session token available');

      const res = await fetch('/api/auth-web', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not verify session');

      await signInWithTelegramToken(data.customToken);
      setUserRecord(data.user);
    } catch (err) {
      console.error('[App] Web bootstrap failed', err);
      setAuthError(err instanceof Error ? err.message : 'Could not sign in');
    } finally {
      setLoading(false);
    }
  }

  const refreshUserRecord = async () => {
    const uid = userRecord?.uid ?? auth.currentUser?.uid;
    if (!uid) return;
    const snap = await getDoc(doc(db, 'users', uid));
    if (snap.exists()) setUserRecord({ uid, ...(snap.data() as Omit<ScholaCoreUserRecord, 'uid'>) });
  };

  const displayName = userRecord?.name || telegramUser?.firstName || '';

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-core-50">
        <div className="flex flex-col items-center gap-3">
          <Logo className="h-10 w-10 animate-pulse text-brand-500" />
          <p className="font-mono text-xs uppercase tracking-wider text-core-600">Loading ScholaCore…</p>
        </div>
      </div>
    );
  }

  if (authError) {
    return (
      <div className="flex h-screen items-center justify-center bg-core-50 p-6 text-center">
        <div>
          <h1 className="mb-2 text-xl font-semibold text-core-950">Couldn't sign you in</h1>
          <p className="text-sm text-core-600">{authError}</p>
        </div>
      </div>
    );
  }

  // Not in Telegram and not signed in to a web account.
  if (!isTelegram && !userRecord && !auth.currentUser) {
    return (
      <Suspense fallback={<FullScreenSpinner />}>
        <WebAuth onAuthenticated={(_, user) => setUserRecord(user as ScholaCoreUserRecord)} />
      </Suspense>
    );
  }

  // In Telegram but launched outside a real Telegram context somehow — or
  // a web session that authenticated but returned no user (edge case).
  if (isTelegram && !telegramUser) {
    return (
      <div className="flex h-screen items-center justify-center bg-core-50 p-6 text-center">
        <div>
          <h1 className="mb-2 text-xl font-semibold text-core-950">Open in Telegram</h1>
          <p className="text-sm text-core-600">
            Please open this link from your Telegram client, or visit it directly in a browser to sign in on the
            web instead.
          </p>
        </div>
      </div>
    );
  }

  if (!userRecord) {
    return (
      <Suspense fallback={<FullScreenSpinner />}>
        <SignUp onSignedUp={setUserRecord} />
      </Suspense>
    );
  }

  if (userRecord.role === 'pending_teacher') {
    return (
      <div className="flex h-screen items-center justify-center bg-core-50 p-6 text-center">
        <div>
          <h1 className="mb-2 text-xl font-semibold text-core-950">Application under review</h1>
          <p className="text-sm text-core-600">
            Thanks, {userRecord.name.split(' ')[0]} — your teaching application is being reviewed. You'll be
            contacted with next steps.
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
    <ScholaCoreContext.Provider
      value={{ uid: userRecord.uid, displayName, userRecord, isTelegram, refreshUserRecord }}
    >
      <div className="flex min-h-screen flex-col bg-core-50">
        <header className="border-b border-core-100 bg-core-950 px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Logo className="h-7 w-7 text-brand-400" />
              <p className="text-lg font-bold leading-none text-white">ScholaCore</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-white">{displayName}</p>
              <p className="text-[11px] capitalize text-core-400">{role}</p>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-4 py-5">
          <Suspense fallback={<InlineSpinner />}>{renderRoute()}</Suspense>
        </main>

        <nav className="sticky bottom-0 border-t border-core-100 bg-white px-2 py-2">
          <div className="flex justify-around">
            {visibleNav.map((item) => (
              <button
                key={item.route}
                onClick={() => setRoute(item.route)}
                className={`rounded-card px-3 py-2 text-xs font-medium transition-colors ${
                  route === item.route ? 'bg-brand-500 text-white' : 'text-core-600 hover:bg-core-100'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </nav>
      </div>
    </ScholaCoreContext.Provider>
  );
}

function FullScreenSpinner() {
  return (
    <div className="flex h-screen items-center justify-center bg-core-50">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-core-200 border-t-brand-500" />
    </div>
  );
}

function InlineSpinner() {
  return (
    <div className="flex justify-center py-10">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-core-200 border-t-brand-500" />
    </div>
  );
}
