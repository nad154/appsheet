/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Neutral, formal palette (white + deep wine red accent). Prefer these
        // semantic names over ad-hoc gray utilities so the whole app restyles
        // from one place.
        surface: '#ffffff',
        canvas: '#f8fafc',
        border: '#e2e8f0',
        ink: {
          DEFAULT: '#0f172a',
          muted: '#64748b',
        },
        accent: {
          DEFAULT: '#881337',
          hover: '#6b0f2b',
          soft: '#fff1f2',
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
          DEFAULT: '#b91c1c',
          soft: '#fef2f2',
        },
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px 0 rgba(70, 9, 22, 0.04)',
        overlay: '0 10px 30px -12px rgba(70, 9, 22, 0.28)',
      },
    },
  },
  plugins: [],
};
