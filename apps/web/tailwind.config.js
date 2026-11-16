/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Clean white + red brand palette. Prefer these semantic names over
        // ad-hoc gray utilities so the whole app restyles from one place.
        brand: {
          50: '#fef2f2',
          100: '#fee2e2',
          200: '#fecaca',
          300: '#fca5a5',
          400: '#f87171',
          500: '#ef4444',
          600: '#dc2626', // primary action
          700: '#b91c1c', // hover / pressed
          800: '#991b1b',
          900: '#7f1d1d',
        },
        surface: '#ffffff',
        canvas: '#faf8f8',
        border: '#ece7e7',
        ink: {
          DEFAULT: '#1f1717',
          muted: '#6b6262',
        },
        accent: {
          DEFAULT: '#dc2626', // brand-600
          hover: '#b91c1c', // brand-700
          soft: '#fef2f2', // brand-50
        },
        success: {
          DEFAULT: '#047857',
          soft: '#ecfdf5',
        },
        warning: {
          DEFAULT: '#b45309',
          soft: '#fffbeb',
        },
        danger: {
          DEFAULT: '#be123c', // rose, kept distinct from the red brand
          soft: '#fff1f2',
        },
        info: {
          DEFAULT: '#1d4ed8',
          soft: '#eff6ff',
        },
        // Categorical palette for dashboards/charts. Mirrored in
        // `src/lib/chartColors.ts` for Recharts (which needs raw hex values).
        data: {
          red: '#dc2626',
          indigo: '#4f46e5',
          teal: '#0d9488',
          amber: '#f59e0b',
          violet: '#7c3aed',
          sky: '#0ea5e9',
          emerald: '#10b981',
          pink: '#ec4899',
          slate: '#64748b',
        },
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, #dc2626 0%, #b91c1c 55%, #991b1b 100%)',
        'brand-soft': 'linear-gradient(180deg, #fef2f2 0%, #ffffff 100%)',
        'page-glow':
          'radial-gradient(900px 400px at 100% -10%, rgba(220,38,38,0.07), transparent 60%)',
        'dot-pattern': 'radial-gradient(rgba(127,29,29,0.10) 1px, transparent 1px)',
      },
      backgroundSize: {
        dots: '18px 18px',
      },
      boxShadow: {
        card: '0 1px 2px 0 rgba(127,29,29,0.05), 0 1px 3px 0 rgba(31,23,23,0.04)',
        overlay: '0 12px 32px -12px rgba(127,29,29,0.30)',
        glow: '0 6px 18px -6px rgba(220,38,38,0.45)',
      },
    },
  },
  plugins: [],
};
