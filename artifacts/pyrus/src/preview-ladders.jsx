// DEV-ONLY design prototype. Explores applying the option-ladder's spatial,
// live-marker concept to the flat form sections (Gates, Risk, Signal), plus the
// collapsed -> expanded density model: a closed section keeps the at-a-glance
// signal (blocking / peak usage) in one line, then expands to the full ladder.
// Throwaway: delete with preview-ladders.html.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import {
  CSS_COLOR,
  cssColorMix,
  dim,
  FONT_WEIGHTS,
  RADII,
  sp,
  T,
  textSize,
} from "./lib/uiTokens.jsx";

const int = (v) => `${Math.round(v)}`;
const money0 = (v) => `$${Math.round(v).toLocaleString()}`;
const money2 = (v) => `$${Number(v).toFixed(2)}`;
const pctFmt = (v) => `${v}%`;
const bars = (v) => `${Math.round(v)} bars`;
const atr = (v) => `${Number(v).toFixed(2)}× ATR`;
const avg = (v) => `${Number(v).toFixed(2)}× avg`;
const TIMEFRAMES = ["1m", "2m", "5m", "15m", "1h", "1d"];

// ---- shared status (used by both the expanded rows and collapsed summaries) --
const gateStatus = (g) => {
  const pass = g.mode === "gateMin" ? g.live >= g.line : g.live <= g.line;
  return { pass, color: pass ? CSS_COLOR.green : CSS_COLOR.red };
};
const capStatus = (c) => {
  const usage = c.live / c.max;
  const color =
    usage >= 0.88 ? CSS_COLOR.red : usage >= 0.6 ? CSS_COLOR.amber : CSS_COLOR.green;
  return { usage, color };
};

const GATES = [
  { label: "MTF frames aligned", min: 0, max: 6, line: 2, live: 4, mode: "gateMin", fmt: int },
  { label: "Min ADX (bear regime)", min: 0, max: 60, line: 25, live: 18, mode: "gateMin", fmt: int },
  { label: "Max spread", min: 0, max: 20, line: 8, live: 12, mode: "gateMax", fmt: pctFmt },
  { label: "Min bid", min: 0, max: 3, line: 0.1, live: 0.45, mode: "gateMin", fmt: money2 },
];
const RISK = [
  { label: "Premium / entry", max: 1500, live: 900, fmt: money0 },
  { label: "Open contracts", max: 5, live: 2, fmt: int },
  { label: "Open symbols", max: 8, live: 3, fmt: int },
  { label: "Daily loss → halt", max: 1000, live: 420, fmt: money0 },
];

const RowLabel = ({ left, right }) => (
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: sp(2) }}>
    <span style={{ fontFamily: T.sans, fontSize: textSize("caption"), color: CSS_COLOR.textSec, fontWeight: FONT_WEIGHTS.label }}>
      {left}
    </span>
    <span style={{ fontFamily: T.data, fontSize: textSize("caption"), color: CSS_COLOR.text }}>{right}</span>
  </div>
);

const AxisTags = ({ left, right, mid }) => (
  <div style={{ display: "flex", justifyContent: "space-between", fontFamily: T.sans, fontSize: textSize("micro"), color: CSS_COLOR.textDim }}>
    <span>{left}</span>
    {mid ? <span>{mid}</span> : null}
    <span>{right}</span>
  </div>
);

