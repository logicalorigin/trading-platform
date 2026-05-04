import { useEffect, useMemo, useState } from "react";
import { fetchEarningsCalendar } from "../lib/researchApi";
import { Logo } from "./ResearchLogo";
import { AppTooltip } from "@/components/ui/tooltip";


export function CalendarView({ cos, liveData, apiKey, onSelect, themes, vx }) {
  const [entries, setEntries] = useState(null); // null = loading, [] = no data, [...] = loaded
  const [rangeFilter, setRangeFilter] = useState("30d"); // "7d" | "30d" | "90d"
  const [themeFilter, setThemeFilter] = useState(null);  // null | theme id

  // Compute from/to in ISO date format
  const today = new Date();
  const pad = n => String(n).padStart(2, "0");
  const isoDate = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const fromDate = isoDate(today);
  const toDate90 = new Date(today); toDate90.setDate(toDate90.getDate() + 90);
  const toDate = isoDate(toDate90);

  useEffect(() => {
    if (!apiKey) { setEntries([]); return; }
    setEntries(null);
    fetchEarningsCalendar(fromDate, toDate).then(data => {
      if (!data) { setEntries([]); return; }
      // Build a set of internal tickers we track — include both native + FMP-mapped symbols
      const universeSet = new Set(cos.map(c => c.t));
      // Filter: only keep entries whose internalTicker is in our universe
      const filtered = data.filter(e => universeSet.has(e.internalTicker));
      setEntries(filtered);
    });
  }, [apiKey, cos, fromDate, toDate]);

  // Apply range filter
  const rangeDays = rangeFilter === "7d" ? 7 : rangeFilter === "30d" ? 30 : 90;
  const rangeCutoff = new Date(today); rangeCutoff.setDate(rangeCutoff.getDate() + rangeDays);
  const rangeCutoffISO = isoDate(rangeCutoff);

  const visible = useMemo(() => {
    if (!entries) return [];
    let rows = entries.filter(e => e.date <= rangeCutoffISO);
    // Apply theme filter
    if (themeFilter) {
      rows = rows.filter(e => {
        const co = cos.find(c => c.t === e.internalTicker);
        return co && co.themes && co.themes.includes(themeFilter);
      });
    }
    // Sort by date asc, then by time of day (bmo before amc)
    rows.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      const aTime = a.time === "bmo" ? 0 : a.time === "amc" ? 2 : 1;
      const bTime = b.time === "bmo" ? 0 : b.time === "amc" ? 2 : 1;
      return aTime - bTime;
    });
    return rows;
  }, [entries, rangeCutoffISO, themeFilter, cos]);

  // Group by date
  const grouped = useMemo(() => {
    const out = [];
    let currentDate = null;
    let currentGroup = null;
    visible.forEach(e => {
      if (e.date !== currentDate) {
        currentGroup = { date: e.date, rows: [] };
        out.push(currentGroup);
        currentDate = e.date;
      }
      currentGroup.rows.push(e);
    });
    return out;
  }, [visible]);

  const fmtDateHeader = iso => {
    const d = new Date(iso + "T12:00:00");
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const dayDiff = Math.round((d - today) / (1000 * 60 * 60 * 24));
    const relLabel = dayDiff === 0 ? "Today" : dayDiff === 1 ? "Tomorrow" : dayDiff < 7 ? "In " + dayDiff + " days" : null;
    return {
      primary: days[d.getDay()] + ", " + months[d.getMonth()] + " " + d.getDate(),
      rel: relLabel,
    };
  };

  const timeBadge = t => {
    if (t === "bmo") return { label: "BMO", bg: "rgba(91,140,42,.15)", fg: "#5b8c2a", title: "Before market open" };
    if (t === "amc") return { label: "AMC", bg: "rgba(142,68,173,.15)", fg: "#8e44ad", title: "After market close" };
    if (t === "dmh") return { label: "DMH", bg: "rgba(205,162,78,.15)", fg: "#b8860b", title: "During market hours" };
    return { label: "—", bg: "rgba(0,0,0,.04)", fg: "#999", title: "Time not specified" };
  };

  const fmtEPS = n => (n == null || isNaN(n)) ? "—" : (n >= 0 ? "$" : "–$") + Math.abs(n).toFixed(2);
  const fmtRev = n => {
    if (n == null) return "—";
    const abs = Math.abs(n);
    if (abs >= 1e9) return "$" + (n / 1e9).toFixed(1) + "B";
    if (abs >= 1e6) return "$" + (n / 1e6).toFixed(0) + "M";
    return "$" + n;
  };
  const accent = "#CDA24E";

  return (
    <div style={{ animation: "fadeIn 0.3s ease" }}>
      {/* ── HEADER ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 11, color: accent, letterSpacing: 5, textTransform: "uppercase", fontWeight: 600 }}>
            Earnings & Catalysts
          </div>
          <h2 style={{ fontFamily: "var(--ra-font-sans)", fontSize: 30, fontWeight: 400, color: "#111", letterSpacing: -0.8, lineHeight: 1.05, marginTop: 3 }}>
            Catalyst Calendar
          </h2>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: accent }}>
            {entries === null ? "…" : visible.length}
          </div>
          <div style={{ fontSize: 10, color: "#aaa", letterSpacing: 0.3 }}>
            scheduled next {rangeFilter === "7d" ? "week" : rangeFilter === "30d" ? "30 days" : "90 days"}
          </div>
        </div>
      </div>

      {/* ── FILTERS ── */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ display: "inline-flex", gap: 2, background: "rgba(0,0,0,.03)", borderRadius: 7, padding: 2 }}>
          {[["7d", "7 days"], ["30d", "30 days"], ["90d", "90 days"]].map(([k, lb]) => (
            <button key={k} onClick={() => setRangeFilter(k)} style={{
              background: rangeFilter === k ? "#fff" : "transparent",
              border: "none", borderRadius: 5, padding: "5px 12px",
              fontSize: 11, fontWeight: rangeFilter === k ? 700 : 500,
              color: rangeFilter === k ? "#111" : "#888", cursor: "pointer",
              boxShadow: rangeFilter === k ? "0 1px 3px rgba(0,0,0,.06)" : "none",
              transition: "all .12s",
            }}>{lb}</button>
          ))}
        </div>

        {/* Theme filter */}
        <div style={{ display: "inline-flex", gap: 3, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, color: "#bbb", letterSpacing: .5, textTransform: "uppercase", marginRight: 4 }}>Theme:</span>
          <button onClick={() => setThemeFilter(null)} style={{
            background: !themeFilter ? "#fff" : "transparent",
            border: !themeFilter ? "1px solid rgba(0,0,0,.1)" : "1px solid transparent",
            borderRadius: 5, padding: "4px 10px", fontSize: 10,
            color: !themeFilter ? "#111" : "#999", cursor: "pointer", fontWeight: 600,
          }}>All</button>
          {Object.keys(themes).filter(id => themes[id].available).map(tid => {
            const t = themes[tid];
            const active = themeFilter === tid;
            return (
              <button key={tid} onClick={() => setThemeFilter(active ? null : tid)} style={{
                background: active ? "#fff" : "transparent",
                border: active ? `1px solid ${t.accent}66` : "1px solid transparent",
                borderRadius: 5, padding: "4px 9px", fontSize: 10,
                color: active ? t.accent : "#888", cursor: "pointer", fontWeight: active ? 700 : 500,
                display: "inline-flex", alignItems: "center", gap: 3,
                boxShadow: active ? `0 1px 3px ${t.accent}22` : "none",
              }}>
                <span style={{ fontSize: 9 }}>{t.icon}</span>
                {t.title.replace(/^The /, "")}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── STATE: LOADING / NO KEY / EMPTY / LIST ── */}
      {!apiKey && (
        <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,.06)", borderRadius: 10, padding: "30px 20px", textAlign: "center", color: "#888", fontSize: 12 }}>
          <div style={{ fontSize: 32, opacity: 0.3, marginBottom: 8 }}>🔑</div>
          <div style={{ fontWeight: 600, marginBottom: 4, color: "#555" }}>FMP API key required</div>
          <div style={{ fontSize: 11, color: "#999" }}>Add a key in settings (gear icon) to load the earnings calendar.</div>
        </div>
      )}

      {apiKey && entries === null && (
        <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,.06)", borderRadius: 10, padding: "30px 20px", textAlign: "center", color: "#888", fontSize: 12 }}>
          <div style={{ fontSize: 11, color: "#b8860b", marginBottom: 6 }}>⌛ Fetching calendar…</div>
          <div style={{ fontSize: 10, color: "#aaa" }}>Calling FMP earnings calendar endpoint for next 90 days.</div>
        </div>
      )}

      {apiKey && entries && entries.length === 0 && (
        <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,.06)", borderRadius: 10, padding: "30px 20px", textAlign: "center", color: "#888", fontSize: 12 }}>
          <div style={{ fontSize: 32, opacity: 0.3, marginBottom: 8 }}>📅</div>
          <div style={{ fontWeight: 600, marginBottom: 4, color: "#555" }}>No earnings data returned</div>
          <div style={{ fontSize: 11, color: "#999" }}>Either no companies in our universe report in the next 90 days, or the API response was empty.</div>
        </div>
      )}

      {apiKey && entries && entries.length > 0 && grouped.length === 0 && (
        <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,.06)", borderRadius: 10, padding: "30px 20px", textAlign: "center", color: "#888", fontSize: 12 }}>
          <div style={{ fontSize: 11, color: "#aaa" }}>No events match the current filters — try widening the range or clearing the theme filter.</div>
        </div>
      )}

      {/* ── GROUPED EVENTS ── */}
      {grouped.map(group => {
        const dh = fmtDateHeader(group.date);
        return (
          <div key={group.date} style={{ marginBottom: 14 }}>
            {/* Date header */}
            <div style={{
              position: "sticky", top: 0, zIndex: 2,
              display: "flex", alignItems: "baseline", gap: 8,
              padding: "5px 8px", background: "linear-gradient(to bottom, #fff 75%, rgba(255,255,255,.85))",
              borderBottom: "1px solid rgba(0,0,0,.08)",
            }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#222" }}>{dh.primary}</span>
              {dh.rel && <span style={{ fontSize: 10, color: accent, fontWeight: 600, letterSpacing: .3 }}>{dh.rel}</span>}
              <span style={{ fontSize: 10, color: "#bbb", marginLeft: "auto" }}>{group.rows.length} event{group.rows.length !== 1 ? "s" : ""}</span>
            </div>
            {/* Rows */}
            <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,.05)", borderTop: "none", borderRadius: "0 0 8px 8px", overflow: "hidden" }}>
              {group.rows.map((row, i) => {
                const co = cos.find(c => c.t === row.internalTicker);
                if (!co) return null;
                const vc = vx[co.v];
                const tb = timeBadge(row.time);
                const epsActual = row.eps;
                const epsEst = row.epsEstimated;
                const revEst = row.revenueEstimated;
                const reported = epsActual != null;
                const beat = reported && epsEst != null && epsActual >= epsEst;
                // Build theme chips
                const themeChips = (co.themes || []).slice(0, 2).map(tid => themes[tid]).filter(Boolean);

                return (
                  <div key={row.internalTicker + "-" + i} onClick={() => onSelect(row.internalTicker)}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "52px 1fr auto auto auto",
                      gap: 12, alignItems: "center",
                      padding: "9px 10px",
                      borderBottom: i < group.rows.length - 1 ? "1px solid rgba(0,0,0,.04)" : "none",
                      background: i % 2 ? "rgba(0,0,0,.008)" : "transparent",
                      cursor: "pointer",
                      transition: "background .12s",
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = vc.bg}
                    onMouseLeave={e => e.currentTarget.style.background = i % 2 ? "rgba(0,0,0,.008)" : "transparent"}
                  >
                    {/* Time badge */}
                    <AppTooltip content={tb.title}><span style={{
                      display: "inline-block", padding: "2px 5px", borderRadius: 3,
                      background: tb.bg, color: tb.fg, fontSize: 9, fontWeight: 700, letterSpacing: .5, textAlign: "center",
                    }}>{tb.label}</span></AppTooltip>

                    {/* Ticker + name + theme */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                      <Logo ticker={co.t} size={18} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: vc.c }}>{co.cc} {co.t}</span>
                          <span style={{ fontSize: 10, color: "#999", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 220 }}>{co.nm}</span>
                        </div>
                        {themeChips.length > 0 && (
                          <div style={{ display: "flex", gap: 3, marginTop: 2 }}>
                            {themeChips.map(t => (
                              <span key={t.id} style={{
                                fontSize: 8, padding: "0 4px", borderRadius: 2,
                                background: t.accent + "15", color: t.accent, fontWeight: 600, letterSpacing: .3,
                              }}>{t.title.replace(/^The /, "")}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* EPS est (or actual if reported) */}
                    <div style={{ textAlign: "right", minWidth: 80 }}>
                      <div style={{ fontSize: 9, color: "#bbb", letterSpacing: .3, textTransform: "uppercase" }}>
                        {reported ? "EPS Act" : "EPS Est"}
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: reported ? (beat ? "#1a8a5c" : "#c44040") : "#333" }}>
                        {reported ? fmtEPS(epsActual) : fmtEPS(epsEst)}
                      </div>
                      {reported && epsEst != null && (
                        <div style={{ fontSize: 9, color: "#999" }}>est {fmtEPS(epsEst)}</div>
                      )}
                    </div>

                    {/* Rev est */}
                    <div style={{ textAlign: "right", minWidth: 70 }}>
                      <div style={{ fontSize: 9, color: "#bbb", letterSpacing: .3, textTransform: "uppercase" }}>Rev Est</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#333" }}>{fmtRev(revEst)}</div>
                    </div>

                    {/* Arrow indicator */}
                    <span style={{ fontSize: 14, color: "#ccc" }}>›</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Footer */}
      {grouped.length > 0 && (
        <div style={{ fontSize: 10, color: "#bbb", marginTop: 12, textAlign: "center" }}>
          Calendar data: FMP · Cached 1 hour · Click any row to open detail panel
        </div>
      )}
    </div>
  );
}

/* ════════════════════════ PEER COMPARISON TABLE ════════════════════════ */
// Renders focal company + up to 7 peers from co.cp array in a table.
// Columns: Ticker, Mkt Cap, P/E, Rev TTM, GM %, Beta, Off 52w-High %.
// Data sourcing (per cell): live > fundCache > authored. Color dot indicates freshness.
// Click non-focal row → onSelect(ticker) to switch detail panel.
