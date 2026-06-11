import { CSS_COLOR, cssColorMix, dim, FONT_WEIGHTS, RADII, sp, T, textSize } from "../../lib/uiTokens.jsx";
import { motionVars } from "../../lib/motion.jsx";

const HIDE_SCROLLBAR_STYLE = {
  scrollbarWidth: "none",
  msOverflowStyle: "none",
};

export const TabBar = ({
  value,
  onChange,
  tabs,
  dense = false,
  sticky = false,
  dataTestId,
  style,
}) => {
  return (
    <div
      role="tablist"
      data-testid={dataTestId}
      style={{
        display: "flex",
        gap: sp(3),
        overflowX: "auto",
        background: CSS_COLOR.bg0,
        padding: sp("2px 0"),
        position: sticky ? "sticky" : undefined,
        top: sticky ? 0 : undefined,
        zIndex: sticky ? 5 : undefined,
        ...HIDE_SCROLLBAR_STYLE,
        ...style,
      }}
    >
      {tabs.map((tab) => {
        const active = tab.id === value;
        const accent = tab.color || CSS_COLOR.accent;
        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={active}
            data-testid={tab.testId || `tab-${tab.id}`}
            onClick={() => onChange(tab.id)}
            className="ra-interactive ra-touch-target"
            style={{
              ...motionVars({ accent }),
              padding: dense ? sp("8px 14px") : sp("10px 16px"),
              fontSize: textSize("paragraphMuted"),
              fontFamily: T.sans,
              fontWeight: FONT_WEIGHTS.medium,
              letterSpacing: 0,
              border: "none",
              borderRadius: dim(RADII.pill),
              background: active ? cssColorMix(accent, 8) : "transparent",
              color: active ? accent : CSS_COLOR.textSec,
              cursor: "pointer",
              whiteSpace: "nowrap",
              flexShrink: 0,
              display: "inline-flex",
              alignItems: "center",
              gap: sp(6),
              transition:
                "background-color var(--ra-motion-standard) var(--ra-motion-ease), color var(--ra-motion-standard) var(--ra-motion-ease)",
            }}
          >
            <span>{tab.label}</span>
            {tab.badge != null && tab.badge !== "" ? (
              <span
                style={{
                  padding: sp("1px 7px"),
                  fontSize: textSize("caption"),
                  fontFamily: T.sans,
                  fontWeight: FONT_WEIGHTS.medium,
                  background: active ? cssColorMix(accent, 16) : cssColorMix(CSS_COLOR.textMuted, 10),
                  color: active ? accent : CSS_COLOR.textSec,
                  borderRadius: dim(RADII.pill),
                  minWidth: dim(18),
                  textAlign: "center",
                }}
              >
                {tab.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
};