// One ladder row: zoned axis with the configured line (threshold/cap) and a live
// marker. mode: "gateMin" | "gateMax" | "cap".
function LadderRow({ label, min = 0, max, line, live, mode, fmt = int }) {
  const span = Math.max(1e-9, max - min);
  const at = (v) => Math.min(100, Math.max(0, ((v - min) / span) * 100));
  const linePct = mode === "cap" ? 100 : at(line);
  const livePct = at(live);
  const status = mode === "cap" ? null : gateStatus({ mode, live, line });
  const usage = mode === "cap" ? capStatus({ live, max }).usage : null;
  const liveColor = mode === "cap" ? capStatus({ live, max }).color : status.color;

  let zones;
  if (mode === "gateMin") {
    zones = [
      { l: 0, w: linePct, c: cssColorMix(CSS_COLOR.red, 20) },
      { l: linePct, w: 100 - linePct, c: cssColorMix(CSS_COLOR.green, 12) },
    ];
  } else if (mode === "gateMax") {
    zones = [
      { l: 0, w: linePct, c: cssColorMix(CSS_COLOR.green, 12) },
      { l: linePct, w: 100 - linePct, c: cssColorMix(CSS_COLOR.red, 20) },
    ];
  } else {
    zones = [
      { l: 0, w: 60, c: cssColorMix(CSS_COLOR.green, 12) },
      { l: 60, w: 28, c: cssColorMix(CSS_COLOR.amber, 16) },
      { l: 88, w: 12, c: cssColorMix(CSS_COLOR.red, 22) },
    ];
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: dim(5), padding: sp("5px 0") }}>
      <RowLabel
        left={label}
        right={
          <>
            {mode === "cap" ? <span style={{ color: CSS_COLOR.textMuted }}>cap </span> : null}
            {fmt(mode === "cap" ? max : line)}
          </>
        }
      />
      <div style={{ position: "relative", height: dim(12) }}>
        <div style={{ position: "absolute", inset: 0, borderRadius: dim(RADII.pill), overflow: "hidden", background: CSS_COLOR.bg0 }}>
          {zones.map((z, i) => (
            <div key={i} style={{ position: "absolute", top: 0, bottom: 0, left: `${z.l}%`, width: `${z.w}%`, background: z.c }} />
          ))}
        </div>
        {mode !== "cap" ? (
          <div style={{ position: "absolute", left: `${linePct}%`, top: dim(-3), bottom: dim(-3), width: dim(2), transform: "translateX(-1px)", background: CSS_COLOR.text, borderRadius: dim(RADII.xs) }} />
        ) : null}
        <div
          style={{
            position: "absolute",
            left: `${livePct}%`,
            top: "50%",
            width: dim(10),
            height: dim(10),
            transform: "translate(-50%, -50%)",
            borderRadius: dim(RADII.pill),
            background: liveColor,
            border: `2px solid ${CSS_COLOR.bg1}`,
          }}
        />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: sp(2) }}>
        <span style={{ width: dim(6), height: dim(6), borderRadius: dim(RADII.pill), background: liveColor, flex: "0 0 auto" }} />
        <span style={{ fontFamily: T.sans, fontSize: textSize("micro"), color: CSS_COLOR.textMuted }}>
          now {fmt(live)}
          {" · "}
          <span style={{ color: liveColor, fontWeight: FONT_WEIGHTS.label }}>
            {mode === "cap" ? `${Math.round(usage * 100)}% of cap` : status.pass ? "passing" : "blocking"}
          </span>
        </span>
      </div>
    </div>
  );
}

function TimeframeSpine({ active, mtf = [] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: dim(5), padding: sp("5px 0") }}>
      <RowLabel left="Signal timeframe" right={active} />
      <div style={{ display: "flex", gap: dim(3) }}>
        {TIMEFRAMES.map((tf) => {
          const on = tf === active;
          return (
            <div key={tf} style={{ flex: "1 1 0", display: "flex", flexDirection: "column", alignItems: "center", gap: dim(3) }}>
              <div
                style={{
                  width: "100%",
                  textAlign: "center",
                  padding: sp("4px 0"),
                  borderRadius: dim(RADII.xs),
                  border: `1px solid ${on ? CSS_COLOR.accent : CSS_COLOR.borderLight}`,
                  background: on ? cssColorMix(CSS_COLOR.accent, 18) : CSS_COLOR.bg0,
                  color: on ? CSS_COLOR.text : CSS_COLOR.textMuted,
                  fontFamily: T.data,
                  fontSize: textSize("micro"),
                  fontWeight: on ? FONT_WEIGHTS.label : FONT_WEIGHTS.regular,
                  boxShadow: on ? `inset 0 -2px 0 ${CSS_COLOR.accent}` : "none",
                }}
              >
                {tf}
              </div>
              <span style={{ width: dim(4), height: dim(4), borderRadius: dim(RADII.pill), background: mtf.includes(tf) ? CSS_COLOR.accent : "transparent" }} />
            </div>
          );
        })}
      </div>
      <AxisTags left="faster" right="slower" mid="● MTF align frame" />
    </div>
  );
}

