import { memo, useMemo } from "react";

import { SurfacePanel } from "../../components/platform/primitives.jsx";
import {
  CSS_COLOR,
  FONT_WEIGHTS,
  RADII,
  T,
  cssColorAlpha,
  cssColorMix,
  dim,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import { motionVars } from "../../lib/motion.jsx";
import { MACHINE_STATE_GROUPS } from "./machineStateDiagramModel.js";

// Funnel layout (see MACHINE_STATE_WIRING.md): sources at the top corners,
// process lanes running left to right through the middle, signals/algo before
// account/trading, and observability on a separate right-side rail. Cards fit
// to their content width (capped by `w`); Client is intentionally not a card.
// Top-down flow: data descends through stacked layers (sources → market data →
// signals/algo → account/execution). Observability is a right-side rail beside
// the flow, since it observes every layer rather than sitting in the pipeline.
const GROUP_XY = Object.freeze({
  broker: { x: 120, y: 20, w: 200 },
  massive: { x: 350, y: 20, w: 188 },
  // Market Data is one wide card rendered as a realtime/historical x
  // equities/options provider table (Trade Chain folded in). It distributes to
  // signals / flow / gex on the next layer.
  market: { x: 160, y: 132, w: 300 },
  signals: { x: 30, y: 274, w: 165 },
  flow: { x: 235, y: 274, w: 165 },
  gex: { x: 444, y: 274, w: 150 },
  // Algo owns trade management (Trade Mgmt is merged into this card at render).
  algo: { x: 196, y: 388, w: 230 },
  account: { x: 206, y: 496, w: 210 },
  diagnostics: { x: 716, y: 48, w: 230 },
  // Persistence sink in the observability rail, below the Client rail (ends
  // y≈386) and within the observability band (bottom y≈620). Right edge aligns
  // with the Diagnostics card. Every card persists into it as a tight bus
  // (deliberate rail-edge exception — see buildDatabaseHighway / MACHINE_STATE_WIRING.md).
  database: { x: 716, y: 408, w: 230 },
});

// Market Data card renders a fixed-height 2x2 provider table, not bubble rows.
const MARKET_TABLE_HEIGHT = 110;

const CLIENT_RAIL_RECT = Object.freeze({ x: 722, y: 230, width: 224, height: 156 });
const CLIENT_ALERT_RECT = Object.freeze({
  x: CLIENT_RAIL_RECT.x - 18,
  y: CLIENT_RAIL_RECT.y + 26,
  width: 1,
  height: CLIENT_RAIL_RECT.height - 38,
});
const DIAGRAM_MIN_WIDTH = 1180;

// Dashed background bands grouping each funnel stage. The observability rail is
// drawn beside the machine so diagnostics/client telemetry does not read as a
// normal downstream pipeline stage.
const LANE_BANDS = Object.freeze([
  { id: "sources", label: "1 · SOURCES & DISTRIBUTION", x: 12, y: 2, w: 672, h: 106 },
  { id: "process", label: "2 · MARKET DATA", x: 12, y: 116, w: 672, h: 134 },
  { id: "signals", label: "3 · SIGNALS · FLOW · GEX → ALGO", x: 12, y: 258, w: 672, h: 222 },
  { id: "trading", label: "4 · ACCOUNT", x: 12, y: 488, w: 672, h: 132 },
  { id: "observability", label: "OBSERVABILITY & CLIENTS", x: 700, y: 2, w: 256, h: 618 },
]);

const TITLE_BAND = 24;
const FOOTER_BAND = 30;
const BUBBLE_ROW_HEIGHT = 15;
// In-SVG font sizes are raw viewBox units, intentionally NOT fs()/textSize():
// the user scale preference already applies to the rendered SVG width, so
// fs() would double-scale. Values snap to the TYPOGRAPHY_SIZES ramp
// (bodyStrong 11 / body 10 / caption 9) and stay readable at the minimum
// rendered width.
const CARD_TITLE_SIZE = 14;
const BUBBLE_LABEL_SIZE = 12;
const CARD_DETAIL_SIZE = 11;
const EDGE_LABEL_SIZE = 12;

// Proportional sans renders ~0.55em per glyph; titles run bolder so they need a
// touch more. These factors back the max-chars math for truncation/wrapping so
// the in-card text stays font-size-correct when the size constants change.
// Sit just under cardContentWidth's sizing factors (title 0.6, label/child 0.55)
// so any text the card was sized to hold renders in full instead of clipping a
// trailing character.
const TITLE_CHAR_EM = 0.58;
const LABEL_CHAR_EM = 0.54;
const DETAIL_CHAR_EM = 0.53;
const charsForWidth = (width, fontSize, em) =>
  Math.max(6, Math.floor(width / (fontSize * em)));

const cardHeight = (childCount) =>
  childCount <= 1
    ? TITLE_BAND + FOOTER_BAND + 6
    : TITLE_BAND + childCount * BUBBLE_ROW_HEIGHT + 4 + FOOTER_BAND;

// Approx rendered text width (proportional sans ~0.55em; titles run bolder).
const textWidth = (text, fontSize, factor = 0.55) =>
  String(text || "").length * fontSize * factor;

// Fit each card to its content: the widest of its title, its child rows
// (icon + label + optional right-aligned metric), capped by the lane slot so
// neighbours never overlap, floored so tiny cards stay legible.
const cardContentWidth = (group, maxWidth) => {
  const titleW = 14 + textWidth(group.label, CARD_TITLE_SIZE, 0.6) + 16;
  const childW = group.children.reduce((widest, child) => {
    const metricW = child.metric ? textWidth(child.metric, BUBBLE_LABEL_SIZE) + 14 : 0;
    const rowW = 26 + textWidth(child.label, BUBBLE_LABEL_SIZE) + metricW + 14;
    return Math.max(widest, rowW);
  }, 0);
  return Math.round(
    Math.max(120, Math.min(maxWidth, Math.max(titleW, childW))),
  );
};

const buildRects = (masters) => {
  const byId = new Map(masters.map((master) => [master.id, master]));
  const rects = {};
  for (const [id, slot] of Object.entries(GROUP_XY)) {
    const master = byId.get(id);
    if (!master) continue;
    if (id === "market") {
      // Market Data is a fixed-height provider table, not a content-fit card.
      rects[id] = {
        x: slot.x,
        y: slot.y,
        width: slot.w,
        height: MARKET_TABLE_HEIGHT,
      };
      continue;
    }
    rects[id] = {
      x: slot.x,
      y: slot.y,
      width: cardContentWidth(master, slot.w),
      height: cardHeight(master.children.length),
    };
  }
  return rects;
};

const VIEWBOX = {
  width:
    Math.max(
      ...Object.values(GROUP_XY).map((slot) => slot.x + slot.w),
      ...LANE_BANDS.map((band) => band.x + band.w),
      CLIENT_RAIL_RECT.x + CLIENT_RAIL_RECT.width,
    ) + 20,
  height:
    Math.max(
      ...MACHINE_STATE_GROUPS.filter((group) => GROUP_XY[group.id]).map(
        (group) =>
          GROUP_XY[group.id].y +
          (group.id === "market"
            ? MARKET_TABLE_HEIGHT
            : cardHeight(group.children.length)),
      ),
      ...LANE_BANDS.map((band) => band.y + band.h),
      CLIENT_RAIL_RECT.y + CLIENT_RAIL_RECT.height,
    ) + 14,
};

const STATUS_META = Object.freeze({
  healthy: {
    label: "Healthy",
    tone: CSS_COLOR.green,
    fill: CSS_COLOR.greenBg,
  },
  checking: {
    label: "Checking",
    tone: CSS_COLOR.blue,
    fill: CSS_COLOR.accentHoverBg,
  },
  degraded: {
    label: "Degraded",
    tone: CSS_COLOR.amber,
    fill: CSS_COLOR.amberBg,
  },
  down: {
    label: "Down",
    tone: CSS_COLOR.red,
    fill: CSS_COLOR.redBg,
  },
  idle: {
    label: "Idle",
    tone: CSS_COLOR.cyan,
    fill: CSS_COLOR.bg2,
  },
  unknown: {
    label: "Unknown",
    tone: CSS_COLOR.textMuted,
    fill: CSS_COLOR.bg2,
  },
});

// Single-char status glyphs from the wiring walkthrough, colored by
// STATUS_META. Anything unmapped falls back to "?".
const STATUS_GLYPH = Object.freeze({
  healthy: "✓",
  checking: "◌",
  degraded: "!",
  down: "✕",
  idle: "–",
  unknown: "?",
});

const LEGEND_STATUSES = ["healthy", "checking", "degraded", "down", "idle", "unknown"];
const LEGEND_EVIDENCE = ["observed", "inferred", "unknown"];

const ATTENTION_STATUSES = new Set(["checking", "degraded", "down"]);
// Hand-authored top-down flow (the diagram is a visual architecture view, not a
// 1:1 trace of backend edges): sources feed Market Data, which fans out to the
// three analysis lanes, all converging on Algo (which owns trade management),
// which acts on the Account. Edge status = worst of its two endpoint cards.
//
// `transports` = the means by which data moves along the edge. Each entry draws
// its OWN parallel line with a dot whose tooltip names the means; a `fresh:
// false` entry is a delayed/historical path (rendered dashed) so a realtime line
// and a delayed line read as DISTINCT sources, never duplicated/merged. The
// means are derived from the model's verified edge graph (machineStateDiagram-
// Model.js ~L1490) and the Market Data provider table; pending backend audit.
const VISUAL_FLOW_EDGES = Object.freeze([
  {
    from: "broker",
    to: "market",
    label: "quotes / chains",
    transports: [
      { means: "IBKR live quotes", detail: "TWS → IBKR bridge, SSE stream", fresh: true },
      { means: "IBKR chains/snapshots", detail: "IBKR bridge REST", fresh: true },
    ],
  },
  {
    from: "massive",
    to: "market",
    label: "equities + options",
    transports: [
      { means: "Massive realtime equities", detail: "Massive WebSocket", fresh: true },
      { means: "Massive historical", detail: "Massive REST, on-demand", fresh: false },
    ],
  },
  // Market Data fans out per source column: Equities (col 0) feeds Signals;
  // Options (col 1) feeds Flow and GEX. portBias spreads the two Options edges
  // apart so they leave from within the Options column rather than overlapping.
  {
    from: "market",
    to: "signals",
    label: "bars / quotes",
    fromCol: 0,
    portBias: 0,
    transports: [{ means: "In-process", detail: "bars/quotes via signal worker state", fresh: true }],
  },
  {
    from: "market",
    to: "flow",
    label: "chains",
    fromCol: 1,
    portBias: -0.24,
    transports: [
      { means: "IBKR realtime", detail: "TWS → bridge, live chains/quotes", fresh: true },
      { means: "Massive ≥15m delayed", detail: "Massive REST spot fallback", fresh: false },
    ],
  },
  {
    from: "market",
    to: "gex",
    label: "option chains",
    fromCol: 1,
    portBias: 0.24,
    transports: [{ means: "IBKR realtime", detail: "option chains via bridge", fresh: true }],
  },
  {
    from: "algo",
    to: "account",
    label: "orders / exits",
    transports: [
      { means: "IBKR order submit", detail: "IBKR bridge REST", fresh: true },
      { means: "IBKR fills/status", detail: "order stream, broker SSE", fresh: true },
    ],
  },
]);

// Lateral gap between parallel transport lines, and the transport dot radius.
const TRANSPORT_LINE_GAP = 7;
const TRANSPORT_DOT_R = 3.2;

const STATUS_SEVERITY = { down: 5, degraded: 4, checking: 3, unknown: 2, idle: 1, healthy: 0 };
const worstStatus = (a, b) =>
  (STATUS_SEVERITY[a] ?? 2) >= (STATUS_SEVERITY[b] ?? 2) ? a : b;

// Trade Mgmt renders inside the Algo card. Merge the two model masters into one
// display card (combined children + worst-of status); the model groups/edges are
// untouched so node telemetry and the wiring contract are unchanged.
const mergeAlgoExecution = (masters) => {
  const algo = masters.find((master) => master.id === "algo");
  const tradeMgmt = masters.find((master) => master.id === "trade-mgmt");
  if (!algo || !tradeMgmt) return masters;
  const mergedAlgo = {
    ...algo,
    children: [...algo.children, ...tradeMgmt.children],
    status: worstStatus(algo.status, tradeMgmt.status),
    stale: Boolean(algo.stale || tradeMgmt.stale),
  };
  return masters
    .filter((master) => master.id !== "trade-mgmt")
    .map((master) => (master.id === "algo" ? mergedAlgo : master));
};
const CLIENT_RAIL_SECTIONS = Object.freeze([
  {
    label: "API Boundary",
    childIds: Object.freeze(["api-runtime", "route-admission", "client-transport"]),
  },
  {
    label: "Browser Signals",
    childIds: Object.freeze(["browser-events", "browser-memory"]),
  },
]);

const statusMeta = (status) => STATUS_META[status] || STATUS_META.unknown;

const centerOf = (rect) => ({
  x: rect.x + rect.width / 2,
  y: rect.y + rect.height / 2,
});

// Pick the bottom/top exit port nearest the target: edges leaving toward a
// far-left/right target exit near the matching card corner.
const exitX = (fromRect, targetX) => {
  const center = fromRect.x + fromRect.width / 2;
  if (Math.abs(targetX - center) < 60) return center;
  return targetX < center ? fromRect.x + 24 : fromRect.x + fromRect.width - 24;
};

// Market Data table geometry (shared with MarketDataCard) so downstream edges
// can leave from the actual source column instead of a target-biased port.
const MARKET_PAD_X = 12;
const MARKET_LABEL_COL_W = 60;
// Absolute X of a Market Data column center (col 0 = Equities, 1 = Options),
// offset by `bias` as a fraction of column width to spread sibling edges.
const marketColumnPortX = (rect, col, bias = 0) => {
  const gridLeft = MARKET_PAD_X + MARKET_LABEL_COL_W;
  const gridRight = rect.width - MARKET_PAD_X;
  const colW = (gridRight - gridLeft) / 2;
  return rect.x + gridLeft + col * colW + colW / 2 + bias * colW;
};

// Orthogonal (manhattan) routing: every edge is right-angled, matching the bus
// look. A port edge (Market fan-out) enters the target at its center; a port-less
// edge enters at the source's own x (clamped into the target) so it drops more or
// less straight down with no stray horizontal. The horizontal leg rides the gutter
// just outside the target edge.
const enterTargetX = (fromX, toRect, toCenterX, fromPortX) =>
  fromPortX != null
    ? toCenterX
    : Math.min(Math.max(fromX, toRect.x + 18), toRect.x + toRect.width - 18);

const edgePath = (fromRect, toRect, fromPortX = null) => {
  const from = centerOf(fromRect);
  const to = centerOf(toRect);

  if (fromRect.y !== toRect.y) {
    const down = fromRect.y < toRect.y;
    const fromX = fromPortX ?? exitX(fromRect, to.x);
    const fromY = down ? fromRect.y + fromRect.height : fromRect.y;
    const toX = enterTargetX(fromX, toRect, to.x, fromPortX);
    const toY = down ? toRect.y : toRect.y + toRect.height;
    const gutterY = down
      ? Math.max(toY - 12, fromY + 6)
      : Math.min(toY + 12, fromY - 6);
    return {
      d: `M ${fromX} ${fromY} L ${fromX} ${gutterY} L ${toX} ${gutterY} L ${toX} ${toY}`,
      mid: { x: (fromX + toX) / 2, y: gutterY },
    };
  }

  // Same-row: step out the near side, through a mid gutter, into the far side.
  const leftToRight = fromRect.x < toRect.x;
  const fromX = leftToRight ? fromRect.x + fromRect.width : fromRect.x;
  const toX = leftToRight ? toRect.x : toRect.x + toRect.width;
  const midX = (fromX + toX) / 2;
  return {
    d: `M ${fromX} ${from.y} L ${midX} ${from.y} L ${midX} ${to.y} L ${toX} ${to.y}`,
    mid: { x: midX, y: (from.y + to.y) / 2 },
  };
};

const edgeLabelPosition = (fromRect, toRect, fromPortX = null) => {
  const from = centerOf(fromRect);
  const to = centerOf(toRect);
  if (fromRect.y !== toRect.y) {
    const down = fromRect.y < toRect.y;
    const fromX = fromPortX ?? exitX(fromRect, to.x);
    const toX = enterTargetX(fromX, toRect, to.x, fromPortX);
    const gutterY = down
      ? Math.max(toRect.y - 12, fromRect.y + fromRect.height + 6)
      : Math.min(toRect.y + toRect.height + 12, fromRect.y - 6);
    return { x: (fromX + toX) / 2, y: gutterY - 4 };
  }
  return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 - 4 };
};

