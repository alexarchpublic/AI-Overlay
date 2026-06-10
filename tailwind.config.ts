/**
 * tailwind.config.ts
 *
 * Why it exists: Wires the trading-palette CSS variables from PRD §0 D7 into
 * Tailwind utility classes so components can use `bg-ap-bg`, `text-ap-fg`, etc.
 * without duplicating the hex values.
 */

import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/renderer/index.html', './src/renderer/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'ap-bg': 'var(--bg)',
        'ap-elevated': 'var(--bg-elevated)',
        'ap-muted': 'var(--bg-muted)',
        'ap-user-bubble': 'var(--bg-user-bubble)',
        'ap-green-action': 'var(--bg-green-action)',
        'ap-warning': 'var(--bg-warning)',
        'ap-error': 'var(--bg-error)',
        'ap-fg': 'var(--fg)',
        'ap-green': 'var(--accent-green)',
        'ap-gold': 'var(--accent-gold)',
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};

export default config;
