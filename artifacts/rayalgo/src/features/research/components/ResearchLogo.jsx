import { BRAND } from "../data/researchSymbols";

export function Logo({ ticker, size = 16, style = {} }) {
  const b = BRAND[ticker] || ["#888", ticker?.slice(0,2) || "?"];
  const fs = size <= 12 ? 6 : size <= 16 ? 7 : size <= 20 ? 8 : size <= 24 ? 10 : 11;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: size, height: size, borderRadius: size > 20 ? "50%" : 3, flexShrink: 0,
      background: b[0], color: "#fff", fontSize: fs, fontWeight: 700, lineHeight: 1, verticalAlign: "middle",
      ...style,
    }}>{b[1]}</span>
  );
}

/* ════════════════════════ LIVE DATA FETCHER ════════════════════════ */
