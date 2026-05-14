import test from "node:test";
import assert from "node:assert/strict";
import type { ChartEvent } from "./chartEvents";
import { buildFlowChartEventPlacements } from "./flowChartEvents";
import type { ChartBar, ChartBarRange } from "./types";
import {
  SPIDER_ANGLE_OFFSET,
  SPIDER_BASE_RADIUS,
  SPIDER_RING_SPACING,
  buildFlowEventClusters,
  computeSpiderChildPositions,
  spiderRingCapacity,
} from "./flowChartSpider";

const bars: ChartBar[] = [
  {
    time: Date.parse("2026-05-12T14:30:00.000Z") / 1000,
    ts: "2026-05-12T14:30:00.000Z",
    date: "2026-05-12",
    o: 100, h: 101, l: 99, c: 100.5, v: 100_000,
  },
  {
    time: Date.parse("2026-05-12T14:35:00.000Z") / 1000,
    ts: "2026-05-12T14:35:00.000Z",
    date: "2026-05-12",
    o: 100.5, h: 103, l: 100, c: 102, v: 120_000,
  },
  {
    time: Date.parse("2026-05-12T14:40:00.000Z") / 1000,
    ts: "2026-05-12T14:40:00.000Z",
    date: "2026-05-12",
    o: 102, h: 104, l: 101, c: 103, v: 130_000,
  },
];

const ranges: ChartBarRange[] = [
  { startMs: Date.parse("2026-05-12T14:30:00.000Z"), endMs: Date.parse("2026-05-12T14:35:00.000Z") },
  { startMs: Date.parse("2026-05-12T14:35:00.000Z"), endMs: Date.parse("2026-05-12T14:40:00.000Z") },
  { startMs: Date.parse("2026-05-12T14:40:00.000Z"), endMs: Date.parse("2026-05-12T14:45:00.000Z") },
];

const flowEvent = (event: Partial<ChartEvent>): ChartEvent => ({
  id: event.id || "flow",
  symbol: "AAPL",
  eventType: "unusual_flow",
  time: event.time || "2026-05-12T14:36:00.000Z",
  placement: "bar",
  severity: event.severity || "medium",
  label: event.label || "C",
  summary: "test flow",
  source: "test",
  confidence: 0.7,
  bias: event.bias || "bullish",
  actions: ["open_flow"],
  metadata: {
    basis: "trade",
    sourceBasis: "confirmed_trade",
    cp: "C",
    premium: 100_000,
    ...(event.metadata || {}),
  },
});

const placements = (events: ChartEvent[]) =>
  buildFlowChartEventPlacements(events, { chartBars: bars, chartBarRanges: ranges });

const anchorByBar = (xPerBar: Record<number, number>, yPerBar: Record<number, number>) =>
  (placement: { barIndex: number }) => ({
    x: xPerBar[placement.barIndex],
    y: yPerBar[placement.barIndex] ?? 50,
  });

test("buildFlowEventClusters groups events on the same bar into one cluster", () => {
  const events = [
    flowEvent({ id: "a", time: "2026-05-12T14:36:10.000Z" }),
    flowEvent({ id: "b", time: "2026-05-12T14:36:20.000Z" }),
    flowEvent({ id: "c", time: "2026-05-12T14:36:40.000Z" }),
  ];
  const result = buildFlowEventClusters(
    placements(events),
    anchorByBar({ 1: 200 }, { 1: 60 }),
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].count, 3);
  assert.equal(result[0].kind, "cluster");
});

test("single-event cluster reports kind === 'single' and skips spider positions", () => {
  const result = buildFlowEventClusters(
    placements([flowEvent({ id: "only", time: "2026-05-12T14:36:00.000Z" })]),
    anchorByBar({ 1: 100 }, { 1: 50 }),
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "single");
  assert.equal(computeSpiderChildPositions(result[0]).length, 0);
});

test("merges adjacent bars whose pixel anchors fall within the merge threshold", () => {
  const events = [
    flowEvent({ id: "bar1-a", time: "2026-05-12T14:31:00.000Z" }),
    flowEvent({ id: "bar2-a", time: "2026-05-12T14:36:00.000Z" }),
  ];
  const merged = buildFlowEventClusters(
    placements(events),
    anchorByBar({ 0: 100, 1: 120 }, { 0: 50, 1: 50 }),
    { mergeThresholdPx: 30 },
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].count, 2);

  const apart = buildFlowEventClusters(
    placements(events),
    anchorByBar({ 0: 100, 1: 200 }, { 0: 50, 1: 50 }),
    { mergeThresholdPx: 30 },
  );
  assert.equal(apart.length, 2);
});

test("does not merge bars that share x but differ in y past the threshold", () => {
  const events = [
    flowEvent({ id: "bar1", time: "2026-05-12T14:31:00.000Z" }),
    flowEvent({ id: "bar2", time: "2026-05-12T14:36:00.000Z" }),
  ];
  const result = buildFlowEventClusters(
    placements(events),
    anchorByBar({ 0: 100, 1: 110 }, { 0: 50, 1: 200 }),
    { mergeThresholdPx: 30 },
  );
  assert.equal(result.length, 2);
});

