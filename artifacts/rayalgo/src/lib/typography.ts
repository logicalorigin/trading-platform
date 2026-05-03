export const FONT_CSS_VAR = {
  sans: "var(--ra-font-sans)",
  display: "var(--ra-font-display)",
  data: "var(--ra-font-data)",
  code: "var(--ra-font-code)",
} as const;

export const TYPE_CSS_VAR = {
  micro: "var(--ra-type-micro)",
  label: "var(--ra-type-label)",
  control: "var(--ra-type-control)",
  body: "var(--ra-type-body)",
  bodyStrong: "var(--ra-type-body-strong)",
  screenTitle: "var(--ra-type-screen-title)",
} as const;

export const TYPE_PX = {
  micro: 7,
  label: 8,
  control: 8,
  body: 10,
  bodyStrong: 11,
  screenTitle: 17,
} as const;

export const APP_FONT_FALLBACK =
  "var(--ra-font-sans, 'IBM Plex Sans', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif)";
