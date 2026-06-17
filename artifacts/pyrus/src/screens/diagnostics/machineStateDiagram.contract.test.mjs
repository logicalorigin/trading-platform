import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DIAGNOSTICS_COLLECTION_INTERVAL_MS,
  IBKR_HEARTBEAT_WARNING_MS,
  MARKET_DATA_FRESHNESS_WARNING_MS,
  MARKET_DATA_STREAM_GAP_WARNING_MS,
  BROWSER_MEMORY_WATCH_PERCENT,
  BROWSER_MEMORY_HIGH_PERCENT,
  SNAPSHOT_STALE_MS,
  SNAPSHOT_EXPIRED_MS,
  MACHINE_STATE_GROUPS,
  buildMachineStateDiagramModel,
} from "./machineStateDiagramModel.js";

const read = (relativePath) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

const modelSource = read("./machineStateDiagramModel.js");
const componentSource = read("./MachineStateDiagram.jsx");
const wiringDoc = read("./MACHINE_STATE_WIRING.md");

const STATUSES = ["unknown", "idle", "healthy", "checking", "degraded", "down"];
const EVIDENCE = ["unknown", "inferred", "observed"];

const keysFromObjectLiteral = (source, anchor) => {
  const start = source.indexOf(anchor);
  assert.ok(start >= 0, `expected to find ${anchor}`);
  const block = source.slice(start, source.indexOf("});", start));
  return [...block.matchAll(/^ {2}(?:"([^"]+)"|([a-zA-Z][\w-]*)):/gm)].map(
    (match) => match[1] || match[2],
  );
};

