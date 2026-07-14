/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/modules/manufacturing/**/*.{js,jsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["DM Sans", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "Cascadia Code", "Segoe UI Mono", "monospace"],
      },
      colors: {
        steel: {
          50: "#f4f6f8",
          100: "#e3e8ed",
          200: "#c5d0d9",
          300: "#9fb0bd",
          400: "#74899a",
          500: "#576e80",
          600: "#445766",
          700: "#384754",
          800: "#1f2937",
          900: "#0f1820",
          950: "#070d12",
        },
        accent: {
          orange: "#f97316",
          green: "#22c55e",
          red: "#ef4444",
          blue: "#3b82f6",
          purple: "#a855f7",
          amber: "#f59e0b",
        },
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "fade-in": "fadeIn 0.3s ease-out",
        "slide-up": "slideUp 0.4s ease-out",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};
