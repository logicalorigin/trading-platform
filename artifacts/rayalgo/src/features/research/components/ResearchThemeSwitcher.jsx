import { AppTooltip } from "@/components/ui/tooltip";
export function ThemeSwitcher({ themeId, setThemeId, themes, themeOrder }) {
  return (
    <div style={{ position: "relative", marginBottom: 14, paddingBottom: 10, borderBottom: "1px solid rgba(0,0,0,.05)" }}>
      <div style={{ fontSize: 9, color: "#bbb", letterSpacing: 2, textTransform: "uppercase", fontWeight: 600, marginBottom: 6 }}>
        Investment Thesis
      </div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {themeOrder.map(tid => {
          const t = themes[tid];
          const active = tid === themeId;
          const unavailable = !t.available;
          return (
            <AppTooltip key={tid} content={unavailable ? "Coming soon" : t.subtitle}><button key={tid}
              onClick={() => { if (t.available) setThemeId(tid); }}
              disabled={unavailable}
              style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                background: active ? "#fff" : unavailable ? "rgba(0,0,0,.015)" : t.meta ? "rgba(85,107,47,.04)" : "transparent",
                border: active ? `1px solid ${t.accent}66` : t.meta ? "1px dashed rgba(0,0,0,.08)" : "1px solid transparent",
                borderRadius: 7, padding: "4px 10px",
                fontSize: 11, color: active ? t.accent : unavailable ? "#ccc" : "#666",
                cursor: unavailable ? "not-allowed" : "pointer", fontWeight: active ? 700 : 500,
                boxShadow: active ? `0 1px 4px ${t.accent}22` : "none",
                transition: "all 0.12s ease", letterSpacing: 0.2,
                opacity: unavailable ? 0.6 : 1,
              }}>
              <span style={{ fontSize: 11, color: active ? t.accent : unavailable ? "#ddd" : "#aaa" }}>{t.icon}</span>
              <span>{t.title.replace(/^The /, "")}</span>
              {unavailable && <span style={{ fontSize: 8, color: "#bbb", fontWeight: 600, marginLeft: 2 }}>soon</span>}
            </button></AppTooltip>
          );
        })}
      </div>
    </div>
  );
}
