import { AppTooltip } from "@/components/ui/tooltip";
import { RADII, T, cssColorAlpha, dim, sp, textSize } from "../../../lib/uiTokens.jsx";
import { confluenceTooltip } from "./tooltips.js";
import { getTone } from "./tones.js";

const toneForDirection = (direction) =>
  direction === "buy" ? getTone("buy") : direction === "sell" ? getTone("sell") : getTone("dim");

const MiniArrow = ({ direction, tone }) => {
  const path =
    direction === "sell"
      ? "M5 11 L10 4 L0 4 Z"
      : "M5 1 L10 8 L0 8 Z";
  return (
    <svg
      width="10"
      height="12"
      viewBox="0 0 10 12"
      aria-hidden="true"
      focusable="false"
      style={{ display: "block", flex: "0 0 auto" }}
    >
      <path d={path} fill={tone} />
    </svg>
  );
};

export const ConfluenceChip = ({
  agreeCount = 0,
  total = 3,
  direction = null,
}) => {
  if (!total || agreeCount !== total) return null;
  const tone = toneForDirection(direction);
  const label = confluenceTooltip({ agreeCount, total });
  return (
    <AppTooltip content={label}>
      <span
        data-testid="algo-confluence-chip"
        title={label}
        aria-label={label}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: sp(2),
          height: dim(16),
          padding: sp("0 5px"),
          borderRadius: dim(RADII.pill),
          border: `1px solid ${cssColorAlpha(tone, "55")}`,
          background: cssColorAlpha(tone, "1A"),
          color: tone,
          fontFamily: T.sans,
          fontSize: textSize("caption"),
          lineHeight: 1,
          whiteSpace: "nowrap",
        }}
      >
        <MiniArrow direction={direction} tone={tone} />
        <span>{agreeCount}/{total}</span>
      </span>
    </AppTooltip>
  );
};

export default ConfluenceChip;
