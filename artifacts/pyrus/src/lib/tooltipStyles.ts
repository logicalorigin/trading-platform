// @ts-expect-error JSX module imported into TypeScript context
import { RADII, T, dim } from "./uiTokens.jsx";

export const chartTooltipContentStyle = {
  background: "var(--ra-tooltip-bg)",
  border: "1px solid var(--ra-tooltip-border)",
  borderRadius: `${dim(RADII.sm)}px`,
  padding: "8px 12px",
  color: "var(--ra-tooltip-text)",
  fontFamily: T.display,
  fontSize: "var(--ra-type-body)",
  lineHeight: 1.4,
  boxShadow: "var(--ra-tooltip-shadow)",
} as const;
