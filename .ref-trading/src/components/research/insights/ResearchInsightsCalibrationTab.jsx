import React from "react";
import { B, BORDER, CARD, F, FS, G, M, R, SH1, Y } from "./shared.jsx";

function SectionCard({ title, subtitle = null, children }) {
  return (
    <div
      style={{
        border: `1px solid ${BORDER}`,
        borderRadius: 10,
        background: CARD,
        boxShadow: SH1,
        padding: "12px 14px",
        minWidth: 0,
      }}
    >
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 12, color: B, fontFamily: FS, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 700 }}>
          {title}
        </div>
        {subtitle ? <div style={{ marginTop: 4, fontSize: 12, color: M, fontFamily: F, lineHeight: 1.45 }}>{subtitle}</div> : null}
      </div>
      {children}
    </div>
  );
}

function WarningList({ warnings = [] }) {
  if (!warnings.length) {
    return null;
  }
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {warnings.map((warning) => (
        <div
          key={warning}
          style={{
            padding: "8px 10px",
            borderRadius: 8,
            border: `1px solid ${Y}33`,
            background: `${Y}10`,
            color: "#7c2d12",
            fontSize: 12,
            fontFamily: F,
            lineHeight: 1.45,
          }}
        >
          {warning}
        </div>
      ))}
    </div>
  );
}

function formatPercent(value, digits = 1, signed = false) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "--";
  }
  return `${signed && numeric > 0 ? "+" : ""}${numeric.toFixed(digits)}%`;
}

function MiniBars({ rows = [], color = B, max = null, suffix = "%" }) {
  const baseline = max || Math.max(...rows.map((row) => Number(row.value) || 0), 1);
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {rows.map((row) => {
        const width = baseline > 0 && Number.isFinite(Number(row.value)) ? Math.max(0, Math.min((Number(row.value) / baseline) * 100, 100)) : 0;
        return (
          <div key={row.label} style={{ display: "grid", gridTemplateColumns: "34px 1fr 56px", gap: 8, alignItems: "center" }}>
            <div style={{ fontSize: 11, color: M, fontFamily: F }}>{row.label}</div>
            <div style={{ height: 8, borderRadius: 999, background: "#e2e8f0", overflow: "hidden" }}>
              <div style={{ width: `${width}%`, height: "100%", background: color, borderRadius: 999 }} />
            </div>
            <div style={{ fontSize: 11, color: color, fontFamily: F, textAlign: "right", fontWeight: 700 }}>
              {row.value == null ? "--" : `${row.value}${suffix}`}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function ResearchInsightsCalibrationTab({ excursionAnalytics = null }) {
  const calibration = excursionAnalytics?.calibration || {};
  const warnings = excursionAnalytics?.warnings || [];
  const overview = excursionAnalytics?.overview || {};

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <WarningList warnings={warnings.slice(0, 2)} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
        <SectionCard title="Trail Activation" subtitle="Conservative rule: winner MFE p25.">
          <div style={{ fontSize: 34, color: G, fontFamily: F, fontWeight: 800, lineHeight: 1.1 }}>
            {calibration.trailActivationPct == null ? "--" : `+${calibration.trailActivationPct.toFixed(1)}%`}
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: M, fontFamily: F, lineHeight: 1.45 }}>
            Activate the profit lock where one quarter of winners have already reached meaningful favorable excursion.
          </div>
          <div style={{ marginTop: 12 }}>
            <MiniBars rows={(calibration.trailDistribution || []).map((entry) => ({ label: entry.label, value: entry.value }))} color={G} />
          </div>
        </SectionCard>

        <SectionCard title="Max Loss Breaker" subtitle="First MAE bucket with zero recovery to profit.">
          <div style={{ fontSize: 34, color: R, fontFamily: F, fontWeight: 800, lineHeight: 1.1 }}>
            {calibration.maxLossThresholdPct == null ? "--" : `-${Number(calibration.maxLossThresholdPct).toFixed(0)}%`}
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: M, fontFamily: F, lineHeight: 1.45 }}>
            Once trades draw down beyond this zone, the current run shows no recovery back to profit in later outcomes.
          </div>
          <div style={{ marginTop: 12 }}>
            <MiniBars
              rows={(calibration.recoveryByMae || []).slice(0, 8).map((entry) => ({
                label: `${entry.thresholdPct}%`,
                value: entry.recoveryPct == null ? null : entry.recoveryPct.toFixed(0),
              }))}
              color={Y}
            />
          </div>
        </SectionCard>

        <SectionCard title="Time Cliff" subtitle="Conservative rule: winner bars-to-peak p80.">
          <div style={{ fontSize: 34, color: B, fontFamily: F, fontWeight: 800, lineHeight: 1.1 }}>
            {calibration.timeCliffMinutes == null ? "--" : `${Number(calibration.timeCliffMinutes).toFixed(0)}m`}
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: M, fontFamily: F, lineHeight: 1.45 }}>
            {overview.pctWinnerPeakWithin60 == null
              ? "Time-to-peak confidence is limited until more winners accumulate."
              : `${formatPercent(overview.pctWinnerPeakWithin60, 1)} of winners peak within 60 minutes in the current run.`}
          </div>
          <div style={{ marginTop: 12 }}>
            <MiniBars
              rows={(calibration.timePercentiles || []).map((entry) => ({
                label: entry.label,
                value: entry.minutes == null ? null : Number(entry.minutes).toFixed(0),
              }))}
              color={B}
              suffix="m"
            />
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Calibration Notes" subtitle="These thresholds are descriptive diagnostics, not execution rewrites by themselves.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
          {[
            ["Trail Basis", calibration.trailActivationPct == null ? "Waiting for winner sample" : `Winner MFE p25 = +${calibration.trailActivationPct.toFixed(1)}%`, G],
            ["Loss Basis", calibration.maxLossThresholdPct == null ? "No zero-recovery bucket yet" : `First zero-recovery MAE bucket = ${calibration.maxLossThresholdPct}%`, R],
            ["Time Basis", calibration.timeCliffMinutes == null ? "Waiting for winner timing sample" : `Winner bars-to-peak p80 = ${Number(calibration.timeCliffMinutes).toFixed(0)}m`, B],
          ].map(([label, value, color]) => (
            <div key={label} style={{ padding: "10px 12px", borderRadius: 8, background: "#f8fafc", border: `1px solid ${BORDER}` }}>
              <div style={{ fontSize: 10, color: M, fontFamily: F, letterSpacing: "0.08em", textTransform: "uppercase" }}>{label}</div>
              <div style={{ marginTop: 6, fontSize: 13, color, fontFamily: F, fontWeight: 700, lineHeight: 1.45 }}>{value}</div>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
