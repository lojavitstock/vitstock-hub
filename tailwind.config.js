/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        amber: {
          400: '#EEBB2C',
          500: '#D9A61B',
        }
      },
      fontFamily: {
        overpass: ['Overpass', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