const isAttentionStatus = (status) => ATTENTION_STATUSES.has(status);

const buildVisibleMasterEdges = (masters) => {
  const masterById = new Map(masters.map((master) => [master.id, master]));
  // The diagram draws only the hand-authored pipeline flow, colored by its
  // endpoints. No connectors are drawn into the observability rail; trouble
  // surfaces via the Diagnostics card status and the attention strip instead.
  return VISUAL_FLOW_EDGES.flatMap((spec) => {
    const from = masterById.get(spec.from);
    const to = masterById.get(spec.to);
    if (!from || !to) return [];
    return [
      {
        id: `${spec.from}->${spec.to}`,
        from: spec.from,
        to: spec.to,
        label: spec.label,
        status: worstStatus(from.status, to.status),
        animated: from.status === "healthy" && to.status === "healthy",
        evidence: "observed",
        viewKind: "pipeline",
        isPrimary: true,
        showLabel: spec.showLabel !== false,
        fromCol: spec.fromCol,
        portBias: spec.portBias,
        transports:
          Array.isArray(spec.transports) && spec.transports.length > 0
            ? spec.transports
            : [{ means: "data path", detail: spec.label, fresh: true }],
      },
    ];
  });
};

// --- Database highway -------------------------------------------------------
// The Database card lives in the observability rail and every card persists into
// it. Rather than 9 long diagonals crossing the diagram, the persistence edges
// MERGE into one tight vertical trunk in the right-hand gutter (clear of every
// card) and travel together as a single transport line, then DIVERGE into the
// Database card's left edge — one labeled, status-colored lane per source. Lanes
// ride tightly (small gap) so the trunk reads as one line. Order is the trick
// that kills crossings: lane-x DECREASES as entry-y increases, so the outer/top
// lane exits highest and no exiting lane ever crosses one still descending.
// Broker/Massive are external feeds (persisted only via the Market Data caches)
// → dashed lanes. Diagnostics sits in the rail directly above the card and drops
// straight down the narrow gutter between the card and the Client rail.
const DB_HIGHWAY_TRUNK_X = 650;
const DB_HIGHWAY_LANE_GAP = 1.7; // tight: the bundle should read as one line
const DB_HIGHWAY_DROP = 12;
// feeder "right": exit the card's right edge straight into the trunk.
// feeder "drop": exit the bottom into the gutter below the card, then run to the
// trunk — used when a straight side exit would cross another card.
// Ordered top-to-bottom by where each feeder joins the trunk.
const DB_HIGHWAY_SOURCES = Object.freeze([
  { id: "massive", feeder: "right", label: "massive", dashed: true, detail: "persisted via Market Data caches" },
  { id: "broker", feeder: "drop", label: "broker", dashed: true, detail: "persisted via Market Data caches" },
  { id: "market", feeder: "right", label: "market", detail: "quote / bar / option-chain caches" },
  { id: "gex", feeder: "right", label: "gex", detail: "gex_snapshots" },
  { id: "signals", feeder: "drop", label: "signals", detail: "signal scan state" },
  { id: "flow", feeder: "drop", label: "flow", detail: "flow_events" },
  { id: "algo", feeder: "right", label: "algo", detail: "execution_events / deployments / shadow positions" },
  { id: "account", feeder: "right", label: "account", detail: "positions / fills via the worker lane" },
]);

