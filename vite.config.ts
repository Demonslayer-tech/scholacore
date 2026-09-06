import { defineConfig } from 'vite';
import { resolve } from 'path';

// Multi-page vanilla TypeScript app. No React/Vue — the brief calls for
// HTML5 + TypeScript + Tailwind, kept deliberately lightweight for fast
// load inside Telegram Mini Apps.
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        studentSignup: resolve(__dirname, 'student-signup.html'),
        teacherVetting: resolve(__dirname, 'teacher-vetting.html'),
        teacherPortal: resolve(__dirname, 'teacher-portal.html'),
        adminDashboard: resolve(__dirname, 'admin-dashboard.html'),
        privacyPolicy: resolve(__dirname, 'privacy-policy.html'),
        termsOfService: resolve(__dirname, 'terms-of-service.html')
      }
    }
  }
});