function MiniScale({ label, value, min, max, fmt, baseline, band, leftTag, rightTag }) {
  const span = Math.max(1e-9, max - min);
  const at = (v) => Math.min(100, Math.max(0, ((v - min) / span) * 100));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: dim(5), padding: sp("5px 0") }}>
      <RowLabel left={label} right={fmt(value)} />
      <div style={{ position: "relative", height: dim(12) }}>
        <div style={{ position: "absolute", inset: 0, borderRadius: dim(RADII.pill), overflow: "hidden", background: CSS_COLOR.bg0 }}>
          {band ? (
            <div style={{ position: "absolute", top: 0, bottom: 0, left: `${at(band[0])}%`, width: `${at(band[1]) - at(band[0])}%`, background: cssColorMix(CSS_COLOR.accent, 12) }} />
          ) : null}
        </div>
        {baseline != null ? (
          <div style={{ position: "absolute", left: `${at(baseline)}%`, top: dim(-2), bottom: dim(-2), width: dim(1), transform: "translateX(-0.5px)", background: CSS_COLOR.textDim }} />
        ) : null}
        <div style={{ position: "absolute", left: `${at(value)}%`, top: "50%", width: dim(10), height: dim(10), transform: "translate(-50%, -50%)", borderRadius: dim(RADII.pill), background: CSS_COLOR.accent, border: `2px solid ${CSS_COLOR.bg1}` }} />
      </div>
      <AxisTags left={leftTag} right={rightTag} mid={baseline != null ? `default ${fmt(baseline)}` : band ? "typical" : null} />
    </div>
  );
}

function Segmented({ label, options, value, leftTag, rightTag }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: dim(5), padding: sp("5px 0") }}>
      <RowLabel left={label} right={value} />
      <div style={{ display: "flex", gap: dim(3) }}>
        {options.map((opt) => {
          const on = opt === value;
          return (
            <div
              key={opt}
              style={{
                flex: "1 1 0",
                textAlign: "center",
                padding: sp("4px 0"),
                borderRadius: dim(RADII.xs),
                border: `1px solid ${on ? CSS_COLOR.accent : CSS_COLOR.borderLight}`,
                background: on ? cssColorMix(CSS_COLOR.accent, 16) : CSS_COLOR.bg0,
                color: on ? CSS_COLOR.text : CSS_COLOR.textMuted,
                fontFamily: T.sans,
                fontSize: textSize("micro"),
                fontWeight: on ? FONT_WEIGHTS.label : FONT_WEIGHTS.regular,
                textTransform: "capitalize",
              }}
            >
              {opt}
            </div>
          );
        })}
      </div>
      <AxisTags left={leftTag} right={rightTag} />
    </div>
  );
}

// ---- collapsed-state summaries: same dots/zones, compressed to one line -------
const Dots = ({ colors }) => (
  <span style={{ display: "inline-flex", gap: dim(3), alignItems: "center" }}>
    {colors.map((c, i) => (
      <span key={i} style={{ width: dim(6), height: dim(6), borderRadius: dim(RADII.pill), background: c }} />
    ))}
  </span>
);

function GatesSummary() {
  const st = GATES.map(gateStatus);
  const blocking = st.filter((s) => !s.pass).length;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: sp(2) }}>
      <Dots colors={st.map((s) => s.color)} />
      <span style={{ fontFamily: T.sans, fontSize: textSize("micro"), fontWeight: FONT_WEIGHTS.label, color: blocking ? CSS_COLOR.red : CSS_COLOR.green }}>
        {blocking ? `${blocking} blocking` : "all pass"}
      </span>
    </span>
  );
}

