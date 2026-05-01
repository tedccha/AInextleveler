import type { Config } from 'tailwindcss'

// Locked per design review:
// - Geist Sans body, Geist Mono code (loaded via geist npm package in app/layout.tsx)
// - shadcn neutral palette + ONE accent: green-600
// - No purple/violet/indigo gradients
// - Border radius capped at 6px on cards
const config: Config = {
  darkMode: 'class',
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'monospace'],
      },
      borderRadius: {
        // Cap card radius per design review anti-slop ban.
        card: '6px',
      },
      colors: {
        // Single accent. Have-status, primary buttons.
        accent: {
          DEFAULT: '#16a34a', // green-600
          hover: '#15803d',   // green-700
        },
      },
    },
  },
  plugins: [],
}
export default config
