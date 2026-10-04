/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#14213D', 50: '#EEF1F6', 100: '#D9DFEA', 300: '#8B97AE', 500: '#4A5873', 700: '#22304F', 900: '#0E1830' },
        paper: '#F5F6F8',
        brand: 'rgb(var(--brand) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        saffron: '#E09A2D',
        rose: '#D64545',
        leaf: '#1F9D6B',
      },
      fontFamily: {
        sans: ['"Noto Sans"', '"Noto Sans Sinhala"', '"Noto Sans Tamil"', 'system-ui', 'sans-serif'],
      },
      borderRadius: { ctl: '6px', panel: '10px' },
    },
  },
  plugins: [],
};
