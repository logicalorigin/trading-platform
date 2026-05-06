export function SettingsPanel({ refreshData, dataStatus, liveData, researchStatus }) {
  return (
    <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,.06)", borderRadius: 10, padding: 12, marginBottom: 10, animation: "fadeIn 0.2s ease", boxShadow: "0 2px 8px rgba(0,0,0,.04)" }}>
      <div style={{ fontSize: 11, fontWeight: 400, color: "#999", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 8 }}>Platform Wiring</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 10, color: "#999", textTransform: "uppercase", letterSpacing: 1 }}>Market data</div>
          <div style={{ fontSize: 11, color: dataStatus === "live" ? "#1a8a5c" : dataStatus === "loading" ? "#b8860b" : "#888", marginTop: 2 }}>
            {dataStatus === "live"
              ? `Connected via platform API for ${Object.keys(liveData).length} tickers`
              : dataStatus === "loading"
                ? "Refreshing platform market data…"
                : "No live quote snapshot loaded"}
          </div>
        </div>
        <button onClick={refreshData} disabled={dataStatus === "loading"} style={{
          background: dataStatus === "loading" ? "rgba(0,0,0,.04)" : "#1a8a5c", border: "none", borderRadius: 5,
          padding: "5px 10px", fontSize: 11, fontWeight: 400, cursor: dataStatus === "loading" ? "default" : "pointer",
          color: dataStatus === "loading" ? "#aaa" : "#fff",
        }}>{dataStatus === "loading" ? "Fetching..." : "Refresh"}</button>
      </div>
      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 10, color: "#999", textTransform: "uppercase", letterSpacing: 1 }}>Research provider</div>
        <div style={{ fontSize: 11, color: researchStatus?.configured ? "#1a8a5c" : "#888", marginTop: 2, lineHeight: 1.5 }}>
          {researchStatus?.configured
            ? `Connected server-side (${String(researchStatus.provider || "research").toUpperCase()}) for fundamentals, calendar, filings, and transcripts`
            : "Offline. Add an FMP secret on the server to enable fundamentals, calendar, filings, and transcript research panels."}
        </div>
      </div>
      {dataStatus === "live" && <div style={{ fontSize: 11, color: "#1a8a5c", marginTop: 3 }}>✓ Live data for {Object.keys(liveData).length} tickers</div>}
    </div>
  );
}

