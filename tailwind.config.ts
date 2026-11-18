import type { Config } from "tailwindcss";
import { palette } from "./src/lib/theme";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: palette.ink,
        surface: palette.surface,
        brand: palette.brand,
        fg: palette.fg,
        line: palette.line,
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
          "danger-solid": palette.status.danger.solid,
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Impact", "Arial Narrow", "sans-serif"],
      },
      borderRadius: {
        xl: "0.75rem",
        "2xl": "1rem",
        "3xl": "1.25rem",
      },
      boxShadow: {
        soft: "0 1px 2px rgba(0,0,0,0.4), 0 8px 24px -12px rgba(0,0,0,0.6)",
        lift: "0 2px 4px rgba(0,0,0,0.5), 0 16px 32px -14px rgba(255,202,5,0.25)",
      },
      spacing: {
        section: "5rem",
      },
    },
  },
  plugins: [],
};

export default config;
