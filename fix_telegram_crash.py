#!/usr/bin/env python3
"""
ScholaCore: fix uncaught crash when the app is opened outside Telegram.

Writes the corrected src/lib/telegram.ts, then runs git add / commit /
push automatically.

Run with:
    python fix_telegram_crash.py

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

TELEGRAM_TS = r'''import {
  init,
  retrieveLaunchParams,
  backButton,
  mainButton,
  viewport,
  hapticFeedback,
  type User
} from '@telegram-apps/sdk-react';

export interface ScholaCoreTelegramUser {
  telegramId: string;
  firstName: string;
  lastName?: string;
  username?: string;
  photoUrl?: string;
  languageCode?: string;
}

let initialized = false;

/**
 * Boots the Telegram Mini App SDK. Safe to call multiple times — subsequent
 * calls are no-ops. Expands the viewport and enables the back button so the
 * app feels native inside Telegram rather than like an embedded website.
 */
export function initTelegramApp(): void {
  if (initialized) return;

  try {
    init();
  } catch {
    // init() throws when there's no real Telegram launch context at all —
    // e.g. this URL opened directly in a normal browser tab rather than
    // through Telegram, which is exactly how you'd test this in devtools.
    // That's an expected, valid case: getTelegramUser()/getRawInitData()
    // below already handle it gracefully and App.tsx shows an "Open in
    // Telegram" message. But this call sits directly in a useEffect with
    // no error boundary around it, so if we don't catch it HERE, it
    // becomes an uncaught exception that blanks the entire page before
    // React ever renders anything — which is exactly what was happening.
    initialized = true;
    return;
  }

  initialized = true;

  if (viewport.mount.isAvailable()) {
    viewport.mount();
    viewport.expand();
  }
  if (backButton.mount.isAvailable()) {
    backButton.mount();
  }
}

/**
 * Pulls the authenticated Telegram user out of launch params. This is
 * read-only client-side context for UI purposes (greeting the user, etc).
 * It must NOT be trusted for access control — always re-verify `initData`
 * server-side (HMAC against the bot token) before minting a Firebase custom
 * token or writing to Firestore on the user's behalf.
 */
export function getTelegramUser(): ScholaCoreTelegramUser | null {
  try {
    const { initData } = retrieveLaunchParams();
    const user = initData?.user as User | undefined;
    if (!user) return null;

    return {
      telegramId: String(user.id),
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.username,
      photoUrl: user.photoUrl,
      languageCode: user.languageCode
    };
  } catch {
    return null;
  }
}

/**
 * Returns the raw, still-signed initData string. This is what gets sent to
 * the backend for HMAC verification — never parse-and-forward the parsed
 * object, since that discards the signature.
 */
export function getRawInitData(): string | null {
  try {
    const { initDataRaw } = retrieveLaunchParams();
    return initDataRaw ?? null;
  } catch {
    return null;
  }
}

export function showMainButton(text: string, onClick: () => void): void {
  if (!mainButton.mount.isAvailable()) return;
  mainButton.mount();
  mainButton.setParams({ text, isVisible: true, isEnabled: true });
  mainButton.onClick(onClick);
}

export function hideMainButton(): void {
  if (mainButton.isMounted()) {
    mainButton.setParams({ isVisible: false });
  }
}

export function hapticSuccess(): void {
  if (hapticFeedback.notificationOccurred.isAvailable()) {
    hapticFeedback.notificationOccurred('success');
  }
}

export function hapticError(): void {
  if (hapticFeedback.notificationOccurred.isAvailable()) {
    hapticFeedback.notificationOccurred('error');
  }
}
'''

FILES = {
    PROJECT_DIR / "src" / "lib" / "telegram.ts": TELEGRAM_TS,
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
        sys.exit(1)

    write_files()

    print("\n== git add ==")
    run_git(["add", "-A"])

    print("\n== git commit ==")
    run_git(
        ["commit", "-m", "Fix uncaught crash in initTelegramApp() outside Telegram"],
        allow_fail_msg="nothing new to commit, files already matched",
    )

    print("\n== git push ==")
    code = run_git(["push"])
    if code != 0:
        print("\ngit push reported an error above (auth prompt needed? no upstream set?).")
        print("Everything else is done - just run 'git push' yourself to finish.")
        sys.exit(1)

    print("\nDone. Vercel should auto-redeploy in about 1-2 minutes.")
    print("After that: the bare URL in a normal browser tab will show")
    print("'Open in Telegram' instead of blank white - that's the real fix here.")
    print("To test the ACTUAL app working end to end, it still needs to be")
    print("opened through Telegram itself (your bot's menu button / t.me link),")
    print("since that's the only place real launch data exists.")


if __name__ == "__main__":
    main()
