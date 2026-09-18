// Loaded via <script type="module" src="/assets/js/telegram.js">.
// Plain JS module, no build step, no TypeScript types. The shapes below
// are documented in comments instead of interfaces.

/**
 * Bootstraps the Telegram Mini App SDK if present. Safe to call when the
 * page is opened in a normal browser (outside Telegram); it simply
 * returns null rather than throwing.
 * @returns {{id: number, first_name: string, last_name?: string} | null}
 */
export function initTelegramWebApp() {
  try {
    const webApp = window.Telegram && window.Telegram.WebApp;
    if (!webApp) return null;
    webApp.ready();
    webApp.expand();
    return (webApp.initDataUnsafe && webApp.initDataUnsafe.user) || null;
  } catch (err) {
    console.warn('Telegram WebApp not available:', err);
    return null;
  }
}

/**
 * Returns the raw, signed initData string for server-side verification
 * (see api/telegram-auth.php). This is different from
 * initTelegramWebApp()'s return value, which is the convenient but
 * client-supplied (and therefore unverifiable) initDataUnsafe.user.
 * @returns {string} empty string when not running inside Telegram
 */
export function getTelegramInitData() {
  try {
    const webApp = window.Telegram && window.Telegram.WebApp;
    return (webApp && webApp.initData) || '';
  } catch (err) {
    return '';
  }
}

/**
 * @param {HTMLElement} el
 * @param {string} message
 * @param {'error' | 'success'} type
 */
export function showAlert(el, message, type) {
  el.textContent = message;
  el.className = 'sc-alert sc-alert--' + type;
  el.style.display = 'block';
}