const orthogonalPath = (pts) =>
  pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");

// Compact row count for the Database bus lanes: 1234 → "1k", 220000 → "220k".
const compactCount = (value) => {
  if (!Number.isFinite(value)) return "";
  if (value < 1000) return String(Math.round(value));
  if (value < 1_000_000) return `${Math.round(value / 1000)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
};

// Build the per-source highway lanes feeding the Database card. Geometry derives
// from the live card rects, so it follows any card move. Returns render-ready
// lanes (orthogonal path + dot + status + terminal label).
const buildDatabaseHighway = (rects, masterById, rowCounts = {}) => {
  const db = rects.database;
  if (!db) return [];
  const dbStatus = masterById.get("database")?.status || "unknown";
  const laneStatus = (id) =>
    worstStatus(masterById.get(id)?.status || "unknown", dbStatus);
  const n = DB_HIGHWAY_SOURCES.length;
  const mid = (n - 1) / 2;
  const entryStep = (db.height - 28) / (n - 1);

  const lanes = DB_HIGHWAY_SOURCES.map((src, i) => {
    const rect = rects[src.id];
    if (!rect) return null;
    // lane-x DECREASES as i (and entry-y) increases: the outer/top lane exits
    // first, so no exit segment ever crosses a lane still descending.
    const laneX = DB_HIGHWAY_TRUNK_X + (mid - i) * DB_HIGHWAY_LANE_GAP;
    const entryY = db.y + 14 + i * entryStep;
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const bottom = rect.y + rect.height;
    const pts =
      src.feeder === "right"
        ? [
            { x: rect.x + rect.width, y: cy },
            { x: laneX, y: cy },
            { x: laneX, y: entryY },
            { x: db.x, y: entryY },
          ]
        : [
            { x: cx, y: bottom },
            { x: cx, y: bottom + DB_HIGHWAY_DROP },
            { x: laneX, y: bottom + DB_HIGHWAY_DROP },
            { x: laneX, y: entryY },
            { x: db.x, y: entryY },
          ];
    return {
      id: `${src.id}->database`,
      source: src.id,
      label: src.label,
      detail: src.detail,
      dashed: Boolean(src.dashed),
      status: laneStatus(src.id),
      rowCount: rowCounts[src.id] ?? null,
      d: orthogonalPath(pts),
      labelPos: { x: db.x - 5, y: entryY + 2 },
    };
  }).filter(Boolean);

  // Diagnostics rides the rail directly above the card; drop it straight down the
  // narrow gutter between the card's left edge and the Client rail into the top.
  const diag = rects.diagnostics;
  if (diag) {
    const gx = db.x + 3;
    const midY = (diag.y + diag.height + db.y) / 2;
    lanes.push({
      id: "diagnostics->database",
      source: "diagnostics",
      label: "diag",
      detail: "diagnostic_snapshots / diagnostic_events",
      dashed: false,
      status: laneStatus("diagnostics"),
      rowCount: rowCounts["diagnostics"] ?? null,
      d: orthogonalPath([
        { x: gx, y: diag.y + diag.height },
        { x: gx, y: db.y },
      ]),
      labelPos: { x: gx - 4, y: midY + 2 },
    });
  }
  return lanes;
};

// --- Algo convergence bus ---------------------------------------------------
// Signals, Flow and GEX feed the Algo engine from the row directly above; Account
// feeds it from below. Same bus treatment as the Database highway: the three upper
// sources drop into a shared collector gutter above Algo and enter its top edge as
// tight lanes, ordered by source-x so they never cross. Account rises straight into
// the bottom edge. Sources sit right next to Algo, so lanes are self-evident and
// carry no label (unlike the 8-deep Database bundle).
const ALGO_BUS_LANE_GAP = 5;
const ALGO_BUS_TOP = Object.freeze([
  { id: "signals", detail: "signal engine worker state" },
  { id: "flow", detail: "flow events via worker state" },
  { id: "gex", detail: "gex projection via worker state" },
]);

const buildAlgoConvergence = (rects, masterById) => {
  const algo = rects.algo;
  if (!algo) return [];
  const algoStatus = masterById.get("algo")?.status || "unknown";
  const laneStatus = (id) =>
    worstStatus(masterById.get(id)?.status || "unknown", algoStatus);
  const collectorY = algo.y - 16;
  const centerX = algo.x + algo.width / 2;
  const mid = (ALGO_BUS_TOP.length - 1) / 2;

  const lanes = ALGO_BUS_TOP.map((src, i) => {
    const rect = rects[src.id];
    if (!rect) return null;
    const laneX = centerX + (i - mid) * ALGO_BUS_LANE_GAP;
    const cx = rect.x + rect.width / 2;
    return {
      id: `${src.id}->algo`,
      source: src.id,
      detail: src.detail,
      status: laneStatus(src.id),
      d: orthogonalPath([
        { x: cx, y: rect.y + rect.height },
        { x: cx, y: collectorY },
        { x: laneX, y: collectorY },
        { x: laneX, y: algo.y },
      ]),
    };
  }).filter(Boolean);

  const account = rects.account;
  if (account) {
    const cx = Math.min(
      Math.max(account.x + account.width / 2, algo.x + 16),
      algo.x + algo.width - 16,
    );
    lanes.push({
      id: "account->algo",
      source: "account",
      detail: "positions / risk via worker state",
      status: laneStatus("account"),
      d: orthogonalPath([
        { x: cx, y: account.y },
        { x: cx, y: algo.y + algo.height },
      ]),
    });
  }
  return lanes;
};

// --- Pressure source links --------------------------------------------------
// When a card is a dominant pressure driver (model.pressureSources, e.g. the DB
// pool), draw a faint connector from it up the rail gutter into the Diagnostics
// card, where API Pressure aggregates — so pressure traces back to its origin.
const buildPressureLinks = (rects, pressureSources) => {
  const diag = rects.diagnostics;
  if (!diag) return [];
  return pressureSources
    .map((source) => {
      const rect = rects[source.cardId];
      if (!rect || rect === diag) return null;
      const gx = Math.min(rect.x, diag.x) - 10;
      const startY = rect.y;
      const endY = diag.y + diag.height;
      return {
        id: `pressure:${source.cardId}`,
        label: source.label,
        detail: source.detail,
        d: orthogonalPath([
          { x: rect.x + 10, y: startY },
          { x: gx, y: startY },
          { x: gx, y: endY },
          { x: diag.x + 10, y: endY },
        ]),
        labelPos: { x: gx - 3, y: (startY + endY) / 2 },
      };
    })
    .filter(Boolean);
};

// Pressure attribution accent — distinct from status colors so a "pressure
// source" marker reads as a cause, not just another degraded card.
const PRESSURE_TONE = "#e8a13a";

const FOOTER_ABBREVIATIONS = [
  [" of ", "/"],
  ["pressure=", "p:"],
  ["circuit open:", "open:"],
  ["circuits closed", "cc"],
  [" lines", " ln"],
  [" heartbeat", " hb"],
  [" freshness", " fr"],
  [" consumers", " cons"],
  [" snapshots", " snap"],
  [" events", " ev"],
  [" warnings", " warn"],
  [" queries", " q"],
  ["last socket", "sock"],
  ["last ws", "ws"],
  [" scan age", " scan"],
  [" fresh signals", " fresh"],
  ["market session quiet", "session quiet"],
  ["not observed", "n/o"],
];

// Render raw millisecond counts as seconds once they pass 1s, so attention
// detail never shows "522,656ms". Shared by the card footers and the attention
// strip so both read the same way.
const formatDurations = (text) =>
  String(text || "").replace(/(\d[\d,]*)ms\b/g, (match, digits) => {
    const ms = Number(digits.replace(/,/g, ""));
    if (!Number.isFinite(ms)) return match;
    return ms >= 1000 ? `${Math.round(ms / 100) / 10}s` : `${ms}ms`;
  });

// Lower-left card footer: status glyph + abbreviated key metrics. The full
// failure explanation lives in the card tooltip.
const abbreviateDetail = (detail) => {
  let text = String(detail || "");
  const colonIdx = text.indexOf(": ");
  if (colonIdx > -1 && colonIdx < 24) text = text.slice(colonIdx + 2);
  text = text.split(" / ").slice(0, 2).join(" \u00B7 ");
  for (const [needle, short] of FOOTER_ABBREVIATIONS) {
    text = text.split(needle).join(short);
  }
  return formatDurations(text);
};

// Wrap a footer detail into at most maxLines. One line when it fits; otherwise a
// balanced two-line split (the line break lands near the middle) so a lone
// cryptic token like "ws" or "free" never orphans on its own line.
const wrapLines = (text, maxChars, maxLines = 2) => {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const full = words.join(" ");
  if (full.length <= maxChars || maxLines <= 1) return [truncate(full, maxChars)];

  let best = null;
  for (let i = 1; i < words.length; i += 1) {
    const first = words.slice(0, i).join(" ");
    if (first.length > maxChars) break;
    const second = words.slice(i).join(" ");
    const score = Math.abs(first.length - second.length);
    if (!best || score < best.score) best = { first, second, score };
  }
  if (!best) return [truncate(full, maxChars)];
  return [best.first, truncate(best.second, maxChars)];
};

const cardTooltip = (master) => {
  const meta = statusMeta(master.status);
  const lines = master.children.map(
    (child) =>
      `\u2022 ${child.label} (${statusMeta(child.status).label.toLowerCase()}, ${child.evidence}): ${child.detail}`,
  );
  return [`${master.label} \u2014 ${meta.label}${master.stale ? " (stale snapshot)" : ""}`, ...lines].join("\n");
};

const truncate = (value, maxLength) => {
  const text = String(value || "");
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1))}…` : text;
};

