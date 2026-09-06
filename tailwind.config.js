/** @type {import('tailwindcss').Config} */
export default {
  content: ['./*.html', './src/**/*.{ts,js}'],
  darkMode: false,
  theme: {
    extend: {
      colors: {
        'sc-blue': '#1E40AF',
        'sc-blue-dark': '#0F52BA',
        'sc-bg': '#F8FAFC',
        'sc-border': '#E2E8F0'
      },
      fontFamily: {
        serif: ['Georgia', '"Times New Roman"', 'serif']
      }
    }
  },
  plugins: []
};
