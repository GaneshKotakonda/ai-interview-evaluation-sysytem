/** @type {import('tailwindcss').Config} */
// Design tokens: a warm "paper and ink" palette. Ink is the only accent;
// ok / warn / bad are reserved for status and always paired with text.
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#f7f6f2',
        surface: '#ffffff',
        sunken: '#efede7',
        line: { DEFAULT: '#e5e2da', strong: '#d3cfc4' },
        ink: {
          DEFAULT: '#171611',
          2: '#4f4b43',
          3: '#868176',
          4: '#b3ada1',
        },
        ok: { DEFAULT: '#2f6a4a', soft: '#e8f0ea' },
        warn: { DEFAULT: '#8f6215', soft: '#f6eedd' },
        bad: { DEFAULT: '#a13a30', soft: '#f6e5e2' },
      },
      fontFamily: {
        sans: ['Geist', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        serif: ['Fraunces', 'ui-serif', 'Georgia', 'serif'],
        mono: ['"Geist Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: {
        panel: '14px',
        control: '10px',
      },
      boxShadow: {
        panel: '0 1px 0 rgba(23, 22, 17, 0.04)',
        lift: '0 12px 28px -12px rgba(23, 22, 17, 0.22)',
        pop: '0 18px 48px -16px rgba(23, 22, 17, 0.35)',
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [],
};
