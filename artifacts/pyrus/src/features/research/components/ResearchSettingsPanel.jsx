import { CSS_COLOR, ELEVATION, FONT_WEIGHTS, RADII, T, fs, sp } from "../../../lib/uiTokens.jsx";

export function SettingsPanel({ refreshData, dataStatus, liveData, researchStatus }) {
  return (
    <div style={{ background: CSS_COLOR.bg1, border: `1px solid ${CSS_COLOR.border}`, borderRadius: RADII.md, padding: sp(12), marginBottom: sp(10), animation: "fadeIn 0.2s ease", boxShadow: ELEVATION.sm }}>
      <div style={{ fontSize: fs(11), fontWeight: FONT_WEIGHTS.regular, color: CSS_COLOR.textDim, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: sp(8) }}>Platform Wiring</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: sp(8), alignItems: "center" }}>
        <div>
          <div style={{ fontSize: fs(10), color: CSS_COLOR.textDim, textTransform: "uppercase", letterSpacing: 1 }}>Market data</div>
          <div style={{ fontSize: fs(11), color: dataStatus === "live" ? CSS_COLOR.green : dataStatus === "loading" ? CSS_COLOR.amber : CSS_COLOR.textDim, marginTop: sp(2) }}>
            {dataStatus === "live"
              ? `Connected via platform API for ${Object.keys(liveData).length} tickers`
              : dataStatus === "loading"
                ? "Refreshing platform market data…"
                : "No live quote snapshot loaded"}
          </div>
        </div>
        <button onClick={refreshData} disabled={dataStatus === "loading"} style={{
          background: dataStatus === "loading" ? CSS_COLOR.bg2 : CSS_COLOR.green, border: "none", borderRadius: RADII.sm,
          padding: sp("5px 10px"), fontSize: fs(11), fontWeight: FONT_WEIGHTS.regular, cursor: dataStatus === "loading" ? "default" : "pointer",
          color: dataStatus === "loading" ? CSS_COLOR.textMuted : CSS_COLOR.onAccent,
        }}>{dataStatus === "loading" ? "Fetching..." : "Refresh"}</button>
      </div>
      <div style={{ marginTop: sp(10) }}>
        <div style={{ fontSize: fs(10), color: CSS_COLOR.textDim, textTransform: "uppercase", letterSpacing: 1 }}>Research provider</div>
        <div style={{ fontSize: fs(11), color: researchStatus?.configured ? CSS_COLOR.green : CSS_COLOR.textDim, marginTop: sp(2), lineHeight: 1.5 }}>
          {researchStatus?.configured
            ? `Connected server-side (${String(researchStatus.provider || "research").toUpperCase()}) for fundamentals, calendar, filings, and transcripts`
            : "Offline. Add an FMP secret on the server to enable fundamentals, calendar, filings, and transcript research panels."}
        </div>
      </div>
      {dataStatus === "live" && <div style={{ fontSize: fs(11), color: CSS_COLOR.green, marginTop: sp(3) }}>✓ Live data for {Object.keys(liveData).length} tickers</div>}
    </div>
  );
}

