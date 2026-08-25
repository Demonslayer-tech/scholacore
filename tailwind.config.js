/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        core: {
          50: '#F6F6F6',
          100: '#EBEBEB',
          200: '#D8D8D8',
          400: '#9A9A9A',
          600: '#525252',
          800: '#262626',
          900: '#141414',
          950: '#000000'
        },
        brand: {
          50: '#E6F0EF',
          100: '#CCE1DF',
          400: '#0A8983',
          500: '#025F5B',
          600: '#014B47',
          700: '#013634'
        },
        signal: {
          success: '#1E8F5F',
          danger: '#C0392B',
          pending: '#B8860B'
        }
      },
      fontFamily: {
        sans: ['"Inter"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace']
      },
      borderRadius: {
        card: '12px'
      }
    }
  },
  plugins: []
};
