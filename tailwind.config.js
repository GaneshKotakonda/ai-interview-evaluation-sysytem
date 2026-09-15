/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          50: '#f3f6fb',
          100: '#e3eaf5',
          600: '#244f82',
          700: '#1b416d',
          800: '#153657',
          900: '#0f2748',
        },
        tealish: {
          50: '#eefcf9',
          500: '#14a891',
          600: '#0e8a78',
        },
      },
      boxShadow: {
        card: '0 8px 24px rgba(15, 39, 72, 0.08)',
      },
    },
  },
  plugins: [],
};
