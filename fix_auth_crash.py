#!/usr/bin/env python3
"""
ScholaCore: fix uncaught crash in auth-telegram.ts.

Writes the corrected api/auth-telegram.ts and api/_lib/firebaseAdmin.ts,
then runs git add / commit / push automatically.

Run with:
    python fix_auth_crash.py

If your project folder isn't at the path below, edit PROJECT_DIR first.
"""
import subprocess
import sys
import shutil
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except AttributeError:
    pass

PROJECT_DIR = Path(r"C:\Users\Bosslady\SCHOLACORE\scholacore")


def find_executable(name):
    resolved = shutil.which(name)
    if resolved:
        return resolved
    if sys.platform == "win32":
        resolved = shutil.which(name + ".cmd")
        if resolved:
            return resolved
    return name


AUTH_TELEGRAM_TS = r'''import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyTelegramInitData } from './_lib/telegramAuth';
import { getAdminAuth, getAdminFirestore } from './_lib/firebaseAdmin';

// This endpoint is the bridge between "Telegram says this is user X" and
// "Firestore/firestore.rules trust this is user X". It is not in the
// original 5-endpoint spec, but firestore.rules reads
// request.auth.token.role on every request — nothing else in this codebase
// mints that token, so without this endpoint the security rules would
// reject all reads/writes. Every other component signs in through here
// before touching Firestore (see src/App.tsx `bootstrapSession`).

interface AuthRequestBody {
  initData: string;
}

function isValidBody(body: unknown): body is AuthRequestBody {
  return !!body && typeof body === 'object' && typeof (body as Record<string, unknown>).initData === 'string';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.error('[auth-telegram] Missing TELEGRAM_BOT_TOKEN');
    return res.status(500).json({ error: 'Auth service misconfigured' });
  }

  if (!isValidBody(req.body)) {
    return res.status(400).json({ error: 'Invalid payload. Required: initData.' });
  }

  let verified;
  try {
    verified = verifyTelegramInitData(req.body.initData, botToken);
  } catch (err) {
    console.warn('[auth-telegram] initData verification failed:', err instanceof Error ? err.message : err);
    return res.status(401).json({ error: 'Invalid Telegram session' });
  }

  const telegramId = String(verified.user.id);

  try {
    // getAdminFirestore() used to be called outside this try/catch. If it
    // threw (e.g. FIREBASE_SERVICE_ACCOUNT_KEY missing or malformed), the
    // exception was never caught by this code at all — it crashed the
    // whole function, and Vercel's platform returned its own generic
    // "A server error has occurred" HTML page instead of JSON. The client
    // then failed trying to JSON.parse() that page, which is what
    // produced the "Unexpected token 'A'..." error on screen.
    const db = getAdminFirestore();
    const userRef = db.collection('users').doc(telegramId);

    const snap = await userRef.get();
    const fallbackName = [verified.user.first_name, verified.user.last_name].filter(Boolean).join(' ');

    let userRecord: {
      name: string;
      role: string;
      studentId?: string;
      classId?: string;
      guardianTelegramId?: string;
      unlockedLessons: Record<string, boolean>;
    };

    if (snap.exists) {
      const data = snap.data()!;
      userRecord = {
        name: data.name ?? fallbackName,
        role: data.role ?? 'student',
        studentId: data.studentId,
        classId: data.classId,
        guardianTelegramId: data.guardianTelegramId,
        unlockedLessons: data.unlockedLessons ?? {}
      };
    } else {
      // First launch: provision a minimal student-role profile. Elevated
      // roles (teacher/bursar/principal) are never self-assigned — a
      // principal promotes a user out-of-band (Firebase console / an admin
      // tool), which naturally takes effect next time this endpoint mints
      // a fresh token for them.
      userRecord = { name: fallbackName, role: 'student', unlockedLessons: {} };
      await userRef.set({
        ...userRecord,
        createdAt: new Date().toISOString()
      });
    }

    const customToken = await getAdminAuth().createCustomToken(telegramId, { role: userRecord.role });

    return res.status(200).json({
      customToken,
      user: { telegramId, ...userRecord }
    });
  } catch (err) {
    console.error('[auth-telegram] Failed to establish session', err);
    // Surfacing the real message here (rather than a generic one) is
    // deliberate — this endpoint's failures are almost always a
    // deployment config problem (missing/malformed env var), and that's
    // exactly what's needed on screen to actually fix it, with no way to
    // read Vercel's function logs from inside Telegram's mobile WebView.
    const message = err instanceof Error ? err.message : 'Unable to establish session';
    return res.status(500).json({ error: message });
  }
}
'''

FIREBASE_ADMIN_TS = r'''import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
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

  let serviceAccount: object;
  try {
    serviceAccount = JSON.parse(rawKey);
  } catch {
    // A truncated paste or a stray quote/newline from Vercel's env var UI
    // is the usual cause — this is deliberately more specific than a
    // generic "invalid credential" error, since the fix is almost always
    // "re-paste the full service account JSON as one line."
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_KEY is not valid JSON. Re-paste the full service account JSON (from Firebase Console → Project Settings → Service Accounts → Generate new private key) as a single line, with no extra quotes added around it.'
    );
  }

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
'''

FILES = {
    PROJECT_DIR / "api" / "auth-telegram.ts": AUTH_TELEGRAM_TS,
    PROJECT_DIR / "api" / "_lib" / "firebaseAdmin.ts": FIREBASE_ADMIN_TS,
}


def write_files():
    print("== Writing files ==")
    for path, content in FILES.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        print("  wrote " + str(path.relative_to(PROJECT_DIR)))


def run(cmd, cwd, allow_fail_msg=None, timeout=300):
    cmd = [find_executable(cmd[0])] + cmd[1:]
    result = subprocess.run(cmd, cwd=str(cwd), capture_output=True, text=True, timeout=timeout)
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
        sys.exit(1)

    write_files()

    print("\n== git add ==")
    run(["git", "add", "-A"], PROJECT_DIR)

    print("\n== git commit ==")
    run(
        ["git", "commit", "-m", "Fix uncaught crash in auth-telegram.ts, surface real error"],
        PROJECT_DIR,
        allow_fail_msg="nothing new to commit, files already matched",
    )

    print("\n== git push ==")
    code = run(["git", "push"], PROJECT_DIR)
    if code != 0:
        print("\ngit push reported an error above (auth prompt needed? no upstream set?).")
        print("Everything else is done - just run 'git push' yourself to finish.")
        sys.exit(1)

    print("\nDone. Vercel should auto-redeploy in about 1-2 minutes.")
    print("\nAfter that, reopen the mini app in Telegram (fully close it first).")
    print("If FIREBASE_SERVICE_ACCOUNT_KEY really is the problem, you'll now see")
    print("the ACTUAL error on screen instead of the JSON parse crash - e.g.")
    print("'Missing FIREBASE_SERVICE_ACCOUNT_KEY environment variable' or")
    print("'FIREBASE_SERVICE_ACCOUNT_KEY is not valid JSON'. Whatever it says,")
    print("send it to me and it'll be a very short fix from there.")
    print("\nQuick self-check while you wait for the deploy: in Vercel -> your")
    print("project -> Settings -> Environment Variables, confirm")
    print("FIREBASE_SERVICE_ACCOUNT_KEY exists and its value starts with { and")
    print("ends with } (the full service account JSON on one line, no extra")
    print("quotes wrapped around it by Vercel's UI).")


if __name__ == "__main__":
    main()