const countBy = (items, key) =>
  items.reduce((counts, item) => {
    const value = item[key] || "unknown";
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});

const TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const formatObservedAt = (value) => {
  if (!value) return "waiting";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return TIME_FORMAT.format(parsed);
};

const chipStyle = (status) => {
  const meta = statusMeta(status);
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: sp(5),
    border: `1px solid ${cssColorMix(meta.tone, 42)}`,
    background: meta.fill,
    color: meta.tone,
    borderRadius: dim(RADII.xs),
    padding: sp("3px 6px"),
    fontFamily: T.sans,
    fontSize: textSize("caption"),
    fontWeight: FONT_WEIGHTS.label,
    whiteSpace: "nowrap",
  };
};

const MasterCard = ({ master, rect, pressureSource = false }) => {
  const meta = statusMeta(master.status);
  const single = master.children.length <= 1;
  const footerChars = Math.max(10, charsForWidth(rect.width - 24, CARD_DETAIL_SIZE, DETAIL_CHAR_EM));
  const footerLines = wrapLines(
    `${STATUS_GLYPH[master.status] || "?"} ${abbreviateDetail(master.detail)}`,
    footerChars,
    2,
  );
  const footerTone =
    master.status === "degraded" || master.status === "down"
      ? meta.tone
      : CSS_COLOR.textDim;
  return (
    <g transform={`translate(${rect.x} ${rect.y})`}>
      <title>{cardTooltip(master)}</title>
      <rect
        width={rect.width}
        height={rect.height}
        rx="10"
        fill={meta.fill}
        stroke={cssColorMix(meta.tone, 52)}
        strokeWidth="1.4"
        strokeDasharray={master.stale ? "5 3" : undefined}
      />
      <text
        x="12"
        y="17"
        fill={CSS_COLOR.text}
        fontFamily={T.sans}
        fontSize={CARD_TITLE_SIZE}
        fontWeight={FONT_WEIGHTS.label}
      >
        {truncate(master.label, charsForWidth(rect.width - 24, CARD_TITLE_SIZE, TITLE_CHAR_EM))}
      </text>
      {pressureSource ? (
        <g transform={`translate(${rect.width - 60} 4)`}>
          <title>This card is a dominant source of server pressure.</title>
          <rect
            width="56"
            height="12.5"
            rx="3"
            fill={cssColorAlpha(PRESSURE_TONE, 0.16)}
            stroke={PRESSURE_TONE}
            strokeWidth="0.8"
          />
          <text
            x="28"
            y="9.2"
            textAnchor="middle"
            fill={PRESSURE_TONE}
            fontFamily={T.sans}
            fontSize="7.5"
            fontWeight={FONT_WEIGHTS.medium}
          >
            ⚡ pressure
          </text>
        </g>
      ) : null}
      {single
        ? null
        : master.children.map((child, index) => {
            const rowY = TITLE_BAND + 8 + index * BUBBLE_ROW_HEIGHT;
            const childMeta = statusMeta(child.status);
            return (
              <g key={child.id}>
                <title>{`${child.label} (${childMeta.label.toLowerCase()}, ${child.evidence}): ${child.detail}`}</title>
                <text
                  x={11}
                  y={rowY}
                  fill={childMeta.tone}
                  fontFamily={T.sans}
                  fontSize={BUBBLE_LABEL_SIZE}
                  fontWeight={FONT_WEIGHTS.emphasis}
                >
                  {STATUS_GLYPH[child.status] || "?"}
                </text>
                <text
                  x={25}
                  y={rowY}
                  fill={CSS_COLOR.textSec}
                  fontFamily={T.sans}
                  fontSize={BUBBLE_LABEL_SIZE}
                >
                  {truncate(child.label, charsForWidth(rect.width - 40, BUBBLE_LABEL_SIZE, LABEL_CHAR_EM))}
                </text>
                {child.metric ? (
                  <text
                    x={rect.width - 11}
                    y={rowY}
                    textAnchor="end"
                    fill={CSS_COLOR.textMuted}
                    fontFamily={T.sans}
                    fontSize={BUBBLE_LABEL_SIZE}
                  >
                    {truncate(child.metric, 16)}
                  </text>
                ) : null}
              </g>
            );
          })}
      {footerLines.map((line, index) => (
        <text
          key={index}
          x="12"
          y={rect.height - 18 + index * 12}
          fill={footerTone}
          fontFamily={T.sans}
          fontSize={CARD_DETAIL_SIZE}
        >
          {line}
        </text>
      ))}
    </g>
  );
};

