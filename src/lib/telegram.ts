import {
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
 * Boots the Telegram Mini App SDK. Safe to call multiple times, and safe
 * to call outside Telegram entirely (the app now also runs as a normal
 * website — see App.tsx) — init() throws when there's no real Telegram
 * launch context, and that's caught here rather than left to crash the
 * whole page before React renders anything.
 */
export function initTelegramApp(): void {
  if (initialized) return;

  try {
    init();
  } catch {
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
 * Pulls the authenticated Telegram user out of launch params, or null if
 * this isn't running inside Telegram at all (which App.tsx treats as "show
 * the normal web sign-in" rather than an error). This is read-only
 * client-side context for UI purposes — it must NOT be trusted for access
 * control; always re-verify `initData` server-side before minting a
 * Firebase custom token.
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
