import {
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Area,
  AreaChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Badge,
  Card,
  ContractDetailInline,
  DataUnavailableState,
  MISSING_VALUE,
  OrderFlowDonut,
  Pill,
  SizeBucketRow,
  T,
  _initialState,
  bridgeRuntimeMessage,
  bridgeRuntimeTone,
  dim,
  flowProviderColor,
  fmtCompactNumber,
  fmtM,
  formatExpirationLabel,
  fs,
  isFiniteNumber,
  persistState,
  sp,
  useLiveMarketFlow,
} from "../RayAlgoPlatform";

export const FlowScreen = ({ onJumpToTrade, session, symbols = [] }) => {
  // ── Saved scans persisted in localStorage ──
  const [savedScans, setSavedScans] = useState(
    _initialState.flowSavedScans || [],
  );
  const [activeScanId, setActiveScanId] = useState(
    _initialState.flowActiveScanId || null,
  );
  useEffect(() => {
    persistState({ flowSavedScans: savedScans });
  }, [savedScans]);

  const [filter, setFilter] = useState(_initialState.flowFilter || "all");
  const [minPrem, setMinPrem] = useState(
    Number.isFinite(_initialState.flowMinPrem) ? _initialState.flowMinPrem : 0,
  );
  const [sortBy, setSortBy] = useState(_initialState.flowSortBy || "time");
  const [selectedEvt, setSelectedEvt] = useState(null); // currently inspected contract
  useEffect(() => {
    persistState({
      flowActiveScanId: activeScanId,
      flowFilter: filter,
      flowMinPrem: minPrem,
      flowSortBy: sortBy,
    });
  }, [activeScanId, filter, minPrem, sortBy]);
  useEffect(() => {
    if (!activeScanId) {
      return;
    }
    if (!savedScans.some((scan) => scan.id === activeScanId)) {
      setActiveScanId(null);
    }
  }, [activeScanId, savedScans]);
  const {
    hasLiveFlow,
    flowStatus,
    providerSummary,
    flowEvents,
    flowTide,
    tickerFlow,
    flowClock,
    dteBuckets,
    marketOrderFlow,
  } = useLiveMarketFlow(symbols, {
    enabled: Boolean(session),
  });

  // ── CLUSTER DETECTION ──
  // Group activity by (ticker + strike + cp). Any group with 2+ events = cluster.
  // We surface cluster size + total premium on each row that's part of a cluster.
  const clusters = useMemo(() => {
    const map = {};
    for (const e of flowEvents) {
      const key =
        e.optionTicker ||
        `${e.ticker}_${e.strike}_${e.cp}_${formatExpirationLabel(e.expirationDate)}`;
      if (!map[key])
        map[key] = {
          count: 0,
          totalPrem: 0,
          ids: [],
          firstTime: e.time,
          lastTime: e.time,
        };
      map[key].count += 1;
      map[key].totalPrem += e.premium;
      map[key].ids.push(e.id);
      if (e.time < map[key].firstTime) map[key].firstTime = e.time;
      if (e.time > map[key].lastTime) map[key].lastTime = e.time;
    }
    return map;
  }, [flowEvents]);
  // Build per-event lookup for fast row rendering
  const clusterFor = (e) => {
    const key =
      e.optionTicker ||
      `${e.ticker}_${e.strike}_${e.cp}_${formatExpirationLabel(e.expirationDate)}`;
    const c = clusters[key];
    return c && c.count >= 2 ? c : null;
  };

  // ── TOP CONTRACTS BY VOLUME, per ticker ──
  // For each ticker, group live flow events by (strike + cp), sum volume + premium, pick top 3.
  // Clicking a contract chip opens the Contract Detail Drawer for the biggest event in that group.
  const topContractsByTicker = useMemo(() => {
    const byTicker = {};
    for (const e of flowEvents) {
      if (!byTicker[e.ticker]) byTicker[e.ticker] = {};
      const key =
        e.optionTicker ||
        `${e.strike}_${e.cp}_${formatExpirationLabel(e.expirationDate)}`;
      if (!byTicker[e.ticker][key]) {
        byTicker[e.ticker][key] = {
          strike: e.strike,
          cp: e.cp,
          dte: e.dte,
          vol: 0,
          premium: 0,
          count: 0,
          biggestEvt: e,
        };
      }
      const g = byTicker[e.ticker][key];
      g.vol += e.vol;
      g.premium += e.premium;
      g.count += 1;
      if (e.premium > g.biggestEvt.premium) g.biggestEvt = e;
    }
    // Convert to sorted-top-3 arrays
    const result = {};
    for (const [ticker, contracts] of Object.entries(byTicker)) {
      result[ticker] = Object.values(contracts)
        .sort((a, b) => b.vol - a.vol)
        .slice(0, 3);
    }
    return result;
  }, [flowEvents]);

  // Aggregate stats
  const totalCallPrem = flowEvents
    .filter((e) => e.cp === "C")
    .reduce((a, e) => a + e.premium, 0);
  const totalPutPrem = flowEvents
    .filter((e) => e.cp === "P")
    .reduce((a, e) => a + e.premium, 0);
  const netPrem = totalCallPrem - totalPutPrem;
  const goldenCount = flowEvents.filter((e) => e.golden).length;
  const blockCount = flowEvents.filter((e) => e.type === "BLOCK").length;
  const sweepCount = flowEvents.filter((e) => e.type === "SWEEP").length;
  const zeroDteCount = flowEvents.filter((e) => e.dte <= 1).length;
  const zeroDtePrem = flowEvents
    .filter((e) => e.dte <= 1)
    .reduce((a, e) => a + e.premium, 0);
  const cpRatio = totalCallPrem ? totalPutPrem / totalCallPrem : 0;
  const mostActive = [...tickerFlow].sort(
    (a, b) => b.calls + b.puts - (a.calls + a.puts),
  )[0] || { sym: MISSING_VALUE, calls: 0, puts: 0 };

  // ── SMART MONEY COMPASS ──
  // Institutional bias = net premium from XL trades (>$250K) on calls vs puts.
  // Score range -100 (max bearish) to +100 (max bullish).
  const xlTrades = flowEvents.filter((e) => e.premium >= 250000);
  const xlCallPrem =
    xlTrades
      .filter((e) => e.cp === "C" && e.side === "BUY")
      .reduce((s, e) => s + e.premium, 0) -
    xlTrades
      .filter((e) => e.cp === "C" && e.side === "SELL")
      .reduce((s, e) => s + e.premium, 0);
  const xlPutPrem =
    xlTrades
      .filter((e) => e.cp === "P" && e.side === "BUY")
      .reduce((s, e) => s + e.premium, 0) -
    xlTrades
      .filter((e) => e.cp === "P" && e.side === "SELL")
      .reduce((s, e) => s + e.premium, 0);
  const xlNet = xlCallPrem - xlPutPrem;
  const xlTotalAbs = Math.abs(xlCallPrem) + Math.abs(xlPutPrem) || 1;
  const compassScore = Math.round((xlNet / xlTotalAbs) * 100); // -100 to +100
  const compassVerdict =
    compassScore >= 50
      ? "BULLISH"
      : compassScore >= 20
        ? "LEAN BULL"
        : compassScore >= -20
          ? "NEUTRAL"
          : compassScore >= -50
            ? "LEAN BEAR"
            : "BEARISH";
  const compassColor =
    compassScore >= 20 ? T.green : compassScore >= -20 ? T.amber : T.red;

  // Filter + sort
  let filtered = flowEvents
    .filter((e) => {
      if (filter === "calls") return e.cp === "C";
      if (filter === "puts") return e.cp === "P";
      if (filter === "golden") return e.golden;
      if (filter === "sweep") return e.type === "SWEEP";
      if (filter === "block") return e.type === "BLOCK";
      if (filter === "cluster") return clusterFor(e) !== null; // new: clusters-only filter
      return true;
    })
    .filter((e) => e.premium >= minPrem);
  if (sortBy === "premium")
    filtered = [...filtered].sort((a, b) => b.premium - a.premium);
  else if (sortBy === "score")
    filtered = [...filtered].sort((a, b) => b.score - a.score);

  const maxTickerPrem = Math.max(1, ...tickerFlow.map((t) => t.calls + t.puts));
  const bridgeTone = bridgeRuntimeTone(session);
  const ibkrLoginRequired =
    Boolean(session?.configured?.ibkr) &&
    !session?.ibkrBridge?.authenticated &&
    !providerSummary.providers.includes("polygon");
  const flowDisplayLabel =
    !hasLiveFlow && ibkrLoginRequired
      ? "IBKR login required"
      : providerSummary.label === "IBKR snapshot live" &&
          session?.ibkrBridge?.liveMarketDataAvailable === false
        ? "IBKR delayed"
        : providerSummary.label;
  const flowDisplayColor =
    !hasLiveFlow && ibkrLoginRequired
      ? T.amber
      : flowDisplayLabel === "IBKR delayed"
        ? T.amber
        : providerSummary.color;
  const flowClockActiveBuckets = flowClock.filter((bucket) => bucket.count > 0);
  const flowClockPeak =
    flowClockActiveBuckets.reduce(
      (best, bucket) =>
        !best || bucket.count > best.count || bucket.prem > best.prem
          ? bucket
          : best,
      null,
    )?.time || MISSING_VALUE;
  const flowClockAverage = Math.round(
    flowEvents.length / Math.max(1, flowClock.length),
  );
  const emptyFlowDetail =
    flowStatus === "loading"
      ? "Waiting on current options activity snapshots for the tracked symbols."
      : ibkrLoginRequired
        ? bridgeRuntimeMessage(session)
        : providerSummary.erroredSource?.errorMessage
          ? providerSummary.erroredSource.errorMessage
          : providerSummary.failures[0]?.error
            ? providerSummary.failures[0].error
            : providerSummary.fallbackUsed
              ? "IBKR returned no active snapshot flow and the Polygon trade fallback was empty."
              : "IBKR returned no active snapshot flow for the tracked symbols.";
  const flowHeader = (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: sp(8),
        padding: sp("2px 2px 0"),
        fontSize: fs(8),
        fontFamily: T.mono,
        color: T.textDim,
      }}
    >
      <span>
        Flow source ·{" "}
        <span style={{ color: flowDisplayColor, fontWeight: 700 }}>
          {flowDisplayLabel}
        </span>
      </span>
      <span
        title={bridgeRuntimeMessage(session)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: sp(5),
          color: bridgeTone.color,
        }}
      >
        <span
          style={{
            width: dim(6),
            height: dim(6),
            background: bridgeTone.color,
            display: "inline-block",
          }}
        />
        IBKR {bridgeTone.label.toUpperCase()}
      </span>
    </div>
  );

  if (!flowEvents.length) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          overflow: "hidden",
          position: "relative",
        }}
      >
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: sp(8),
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {flowHeader}
          <Card
            style={{
              padding: sp(10),
              minHeight: dim(220),
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <DataUnavailableState
              title="No live options activity"
              detail={emptyFlowDetail}
            />
          </Card>
        </div>
      </div>
    );
  }

  // ── SAVED SCAN HELPERS ──
  const saveCurrentScan = () => {
    const name = prompt(
      "Name this scan:",
      filter === "golden"
        ? "★ Golden plays"
        : filter === "block"
          ? "Block trades"
          : `${filter} ≥${(minPrem / 1000) | 0}K`,
    );
    if (!name) return;
    const newScan = { id: Date.now(), name, filter, minPrem, sortBy };
    setSavedScans((s) => [...s, newScan].slice(-8)); // cap at 8
    setActiveScanId(newScan.id);
  };
  const loadScan = (scan) => {
    setFilter(scan.filter);
    setMinPrem(scan.minPrem);
    setSortBy(scan.sortBy);
    setActiveScanId(scan.id);
  };
  const deleteScan = (id) => {
    setSavedScans((s) => s.filter((x) => x.id !== id));
    if (activeScanId === id) setActiveScanId(null);
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: sp(8),
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {flowHeader}

        {/* ── ROW 1: KPI Bar ── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            gap: 6,
          }}
        >
          {[
            {
              label: "TOTAL PREMIUM",
              value: fmtM(totalCallPrem + totalPutPrem),
              sub: `${flowEvents.length} contracts`,
              color: T.text,
            },
            {
              label: "NET PREMIUM",
              value: (netPrem >= 0 ? "+" : "") + fmtM(Math.abs(netPrem)),
              sub: cpRatio < 1 ? "Bullish" : "Bearish",
              color: netPrem >= 0 ? T.green : T.red,
            },
            {
              label: "P/C RATIO",
              value: cpRatio.toFixed(2),
              sub: cpRatio < 0.7 ? "Greed" : cpRatio < 1 ? "Neutral" : "Fear",
              color: cpRatio < 0.7 ? T.green : cpRatio < 1 ? T.amber : T.red,
            },
            {
              label: "★ GOLDEN SWEEPS",
              value: goldenCount,
              sub: "High conv.",
              color: T.amber,
            },
            {
              label: "⚡ 0DTE",
              value: zeroDteCount,
              sub: fmtM(zeroDtePrem),
              color: T.cyan,
            },
            {
              label: "MOST ACTIVE",
              value: mostActive.sym,
              sub: fmtM(mostActive.calls + mostActive.puts),
              color: T.purple,
            },
          ].map((k, i) => (
            <Card key={i} style={{ padding: "5px 9px" }}>
              <div
                style={{
                  fontSize: fs(7),
                  fontWeight: 600,
                  color: T.textDim,
                  letterSpacing: "0.06em",
                  fontVariant: "all-small-caps",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  lineHeight: 1,
                }}
              >
                {k.label}
              </div>
              <div
                style={{
                  fontSize: fs(18),
                  fontWeight: 800,
                  fontFamily: T.mono,
                  color: k.color,
                  marginTop: sp(2),
                  lineHeight: 1,
                }}
              >
                {k.value}
              </div>
              <div
                style={{
                  fontSize: fs(8),
                  color: T.textDim,
                  fontFamily: T.sans,
                  marginTop: sp(1),
                  lineHeight: 1,
                }}
              >
                {k.sub}
              </div>
            </Card>
          ))}
          {/* ── SMART MONEY COMPASS ── institutional bias gauge from XL trades */}
          <Card style={{ padding: "5px 9px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span
                style={{
                  fontSize: fs(7),
                  fontWeight: 600,
                  color: T.textDim,
                  letterSpacing: "0.06em",
                  fontVariant: "all-small-caps",
                  whiteSpace: "nowrap",
                  lineHeight: 1,
                }}
              >
                SMART MONEY
              </span>
              <span
                style={{
                  fontSize: fs(7),
                  color: T.textDim,
                  fontFamily: T.mono,
                }}
              >
                {xlTrades.length} XL
              </span>
            </div>
            {/* Bias gauge: half-circle with needle pointing to institutional direction */}
            <div
              style={{
                position: "relative",
                width: "100%",
                height: dim(28),
                marginTop: sp(2),
              }}
            >
              <svg
                width="100%"
                height="100%"
                viewBox="0 0 100 36"
                preserveAspectRatio="xMidYMid meet"
              >
                {/* Track segments: red (bearish), amber (neutral), green (bullish) */}
                <path
                  d="M 8 30 A 28 28 0 0 1 36 6"
                  fill="none"
                  stroke={T.red}
                  strokeWidth="3.5"
                  opacity="0.65"
                />
                <path
                  d="M 36 6 A 28 28 0 0 1 64 6"
                  fill="none"
                  stroke={T.amber}
                  strokeWidth="3.5"
                  opacity="0.65"
                />
                <path
                  d="M 64 6 A 28 28 0 0 1 92 30"
                  fill="none"
                  stroke={T.green}
                  strokeWidth="3.5"
                  opacity="0.65"
                />
                {/* Needle: angle in degrees, -90° (left/bearish) to +90° (right/bullish) */}
                {(() => {
                  const angle = (compassScore / 100) * 90; // -90 to +90
                  const rad = ((angle - 90) * Math.PI) / 180;
                  const cx = 50,
                    cy = 30,
                    len = 22;
                  const x2 = cx + len * Math.cos(rad);
                  const y2 = cy + len * Math.sin(rad);
                  return (
                    <>
                      <line
                        x1={cx}
                        y1={cy}
                        x2={x2}
                        y2={y2}
                        stroke={compassColor}
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                      <circle cx={cx} cy={cy} r="2.2" fill={compassColor} />
                    </>
                  );
                })()}
              </svg>
            </div>
            <div
              style={{
                fontSize: fs(11),
                fontWeight: 800,
                fontFamily: T.display,
                color: compassColor,
                marginTop: sp(1),
                letterSpacing: "0.04em",
              }}
            >
              {compassVerdict}
            </div>
            <div
              style={{
                fontSize: fs(8),
                color: T.textDim,
                fontFamily: T.mono,
                marginTop: 1,
              }}
            >
              {compassScore >= 0 ? "+" : ""}
              {compassScore} bias
            </div>
          </Card>
        </div>

        {/* ── ROW 2: Premium Tide + Ticker Flow Leaderboard ── */}
        <div
          style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 6 }}
        >
          {/* Premium Tide Chart */}
          <div
            style={{
              background: T.bg2,
              border: `1px solid ${T.border}`,
              borderRadius: dim(6),
              padding: sp("8px 10px"),
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 6,
              }}
            >
              <span
                style={{
                  fontSize: fs(10),
                  fontWeight: 700,
                  fontFamily: T.display,
                  color: T.textSec,
                }}
              >
                Premium Tide · Intraday
              </span>
              <div
                style={{
                  display: "flex",
                  gap: sp(8),
                  fontSize: fs(9),
                  fontFamily: T.mono,
                }}
              >
                <span style={{ color: T.green }}>
                  ■ Calls {fmtM(totalCallPrem)}
                </span>
                <span style={{ color: T.red }}>
                  ■ Puts {fmtM(totalPutPrem)}
                </span>
                <span style={{ color: T.accent, fontWeight: 700 }}>
                  Net {netPrem >= 0 ? "+" : ""}
                  {fmtM(Math.abs(netPrem))}
                </span>
              </div>
            </div>
            <div style={{ height: dim(200), width: "100%" }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={flowTide}>
                  <XAxis
                    dataKey="time"
                    tick={{ fontSize: fs(9), fill: T.textMuted }}
                  />
                  <YAxis
                    tick={{ fontSize: fs(9), fill: T.textMuted }}
                    tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`}
                  />
                  <Tooltip
                    contentStyle={{
                      background: T.bg4,
                      border: `1px solid ${T.border}`,
                      borderRadius: dim(6),
                      fontSize: fs(10),
                      fontFamily: T.mono,
                    }}
                    formatter={(v) =>
                      `${v >= 0 ? "+" : ""}$${(v / 1e6).toFixed(2)}M`
                    }
                  />
                  <ReferenceLine
                    y={0}
                    stroke={T.textMuted}
                    strokeDasharray="2 2"
                  />
                  <Area
                    type="monotone"
                    dataKey="cumNet"
                    stroke={T.accent}
                    strokeWidth={2}
                    fill={T.accent}
                    fillOpacity={0.4}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Ticker Flow Leaderboard with top contracts per ticker */}
          <Card style={{ padding: "8px 10px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 6,
              }}
            >
              <span
                style={{
                  fontSize: fs(10),
                  fontWeight: 700,
                  fontFamily: T.display,
                  color: T.textSec,
                }}
              >
                Top Tickers by Flow
              </span>
              <span
                style={{
                  fontSize: fs(8),
                  color: T.textDim,
                  fontFamily: T.mono,
                }}
              >
                Top 3 contracts · click to inspect
              </span>
            </div>
            {tickerFlow.map((t) => {
              const total = t.calls + t.puts;
              const net = t.calls - t.puts;
              const callPct = (t.calls / total) * 100;
              const barW = (total / maxTickerPrem) * 100;
              const topContracts = topContractsByTicker[t.sym] || [];
              return (
                <div
                  key={t.sym}
                  style={{
                    marginBottom: sp(6),
                    paddingBottom: sp(4),
                    borderBottom: `1px solid ${T.border}30`,
                  }}
                >
                  {/* Ticker row: symbol + net premium */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      fontSize: fs(9),
                      fontFamily: T.mono,
                      marginBottom: sp(1),
                    }}
                  >
                    <span style={{ fontWeight: 700, color: T.text }}>
                      {t.sym}
                    </span>
                    <span
                      style={{
                        color: net >= 0 ? T.green : T.red,
                        fontWeight: 600,
                      }}
                    >
                      {net >= 0 ? "+" : "-"}
                      {fmtM(Math.abs(net))}
                    </span>
                  </div>
                  {/* Call/put ratio bar */}
                  <div
                    style={{
                      display: "flex",
                      height: dim(8),
                      borderRadius: dim(2),
                      overflow: "hidden",
                      background: T.bg3,
                      width: `${barW}%`,
                      marginBottom: sp(3),
                    }}
                  >
                    <div
                      style={{
                        width: `${callPct}%`,
                        background: T.green,
                        height: "100%",
                      }}
                    />
                    <div
                      style={{ flex: 1, background: T.red, height: "100%" }}
                    />
                  </div>
                  {/* Top 3 contracts by volume */}
                  {topContracts.length > 0 && (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(3, 1fr)",
                        gap: sp(3),
                      }}
                    >
                      {topContracts.map((c, i) => {
                        const cpColor = c.cp === "C" ? T.green : T.red;
                        const volStr =
                          c.vol >= 1000
                            ? `${(c.vol / 1000).toFixed(1)}K`
                            : `${c.vol}`;
                        return (
                          <div
                            key={i}
                            onClick={() =>
                              setSelectedEvt((prev) =>
                                prev && prev.id === c.biggestEvt.id
                                  ? null
                                  : c.biggestEvt,
                              )
                            }
                            title={`${t.sym} ${c.strike}${c.cp} · ${c.count} event${c.count === 1 ? "" : "s"} · ${fmtM(c.premium)} premium · ${volStr} vol`}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: sp(4),
                              padding: sp("4px 6px"),
                              background: `${cpColor}08`,
                              border: `1px solid ${cpColor}30`,
                              borderLeft: `2px solid ${cpColor}`,
                              borderRadius: dim(2),
                              cursor: "pointer",
                              transition: "background 0.1s, transform 0.1s",
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = `${cpColor}16`;
                              e.currentTarget.style.transform =
                                "translateY(-1px)";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = `${cpColor}08`;
                              e.currentTarget.style.transform = "translateY(0)";
                            }}
                          >
                            <span
                              style={{
                                fontSize: fs(10),
                                fontWeight: 800,
                                fontFamily: T.mono,
                                color: cpColor,
                                lineHeight: 1,
                              }}
                            >
                              {c.cp}
                              {c.strike}
                            </span>
                            <div
                              style={{
                                flex: 1,
                                display: "flex",
                                justifyContent: "space-between",
                                fontSize: fs(8),
                                fontFamily: T.mono,
                                color: T.textDim,
                                lineHeight: 1,
                              }}
                            >
                              <span>{volStr}</span>
                              <span>{c.dte}d</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </Card>
        </div>

        {/* ── ROW 2B: Flow Analytics (Clock + Sector + DTE) ── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 6,
          }}
        >
          {/* Flow Clock */}
          <div
            style={{
              background: T.bg2,
              border: `1px solid ${T.border}`,
              borderRadius: dim(6),
              padding: "6px 10px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 4,
              }}
            >
              <span
                style={{
                  fontSize: fs(10),
                  fontWeight: 700,
                  fontFamily: T.display,
                  color: T.textSec,
                }}
              >
                Flow Clock
              </span>
              <span
                style={{
                  fontSize: fs(8),
                  color: T.textDim,
                  fontFamily: T.mono,
                }}
              >
                Activity by time
              </span>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                gap: sp(2),
                height: dim(72),
                padding: "0 2px",
              }}
            >
              {flowClock.map((bucket, i) => {
                const maxCount = Math.max(...flowClock.map((b) => b.count), 1);
                const heightPct = (bucket.count / maxCount) * 100;
                const color =
                  bucket.prem > 1500000
                    ? T.amber
                    : bucket.prem > 1000000
                      ? T.accent
                      : T.textDim;
                return (
                  <div
                    key={i}
                    style={{
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "flex-end",
                      height: "100%",
                    }}
                  >
                    <div
                      style={{
                        height: `${heightPct}%`,
                        background: color,
                        borderRadius: "2px 2px 0 0",
                        minHeight: 2,
                        opacity: 0.85,
                      }}
                    />
                  </div>
                );
              })}
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: fs(7),
                color: T.textMuted,
                fontFamily: T.mono,
                marginTop: sp(2),
                padding: "0 2px",
              }}
            >
              <span>9:30</span>
              <span>12:00</span>
              <span>16:00</span>
            </div>
            <div
              style={{
                marginTop: sp(2),
                padding: sp("3px 6px"),
                background: T.bg3,
                borderRadius: dim(3),
                fontSize: fs(8),
                fontFamily: T.mono,
                color: T.textDim,
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span>
                Peak:{" "}
                <span style={{ color: T.amber, fontWeight: 600 }}>
                  {flowClockPeak}
                </span>
              </span>
              <span>
                Avg:{" "}
                <span style={{ color: T.textSec, fontWeight: 600 }}>
                  {flowClockAverage} / 30min
                </span>
              </span>
            </div>
          </div>

          {/* Order Flow Distribution — moved from Market tab where it was cramped */}
          <div
            style={{
              background: T.bg2,
              border: `1px solid ${T.border}`,
              borderRadius: dim(6),
              padding: "6px 10px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 4,
              }}
            >
              <span
                style={{
                  fontSize: fs(10),
                  fontWeight: 700,
                  fontFamily: T.display,
                  color: T.textSec,
                }}
              >
                Order Flow
              </span>
              <span
                style={{
                  fontSize: fs(8),
                  color: T.textDim,
                  fontFamily: T.mono,
                }}
              >
                $M · by trade size
              </span>
            </div>
            {(() => {
              const buy =
                marketOrderFlow.buyXL +
                marketOrderFlow.buyL +
                marketOrderFlow.buyM +
                marketOrderFlow.buyS;
              const sell =
                marketOrderFlow.sellXL +
                marketOrderFlow.sellL +
                marketOrderFlow.sellM +
                marketOrderFlow.sellS;
              const buyPct = (buy / (buy + sell)) * 100;
              const max = Math.max(
                marketOrderFlow.buyXL,
                marketOrderFlow.buyL,
                marketOrderFlow.buyM,
                marketOrderFlow.buyS,
                marketOrderFlow.sellXL,
                marketOrderFlow.sellL,
                marketOrderFlow.sellM,
                marketOrderFlow.sellS,
                1,
              );
              return (
                <>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: sp(8),
                      marginBottom: sp(2),
                    }}
                  >
                    <OrderFlowDonut
                      flow={marketOrderFlow}
                      size={dim(64)}
                      thickness={dim(10)}
                    />
                    <div
                      style={{
                        flex: 1,
                        display: "flex",
                        flexDirection: "column",
                        gap: sp(2),
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontFamily: T.mono,
                          fontSize: fs(10),
                        }}
                      >
                        <span style={{ color: T.green, fontWeight: 700 }}>
                          ${buy.toFixed(0)}M
                        </span>
                        <span style={{ color: T.red, fontWeight: 700 }}>
                          ${sell.toFixed(0)}M
                        </span>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          height: dim(4),
                          borderRadius: dim(2),
                          overflow: "hidden",
                          background: T.bg3,
                        }}
                      >
                        <div
                          style={{
                            width: `${buyPct}%`,
                            background: T.green,
                            opacity: 0.85,
                          }}
                        />
                        <div
                          style={{
                            width: `${100 - buyPct}%`,
                            background: T.red,
                            opacity: 0.85,
                          }}
                        />
                      </div>
                      <div
                        style={{
                          fontSize: fs(8),
                          color: T.textDim,
                          fontFamily: T.mono,
                        }}
                      >
                        {buyPct.toFixed(1)}% buy ·{" "}
                        <span
                          style={{
                            color: buy >= sell ? T.green : T.red,
                            fontWeight: 600,
                          }}
                        >
                          {buy >= sell ? "BULLISH" : "BEARISH"}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div
                    style={{
                      borderTop: `1px solid ${T.border}`,
                      paddingTop: sp(2),
                    }}
                  >
                    <SizeBucketRow
                      label="XL"
                      buy={marketOrderFlow.buyXL}
                      sell={marketOrderFlow.sellXL}
                      maxValue={max}
                    />
                    <SizeBucketRow
                      label="L"
                      buy={marketOrderFlow.buyL}
                      sell={marketOrderFlow.sellL}
                      maxValue={max}
                    />
                    <SizeBucketRow
                      label="M"
                      buy={marketOrderFlow.buyM}
                      sell={marketOrderFlow.sellM}
                      maxValue={max}
                    />
                    <SizeBucketRow
                      label="S"
                      buy={marketOrderFlow.buyS}
                      sell={marketOrderFlow.sellS}
                      maxValue={max}
                    />
                  </div>
                </>
              );
            })()}
          </div>

          {/* DTE Buckets */}
          <div
            style={{
              background: T.bg2,
              border: `1px solid ${T.border}`,
              borderRadius: dim(6),
              padding: "6px 10px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 4,
              }}
            >
              <span
                style={{
                  fontSize: fs(10),
                  fontWeight: 700,
                  fontFamily: T.display,
                  color: T.textSec,
                }}
              >
                Expiration Buckets
              </span>
              <span
                style={{
                  fontSize: fs(8),
                  color: T.textDim,
                  fontFamily: T.mono,
                }}
              >
                C vs P premium
              </span>
            </div>
            <div>
              {dteBuckets.map((b, i) => {
                const total = b.calls + b.puts;
                const callPct = (b.calls / total) * 100;
                const maxTotal = Math.max(
                  1,
                  ...dteBuckets.map((x) => x.calls + x.puts),
                );
                const barWidth = (total / maxTotal) * 100;
                return (
                  <div key={i} style={{ marginBottom: 2 }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: fs(8),
                        fontFamily: T.mono,
                        marginBottom: 1,
                      }}
                    >
                      <span style={{ color: T.textSec, fontWeight: 600 }}>
                        {b.bucket === "0DTE" && (
                          <span style={{ color: T.amber, marginRight: 3 }}>
                            ⚡
                          </span>
                        )}
                        {b.bucket}
                      </span>
                      <span style={{ color: T.textDim }}>
                        {b.count} events · {fmtM(total)}
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        height: dim(7),
                        borderRadius: dim(2),
                        overflow: "hidden",
                        background: T.bg3,
                        width: `${barWidth}%`,
                      }}
                    >
                      <div
                        style={{
                          width: `${callPct}%`,
                          background: T.green,
                          opacity: 0.85,
                        }}
                      />
                      <div
                        style={{ flex: 1, background: T.red, opacity: 0.85 }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── ROW 2C: Top Activity Spotlight (hidden when contract detail is up) ── */}
        {!selectedEvt && (
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: sp(6),
                marginBottom: sp(4),
                padding: "0 2px",
              }}
            >
              <span
                style={{
                  fontSize: fs(10),
                  fontWeight: 700,
                  fontFamily: T.display,
                  color: T.textSec,
                  letterSpacing: "0.02em",
                }}
              >
                Top Activity Today
              </span>
              <div style={{ flex: 1, height: dim(1), background: T.border }} />
              <span
                style={{
                  fontSize: fs(8),
                  color: T.textDim,
                  fontFamily: T.mono,
                }}
              >
                sorted by premium
              </span>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: 6,
              }}
            >
              {[...flowEvents]
                .sort((a, b) => b.premium - a.premium)
                .slice(0, 4)
                .map((evt) => {
                  const sideColor =
                    evt.side === "BUY"
                      ? T.green
                      : evt.side === "SELL"
                        ? T.red
                        : T.textDim;
                  const cpColor = evt.cp === "C" ? T.green : T.red;
                  const typeColor =
                    evt.type === "SWEEP"
                      ? T.amber
                      : evt.type === "BLOCK"
                        ? T.accent
                        : T.purple;
                  const scoreColor =
                    evt.score >= 80
                      ? T.amber
                      : evt.score >= 60
                        ? T.green
                        : T.textDim;
                  const context =
                    evt.basis === "snapshot"
                      ? "Snapshot-derived option activity"
                      : evt.golden
                        ? "Golden sweep · High conviction"
                        : evt.type === "BLOCK"
                      ? "Institutional block · Off-exchange"
                      : evt.type === "SWEEP"
                        ? "Aggressive multi-exchange sweep"
                        : evt.type === "SPLIT"
                          ? "Split fill · Multiple prices"
                          : "Multi-leg strategy";
                  return (
                    <div
                      key={evt.id}
                      onClick={() =>
                        setSelectedEvt((prev) =>
                          prev && prev.id === evt.id ? null : evt,
                        )
                      }
                      style={{
                        background: T.bg2,
                        border: `1px solid ${evt.golden ? T.amber : T.border}`,
                        borderRadius: dim(6),
                        padding: sp("6px 10px"),
                        borderLeft: `3px solid ${evt.golden ? T.amber : cpColor}`,
                        position: "relative",
                        cursor: "pointer",
                        transition: "transform 0.1s, box-shadow 0.1s",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = "translateY(-1px)";
                        e.currentTarget.style.boxShadow = `0 4px 12px ${T.bg0}80`;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = "translateY(0)";
                        e.currentTarget.style.boxShadow = "none";
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                          marginBottom: 3,
                        }}
                      >
                        <div>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 4,
                            }}
                          >
                            {evt.golden && (
                              <span
                                style={{ color: T.amber, fontSize: fs(11) }}
                              >
                                ★
                              </span>
                            )}
                            <span
                              style={{
                                fontSize: fs(14),
                                fontWeight: 800,
                                fontFamily: T.mono,
                                color: T.text,
                              }}
                            >
                              {evt.ticker}
                            </span>
                            <span
                              style={{
                                fontSize: fs(11),
                                fontWeight: 700,
                                fontFamily: T.mono,
                                color: cpColor,
                              }}
                            >
                              {evt.cp}
                              {evt.strike}
                            </span>
                          </div>
                          <div
                            style={{
                              fontSize: fs(8),
                              color: T.textDim,
                              fontFamily: T.mono,
                              marginTop: 1,
                            }}
                          >
                            exp {evt.dte}d · IV{" "}
                            {isFiniteNumber(evt.iv)
                              ? `${(evt.iv * 100).toFixed(1)}%`
                              : MISSING_VALUE}
                          </div>
                        </div>
                        <Badge color={scoreColor}>{evt.score}</Badge>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: sp(4),
                          marginBottom: 3,
                          flexWrap: "wrap",
                        }}
                      >
                        <span
                          style={{
                            fontSize: fs(18),
                            fontWeight: 800,
                            fontFamily: T.mono,
                            color: evt.premium > 400000 ? T.amber : T.text,
                          }}
                        >
                          {evt.premium >= 1e6
                            ? `$${(evt.premium / 1e6).toFixed(2)}M`
                            : `$${(evt.premium / 1e3).toFixed(0)}K`}
                        </span>
                        <Badge color={sideColor}>{evt.side}</Badge>
                        <Badge color={typeColor}>{evt.type}</Badge>
                        <Badge color={flowProviderColor(evt.provider)}>
                          {evt.sourceLabel}
                        </Badge>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: fs(7),
                          color: T.textDim,
                          fontFamily: T.mono,
                          paddingTop: sp(3),
                          borderTop: `1px solid ${T.border}08`,
                        }}
                      >
                        <span>{evt.time} ET</span>
                        <span>
                          Vol {fmtCompactNumber(evt.vol)} / OI{" "}
                          {fmtCompactNumber(evt.oi)}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: fs(7),
                          color: T.textMuted,
                          fontFamily: T.sans,
                          fontStyle: "italic",
                          marginTop: 2,
                        }}
                      >
                        {context}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* ── ROW 3a: Saved Scans bar (only renders if user has saved any) ── */}
        {savedScans.length > 0 && (
          <div
            style={{
              display: "flex",
              gap: sp(4),
              alignItems: "center",
              flexWrap: "wrap",
              padding: "2px 0",
            }}
          >
            <span
              style={{
                fontSize: fs(8),
                fontWeight: 700,
                color: T.textMuted,
                letterSpacing: "0.08em",
                marginRight: 2,
              }}
            >
              SAVED
            </span>
            {savedScans.map((scan) => (
              <div
                key={scan.id}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: sp(3),
                  padding: sp("3px 6px 3px 8px"),
                  borderRadius: 0,
                  background:
                    activeScanId === scan.id ? `${T.accent}20` : T.bg2,
                  border: `1px solid ${activeScanId === scan.id ? T.accent : T.border}`,
                  cursor: "pointer",
                  transition:
                    "background 0.12s ease, border-color 0.12s ease, transform 0.12s ease",
                }}
                onClick={() => loadScan(scan)}
                onMouseEnter={(event) => {
                  if (activeScanId !== scan.id) {
                    event.currentTarget.style.background = T.bg3;
                    event.currentTarget.style.borderColor = T.textMuted;
                  }
                  event.currentTarget.style.transform = "translateY(-1px)";
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.background =
                    activeScanId === scan.id ? `${T.accent}20` : T.bg2;
                  event.currentTarget.style.borderColor =
                    activeScanId === scan.id ? T.accent : T.border;
                  event.currentTarget.style.transform = "translateY(0)";
                }}
                title={`${scan.name} · ${scan.filter} · min ${scan.minPrem} · sort ${scan.sortBy}`}
              >
                <span
                  style={{
                    fontSize: fs(9),
                    fontWeight: 600,
                    color: activeScanId === scan.id ? T.accent : T.textSec,
                    fontFamily: T.sans,
                  }}
                >
                  {scan.name}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteScan(scan.id);
                  }}
                  title="Delete scan"
                  style={{
                    background: "transparent",
                    border: "none",
                    color: T.textMuted,
                    cursor: "pointer",
                    fontSize: fs(11),
                    padding: 0,
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              </div>
            ))}
            <span style={{ flex: 1 }} />
            <span
              style={{ fontSize: fs(8), color: T.textDim, fontFamily: T.mono }}
            >
              {savedScans.length} of 8
            </span>
          </div>
        )}

        {/* ── ROW 3: Filter Bar ── */}
        <div
          style={{
            display: "flex",
            gap: sp(4),
            alignItems: "center",
            flexWrap: "wrap",
            padding: "2px 0",
          }}
        >
          <span
            style={{
              fontSize: fs(7),
              fontWeight: 600,
              color: T.textDim,
              letterSpacing: "0.06em",
              fontVariant: "all-small-caps",
            }}
          >
            Type
          </span>
          {[
            ["all", "All"],
            ["calls", "Calls"],
            ["puts", "Puts"],
            ["golden", "★ Golden"],
            ["sweep", "Sweep"],
            ["block", "Block"],
            ["cluster", "🔁 Cluster"],
          ].map(([k, l]) => (
            <Pill
              key={k}
              active={filter === k}
              onClick={() => {
                setFilter(k);
                setActiveScanId(null);
              }}
              color={
                k === "golden" ? T.amber : k === "cluster" ? T.cyan : undefined
              }
            >
              {l}
            </Pill>
          ))}
          <div
            style={{
              width: dim(1),
              height: dim(16),
              background: T.border,
              margin: "0 2px",
            }}
          />
          <span
            style={{
              fontSize: fs(7),
              fontWeight: 600,
              color: T.textDim,
              letterSpacing: "0.06em",
              fontVariant: "all-small-caps",
            }}
          >
            Min $
          </span>
          {[
            [0, "All"],
            [50000, "$50K"],
            [100000, "$100K"],
            [250000, "$250K"],
          ].map(([v, l]) => (
            <Pill
              key={v}
              active={minPrem === v}
              onClick={() => {
                setMinPrem(v);
                setActiveScanId(null);
              }}
            >
              {l}
            </Pill>
          ))}
          <div
            style={{
              width: dim(1),
              height: dim(16),
              background: T.border,
              margin: "0 2px",
            }}
          />
          <span
            style={{
              fontSize: fs(7),
              fontWeight: 600,
              color: T.textDim,
              letterSpacing: "0.06em",
              fontVariant: "all-small-caps",
            }}
          >
            Sort
          </span>
          {[
            ["time", "Time"],
            ["premium", "Premium"],
            ["score", "Score"],
          ].map(([k, l]) => (
            <Pill
              key={k}
              active={sortBy === k}
              onClick={() => {
                setSortBy(k);
                setActiveScanId(null);
              }}
            >
              {l}
            </Pill>
          ))}
          <div
            style={{
              width: dim(1),
              height: dim(16),
              background: T.border,
              margin: "0 2px",
            }}
          />
          <button
            onClick={saveCurrentScan}
            title="Save current filter as a named scan"
            style={{
              padding: sp("3px 7px"),
              fontSize: fs(10),
              fontWeight: 600,
              fontFamily: T.sans,
              background: "transparent",
              color: T.accent,
              border: `1px solid ${T.accent}`,
              borderRadius: 0,
              cursor: "pointer",
              transition: "background 0.12s ease, color 0.12s ease",
            }}
            onMouseEnter={(event) => {
              event.currentTarget.style.background = `${T.accent}14`;
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.background = "transparent";
            }}
          >
            + Save
          </button>
          <span style={{ flex: 1 }} />
          <span
            style={{ fontSize: fs(9), color: T.textDim, fontFamily: T.mono }}
          >
            {filtered.length} / {flowEvents.length}
          </span>
        </div>

        {/* ── ROW 4: Flow Tape (default) or Contract Detail (when a contract is selected) ── */}
        {selectedEvt ? (
          <ContractDetailInline
            evt={selectedEvt}
            onBack={() => setSelectedEvt(null)}
            onJumpToTrade={(evt) => {
              setSelectedEvt(null);
              onJumpToTrade && onJumpToTrade(evt);
            }}
          />
        ) : (
          <Card
            noPad
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              minHeight: 300,
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "48px 40px 40px 60px 130px 52px 72px 56px 56px 48px 52px 42px",
                padding: sp("6px 10px"),
                fontSize: fs(8),
                fontWeight: 700,
                color: T.textMuted,
                letterSpacing: "0.08em",
                borderBottom: `1px solid ${T.border}`,
                gap: sp(3),
                flexShrink: 0,
              }}
            >
              <span>TIME</span>
              <span>SIDE</span>
              <span>TYPE</span>
              <span>TICK</span>
              <span>CONTRACT</span>
              <span style={{ textAlign: "right" }}>DTE</span>
              <span style={{ textAlign: "right" }}>PREMIUM</span>
              <span style={{ textAlign: "right" }}>VOL</span>
              <span style={{ textAlign: "right" }}>OI</span>
              <span style={{ textAlign: "right" }}>V/OI</span>
              <span style={{ textAlign: "right" }}>IV</span>
              <span style={{ textAlign: "center" }}>SCORE</span>
            </div>

            <div style={{ flex: 1, overflowY: "auto" }}>
              {filtered.map((evt) => {
                const sideColor =
                  evt.side === "BUY"
                    ? T.green
                    : evt.side === "SELL"
                      ? T.red
                      : T.textDim;
                const cpColor = evt.cp === "C" ? T.green : T.red;
                const premStr =
                  evt.premium >= 1e6
                    ? `$${(evt.premium / 1e6).toFixed(2)}M`
                    : `$${(evt.premium / 1e3).toFixed(0)}K`;
                const voi =
                  isFiniteNumber(evt.vol) && isFiniteNumber(evt.oi) && evt.oi > 0
                    ? evt.vol / evt.oi
                    : null;
                const scoreColor =
                  evt.score >= 80
                    ? T.amber
                    : evt.score >= 60
                      ? T.green
                      : T.textDim;
                const typeColor =
                  evt.type === "SWEEP"
                    ? T.amber
                    : evt.type === "BLOCK"
                      ? T.accent
                      : T.purple;
                return (
                  <div
                    key={evt.id}
                    onClick={() =>
                      setSelectedEvt((prev) =>
                        prev && prev.id === evt.id ? null : evt,
                      )
                    }
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "48px 40px 40px 60px 130px 52px 72px 56px 56px 48px 52px 42px",
                      padding: sp("5px 10px"),
                      fontSize: fs(10),
                      fontFamily: T.mono,
                      gap: sp(3),
                      alignItems: "center",
                      borderBottom: `1px solid ${T.border}08`,
                      background: evt.golden ? `${T.amber}10` : "transparent",
                      borderLeft: evt.golden
                        ? `2px solid ${T.amber}`
                        : "2px solid transparent",
                      cursor: "pointer",
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = evt.golden
                        ? `${T.amber}18`
                        : T.bg3)
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = evt.golden
                        ? `${T.amber}10`
                        : "transparent")
                    }
                  >
                    <span style={{ color: T.textDim }}>{evt.time}</span>
                    <Badge color={sideColor}>{evt.side}</Badge>
                    <Badge color={typeColor}>{evt.type}</Badge>
                    <span
                      style={{
                        fontWeight: 700,
                        color: T.text,
                        display: "flex",
                        alignItems: "center",
                        gap: 3,
                      }}
                    >
                      {evt.golden && (
                        <span style={{ color: T.amber, fontSize: fs(10) }}>
                          ★
                        </span>
                      )}
                      {evt.ticker}
                    </span>
                    <span
                      style={{
                        color: T.textSec,
                        display: "flex",
                        alignItems: "center",
                        gap: sp(3),
                      }}
                    >
                      <span
                        style={{
                          color: cpColor,
                          fontWeight: 600,
                          marginRight: 2,
                        }}
                      >
                        {evt.cp}
                      </span>
                      {evt.strike}{" "}
                      <span style={{ color: T.textDim }}>
                        {formatExpirationLabel(evt.expirationDate)}
                      </span>
                      {(() => {
                        const c = clusterFor(evt);
                        if (!c) return null;
                        return (
                          <span
                            title={`${c.count} events on this contract today · total $${(c.totalPrem / 1e6).toFixed(2)}M`}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 1,
                              padding: sp("0px 4px"),
                              borderRadius: dim(2),
                              background: `${T.cyan}20`,
                              border: `1px solid ${T.cyan}50`,
                              color: T.cyan,
                              fontWeight: 700,
                              fontSize: fs(8),
                              fontFamily: T.mono,
                              marginLeft: sp(2),
                            }}
                          >
                            🔁 {c.count}×
                          </span>
                        );
                      })()}
                      <Badge color={flowProviderColor(evt.provider)}>
                        {evt.sourceLabel}
                      </Badge>
                    </span>
                    <span style={{ textAlign: "right", color: T.textDim }}>
                      {evt.dte}d
                    </span>
                    <span
                      style={{
                        textAlign: "right",
                        fontWeight: 700,
                        color:
                          evt.premium > 250000
                            ? T.amber
                            : evt.premium > 100000
                              ? T.text
                              : T.textSec,
                      }}
                    >
                      {premStr}
                    </span>
                    <span style={{ textAlign: "right", color: T.textSec }}>
                      {fmtCompactNumber(evt.vol)}
                    </span>
                    <span style={{ textAlign: "right", color: T.textDim }}>
                      {fmtCompactNumber(evt.oi)}
                    </span>
                    <span
                      style={{
                        textAlign: "right",
                        color: isFiniteNumber(voi) && voi > 1 ? T.amber : T.textDim,
                        fontWeight: isFiniteNumber(voi) && voi > 1 ? 600 : 400,
                      }}
                    >
                      {isFiniteNumber(voi) ? voi.toFixed(2) : MISSING_VALUE}
                    </span>
                    <span style={{ textAlign: "right", color: T.textDim }}>
                      {isFiniteNumber(evt.iv)
                        ? `${(evt.iv * 100).toFixed(1)}%`
                        : MISSING_VALUE}
                    </span>
                    <span style={{ textAlign: "center" }}>
                      <Badge color={scoreColor}>{evt.score}</Badge>
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
};

export default FlowScreen;
