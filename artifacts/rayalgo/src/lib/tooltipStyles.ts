export const chartTooltipContentStyle = {
  background: "var(--ra-tooltip-bg)",
  border: "1px solid var(--ra-tooltip-border)",
  borderRadius: "6px",
  color: "var(--ra-tooltip-text)",
  fontFamily: "var(--ra-font-sans)",
  fontSize: "var(--ra-type-body)",
  lineHeight: 1.35,
  boxShadow: "var(--ra-tooltip-shadow)",
} as const;

export const chartTooltipLabelStyle = {
  color: "var(--ra-tooltip-muted)",
  fontFamily: "var(--ra-font-sans)",
  fontSize: "var(--ra-type-label)",
} as const;

export const chartTooltipItemStyle = {
  color: "var(--ra-tooltip-text)",
  fontFamily: "var(--ra-font-sans)",
  fontSize: "var(--ra-type-body)",
} as const;
