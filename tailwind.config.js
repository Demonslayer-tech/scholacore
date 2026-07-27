/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ScholaCore brand — deep academic navy + a single warm "gold seal" accent,
        // kept restrained so it reads as an institution, not a startup.
        core: {
          950: '#0A1628',
          900: '#0F1F38',
          800: '#16304F',
          700: '#1F4066',
          600: '#2C5A8C',
          100: '#E8EEF5',
          50: '#F5F8FC'
        },
        seal: {
          600: '#B8860B',
          500: '#D4A017',
          400: '#E6BC4A'
        },
        signal: {
          success: '#1E8F5F',
          danger: '#C0392B',
          pending: '#B8860B'
        }
      },
      fontFamily: {
        display: ['"Fraunces"', 'serif'],
        sans: ['"Inter"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace']
      },
      borderRadius: {
        card: '10px'
      }
    }
  },
  plugins: []
};
