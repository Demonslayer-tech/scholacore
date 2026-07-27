import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getAuth, type Auth } from 'firebase-admin/auth';

// Shared across all /api functions. FIREBASE_SERVICE_ACCOUNT_KEY is the
// full service-account JSON, stored as a single-line Vercel env var.
// Using the Admin SDK here means these operations bypass firestore.rules
// entirely — which is intentional: the webhook and AI-grading endpoints are
// the ONLY writers for transactions/aiScore/unlockedLessons, so they run
// with elevated trust that the rules explicitly refuse to grant clients.
let app: App;

function getAdminApp(): App {
  if (getApps().length) {
    return getApps()[0];
  }

  const rawKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!rawKey) {
    throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_KEY environment variable');
  }

  const serviceAccount = JSON.parse(rawKey);

  app = initializeApp({
    credential: cert(serviceAccount)
  });

  return app;
}

export function getAdminFirestore(): Firestore {
  return getFirestore(getAdminApp());
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}
