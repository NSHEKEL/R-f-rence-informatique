/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef5ff",
          100: "#d9e8ff",
          200: "#bcd7ff",
          300: "#8ebeff",
          400: "#589aff",
          500: "#2f74f5",
          600: "#1b6fe3",
          700: "#1553bd",
          800: "#174599",
          900: "#183d79",
          950: "#0f244a",
        },
        ink: {
          DEFAULT: "#0f172a",
          soft: "#1e293b",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)",
        soft: "0 4px 20px rgba(15,23,42,0.06)",
      },
    },
  },
  plugins: [],
};
