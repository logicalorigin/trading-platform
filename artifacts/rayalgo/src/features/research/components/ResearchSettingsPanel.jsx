import { FONT_WEIGHTS, RADII, T, fs, sp } from "../../../lib/uiTokens.jsx";

export function SettingsPanel({ refreshData, dataStatus, liveData, researchStatus }) {
  return (
    <div style={{ background: T.bg1, border: `1px solid ${T.border}`, borderRadius: RADII.md, padding: sp(12), marginBottom: sp(10), animation: "fadeIn 0.2s ease", boxShadow: "0 2px 8px rgba(0,0,0,.04)" }}>
      <div style={{ fontSize: fs(11), fontWeight: FONT_WEIGHTS.regular, color: T.textDim, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: sp(8) }}>Platform Wiring</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: sp(8), alignItems: "center" }}>
        <div>
          <div style={{ fontSize: fs(10), color: T.textDim, textTransform: "uppercase", letterSpacing: 1 }}>Market data</div>
          <div style={{ fontSize: fs(11), color: dataStatus === "live" ? T.green : dataStatus === "loading" ? T.amber : T.textDim, marginTop: sp(2) }}>
            {dataStatus === "live"
              ? `Connected via platform API for ${Object.keys(liveData).length} tickers`
              : dataStatus === "loading"
                ? "Refreshing platform market data…"
                : "No live quote snapshot loaded"}
          </div>
        </div>
        <button onClick={refreshData} disabled={dataStatus === "loading"} style={{
          background: dataStatus === "loading" ? T.bg2 : T.green, border: "none", borderRadius: RADII.sm,
          padding: sp("5px 10px"), fontSize: fs(11), fontWeight: FONT_WEIGHTS.regular, cursor: dataStatus === "loading" ? "default" : "pointer",
          color: dataStatus === "loading" ? T.textMuted : T.onAccent,
        }}>{dataStatus === "loading" ? "Fetching..." : "Refresh"}</button>
      </div>
      <div style={{ marginTop: sp(10) }}>
        <div style={{ fontSize: fs(10), color: T.textDim, textTransform: "uppercase", letterSpacing: 1 }}>Research provider</div>
        <div style={{ fontSize: fs(11), color: researchStatus?.configured ? T.green : T.textDim, marginTop: sp(2), lineHeight: 1.5 }}>
          {researchStatus?.configured
            ? `Connected server-side (${String(researchStatus.provider || "research").toUpperCase()}) for fundamentals, calendar, filings, and transcripts`
            : "Offline. Add an FMP secret on the server to enable fundamentals, calendar, filings, and transcript research panels."}
        </div>
      </div>
      {dataStatus === "live" && <div style={{ fontSize: fs(11), color: T.green, marginTop: sp(3) }}>✓ Live data for {Object.keys(liveData).length} tickers</div>}
    </div>
  );
}

