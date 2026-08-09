import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Generated fresh every time this diagnostic script runs. If you don't see
// today's timestamp on your phone after redeploying, Telegram is showing
// you a CACHED build -- fully force-quit Telegram (swipe it away in the
// app switcher, not just closing the Mini App) and reopen.
const BUILD_STAMP = '2026-08-09 13:00:00 UTC';

function renderBuildStamp() {
  const el = document.createElement('div');
  el.textContent = `Build: ${BUILD_STAMP}`;
  el.style.cssText =
    'position:fixed;bottom:2px;right:4px;font-size:9px;font-family:monospace;' +
    'color:#94a3b8;opacity:0.6;z-index:999999;pointer-events:none;';
  document.body.appendChild(el);
}

// Writes directly into the DOM, independent of React state -- this must
// keep working even if React itself never successfully mounts (e.g. a
// module-level throw during import, before any component renders).
function renderFatalError(source: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error && error.stack ? error.stack : '(no stack available)';

  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;inset:0;background:#f8fafc;color:#0f172a;z-index:9999999;' +
    'padding:24px;overflow:auto;font-family:-apple-system,sans-serif;';
  el.innerHTML = `
    <h1 style="font-size:18px;font-weight:700;margin:0 0 8px;">Unhandled error (${source})</h1>
    <p style="font-size:13px;color:#475569;margin:0 0 16px;">Build: ${BUILD_STAMP}</p>
    <p style="font-size:14px;font-weight:600;margin:0 0 8px;">${message}</p>
    <pre style="font-size:11px;white-space:pre-wrap;background:#e2e8f0;padding:12px;border-radius:8px;">${stack}</pre>
  `;
  document.body.appendChild(el);
}

window.addEventListener('error', (event) => {
  console.error('[global error]', event.error ?? event.message);
  renderFatalError('window.onerror', event.error ?? event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('[unhandled rejection]', event.reason);
  renderFatalError('unhandledrejection', event.reason);
});

try {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
  renderBuildStamp();
} catch (err) {
  console.error('[main.tsx] Failed to mount React root', err);
  renderFatalError('React root render', err);
}
