import React from "react";
import { B, F, G, R } from "./shared.jsx";

export default function ResearchInsightsOptimizeTab({
  optResults,
  onRunOptimize,
  optRunning,
  errorMessage = null,
  strategyLabel,
  onApplyOpt,
  onSaveOptBundle,
  activeOptimizerJob = null,
}) {
  const [notice, setNotice] = React.useState(null);

  if (!optResults) {
    return (
      <div style={{ textAlign: "center", padding: 20 }}>
        {activeOptimizerJob?.jobId ? (
          <div style={{ fontSize: 13, color: B, fontFamily: F, marginBottom: 10, fontWeight: 700 }}>
            {activeOptimizerJob.status === "queued" ? "Optimizer queued server-side." : activeOptimizerJob.progress?.detail || "Optimizer running server-side."}
          </div>
        ) : null}
        {errorMessage ? (
          <div style={{ fontSize: 13, color: "#b91c1c", fontFamily: F, marginBottom: 10 }}>
            {errorMessage}
          </div>
        ) : null}
        <button
          onClick={onRunOptimize}
          disabled={optRunning}
          style={{
            padding: "8px 20px",
            fontSize: 15,
            fontFamily: F,
            background: optRunning ? "#c7d2fe" : B,
            color: "#fff",
            border: "none",
            borderRadius: 6,
            cursor: optRunning ? "wait" : "pointer",
            fontWeight: 600,
          }}
        >
          {optRunning ? "Running real-data shortlist..." : "Run Real-Data Shortlist"}
        </button>
        <div style={{ fontSize: 13, color: "#9ca3af", fontFamily: F, marginTop: 6 }}>
          Runs the current strategy across nearby DTEs and all exit presets on Massive-backed option history.
        </div>
      </div>
    );
  }

  return (
    <div>
      {notice ? (
        <div style={{ fontSize: 12, color: B, fontFamily: F, marginBottom: 6, fontWeight: 700 }}>
          {notice}
        </div>
      ) : null}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span
          style={{
            fontSize: 13,
            color: B,
            fontFamily: F,
            fontWeight: 700,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          Top {optResults.length} Real-Data Configs
        </span>
        <button
          onClick={onRunOptimize}
          disabled={optRunning}
          style={{
            fontSize: 12,
            fontFamily: F,
            background: `${B}10`,
            border: `1px solid ${B}40`,
            borderRadius: 3,
            padding: "2px 6px",
            color: B,
            cursor: optRunning ? "wait" : "pointer",
            opacity: optRunning ? 0.7 : 1,
          }}
        >
          {optRunning ? "Running..." : "Re-run"}
        </button>
      </div>
      {errorMessage ? (
        <div style={{ fontSize: 12, color: "#b91c1c", fontFamily: F, marginBottom: 6 }}>
          {errorMessage}
        </div>
      ) : null}
      <div style={{ fontSize: 11, color: "#64748b", fontFamily: F, marginBottom: 6 }}>
        Shortlist batches are archived into History automatically after each run.
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: F, fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: `2px solid ${B}30` }}>
            {["#", "Strategy", "DTE", "Exit", "Filter", "N", "E[$/t]", "ROI", "WR", "PF", "Sharpe", "DD", "Score", "", ""].map(
              (header) => (
                <th
                  key={header}
                  style={{
                    padding: "3px 4px",
                    textAlign: "left",
                    color: B,
                    fontWeight: 600,
                    fontSize: 11,
                    textTransform: "uppercase",
                  }}
                >
                  {header}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {optResults.slice(0, 25).map((result, index) => (
            <tr
              key={index}
              style={{
                borderBottom: "1px solid #f3f4f6",
                background: index === 0 ? `${G}06` : index < 3 ? `${B}04` : "transparent",
              }}
            >
              <td style={{ padding: "3px 4px", color: index < 3 ? B : "#9ca3af", fontWeight: index < 3 ? 700 : 400 }}>
                {index + 1}
              </td>
              <td style={{ padding: "3px 4px", color: "#1f2937" }}>{strategyLabel(result.strategy)}</td>
              <td style={{ padding: "3px 4px", color: "#1f2937" }}>{result.dte}d</td>
              <td style={{ padding: "3px 4px", color: "#1f2937" }}>{result.exit}</td>
              <td style={{ padding: "3px 4px", color: "#9ca3af", fontSize: 11 }}>
                {result.regime === "not_bear" ? "!bear" : "all"}
              </td>
              <td style={{ padding: "3px 4px", color: "#6b7280" }}>{result.n}</td>
              <td style={{ padding: "3px 4px", color: result.exp >= 0 ? G : R, fontWeight: 600 }}>
                {result.exp >= 0 ? "+" : ""}
                {result.exp}
              </td>
              <td style={{ padding: "3px 4px", color: result.roi >= 0 ? G : R, fontSize: 11 }}>
                {result.roi >= 0 ? "+" : ""}
                {result.roi}%
              </td>
              <td style={{ padding: "3px 4px", color: result.wr >= 50 ? G : R }}>{result.wr}%</td>
              <td style={{ padding: "3px 4px", color: parseFloat(result.pf) > 1 ? G : R }}>{result.pf}</td>
              <td style={{ padding: "3px 4px", color: result.sharpe > 0 ? B : R }}>{result.sharpe}</td>
              <td style={{ padding: "3px 4px", color: R }}>{result.dd}%</td>
              <td style={{ padding: "3px 4px", color: B, fontWeight: 700 }}>{result.score}</td>
              <td style={{ padding: "3px 4px" }}>
                <button
                  onClick={() => onApplyOpt(result)}
                  style={{
                    fontSize: 11,
                    fontFamily: F,
                    background: `${G}10`,
                    border: `1px solid ${G}40`,
                    borderRadius: 3,
                    padding: "1px 5px",
                    color: G,
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  Apply
                </button>
              </td>
              <td style={{ padding: "3px 4px" }}>
                {String(result.strategy || "").trim().toLowerCase() === "rayalgo" ? (
                  <button
                    onClick={() => {
                      const response = onSaveOptBundle?.(result);
                      setNotice(response?.ok ? `Saved ${response.bundle?.label || "optimizer bundle"}.` : (response?.reason || "Save blocked."));
                    }}
                    style={{
                      fontSize: 11,
                      fontFamily: F,
                      background: `${B}10`,
                      border: `1px solid ${B}40`,
                      borderRadius: 3,
                      padding: "1px 5px",
                      color: B,
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                  >
                    Save Bundle
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
