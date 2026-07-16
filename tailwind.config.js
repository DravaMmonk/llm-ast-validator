import preset from "./src/shared-console/tailwind-preset.js";

/**
 * The shared console preset owns the token→utility mapping, the type scale, and
 * the `mobile:` raw media query. This project only points it at its own sources;
 * it must not redefine the design language.
 */
export default {
  presets: [preset],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
};
