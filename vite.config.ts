import { defineConfig } from 'vite';
import { resolve } from 'path';

// Multi-page vanilla TypeScript app. No React/Vue — the brief calls for
// HTML5 + TypeScript + Tailwind, kept deliberately lightweight for fast
// load inside Telegram Mini Apps.
//
// NOTE: this input list currently only has index.html (Phase 1 scaffold).
// Phase 2 adds student-signup.html, teacher-vetting.html, teacher-portal.html,
// admin-dashboard.html, privacy-policy.html, terms-of-service.html — each
// new page must be added to `input` below or Vite won't build it.
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html')
      }
    }
  }
});
