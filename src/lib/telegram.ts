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
 * Boots the Telegram Mini App SDK. Safe to call multiple times — subsequent
 * calls are no-ops. Expands the viewport and enables the back button so the
 * app feels native inside Telegram rather than like an embedded website.
 */
export function initTelegramApp(): void {
  if (initialized) return;
  init();
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