// Provider per quadrant. Equities are Massive-only (IBKR no longer serves equity
// bars); options realtime rides IBKR broker lines because Massive options is
// 15-min delayed, while historical options come from Massive. So IBKR appears in
// exactly one cell. Each cell carries a live status glyph: realtime cells from
// the equity/option stream sensors, historical cells from the Massive provider
// connection (`massive-feed`) since historical is served on demand from it.
const MARKET_TABLE_CELLS = Object.freeze([
  { row: 0, col: 0, providers: "Massive", liveChildId: "market-equities" },
  { row: 0, col: 1, providers: "IBKR", liveChildId: "market-options" },
  { row: 1, col: 0, providers: "Massive", liveChildId: "massive-feed" },
  { row: 1, col: 1, providers: "Massive", liveChildId: "massive-feed" },
]);
const MARKET_COLUMNS = ["Equities", "Options"];
const MARKET_ROWS = ["Realtime", "Historical"];

const MarketDataCard = ({ master, rect, nodeById }) => {
  const meta = statusMeta(master.status);

  // Table geometry inside the translated card (shared with marketColumnPortX).
  const padX = MARKET_PAD_X;
  const labelColW = MARKET_LABEL_COL_W;
  const headerY = 40;
  const gridTop = 46;
  const gridLeft = padX + labelColW;
  const gridRight = rect.width - padX;
  const colW = (gridRight - gridLeft) / MARKET_COLUMNS.length;
  const rowH = (rect.height - gridTop - 8) / MARKET_ROWS.length;
  const colX = (col) => gridLeft + col * colW;
  const rowY = (row) => gridTop + row * rowH;
  const cellChars = (width) =>
    charsForWidth(width - 22, CARD_DETAIL_SIZE, DETAIL_CHAR_EM);

  return (
    <g transform={`translate(${rect.x} ${rect.y})`}>
      <title>{cardTooltip(master)}</title>
      <rect
        width={rect.width}
        height={rect.height}
        rx="10"
        fill={meta.fill}
        stroke={cssColorMix(meta.tone, 52)}
        strokeWidth="1.4"
        strokeDasharray={master.stale ? "5 3" : undefined}
      />
      <text
        x="12"
        y="17"
        fill={CSS_COLOR.text}
        fontFamily={T.sans}
        fontSize={CARD_TITLE_SIZE}
        fontWeight={FONT_WEIGHTS.label}
      >
        Market Data
      </text>

      {/* Column headers */}
      {MARKET_COLUMNS.map((label, col) => (
        <text
          key={label}
          x={colX(col) + colW / 2}
          y={headerY - 14}
          textAnchor="middle"
          fill={CSS_COLOR.textDim}
          fontFamily={T.sans}
          fontSize={CARD_DETAIL_SIZE}
          fontWeight={FONT_WEIGHTS.label}
          letterSpacing="0.04em"
        >
          {label}
        </text>
      ))}

      {/* Row labels */}
      {MARKET_ROWS.map((label, row) => (
        <text
          key={label}
          x={padX}
          y={rowY(row) + rowH / 2 + 4}
          fill={CSS_COLOR.textSec}
          fontFamily={T.sans}
          fontSize={CARD_DETAIL_SIZE}
          fontWeight={FONT_WEIGHTS.label}
        >
          {label}
        </text>
      ))}

      {/* Gridlines */}
      <line x1={gridLeft} y1={gridTop} x2={gridRight} y2={gridTop} stroke={CSS_COLOR.borderLight} strokeWidth="1" />
      <line x1={gridLeft} y1={rowY(1)} x2={gridRight} y2={rowY(1)} stroke={CSS_COLOR.borderLight} strokeWidth="1" />
      <line x1={gridLeft} y1={gridTop} x2={gridLeft} y2={rowY(MARKET_ROWS.length)} stroke={CSS_COLOR.borderLight} strokeWidth="1" />
      <line x1={colX(1)} y1={gridTop} x2={colX(1)} y2={rowY(MARKET_ROWS.length)} stroke={CSS_COLOR.borderLight} strokeWidth="1" />

      {/* Cells */}
      {MARKET_TABLE_CELLS.map((cell) => {
        const cx = colX(cell.col) + 6;
        const cy = rowY(cell.row) + rowH / 2 + 4;
        const child = cell.liveChildId ? nodeById.get(cell.liveChildId) : null;
        const live = cell.liveChildId && child;
        const childMeta = child ? statusMeta(child.status) : null;
        const labelX = live ? cx + 13 : cx;
        return (
          <g key={`${cell.row}-${cell.col}`}>
            {child ? (
              <title>{`${child.label} (${childMeta.label.toLowerCase()}, ${child.evidence}): ${child.detail}`}</title>
            ) : null}
            {live ? (
              <text
                x={cx}
                y={cy}
                fill={childMeta.tone}
                fontFamily={T.sans}
                fontSize={BUBBLE_LABEL_SIZE}
                fontWeight={FONT_WEIGHTS.emphasis}
              >
                {STATUS_GLYPH[child.status] || "?"}
              </text>
            ) : null}
            <text
              x={labelX}
              y={cy}
              fill={live ? CSS_COLOR.textSec : CSS_COLOR.textDim}
              fontFamily={T.sans}
              fontSize={CARD_DETAIL_SIZE}
            >
              {truncate(cell.providers, cellChars(colW - (live ? 13 : 0)))}
            </text>
          </g>
        );
      })}
    </g>
  );
};

