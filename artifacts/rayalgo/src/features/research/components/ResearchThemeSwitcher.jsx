import { AppTooltip } from "@/components/ui/tooltip";
import { FONT_WEIGHTS, RADII, T, fs, sp } from "../../../lib/uiTokens.jsx";

export function ThemeSwitcher({ themeId, setThemeId, themes, themeOrder }) {
  return (
    <div style={{ position: "relative", marginBottom: sp(14), paddingBottom: sp(10), borderBottom: `1px solid ${T.border}` }}>
      <div style={{ fontSize: fs(9), color: T.textMuted, letterSpacing: 2, textTransform: "uppercase", fontWeight: FONT_WEIGHTS.regular, marginBottom: sp(6) }}>
        Investment Thesis
      </div>
      <div style={{ display: "flex", gap: sp(4), flexWrap: "wrap" }}>
        {themeOrder.map(tid => {
          const t = themes[tid];
          const active = tid === themeId;
          const unavailable = !t.available;
          return (
            <AppTooltip key={tid} content={unavailable ? "Coming soon" : t.subtitle}><button key={tid}
              onClick={() => { if (t.available) setThemeId(tid); }}
              disabled={unavailable}
              style={{
                display: "inline-flex", alignItems: "center", gap: sp(5),
                background: active ? T.bg1 : unavailable ? T.bg2 : t.meta ? T.greenBg : "transparent",
                border: active ? `1px solid ${t.accent}66` : t.meta ? `1px dashed ${T.border}` : "1px solid transparent",
                borderRadius: RADII.sm, padding: sp("4px 10px"),
                fontSize: fs(11), color: active ? t.accent : unavailable ? T.textMuted : T.textSec,
                cursor: unavailable ? "not-allowed" : "pointer", fontWeight: FONT_WEIGHTS.regular,
                boxShadow: active ? `0 1px 4px ${t.accent}22` : "none",
                transition: "all 0.12s ease", letterSpacing: 0.2,
                opacity: unavailable ? 0.6 : 1,
              }}>
              <span style={{ fontSize: fs(11), color: active ? t.accent : unavailable ? T.textMuted : T.textDim }}>{t.icon}</span>
              <span>{t.title.replace(/^The /, "")}</span>
              {unavailable && <span style={{ fontSize: fs(8), color: T.textMuted, fontWeight: FONT_WEIGHTS.regular, marginLeft: sp(2) }}>soon</span>}
            </button></AppTooltip>
          );
        })}
      </div>
    </div>
  );
}
