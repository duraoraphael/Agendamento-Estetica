import type { Config } from "tailwindcss";
import { palette } from "./src/lib/theme";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        blush: palette.blush,
        cream: palette.cream,
        wine: palette.wine,
        plum: palette.plum,
        gold: palette.gold,
        neutral: palette.neutral,
        status: {
          confirmed: palette.status.confirmed.fg,
          "confirmed-bg": palette.status.confirmed.bg,
          done: palette.status.done.fg,
          "done-bg": palette.status.done.bg,
          cancelled: palette.status.cancelled.fg,
          "cancelled-bg": palette.status.cancelled.bg,
          noshow: palette.status.noshow.fg,
          "noshow-bg": palette.status.noshow.bg,
          danger: palette.status.danger.fg,
          "danger-bg": palette.status.danger.bg,
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Georgia", "serif"],
      },
      borderRadius: {
        xl: "1rem",
        "2xl": "1.5rem",
        "3xl": "2rem",
      },
      boxShadow: {
        soft: "0 1px 2px rgba(52,35,45,0.04), 0 8px 24px -12px rgba(139,49,87,0.18)",
        lift: "0 2px 4px rgba(52,35,45,0.05), 0 16px 32px -14px rgba(139,49,87,0.28)",
      },
      spacing: {
        section: "5rem",
      },
    },
  },
  plugins: [],
};

export default config;
