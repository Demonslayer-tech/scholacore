export interface TelegramWebAppUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}

interface TelegramWebApp {
  ready: () => void;
  expand: () => void;
  initData: string;
  initDataUnsafe: { user?: TelegramWebAppUser };
}

declare global {
  interface Window {
    Telegram?: { WebApp: TelegramWebApp };
  }
}

/**
 * Bootstraps the Telegram Mini App SDK if present. Safe to call when the
 * page is opened in a normal browser (outside Telegram) — it simply does
 * nothing rather than throwing, which was a real crash in the v1 app.
 */
export function initTelegramWebApp(): TelegramWebAppUser | null {
  try {
    const webApp = window.Telegram?.WebApp;
    if (!webApp) return null;
    webApp.ready();
    webApp.expand();
    return webApp.initDataUnsafe.user ?? null;
  } catch (err) {
    console.warn('Telegram WebApp not available:', err);
    return null;
  }
}

export function showAlert(el: HTMLElement, message: string, type: 'error' | 'success'): void {
  el.textContent = message;
  el.className = `sc-alert sc-alert--${type}`;
  el.style.display = 'block';
}
