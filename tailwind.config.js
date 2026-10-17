/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        theme: {
          page: '#F8FAFC',
          card: '#FFFFFF',
          border: '#E2E8F0',
          sidebar: '#0F172A',
          logo: '#2563EB',
          text: '#0F172A',
          muted: '#64748B',
          accent: '#2563EB',
          gold: '#C89A2E',
          rose: '#C4525B',
          indigo: '#4338CA',
          cyan: '#06B6D4',
        },
        brand: {
          50: '#EFF6FF',
          100: '#DBEAFE',
          500: '#2563EB',
          600: '#1D4ED8',
          800: '#1E3A8A',
          900: '#0F172A',
        },
      },
      fontFamily: {
        marathi: ['Noto Sans Devanagari', 'Mukta', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
