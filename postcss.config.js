/**
 * postcss.config.js
 *
 * Why it exists: Chains Tailwind + Autoprefixer for the renderer bundle.
 * Kept as CommonJS (.js) rather than the PRD-listed .ts because Tailwind and
 * Vite load this natively without an additional TS loader. Flagged as a minor
 * deviation in the scaffold handoff entry.
 */

module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