const ClientRailSignals = ({ master, rect }) => {
  if (!master) return null;
  const masterMeta = statusMeta(master.status);
  const childById = new Map(master.children.map((child) => [child.id, child]));
  const rows = [];
  let cursorY = 32;
  for (const section of CLIENT_RAIL_SECTIONS) {
    rows.push({ type: "section", label: section.label, y: cursorY });
    cursorY += 15;
    for (const childId of section.childIds) {
      const child = childById.get(childId);
      if (!child) continue;
      rows.push({ type: "child", child, y: cursorY });
      cursorY += 16;
    }
    cursorY += 7;
  }

  return (
    <g transform={`translate(${rect.x} ${rect.y})`}>
      <title>{cardTooltip(master)}</title>
      <text
        x="0"
        y="12"
        fill={CSS_COLOR.textMuted}
        fontFamily={T.sans}
        fontSize={CARD_DETAIL_SIZE}
        fontWeight={FONT_WEIGHTS.label}
        letterSpacing="0.08em"
      >
        CLIENT VISIBILITY
      </text>
      <text
        x={rect.width}
        y="12"
        textAnchor="end"
        fill={masterMeta.tone}
        fontFamily={T.sans}
        fontSize={CARD_DETAIL_SIZE}
        fontWeight={FONT_WEIGHTS.emphasis}
      >
        {STATUS_GLYPH[master.status] || "?"}
      </text>
      <line
        x1="0"
        y1="20"
        x2={rect.width}
        y2="20"
        stroke={CSS_COLOR.borderLight}
        strokeWidth="1"
      />
      {rows.map((row) => {
        if (row.type === "section") {
          return (
            <text
              key={`${row.label}-${row.y}`}
              x="0"
              y={row.y}
              fill={CSS_COLOR.textDim}
              fontFamily={T.sans}
              fontSize={CARD_DETAIL_SIZE}
              fontWeight={FONT_WEIGHTS.label}
            >
              {row.label}
            </text>
          );
        }

        const childMeta = statusMeta(row.child.status);
        return (
          <g key={row.child.id}>
            <title>{`${row.child.label} (${childMeta.label.toLowerCase()}, ${row.child.evidence}): ${row.child.detail}`}</title>
            <text
              x="0"
              y={row.y}
              fill={childMeta.tone}
              fontFamily={T.sans}
              fontSize={BUBBLE_LABEL_SIZE}
              fontWeight={FONT_WEIGHTS.emphasis}
            >
              {STATUS_GLYPH[row.child.status] || "?"}
            </text>
            <text
              x="16"
              y={row.y}
              fill={CSS_COLOR.textSec}
              fontFamily={T.sans}
              fontSize={BUBBLE_LABEL_SIZE}
            >
              {truncate(row.child.label, charsForWidth(rect.width * 0.52, BUBBLE_LABEL_SIZE, LABEL_CHAR_EM))}
            </text>
            <text
              x={rect.width}
              y={row.y}
              textAnchor="end"
              fill={CSS_COLOR.textDim}
              fontFamily={T.sans}
              fontSize={CARD_DETAIL_SIZE}
            >
              {truncate(abbreviateDetail(row.child.detail), charsForWidth(rect.width * 0.44, CARD_DETAIL_SIZE, DETAIL_CHAR_EM))}
            </text>
          </g>
        );
      })}
    </g>
  );
};

