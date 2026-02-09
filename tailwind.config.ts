import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        serif: ['var(--font-serif)', 'Cormorant Garamond', 'Georgia', 'serif'],
        sans: ['var(--font-sans)', 'Karla', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'IBM Plex Mono', 'Menlo', 'monospace'],
      },
      colors: {
        background: "#f8f5ee",
        foreground: "#2c2a25",
        ink: "#2c2a25",
        paper: "#f8f5ee",
        parchment: "#f1ece1",
        warm: "#e6dfd0",
        accent: "#7a6842",
        "accent-soft": "#b8a67a",
        muted: "#8a8478",
        sage: "#5e7252",
        "sage-bg": "#eaf0e4",
        rose: "#8f5f5f",
        "rose-bg": "#f3ebe9",
        sky: "#5a6f87",
        "sky-bg": "#e8edf3",
        amber: "#b08a3e",
        "amber-bg": "#faf3e2",
        earth: "#6e5d48",
        border: "#ddd6c8",
        card: "#fdfbf6",
      },
    },
  },
  plugins: [],
};

export default config;
