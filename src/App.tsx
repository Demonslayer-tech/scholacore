import { createContext, useContext, useEffect, useState, Suspense, lazy } from 'react';
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
