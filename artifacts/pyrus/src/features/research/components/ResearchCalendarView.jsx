import {
  useEffect,
  useMemo,
  useState,
} from "react";
import { fetchEarningsCalendar } from "../lib/researchApi";
import { Logo } from "./ResearchLogo";
import { AppTooltip } from "@/components/ui/tooltip";
import { DataUnavailableState, SegmentedControl, Skeleton } from "../../../components/platform/primitives.jsx";
import {
  CSS_COLOR,
  cssColorMix,
  ELEVATION,
  FONT_WEIGHTS,
  RADII,
  T,
  fs,
  sp,
  textSize,
} from "../../../lib/uiTokens.jsx";


export function CalendarView({ cos, apiKey, onSelect, themes, vx }) {
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
    let cancelled = false;
    setEntries(null);
    fetchEarningsCalendar(fromDate, toDate).then(data => {
      if (cancelled) return;
      if (!data) { setEntries([]); return; }
      // Build a set of internal tickers we track — include both native + FMP-mapped symbols
      const universeSet = new Set(cos.map(c => c.t));
      // Filter: only keep entries whose internalTicker is in our universe
      const filtered = data.filter(e => universeSet.has(e.internalTicker));
      setEntries(filtered);
    });
    return () => {
      cancelled = true;
    };
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
    if (t === "bmo") return { label: "BMO", bg: CSS_COLOR.greenBg, fg: CSS_COLOR.green, title: "Before market open" };
    if (t === "amc") return { label: "AMC", bg: `${cssColorMix(CSS_COLOR.purple, 15)}`, fg: CSS_COLOR.purple, title: "After market close" };
    if (t === "dmh") return { label: "DMH", bg: CSS_COLOR.amberBg, fg: CSS_COLOR.amber, title: "During market hours" };
    return { label: "—", bg: CSS_COLOR.bg2, fg: CSS_COLOR.textDim, title: "Time not specified" };
  };

  const fmtEPS = n => (n == null || isNaN(n)) ? "—" : (n >= 0 ? "$" : "–$") + Math.abs(n).toFixed(2);
  const fmtRev = n => {
    if (n == null) return "—";
    const abs = Math.abs(n);
    if (abs >= 1e9) return "$" + (n / 1e9).toFixed(1) + "B";
    if (abs >= 1e6) return "$" + (n / 1e6).toFixed(0) + "M";
    return "$" + n;
  };
  const accent = CSS_COLOR.accent;

  return (
    <div style={{ animation: "fadeIn 0.3s ease" }}>
      {/* ── HEADER ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: sp(14) }}>
        <div>
          <div style={{ fontSize: fs(11), color: accent, letterSpacing: 5, textTransform: "uppercase", fontWeight: FONT_WEIGHTS.regular }}>
            Earnings & Catalysts
          </div>
          <h2 style={{ fontFamily: T.display, fontSize: fs(30), fontWeight: FONT_WEIGHTS.regular, color: CSS_COLOR.text, letterSpacing: 0, lineHeight: 1.05, marginTop: sp(3) }}>
            Catalyst Calendar
          </h2>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: fs(18), fontWeight: FONT_WEIGHTS.regular, color: accent }}>
            {entries === null ? "…" : visible.length}
          </div>
          <div style={{ fontSize: fs(10), color: CSS_COLOR.textMuted, letterSpacing: 0.3 }}>
            scheduled next {rangeFilter === "7d" ? "week" : rangeFilter === "30d" ? "30 days" : "90 days"}
          </div>
        </div>
      </div>

      {/* ── FILTERS ── */}
      <div style={{ display: "flex", gap: sp(10), alignItems: "center", marginBottom: sp(12), flexWrap: "wrap" }}>
        <SegmentedControl
          ariaLabel="Calendar range"
          options={[{ value: "7d", label: "7d" }, { value: "30d", label: "30d" }, { value: "90d", label: "90d" }]}
          value={rangeFilter}
          onChange={setRangeFilter}
        />

        {/* Theme filter */}
        <div style={{ display: "inline-flex", gap: sp(3), alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: fs(10), color: CSS_COLOR.textMuted, letterSpacing: .5, textTransform: "uppercase", marginRight: sp(4) }}>Theme:</span>
          <button type="button" className="ra-touch-target-y" aria-pressed={!themeFilter} onClick={() => setThemeFilter(null)} style={{
            background: !themeFilter ? CSS_COLOR.bg1 : "transparent",
            border: !themeFilter ? `1px solid ${CSS_COLOR.border}` : "1px solid transparent",
            borderRadius: RADII.sm, padding: sp("4px 10px"), fontSize: fs(10),
            color: !themeFilter ? CSS_COLOR.text : CSS_COLOR.textDim, cursor: "pointer", fontWeight: FONT_WEIGHTS.regular,
          }}>All</button>
          {Object.keys(themes).filter(id => themes[id].available).map(tid => {
            const t = themes[tid];
            const active = themeFilter === tid;
            return (
              <button key={tid} type="button" className="ra-touch-target-y" aria-pressed={active} onClick={() => setThemeFilter(active ? null : tid)} style={{
                background: active ? CSS_COLOR.bg1 : "transparent",
                border: active ? `1px solid ${t.accent}66` : "1px solid transparent",
                borderRadius: RADII.sm, padding: sp("4px 9px"), fontSize: fs(10),
                color: active ? t.accent : CSS_COLOR.textDim, cursor: "pointer", fontWeight: FONT_WEIGHTS.regular,
                display: "inline-flex", alignItems: "center", gap: sp(3),
                boxShadow: active ? ELEVATION.sm : "none",
              }}>
                <span aria-hidden="true" style={{ fontSize: textSize("caption") }}>{t.icon}</span>
                {t.title.replace(/^The /, "")}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── STATE: LOADING / NO KEY / EMPTY / LIST ── */}
      {!apiKey && (
        <DataUnavailableState
          variant="warning"
          title="FMP API key required"
          detail="Add a key in settings (gear icon) to load the earnings calendar."
        />
      )}

      {apiKey && entries === null && (
        <div aria-hidden="true">
          {[0, 1].map(g => (
            <div key={g} style={{ marginBottom: sp(14) }}>
              <div style={{ display: "flex", alignItems: "center", gap: sp(8), padding: sp("5px 8px"), borderBottom: `1px solid ${CSS_COLOR.border}` }}>
                <Skeleton width={140} height={13} />
                <Skeleton width={48} height={10} style={{ marginLeft: "auto" }} />
              </div>
              <div style={{ background: CSS_COLOR.bg1, border: `1px solid ${CSS_COLOR.border}`, borderTop: "none", borderRadius: `0 0 ${RADII.md}px ${RADII.md}px`, overflow: "hidden" }}>
                {[0, 1, 2].map(r => (
                  <div key={r} style={{
                    display: "grid", gridTemplateColumns: "52px 1fr auto auto auto",
                    gap: sp(12), alignItems: "center", padding: sp("9px 10px"),
                    borderBottom: r < 2 ? `1px solid ${CSS_COLOR.border}` : "none",
                  }}>
                    <Skeleton width={34} height={16} />
                    <div style={{ display: "flex", alignItems: "center", gap: sp(6) }}>
                      <Skeleton width={18} height={18} radius={RADII.sm} />
                      <div style={{ display: "flex", flexDirection: "column", gap: sp(4) }}>
                        <Skeleton width={120} height={11} />
                        <Skeleton width={70} height={8} />
                      </div>
                    </div>
                    <Skeleton width={56} height={24} />
                    <Skeleton width={48} height={24} />
                    <Skeleton width={10} height={14} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {apiKey && entries && entries.length === 0 && (
        <DataUnavailableState
          title="No earnings data returned"
          detail="Either no companies in our universe report in the next 90 days, or the API response was empty."
        />
      )}

      {apiKey && entries && entries.length > 0 && grouped.length === 0 && (
        <DataUnavailableState
          title="No matching events"
          detail="No events match the current filters — try widening the range or clearing the theme filter."
        />
      )}

      {/* ── GROUPED EVENTS ── */}
      {grouped.map(group => {
        const dh = fmtDateHeader(group.date);
        return (
          <div key={group.date} style={{ marginBottom: sp(14) }}>
            {/* Date header */}
            <div style={{
              position: "sticky", top: 0, zIndex: 2,
              display: "flex", alignItems: "baseline", gap: sp(8),
              padding: sp("5px 8px"), background: `linear-gradient(to bottom, ${CSS_COLOR.bg1} 75%, color-mix(in srgb, ${CSS_COLOR.bg1} 85%, transparent))`,
              borderBottom: `1px solid ${CSS_COLOR.border}`,
            }}>
              <span style={{ fontSize: fs(13), fontWeight: FONT_WEIGHTS.regular, color: CSS_COLOR.text }}>{dh.primary}</span>
              {dh.rel && <span style={{ fontSize: fs(10), color: accent, fontWeight: FONT_WEIGHTS.regular, letterSpacing: .3 }}>{dh.rel}</span>}
              <span style={{ fontSize: fs(10), color: CSS_COLOR.textMuted, marginLeft: "auto" }}>{group.rows.length} event{group.rows.length !== 1 ? "s" : ""}</span>
            </div>
            {/* Rows */}
            <div style={{ background: CSS_COLOR.bg1, border: `1px solid ${CSS_COLOR.border}`, borderTop: "none", borderRadius: `0 0 ${RADII.md}px ${RADII.md}px`, overflow: "hidden" }}>
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
                  <div key={row.internalTicker + "-" + i}
                    className="ra-table-row"
                    role="button"
                    tabIndex={0}
                    aria-label={`Open ${co.cc} ${co.t} earnings detail`}
                    onClick={() => onSelect(row.internalTicker)}
                    onKeyDown={e => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelect(row.internalTicker);
                      }
                    }}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "52px 1fr auto auto auto",
                      gap: sp(12), alignItems: "center",
                      padding: sp("9px 10px"),
                      borderBottom: i < group.rows.length - 1 ? `1px solid ${CSS_COLOR.border}` : "none",
                      background: i % 2 ? CSS_COLOR.bg2 : "transparent",
                      cursor: "pointer",
                      transition: "background var(--ra-motion-fast)",
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = vc.bg}
                    onMouseLeave={e => e.currentTarget.style.background = i % 2 ? CSS_COLOR.bg2 : "transparent"}
                  >
                    {/* Time badge */}
                    <AppTooltip content={tb.title}><span style={{
                      display: "inline-block", padding: sp("2px 5px"), borderRadius: RADII.xs,
                      background: tb.bg, color: tb.fg, fontSize: textSize("caption"), fontWeight: FONT_WEIGHTS.regular, letterSpacing: .5, textAlign: "center",
                    }}>{tb.label}</span></AppTooltip>

                    {/* Ticker + name + theme */}
                    <div style={{ display: "flex", alignItems: "center", gap: sp(6), minWidth: 0 }}>
                      <Logo ticker={co.t} size={18} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: sp(5) }}>
                          <span style={{ fontSize: fs(12), fontWeight: FONT_WEIGHTS.regular, color: vc.c }}>{co.cc} {co.t}</span>
                          <span style={{ fontSize: fs(10), color: CSS_COLOR.textDim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 220 }}>{co.nm}</span>
                        </div>
                        {themeChips.length > 0 && (
                          <div style={{ display: "flex", gap: sp(3), marginTop: sp(2) }}>
                            {themeChips.map(t => (
                              <span key={t.id} style={{
                                fontSize: fs(8), padding: sp("0 4px"), borderRadius: RADII.xs,
                                background: t.accent + "15", color: t.accent, fontWeight: FONT_WEIGHTS.regular, letterSpacing: .3,
                              }}>{t.title.replace(/^The /, "")}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* EPS est (or actual if reported) */}
                    <div style={{ textAlign: "right", minWidth: 80 }}>
                      <div style={{ fontSize: textSize("caption"), color: CSS_COLOR.textMuted, letterSpacing: .3, textTransform: "uppercase" }}>
                        {reported ? "EPS Act" : "EPS Est"}
                      </div>
                      <div style={{ fontSize: fs(12), fontWeight: FONT_WEIGHTS.regular, color: reported ? (beat ? CSS_COLOR.green : CSS_COLOR.red) : CSS_COLOR.text }}>
                        {reported ? fmtEPS(epsActual) : fmtEPS(epsEst)}
                      </div>
                      {reported && epsEst != null && (
                        <div style={{ fontSize: textSize("caption"), color: CSS_COLOR.textDim }}>est {fmtEPS(epsEst)}</div>
                      )}
                    </div>

                    {/* Rev est */}
                    <div style={{ textAlign: "right", minWidth: 70 }}>
                      <div style={{ fontSize: textSize("caption"), color: CSS_COLOR.textMuted, letterSpacing: .3, textTransform: "uppercase" }}>Rev Est</div>
                      <div style={{ fontSize: fs(12), fontWeight: FONT_WEIGHTS.regular, color: CSS_COLOR.text }}>{fmtRev(revEst)}</div>
                    </div>

                    {/* Arrow indicator */}
                    <span aria-hidden="true" style={{ fontSize: fs(14), color: CSS_COLOR.textMuted }}>›</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Footer */}
      {grouped.length > 0 && (
        <div style={{ fontSize: fs(10), color: CSS_COLOR.textMuted, marginTop: sp(12), textAlign: "center" }}>
          Calendar data: FMP · Cached 1 hour · Select any event to open its detail panel
        </div>
      )}
    </div>
  );
}
