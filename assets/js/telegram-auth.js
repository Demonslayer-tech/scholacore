import { auth } from '/api/firebase-config.php';
import { getTelegramInitData } from '/assets/js/telegram.js';
import { signInWithCustomToken } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

/**
 * Attempts a silent, formless sign-in using Telegram's identity. Returns
 * null (not an error) when the page isn't running inside Telegram, so
 * callers can fall back to the email/password form without treating
 * "opened in a normal browser" as a failure.
 *
 * @returns {Promise<{isNewUser: boolean, needsGradeLevel: boolean} | null>}
 * @throws if running inside Telegram but the sign-in itself fails
 *   (e.g. the server couldn't verify the signature) -- that IS a real
 *   error the caller should show to the user.
 */
export async function silentTelegramSignIn() {
  const initData = getTelegramInitData();
  if (!initData) {
    return null;
  }

  const response = await fetch('/api/telegram-auth.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData }),
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || 'Could not verify your Telegram identity.');
  }

  await signInWithCustomToken(auth, result.customToken);
  return { isNewUser: result.isNewUser, needsGradeLevel: result.needsGradeLevel };
}