function RiskSummary() {
  const st = RISK.map(capStatus);
  const peak = st.reduce((a, s) => (s.usage > a.usage ? s : a));
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: sp(2) }}>
      <Dots colors={st.map((s) => s.color)} />
      <span style={{ fontFamily: T.sans, fontSize: textSize("micro"), fontWeight: FONT_WEIGHTS.label, color: peak.color }}>
        {Math.round(peak.usage * 100)}% peak
      </span>
    </span>
  );
}

const SignalSummary = () => (
  <span style={{ fontFamily: T.data, fontSize: textSize("micro"), color: CSS_COLOR.textSec }}>5m · 8 bars · wicks</span>
);

const Chevron = ({ open }) => (
  <span style={{ display: "inline-block", width: dim(10), transform: open ? "rotate(90deg)" : "none", transition: "transform 120ms ease", color: CSS_COLOR.textMuted, fontSize: textSize("caption"), lineHeight: 1 }}>
    ›
  </span>
);

function Section({ title, summary, defaultOpen, children }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <section style={{ display: "flex", flexDirection: "column", borderTop: `1px solid ${CSS_COLOR.borderLight}`, paddingTop: dim(8) }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{ all: "unset", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", gap: sp(3), padding: sp("1px 0") }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: sp(2) }}>
          <Chevron open={open} />
          <span style={{ fontFamily: T.sans, fontSize: textSize("micro"), letterSpacing: 0.4, textTransform: "uppercase", color: CSS_COLOR.accent, fontWeight: FONT_WEIGHTS.label }}>
            {title}
          </span>
        </span>
        {!open ? summary : null}
      </button>
      {open ? <div style={{ display: "flex", flexDirection: "column", paddingTop: dim(4) }}>{children}</div> : null}
    </section>
  );
}

const PANEL_STYLE = {
  width: 360,
  display: "flex",
  flexDirection: "column",
  gap: dim(6),
  border: `1px solid ${CSS_COLOR.border}`,
  borderRadius: RADII.md,
  background: CSS_COLOR.bg1,
  padding: sp("12px"),
  boxSizing: "border-box",
};

const Tag = ({ children }) => (
  <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, color: CSS_COLOR.textMuted, paddingBottom: dim(2) }}>{children}</div>
);

function Proto() {
  return (
    <div style={{ background: CSS_COLOR.bg0, minHeight: "100vh", padding: 20, display: "flex", gap: 24, alignItems: "flex-start" }}>
      <div style={PANEL_STYLE}>
        <Tag>resting rail · click headers to expand · 360px</Tag>
        <Section title="Signal" summary={<SignalSummary />} defaultOpen={false}>
          <TimeframeSpine active="5m" mtf={["1m", "2m", "5m", "15m"]} />
          <MiniScale label="Time horizon" value={8} min={2} max={50} fmt={bars} band={[5, 13]} leftTag="short" rightTag="long" />
          <Segmented label="BOS confirmation" options={["close", "wicks"]} value="wicks" leftTag="stricter" rightTag="faster" />
          <MiniScale label="CHOCH ATR buffer" value={0.5} min={0} max={4} fmt={atr} baseline={0} leftTag="loose" rightTag="strict" />
          <MiniScale label="CHOCH body ATR" value={0.8} min={0} max={4} fmt={atr} baseline={0} leftTag="loose" rightTag="strict" />
          <MiniScale label="CHOCH volume" value={1.2} min={0} max={4} fmt={avg} baseline={0} leftTag="loose" rightTag="strict" />
        </Section>
        <Section title="Gates" summary={<GatesSummary />} defaultOpen>
          {GATES.map((g, i) => (
            <LadderRow key={i} {...g} />
          ))}
        </Section>
        <Section title="Risk" summary={<RiskSummary />} defaultOpen={false}>
          {RISK.map((c, i) => (
            <LadderRow key={i} {...c} mode="cap" />
          ))}
        </Section>
      </div>
    </div>
  );
}

createRoot(document.getElementById("proto-root")).render(<Proto />);
