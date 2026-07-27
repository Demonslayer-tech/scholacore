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

export const app: FirebaseApp = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const db: Firestore = getFirestore(app);
export const auth: Auth = getAuth(app);

/**
 * Exchanges a server-minted Firebase custom token (produced from verified
 * Telegram initData — see lib/telegram.ts + a /api/auth endpoint) for a
 * signed-in Firebase Auth session. This is what lets firestore.rules read
 * request.auth.token.role.
 */
export async function signInWithTelegramToken(customToken: string) {
  return signInWithCustomToken(auth, customToken);
}