test("members preserve sourceBasis-then-eventTimeMs order in the cluster", () => {
  const events = [
    flowEvent({ id: "later-confirmed", time: "2026-05-12T14:36:40.000Z" }),
    flowEvent({ id: "earlier-confirmed", time: "2026-05-12T14:36:10.000Z" }),
  ];
  const result = buildFlowEventClusters(
    placements(events),
    anchorByBar({ 1: 100 }, { 1: 50 }),
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].members[0].event.id, "earlier-confirmed");
  assert.equal(result[0].members[1].event.id, "later-confirmed");
});

test("dominant severity is the highest among members; bias tracks that event", () => {
  const events = [
    flowEvent({ id: "low", severity: "low", bias: "neutral" }),
    flowEvent({ id: "extreme", severity: "extreme", bias: "bearish", time: "2026-05-12T14:36:30.000Z" }),
    flowEvent({ id: "med", severity: "medium", bias: "bullish", time: "2026-05-12T14:36:40.000Z" }),
  ];
  const result = buildFlowEventClusters(
    placements(events),
    anchorByBar({ 1: 100 }, { 1: 50 }),
  );
  assert.equal(result[0].dominantSeverity, "extreme");
  assert.equal(result[0].dominantBias, "bearish");
});

test("cluster id is stable across re-clustering for the same members", () => {
  const events = [
    flowEvent({ id: "a", time: "2026-05-12T14:36:10.000Z" }),
    flowEvent({ id: "b", time: "2026-05-12T14:36:20.000Z" }),
  ];
  const left = buildFlowEventClusters(placements(events), anchorByBar({ 1: 100 }, { 1: 50 }));
  const right = buildFlowEventClusters(placements(events), anchorByBar({ 1: 250 }, { 1: 80 }));
  assert.equal(left[0].id, right[0].id);
});

test("spider ring capacities follow the documented sequence", () => {
  assert.equal(spiderRingCapacity(0), 7);
  assert.equal(spiderRingCapacity(1), 12);
  assert.equal(spiderRingCapacity(2), 17);
});

const buildClusterOf = (count: number) => {
  const events = Array.from({ length: count }, (_, index) =>
    flowEvent({
      id: `evt-${index}`,
      time: `2026-05-12T14:36:${String(10 + index).padStart(2, "0")}.000Z`,
    }),
  );
  const [cluster] = buildFlowEventClusters(
    placements(events),
    anchorByBar({ 1: 200 }, { 1: 60 }),
  );
  return cluster;
};

test("ring overflow: 9 members spill into ring 1 with two outer markers", () => {
  const positions = computeSpiderChildPositions(buildClusterOf(9));
  assert.equal(positions.length, 9);
  assert.equal(positions.filter((p) => p.ring === 0).length, 7);
  assert.equal(positions.filter((p) => p.ring === 1).length, 2);
});

test("ring overflow: 15 members fill ring 0 (7) and partially fill ring 1 (8)", () => {
  const positions = computeSpiderChildPositions(buildClusterOf(15));
  assert.equal(positions.filter((p) => p.ring === 0).length, 7);
  assert.equal(positions.filter((p) => p.ring === 1).length, 8);
});

test("ring overflow: 23 members spill into ring 2", () => {
  const positions = computeSpiderChildPositions(buildClusterOf(23));
  assert.equal(positions.filter((p) => p.ring === 0).length, 7);
  assert.equal(positions.filter((p) => p.ring === 1).length, 12);
  assert.equal(positions.filter((p) => p.ring === 2).length, 4);
});

test("cluster.totalPremium sums member premiums", () => {
  const events = [
    flowEvent({ id: "a", time: "2026-05-12T14:36:10.000Z", metadata: { premium: 100_000 } }),
    flowEvent({ id: "b", time: "2026-05-12T14:36:20.000Z", metadata: { premium: 250_000 } }),
    flowEvent({ id: "c", time: "2026-05-12T14:36:30.000Z", metadata: { premium: 50_000 } }),
  ];
  const [cluster] = buildFlowEventClusters(
    placements(events),
    anchorByBar({ 1: 100 }, { 1: 50 }),
  );
  assert.equal(cluster.totalPremium, 400_000);
});

test("first spider slot points 'up' (angle = -π/2) at the base radius", () => {
  const cluster = buildClusterOf(3);
  const [first] = computeSpiderChildPositions(cluster);
  assert.equal(first.angle, SPIDER_ANGLE_OFFSET);
  const dx = first.x - cluster.anchorX;
  const dy = first.y - cluster.anchorY;
  assert.ok(Math.abs(dx) < 1e-6, `dx should be ~0, got ${dx}`);
  assert.ok(Math.abs(dy + SPIDER_BASE_RADIUS) < 1e-6);
});

test("ring 1 radius equals base + ring spacing", () => {
  const cluster = buildClusterOf(9);
  const positions = computeSpiderChildPositions(cluster);
  const ring1 = positions.find((p) => p.ring === 1)!;
  const dist = Math.hypot(ring1.x - cluster.anchorX, ring1.y - cluster.anchorY);
  assert.ok(Math.abs(dist - (SPIDER_BASE_RADIUS + SPIDER_RING_SPACING)) < 1e-6);
});