const stringEntriesFromObjectLiteral = (source, anchor) => {
  const start = source.indexOf(anchor);
  assert.ok(start >= 0, `expected to find ${anchor}`);
  const block = source.slice(start, source.indexOf("});", start));
  return Object.fromEntries(
    [...block.matchAll(/^ {2}(?:"([^"]+)"|([a-zA-Z][\w-]*)):\s*"([^"]+)"/gm)].map(
      (match) => [match[1] || match[2], match[3]],
    ),
  );
};

const emptyModel = () =>
  buildMachineStateDiagramModel({
    latest: null,
    streamState: "unknown",
    runtimeControl: null,
    footerSignal: null,
    memoryPressureState: null,
    nowMs: Date.parse("2026-06-12T12:00:00.000Z"),
  });

test("contract: every model node belongs to exactly one master and vice versa", () => {
  const model = emptyModel();
  const childIds = MACHINE_STATE_GROUPS.flatMap((group) => [...group.children]);
  assert.equal(new Set(childIds).size, childIds.length, "child claimed by two masters");
  assert.deepEqual(
    [...childIds].sort(),
    model.nodes.map((node) => node.id).sort(),
    "GROUP children and model nodes diverged",
  );
});

test("contract: the renderer has a position for every master and no orphans", () => {
  const positionKeys = keysFromObjectLiteral(componentSource, "const GROUP_XY");
  // "trade" (Trade Chain) is folded into the Market Data table card and
  // "trade-mgmt" is merged into the Algo card: both stay in the model so their
  // child sensors and edges survive, but neither is positioned or rendered as a
  // standalone card. "client" renders as the right-rail sections.
  const renderedCardGroupIds = MACHINE_STATE_GROUPS.map((group) => group.id).filter(
    (id) => id !== "client" && id !== "trade" && id !== "trade-mgmt",
  );
  assert.deepEqual(
    [...positionKeys].sort(),
    renderedCardGroupIds.sort(),
  );
  assert.ok(
    MACHINE_STATE_GROUPS.some((group) => group.id === "client"),
    "client telemetry remains in the view model",
  );
  assert.match(
    componentSource,
    /const CLIENT_RAIL_SECTIONS = Object\.freeze/,
    "client telemetry renders as rail sections, not a standalone card",
  );
});

test("contract: every cross-group child edge survives master-edge derivation", () => {
  const model = emptyModel();
  const groupByChild = new Map();
  for (const group of MACHINE_STATE_GROUPS) {
    for (const childId of group.children) groupByChild.set(childId, group.id);
  }
  const expected = new Set(
    model.edges
      .map((edge) => `${groupByChild.get(edge.from)}->${groupByChild.get(edge.to)}`)
      .filter((key) => {
        const [from, to] = key.split("->");
        return from && to && from !== to && from !== "undefined" && to !== "undefined";
      }),
  );
  const derived = new Set(model.groups.edges.map((edge) => edge.id));
  assert.deepEqual([...derived].sort(), [...expected].sort());
  // Every child edge endpoint must be a known node id.
  const nodeIds = new Set(model.nodes.map((node) => node.id));
  for (const edge of model.edges) {
    assert.ok(nodeIds.has(edge.from), `unknown edge source ${edge.from}`);
    assert.ok(nodeIds.has(edge.to), `unknown edge target ${edge.to}`);
  }
});

test("contract: status vocabulary is pinned across model, renderer, and wiring doc", () => {
  const modelStatuses = keysFromObjectLiteral(modelSource, "const STATUS_ORDER");
  const rendererStatuses = keysFromObjectLiteral(componentSource, "const STATUS_META");
  assert.deepEqual([...modelStatuses].sort(), [...STATUSES].sort());
  assert.deepEqual([...rendererStatuses].sort(), [...STATUSES].sort());
  assert.match(wiringDoc, /`unknown \| idle \| healthy \| checking \| degraded \| down`/);
  // The legend must cover every status.
  const legendMatch = componentSource.match(/const LEGEND_STATUSES = \[([^\]]+)\]/);
  assert.ok(legendMatch, "expected LEGEND_STATUSES");
  const legend = [...legendMatch[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual([...legend].sort(), [...STATUSES].sort());
});

test("contract: renderer status glyphs, funnel stages, and observability rail match the wiring walkthrough", () => {
  assert.deepEqual(stringEntriesFromObjectLiteral(componentSource, "const STATUS_GLYPH"), {
    healthy: "✓",
    checking: "◌",
    degraded: "!",
    down: "✕",
    idle: "–",
    unknown: "?",
  });
  assert.match(
    wiringDoc,
    /healthy ✓, checking ◌, degraded !, down ✕, idle –, unknown \?/,
  );

  const bandLabels = [
    ...componentSource.matchAll(/\{\s*id:\s*"[^"]+",\s*label:\s*"([^"]+)"/g),
  ].map((match) => match[1]);
  // LANE_BANDS stays as the conceptual layout/viewBox reference...
  assert.deepEqual(bandLabels, [
    "1 · SOURCES & DISTRIBUTION",
    "2 · MARKET DATA",
    "3 · SIGNALS · FLOW · GEX → ALGO",
    "4 · ACCOUNT",
    "OBSERVABILITY & CLIENTS",
  ]);
  // ...but the lane chrome is NOT drawn: no stage labels rendered (band.label
  // is only read by the removed render; viewBox uses band.x/y/w/h, not label).
  assert.doesNotMatch(componentSource, /band\.label/);
  assert.match(componentSource, /const ATTENTION_STATUSES = new Set\(\["checking", "degraded", "down"\]\)/);
  // Connectors into the observability rail are limited to the Database card: the
  // alert overlay was removed, so trouble surfaces via the Diagnostics card +
  // attention strip only, and the Diagnostics card itself takes no incoming edges.
  assert.doesNotMatch(componentSource, /viewKind: "alert"/);
  assert.doesNotMatch(componentSource, /to: "diagnostics"/);
  // The Database card (also in the rail) is the one deliberate exception: every
  // card persists into it. The persistence edges render as a single tight,
  // non-crossing BUS (buildDatabaseHighway, not VISUAL_FLOW_EDGES): feeders merge
  // into one trunk in the right gutter and diverge into the card's labeled left
  // edge. Lock the bus and all 8 left-feeding sources.
  assert.match(componentSource, /const buildDatabaseHighway = /);
  assert.match(componentSource, /const DB_HIGHWAY_SOURCES = /);
  for (const id of [
    "massive",
    "broker",
    "market",
    "gex",
    "signals",
    "flow",
    "algo",
    "account",
  ]) {
    assert.match(
      componentSource,
      new RegExp(`id: "${id}", feeder:`),
      `expected ${id} as a Database bus source`,
    );
  }
  // Diagnostics persists too, routed straight down the rail gutter into the top.
  assert.match(componentSource, /id: "diagnostics->database"/);
  // No crossings: lane-x DECREASES as entry-y increases (outer/top lane exits
  // first), so an exiting lane never crosses one still descending.
  assert.match(componentSource, /\(mid - i\) \* DB_HIGHWAY_LANE_GAP/);
  // Signals/Flow/GEX/Account converge into Algo as the same kind of bus.
  assert.match(componentSource, /const buildAlgoConvergence = /);
  assert.match(componentSource, /id: "account->algo"/);
  // Position Quotes (and any split node) renders a single worst-of glyph; the
  // live/shadow breakdown lives in the card footer detail, not a doubled glyph.
  assert.doesNotMatch(componentSource, /child\.split \?/);
  // Market Data fans out per source column: Equities (col 0) -> Signals,
  // Options (col 1) -> Flow and GEX, anchored via marketColumnPortX.
  assert.match(componentSource, /to: "signals",[\s\S]{0,200}?fromCol: 0/);
  assert.match(componentSource, /to: "flow",[\s\S]{0,200}?fromCol: 1/);
  assert.match(componentSource, /to: "gex",[\s\S]{0,200}?fromCol: 1/);
  assert.match(componentSource, /const marketColumnPortX = /);
  // Each edge declares the transport means; multi-means edges draw parallel
  // lines + per-means dots (tooltips). Delayed paths (fresh:false) are distinct.
  assert.match(componentSource, /transports: \[/);
  assert.match(componentSource, /const TRANSPORT_LINE_GAP = /);
  assert.match(componentSource, /diagnostics-machine-edge-dot/);
  // The Flow line carries BOTH the IBKR realtime and Massive delayed means.
  assert.match(componentSource, /Massive ≥15m delayed/);
  assert.doesNotMatch(componentSource, /height="auto"/);
});

test("contract: evidence vocabulary is pinned across model, renderer, and wiring doc", () => {
  const modelEvidence = keysFromObjectLiteral(modelSource, "const EVIDENCE_ORDER");
  assert.deepEqual([...modelEvidence].sort(), [...EVIDENCE].sort());
  const legendMatch = componentSource.match(/const LEGEND_EVIDENCE = \[([^\]]+)\]/);
  assert.ok(legendMatch, "expected LEGEND_EVIDENCE");
  const legend = [...legendMatch[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual([...legend].sort(), [...EVIDENCE].sort());
  assert.match(wiringDoc, /`unknown \| inferred \| observed`/);
});

test("contract: observedAt is never fabricated", () => {
  assert.equal(emptyModel().observedAt, null);
  // The renderer must not synthesize times either.
  assert.doesNotMatch(componentSource, /Date\.now\(\)/);
  assert.doesNotMatch(componentSource, /new Date\(\)/);
});

test("contract: mirrored backend constants match their pinned values", () => {
  // If one of these fails, re-verify the cited backend source before bumping
  // (see MACHINE_STATE_WIRING.md "Mirrored backend constants").
  assert.equal(DIAGNOSTICS_COLLECTION_INTERVAL_MS, 15_000);
  assert.equal(IBKR_HEARTBEAT_WARNING_MS, 30_000);
  assert.equal(MARKET_DATA_FRESHNESS_WARNING_MS, 2_000);
  assert.equal(MARKET_DATA_STREAM_GAP_WARNING_MS, 5_000);
  assert.equal(BROWSER_MEMORY_WATCH_PERCENT, 60);
  assert.equal(BROWSER_MEMORY_HIGH_PERCENT, 75);
  assert.equal(SNAPSHOT_STALE_MS, 2 * DIAGNOSTICS_COLLECTION_INTERVAL_MS);
  assert.equal(SNAPSHOT_EXPIRED_MS, 4 * DIAGNOSTICS_COLLECTION_INTERVAL_MS);
});

test("contract: decay tiers trip exactly at their boundaries", () => {
  const timestamp = "2026-06-12T11:59:58.000Z";
  const baseMs = Date.parse(timestamp);
  const latest = {
    timestamp,
    status: "ok",
    severity: "success",
    events: [],
    snapshots: [
      { subsystem: "api", status: "ok", severity: "success", metrics: { p95LatencyMs: 40 } },
    ],
  };
  const apiAt = (nowMs) =>
    buildMachineStateDiagramModel({ latest, nowMs }).nodes.find(
      (node) => node.id === "api-runtime",
    );

  const atStaleBoundary = apiAt(baseMs + SNAPSHOT_STALE_MS);
  assert.equal(atStaleBoundary.evidence, "observed");
  const pastStale = apiAt(baseMs + SNAPSHOT_STALE_MS + 1);
  assert.equal(pastStale.evidence, "inferred");
  assert.equal(pastStale.status, "healthy");
  const pastExpired = apiAt(baseMs + SNAPSHOT_EXPIRED_MS + 1);
  assert.equal(pastExpired.status, "unknown");
  assert.match(pastExpired.detail, /snapshot .* old/);
});

test("contract: edge animation requires evidence, flow-capable status, and freshness", () => {
  const model = emptyModel();
  for (const edge of [...model.edges, ...model.groups.edges]) {
    if (edge.animated) {
      assert.notEqual(edge.evidence, "unknown", `${edge.id} animates without evidence`);
      assert.ok(
        edge.status === "healthy" || edge.status === "checking",
        `${edge.id} animates with status ${edge.status}`,
      );
    }
  }
  // With no inputs at all, nothing may animate.
  assert.equal(model.edges.some((edge) => edge.animated), false);
});
