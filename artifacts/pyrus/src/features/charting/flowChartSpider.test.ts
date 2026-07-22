import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  ChartEvent,
  ChartEventBias,
  ChartEventSeverity,
} from "./chartEvents.ts";
import type { FlowChartEventPlacement } from "./flowChartEvents.ts";
import { buildFlowChartEventPlacements } from "./flowChartEvents.ts";
import { buildFlowEventClusters } from "./flowChartSpider.ts";

const time = "2026-07-20T14:30:00.000Z";
const chartTime = Date.parse(time) / 1_000;

const placement = ({
  id,
  severity,
  bias,
  premium,
}: {
  id: string;
  severity: ChartEventSeverity;
  bias: ChartEventBias;
  premium: number;
}): FlowChartEventPlacement => {
  const event: ChartEvent = {
    id,
    symbol: "AAPL",
    eventType: "unusual_flow",
    time,
    placement: "bar",
    severity,
    label: id,
    summary: "Flow event",
    source: "test",
    confidence: 1,
    bias,
    actions: [],
    metadata: {
      sourceBasis: "confirmed_trade",
      optionTicker: id,
      premium,
    },
  };

  return buildFlowChartEventPlacements([event], {
    chartBars: [
      {
        time: chartTime,
        ts: time,
        date: time.slice(0, 10),
        o: 100,
        h: 101,
        l: 99,
        c: 100,
        v: 1_000,
      },
    ],
  })[0];
};

test("dominant severity cannot be outweighed by premium", () => {
  const [cluster] = buildFlowEventClusters(
    [
      placement({
        id: "large-low",
        severity: "low",
        bias: "neutral",
        premium: 4_000_000_000_000,
      }),
      placement({
        id: "small-extreme",
        severity: "extreme",
        bias: "bearish",
        premium: 1,
      }),
    ],
    () => ({ x: 0, y: 0 }),
  );

  assert.equal(cluster.dominantSeverity, "extreme");
  assert.equal(cluster.dominantBias, "bearish");
});
