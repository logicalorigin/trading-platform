import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildHeaderAlgoTapeItems } from "./headerBroadcastModel.js";

const source = readFileSync(
  new URL("./HeaderBroadcastScrollerStack.jsx", import.meta.url),
  "utf8",
);

test("algo events identify only trade-level values as header metrics", () => {
  const items = buildHeaderAlgoTapeItems([
    {
      id: "exit",
      eventType: "signal_options_shadow_exit",
      createdAt: "2026-07-18T20:00:00.000Z",
      payload: {
        symbol: "AAPL",
        pnl: 842.35,
        position: {
          optionRight: "call",
          premiumAtRisk: 1_260,
          quantity: 3,
        },
      },
    },
    {
      id: "mark",
      eventType: "signal_options_shadow_mark",
      createdAt: "2026-07-18T19:59:00.000Z",
      payload: {
        symbol: "NVDA",
        pnl: -126.4,
        position: {
          quantity: 5,
          dte: 2,
        },
      },
    },
  ]);

  assert.deepEqual(
    items[0].contextIcons
      .filter((context) => context.metricLabel)
      .map((context) => [
        context.kind,
        context.metricLabel,
        context.valueLabel,
      ]),
    [
      ["status", "P&L", "+$842"],
      ["money", "PREM", "$1.3K"],
      ["quantity", "SIZE", "x3"],
    ],
  );
  assert.deepEqual(
    items[1].contextIcons
      .filter((context) => context.metricLabel)
      .map((context) => [
        context.kind,
        context.metricLabel,
        context.valueLabel,
      ]),
    [
      ["money", "P&L", "-$126"],
      ["quantity", "SIZE", "x5"],
      ["dte", "DTE", "2d"],
    ],
  );
  assert.equal(
    items[0].contextIcons.find((context) => context.metricLabel === "P&L")
      ?.label,
    "Profitable exit +$842",
  );
});

test("sub-dollar algo P&L retains cents instead of displaying as zero", () => {
  const [item] = buildHeaderAlgoTapeItems([
    {
      id: "sub-dollar-exit",
      eventType: "signal_options_shadow_exit",
      createdAt: "2026-07-18T20:00:00.000Z",
      payload: {
        symbol: "AAPL",
        pnl: -0.4,
      },
    },
  ]);

  const pnlContext = item.contextIcons.find(
    (context) => context.metricLabel === "P&L",
  );
  assert.deepEqual(
    { label: pnlContext?.label, valueLabel: pnlContext?.valueLabel },
    { label: "Losing exit -$0.40", valueLabel: "-$0.40" },
  );
});

test("algo tape renders authored trade metrics as right-edge pills", () => {
  assert.match(source, /const HeaderAlgoTradeMetricPill =/);
  assert.match(source, /data-algo-trade-metric=\{context\.metricLabel\}/);
  assert.match(source, /borderRadius: dim\(RADII\.pill\)/);
  assert.match(source, /marginLeft: "auto"/);
  assert.match(source, /maxWidth=\{compact \? 260 : 360\}/);
  assert.match(
    source,
    /const contextIcons = \(item\.contextIcons \|\| \[\]\)\.filter\(\s*\(context\) => !context\.metricLabel,?\s*\)/,
  );
  assert.match(
    source,
    /\(item\.contextIcons \|\| \[\]\)\.filter\(\s*\(context\) => context\.metricLabel,?\s*\)/,
  );
});

test("the aria-hidden algo tape copy disables trade-metric tooltips", () => {
  assert.match(
    source,
    /const HeaderAlgoTradeMetricPill = \(\{[\s\S]*?tooltipsEnabled = true,[\s\S]*?\}\) =>/,
  );
  assert.match(source, /disabled=\{!tooltipsEnabled\}/);
  assert.match(
    source,
    /<HeaderAlgoTradeMetricPill[\s\S]*?tooltipsEnabled=\{!duplicate\}/,
  );
});
