import {
  AppTooltip,
} from "@/components/ui/tooltip";
import { CSS_COLOR, ELEVATION, FONT_WEIGHTS, RADII, cssColorAlpha, fs, sp, textSize } from "../../../lib/uiTokens.jsx";

export function ThemeSwitcher({ themeId, setThemeId, themes, themeOrder }) {
  return (
    <div style={{ position: "relative", marginBottom: sp(14), paddingBottom: sp(10), borderBottom: `1px solid ${CSS_COLOR.border}` }}>
      <div style={{ fontSize: textSize("caption"), color: CSS_COLOR.textMuted, letterSpacing: 2, textTransform: "uppercase", fontWeight: FONT_WEIGHTS.regular, marginBottom: sp(6) }}>
        Investment Thesis
      </div>
      <div style={{ display: "flex", gap: sp(4), flexWrap: "wrap" }}>
        {themeOrder.map(tid => {
          const t = themes[tid];
          const active = tid === themeId;
          const unavailable = !t.available;
          return (
            <AppTooltip key={tid} content={unavailable ? "Coming soon" : t.subtitle}><button key={tid}
              type="button"
              className="ra-touch-target-y"
              aria-pressed={active}
              onClick={() => { if (t.available) setThemeId(tid); }}
              disabled={unavailable}
              style={{
                display: "inline-flex", alignItems: "center", gap: sp(5),
                background: active ? CSS_COLOR.bg1 : unavailable ? CSS_COLOR.bg2 : t.meta ? cssColorAlpha(CSS_COLOR.accent, "14") : "transparent",
                border: active ? `1px solid ${cssColorAlpha(t.accent, "66")}` : t.meta ? `1px dashed ${CSS_COLOR.border}` : "1px solid transparent",
                borderRadius: RADII.sm, padding: sp("4px 10px"),
                fontSize: fs(11), color: active ? t.accent : unavailable ? CSS_COLOR.textMuted : CSS_COLOR.textSec,
                cursor: unavailable ? "not-allowed" : "pointer", fontWeight: FONT_WEIGHTS.regular,
                boxShadow: active ? ELEVATION.sm : "none",
                transition: "background-color var(--ra-motion-fast) ease, border-color var(--ra-motion-fast) ease, color var(--ra-motion-fast) ease, box-shadow var(--ra-motion-fast) ease, transform var(--ra-motion-fast) ease", letterSpacing: 0.2,
                opacity: unavailable ? 0.6 : 1,
              }}>
              <span>{t.title.replace(/^The /, "")}</span>
              {unavailable && <span style={{ fontSize: fs(8), color: CSS_COLOR.textMuted, fontWeight: FONT_WEIGHTS.regular, marginLeft: sp(2) }}>soon</span>}
            </button></AppTooltip>
          );
        })}
      </div>
    </div>
  );
}
