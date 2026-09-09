<?php
// Served as a JavaScript ES module (not JSON) so pages can:
//   import { auth, db, storage } from '/api/firebase-config.php';
// This keeps Firebase config values out of static, committed JS files;
// they come from real environment variables set in Vercel, the same way
// every other secret/config value in this project does.

header('Content-Type: application/javascript');

// Not secrets, but still driven by env vars so nothing is hardcoded here.
$config = [
    'apiKey' => getenv('FIREBASE_API_KEY') ?: '',
    'authDomain' => getenv('FIREBASE_AUTH_DOMAIN') ?: '',
    'projectId' => getenv('FIREBASE_PROJECT_ID') ?: '',
    'storageBucket' => getenv('FIREBASE_STORAGE_BUCKET') ?: '',
    'messagingSenderId' => getenv('FIREBASE_MESSAGING_SENDER_ID') ?: '',
    'appId' => getenv('FIREBASE_APP_ID') ?: '',
];

$configJson = json_encode($config, JSON_UNESCAPED_SLASHES);
?>
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getStorage } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js';

const firebaseConfig = <?php echo $configJson; ?>;

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
