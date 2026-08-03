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
