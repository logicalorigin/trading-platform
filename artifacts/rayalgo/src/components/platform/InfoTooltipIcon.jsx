import { Info } from "lucide-react";
import { AppTooltip } from "@/components/ui/tooltip";
import { T, dim, sp, textSize } from "../../lib/uiTokens.jsx";

const formatTooltipBody = (entry) => {
  if (!entry) return null;
  if (typeof entry === "string") return entry;
  return (
    <div style={{ display: "grid", gap: sp(4), maxWidth: dim(260) }}>
      {entry.label ? (
        <div
          style={{
            color: T.text,
            fontFamily: T.display,
            fontWeight: 700,
            fontSize: textSize("bodyStrong"),
          }}
        >
          {entry.label}
        </div>
      ) : null}
      {entry.definition ? (
        <div style={{ color: T.textSec, fontSize: textSize("caption"), lineHeight: 1.4 }}>
          {entry.definition}
        </div>
      ) : null}
      {entry.interpretation ? (
        <div style={{ color: T.textDim, fontSize: textSize("caption"), lineHeight: 1.4 }}>
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
  const body = formatTooltipBody(entry);
  if (!body) return null;
  return (
    <AppTooltip content={body} side={side} align={align}>
      <button
        type="button"
        aria-label={ariaLabel || (entry?.label ? `${entry.label} info` : "info")}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 2,
          margin: 0,
          border: 0,
          background: "transparent",
          color: T.textDim,
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
