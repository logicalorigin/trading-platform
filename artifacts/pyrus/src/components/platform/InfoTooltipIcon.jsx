import { Info } from "lucide-react";
import { AppTooltip } from "@/components/ui/tooltip";
import { CSS_COLOR, dim, FONT_WEIGHTS, sp, T, textSize } from "../../lib/uiTokens.jsx";
import { useViewport } from "../../lib/responsive";

const formatTooltipBody = (entry) => {
  if (!entry) return null;
  if (typeof entry === "string") return entry;
  return (
    <div style={{ display: "grid", gap: sp(4), maxWidth: dim(260) }}>
      {entry.label ? (
        <div
          style={{
            color: CSS_COLOR.text,
            fontFamily: T.display,
            fontWeight: FONT_WEIGHTS.emphasis,
            fontSize: textSize("bodyStrong"),
          }}
        >
          {entry.label}
        </div>
      ) : null}
      {entry.definition ? (
        <div style={{ color: CSS_COLOR.textSec, fontSize: textSize("caption"), lineHeight: 1.4 }}>
          {entry.definition}
        </div>
      ) : null}
      {entry.interpretation ? (
        <div style={{ color: CSS_COLOR.textDim, fontSize: textSize("caption"), lineHeight: 1.4 }}>
          {entry.interpretation}
        </div>
      ) : null}
    </div>
  );
};

export const InfoTooltipIcon = ({
  entry,
  ariaLabel,
  size = 12,
  side = "top",
  align = "center",
}) => {
  const isPhone = useViewport().flags.isPhone;
  const body = formatTooltipBody(entry);
  if (!body) return null;
  // Hit-slop: grow the tap target (44px on phone, 24px desktop) without
  // enlarging the glyph. Negative margin offsets the extra padding so the
  // surrounding layout footprint stays identical to the original sp(2) box.
  const hitPad = isPhone ? Math.round((44 - size) / 2) : Math.round((24 - size) / 2);
  const hitInset = -(hitPad - sp(2));
  return (
    <AppTooltip content={body} side={side} align={align}>
      <button
        type="button"
        aria-label={ariaLabel || (entry?.label ? `${entry.label} info` : "info")}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: hitPad,
          margin: hitInset,
          border: 0,
          background: "transparent",
          color: CSS_COLOR.textDim,
          cursor: "help",
          lineHeight: 0,
        }}
      >
        <Info size={size} />
      </button>
    </AppTooltip>
  );
};

export default InfoTooltipIcon;
