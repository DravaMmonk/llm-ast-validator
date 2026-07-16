/** @type {import('tailwindcss').Config} */

// Map a CSS variable to a Tailwind color token (alpha-aware via <alpha-value>).
const v = (name) => `var(--${name})`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      /*
       * `mobile:` — phone mode. Deliberately NOT width-only: a zoomed-in
       * desktop window narrows the CSS viewport, and desktop layouts must
       * survive zoom unchanged (kit.MOBILE_MQ mirrors this string). Matches
       * true handsets (narrow + coarse pointer) and ultra-narrow windows.
       */
      screens: {
        mobile: { raw: "(max-width: 480px), ((max-width: 767px) and (pointer: coarse))" },
      },
      colors: {
        bg: v("bg"),
        card: v("card"),
        "card-2": v("card-2"),
        elev: v("elev"),
        fg: v("fg"),
        "fg-strong": v("fg-strong"),
        muted: v("muted"),
        "muted-fg": v("muted-fg"),
        faint: v("faint"),
        border: v("border"),
        "border-2": v("border-2"),
        primary: v("primary"),
        "primary-fg": v("primary-fg"),
        "primary-soft": v("primary-soft"),
        grid: v("grid"),
        info: v("info"),
        accent2: v("accent2"),
        warn: v("warn"),
        bad: v("bad"),
        "risk-low": v("risk-low"),
        "risk-mod": v("risk-mod"),
        "risk-elev": v("risk-elev"),
        "risk-high": v("risk-high"),
        "risk-high-soft": v("risk-high-soft"),
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      /*
       * Console type scale — the ONLY sanctioned font sizes (see DESIGN.md).
       * Values are size-only strings so line-height keeps inheriting; larger
       * display numerals (15–24px) stay arbitrary and are rare by design.
       *   micro  8.5px  table micro-labels, axis ticks
       *   tag    9px    chips, badges, pills
       *   cap    10px   section captions (capSm), dense meta
       *   label  11px   pane captions (cap), key-value rows, dense body
       *   body   11.5px table cells, list rows
       *   ui     12px   buttons, inputs, body copy
       *   md     13px   emphasized body, empty-state titles
       *   title  14px   page/pane titles
       */
      fontSize: {
        nano: "8px",
        micro: "8.5px",
        tag: "9px",
        fine: "9.5px",
        cap: "10px",
        dense: "10.5px",
        label: "11px",
        body: "11.5px",
        ui: "12px",
        emph: "12.5px",
        md: "13px",
        title: "14px",
      },
      keyframes: {
        "ui-blink": { "0%,100%": { opacity: "0.35" }, "50%": { opacity: "1" } },
      },
      animation: {
        "ui-blink": "ui-blink 1.6s infinite",
      },
    },
  },
  plugins: [],
};