const DEFAULT_SUMMARY = Object.freeze({
  status: "unknown",
  label: "No Runtime Snapshot",
  detail: "Diagnostics has not observed enough state.",
});

export const MachineStateDiagram = memo(function MachineStateDiagram({ model }) {
  // Per-field normalization: a malformed model ({nodes: undefined}, missing
  // groups) must degrade to an empty diagram, never crash the screen.
  const nodes = Array.isArray(model?.nodes) ? model.nodes : [];
  const nodeById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  );
  const summary =
    model?.summary && typeof model.summary === "object"
      ? model.summary
      : DEFAULT_SUMMARY;
  const observedAt = model?.observedAt ?? null;
  const masters = Array.isArray(model?.groups?.masters) ? model.groups.masters : [];
  // Trade Mgmt is merged into the Algo card for display; model groups are intact.
  const displayMasters = useMemo(() => mergeAlgoExecution(masters), [masters]);

  // Card rects fit each master's content width, so they depend on the live
  // model; recompute only when the masters change.
  const groupRects = useMemo(() => buildRects(displayMasters), [displayMasters]);
  const edgeEndpointRects = useMemo(
    () => ({ ...groupRects, client: CLIENT_ALERT_RECT }),
    [groupRects],
  );
  const visibleEdges = useMemo(
    () => buildVisibleMasterEdges(displayMasters),
    [displayMasters],
  );
  const masterById = useMemo(
    () => new Map(displayMasters.map((master) => [master.id, master])),
    [displayMasters],
  );
  const databaseRowCounts = model?.databaseRowCounts;
  const databaseHighway = useMemo(
    () => buildDatabaseHighway(groupRects, masterById, databaseRowCounts || {}),
    [groupRects, masterById, databaseRowCounts],
  );
  const algoConvergence = useMemo(
    () => buildAlgoConvergence(groupRects, masterById),
    [groupRects, masterById],
  );
  const pressureSources = useMemo(
    () => (Array.isArray(model?.pressureSources) ? model.pressureSources : []),
    [model],
  );
  const pressureSourceIds = useMemo(
    () => new Set(pressureSources.map((source) => source.cardId)),
    [pressureSources],
  );
  const pressureLinks = useMemo(
    () => buildPressureLinks(groupRects, pressureSources),
    [groupRects, pressureSources],
  );
  const clientMaster =
    displayMasters.find((master) => master.id === "client") || null;
  const positionedMasters = displayMasters.filter(
    (master) => groupRects[master.id],
  );
  const positionedEdges = visibleEdges.filter(
    (edge) => edgeEndpointRects[edge.from] && edgeEndpointRects[edge.to],
  );
  const statusCounts = countBy(nodes, "status");
  const evidenceCounts = countBy(nodes, "evidence");
  const attentionNodes = nodes.filter((node) => isAttentionStatus(node.status));
  const summaryMeta = statusMeta(summary.status);

  return (
    <SurfacePanel
      title="Backend Data Machine"
      subtitle={summary.detail}
      rightRail={`observed ${formatObservedAt(observedAt)}`}
      action={
        <span style={chipStyle(summary.status)}>
          <span
            aria-hidden="true"
            style={{
              width: dim(8),
              height: dim(8),
              borderRadius: dim(RADII.xs),
              background: summaryMeta.tone,
              flex: "0 0 auto",
            }}
          />
          {summaryMeta.label}
        </span>
      }
      compact
      bodyStyle={{ padding: sp("6px 6px 8px") }}
      data-testid="diagnostics-machine-state-diagram"
    >
      <div style={{ display: "grid", gap: sp(6), minWidth: 0 }}>
        <div
          className="ra-hide-scrollbar"
          style={{
            overflowX: "auto",
            minWidth: 0,
          }}
        >
          <div
            className="diagnostics-machine-diagram-workspace"
            style={{ "--diagnostics-machine-min-width": `${dim(DIAGRAM_MIN_WIDTH)}px` }}
          >
            <svg
              role="img"
              aria-label={`${summary.label}: ${summary.detail}`}
              viewBox={`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`}
              width="100%"
              style={{
                display: "block",
                height: "auto",
                aspectRatio: `${VIEWBOX.width} / ${VIEWBOX.height}`,
                color: CSS_COLOR.textSec,
              }}
            >
            <defs>
              <marker
                id="diagnostics-machine-arrow"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill={CSS_COLOR.textMuted} />
              </marker>
            </defs>
            {/* Swimlane chrome is intentionally not drawn: LANE_BANDS remains
                the layout/viewBox reference, but cards and edges float without
                visible lane boxes or stage labels. */}
            {positionedEdges.map((edge) => {
              const fromRect = edgeEndpointRects[edge.from];
              const toRect = edgeEndpointRects[edge.to];
              const meta = statusMeta(edge.status);
              const fromPortX =
                edge.from === "market" && typeof edge.fromCol === "number"
                  ? marketColumnPortX(fromRect, edge.fromCol, edge.portBias || 0)
                  : null;
              const labelPosition = edgeLabelPosition(fromRect, toRect, fromPortX);
              const baseStrokeWidth = edge.isPrimary ? 1.8 : 1;
              const geom = edgePath(fromRect, toRect, fromPortX);
              // Each transport (means of moving data) draws its own parallel
              // line + dot. A delayed/historical path (fresh:false) is dashed so
              // it reads as a distinct source, never merged with the realtime line.
              const transports = edge.transports;
              const transportCount = transports.length;
              return (
                <g key={edge.id}>
                  {transports.map((transport, transportIndex) => {
                    const dx =
                      (transportIndex - (transportCount - 1) / 2) * TRANSPORT_LINE_GAP;
                    const fresh = transport.fresh !== false;
                    const tip = `${transport.means}: ${transport.detail}${fresh ? "" : " · delayed"}`;
                    return (
                      <g
                        key={transportIndex}
                        transform={dx ? `translate(${dx} 0)` : undefined}
                      >
                        <path
                          className="diagnostics-machine-edge"
                          data-kind={edge.viewKind}
                          data-primary={edge.isPrimary ? "true" : "false"}
                          data-status={edge.status}
                          data-animated={
                            edge.viewKind === "pipeline" && edge.animated && fresh
                              ? "true"
                              : "false"
                          }
                          d={geom.d}
                          fill="none"
                          stroke={meta.tone}
                          strokeWidth={baseStrokeWidth}
                          strokeDasharray={
                            fresh ? (edge.isPrimary ? undefined : "2 7") : "5 4"
                          }
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          markerEnd={
                            edge.isPrimary ? "url(#diagnostics-machine-arrow)" : undefined
                          }
                          style={{
                            ...motionVars({ accent: meta.tone }),
                            opacity: fresh ? (edge.isPrimary ? 0.7 : 0.14) : 0.5,
                          }}
                        >
                          <title>{`${edge.from} → ${edge.to} · ${tip}`}</title>
                        </path>
                        <circle
                          className="diagnostics-machine-edge-dot"
                          cx={geom.mid.x}
                          cy={geom.mid.y}
                          r={TRANSPORT_DOT_R}
                          fill={meta.tone}
                          stroke={CSS_COLOR.bg1}
                          strokeWidth="1.2"
                        >
                          <title>{tip}</title>
                        </circle>
                      </g>
                    );
                  })}
                  {edge.showLabel ? (
                    <text
                      x={labelPosition.x}
                      y={labelPosition.y}
                      textAnchor="middle"
                      fill={CSS_COLOR.textMuted}
                      stroke={CSS_COLOR.bg1}
                      strokeWidth="5"
                      strokeLinejoin="round"
                      paintOrder="stroke"
                      pointerEvents="none"
                      fontFamily={T.sans}
                      fontSize={EDGE_LABEL_SIZE}
                      fontWeight={FONT_WEIGHTS.medium}
                    >
                      {truncate(edge.label, 22)}
                    </text>
                  ) : null}
                </g>
              );
            })}
            {databaseHighway.map((lane) => {
              const meta = statusMeta(lane.status);
              const tip = `${lane.source} → database · ${lane.detail}`;
              return (
                <g key={lane.id} data-db-lane={lane.source}>
                  <path
                    className="diagnostics-machine-edge"
                    d={lane.d}
                    fill="none"
                    stroke={meta.tone}
                    strokeWidth={1.2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    strokeDasharray={lane.dashed ? "4 4" : undefined}
                    markerEnd="url(#diagnostics-machine-arrow)"
                    style={{ opacity: lane.dashed ? 0.55 : 0.8 }}
                  >
                    <title>{tip}</title>
                  </path>
                  <text
                    x={lane.labelPos.x}
                    y={lane.labelPos.y}
                    textAnchor="end"
                    fontFamily={T.sans}
                    fontSize={7.5}
                    fontWeight={FONT_WEIGHTS.medium}
                    fill={meta.tone}
                    stroke={CSS_COLOR.bg1}
                    strokeWidth="2.5"
                    paintOrder="stroke"
                  >
                    <title>
                      {lane.rowCount != null
                        ? `${tip} · ${lane.rowCount.toLocaleString()} rows`
                        : tip}
                    </title>
                    {lane.label}
                    {lane.rowCount != null ? (
                      <tspan dx="3" fill={CSS_COLOR.textMuted}>
                        {compactCount(lane.rowCount)}
                      </tspan>
                    ) : null}
                  </text>
                </g>
              );
            })}
            {algoConvergence.map((lane) => {
              const meta = statusMeta(lane.status);
              return (
                <path
                  key={lane.id}
                  className="diagnostics-machine-edge"
                  data-algo-lane={lane.source}
                  d={lane.d}
                  fill="none"
                  stroke={meta.tone}
                  strokeWidth={1.2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  markerEnd="url(#diagnostics-machine-arrow)"
                  style={{ opacity: 0.8 }}
                >
                  <title>{`${lane.source} → algo · ${lane.detail}`}</title>
                </path>
              );
            })}
            {pressureLinks.map((link) => (
              <path
                key={link.id}
                data-pressure-link={link.id}
                d={link.d}
                fill="none"
                stroke={PRESSURE_TONE}
                strokeWidth={1}
                strokeDasharray="2 4"
                strokeLinejoin="round"
                strokeLinecap="round"
                style={{ opacity: 0.55 }}
              >
                <title>{`${link.label} → API Pressure · ${link.detail}`}</title>
              </path>
            ))}
            {positionedMasters.map((master) =>
              master.id === "market" ? (
                <MarketDataCard
                  key={master.id}
                  master={master}
                  rect={groupRects[master.id]}
                  nodeById={nodeById}
                />
              ) : (
                <MasterCard
                  key={master.id}
                  master={master}
                  rect={groupRects[master.id]}
                  pressureSource={pressureSourceIds.has(master.id)}
                />
              ),
            )}
              <ClientRailSignals master={clientMaster} rect={CLIENT_RAIL_RECT} />
            </svg>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
            gap: sp(8),
            minWidth: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: sp(5),
              flexWrap: "wrap",
              minWidth: 0,
            }}
          >
            {LEGEND_STATUSES.map((status) => {
              const meta = statusMeta(status);
              return (
                <span
                  key={status}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: sp(4),
                    border: `1px solid ${cssColorAlpha(meta.tone, "33")}`,
                    color: meta.tone,
                    background: cssColorAlpha(meta.tone, "0f"),
                    borderRadius: dim(RADII.xs),
                    padding: sp("2px 5px"),
                    fontFamily: T.sans,
                    fontSize: textSize("label"),
                    whiteSpace: "nowrap",
                  }}
                >
                  <span aria-hidden="true">{STATUS_GLYPH[status] || "?"}</span>
                  {meta.label} {statusCounts[status] || 0}
                </span>
              );
            })}
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              alignItems: "center",
              gap: sp(5),
              flexWrap: "wrap",
              minWidth: 0,
            }}
          >
            {LEGEND_EVIDENCE.map((evidence) => (
              <span
                key={evidence}
                style={{
                  color: CSS_COLOR.textDim,
                  border: `1px solid ${CSS_COLOR.border}`,
                  background: CSS_COLOR.bg2,
                  borderRadius: dim(RADII.xs),
                  padding: sp("2px 5px"),
                  fontFamily: T.sans,
                  fontSize: textSize("label"),
                  whiteSpace: "nowrap",
                }}
              >
                {`${evidence.charAt(0).toUpperCase()}${evidence.slice(1)} ${evidenceCounts[evidence] || 0}`}
              </span>
            ))}
          </div>
        </div>

        {attentionNodes.length ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
              gap: sp(5),
            }}
          >
            {attentionNodes.slice(0, 4).map((node) => {
              const meta = statusMeta(node.status);
              return (
                <div
                  key={node.id}
                  title={`${node.label} — ${meta.label}: ${node.detail}`}
                  style={{
                    minWidth: 0,
                    display: "flex",
                    alignItems: "baseline",
                    gap: sp(5),
                    borderLeft: `2px solid ${meta.tone}`,
                    background: cssColorAlpha(meta.tone, "0d"),
                    borderRadius: dim(RADII.xs),
                    padding: sp("3px 8px"),
                    fontFamily: T.sans,
                    overflow: "hidden",
                  }}
                >
                  <span aria-hidden="true" style={{ flex: "0 0 auto", color: meta.tone, fontWeight: FONT_WEIGHTS.emphasis }}>
                    {STATUS_GLYPH[node.status] || "?"}
                  </span>
                  <span style={{ flex: "0 0 auto", color: meta.tone, fontSize: textSize("caption"), fontWeight: FONT_WEIGHTS.label, whiteSpace: "nowrap" }}>
                    {node.label}
                  </span>
                  <span style={{ minWidth: 0, color: CSS_COLOR.textDim, fontSize: textSize("label"), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {formatDurations(node.detail)}
                  </span>
                </div>
              );
            })}
            {attentionNodes.length > 4 ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  color: CSS_COLOR.textDim,
                  fontFamily: T.sans,
                  fontSize: textSize("caption"),
                  padding: sp("3px 6px"),
                }}
              >
                +{attentionNodes.length - 4} more need attention
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </SurfacePanel>
  );
});
