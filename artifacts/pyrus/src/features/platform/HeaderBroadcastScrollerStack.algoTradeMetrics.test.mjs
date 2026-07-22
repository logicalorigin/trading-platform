import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildHeaderAlgoTapeItems } from "./headerBroadcastModel.js";

const source = readFileSync(
  new URL("./HeaderBroadcastScrollerStack.jsx", import.meta.url),
  "utf8",
);

test("production-shaped algo events expose only authored trade metrics", () => {
  const items = buildHeaderAlgoTapeItems([
    {
      id: "exit",
      symbol: "AAPL",
      eventType: "signal_options_shadow_exit",
      occurredAt: "2026-07-18T20:00:00.000Z",
      payload: {
        reason: "hard_stop",
        exitPrice: 5.4,
        pnl: 842.35,
        position: {
          symbol: "AAPL",
          optionRight: "call",
          premiumAtRisk: 1_260,
          quantity: 3,
        },
        selectedContract: {
          expirationDate: "2026-07-24",
          multiplier: 100,
          right: "call",
          strike: 220,
        },
      },
    },
    {
      id: "mark",
      symbol: "NVDA",
      eventType: "signal_options_shadow_mark",
      occurredAt: "2026-07-18T19:59:00.000Z",
      payload: {
        position: {
          symbol: "NVDA",
          optionRight: "put",
          entryPrice: 2.1,
          lastMarkPrice: 1.85,
          premiumAtRisk: 1_050,
          quantity: 5,
          selectedContract: {
            expirationDate: "2026-07-24",
            multiplier: 100,
            right: "put",
            strike: 165,
          },
        },
        selectedContract: {
          expirationDate: "2026-07-24",
          multiplier: 100,
          right: "put",
          strike: 165,
        },
        quote: { bid: 1.8, ask: 1.9, mark: 1.85 },
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
  assert.equal(
    items[0].contextIcons.find((context) => context.metricLabel === "P&L")
      ?.label,
    "Profitable exit +$842",
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
      ["money", "PREM", "$1.1K"],
      ["quantity", "SIZE", "x5"],
    ],
  );
  assert.equal(
    items[1].contextIcons.some((context) => context.metricLabel === "P&L"),
    false,
    "mark writers do not author a P&L field for the header to present",
  );
});

test("sub-dollar algo P&L retains cents instead of displaying as zero", () => {
  const [item] = buildHeaderAlgoTapeItems([
    {
      id: "sub-dollar-exit",
      symbol: "AAPL",
      eventType: "signal_options_shadow_exit",
      occurredAt: "2026-07-18T20:00:00.000Z",
      payload: {
        pnl: -0.4,
      },
    },
  ]);

  assert.equal(
    item.contextIcons.find((context) => context.metricLabel === "P&L")
      ?.valueLabel,
    "-$0.40",
  );
  assert.equal(
    item.contextIcons.find((context) => context.metricLabel === "P&L")?.label,
    "Losing exit -$0.40",
  );
});

test("algo tape renders authored trade metrics as right-edge pills", () => {
  assert.match(source, /const HeaderAlgoTradeMetricPill =/);
  assert.match(
    source,
    /const metricTone = `color-mix\(in srgb, \$\{tone\} 80%, \$\{CSS_COLOR\.text\}\)`;/,
  );
  assert.match(
    source,
    /data-algo-trade-metric=\{context\.metricLabel\}/,
  );
  assert.match(source, /color: metricTone,/);
  assert.match(
    source,
    /color: CSS_COLOR\.textSec,[\s\S]*?\{context\.metricLabel\}/,
  );
  assert.match(source, /borderRadius: dim\(RADII\.pill\)/);
  assert.match(source, /marginLeft: "auto"/);
  assert.match(source, /maxWidth=\{compact \? 260 : 360\}/);
  assert.match(
    source,
    /\(item\.contextIcons \|\| \[\]\)\.filter\(\(context\) => context\.metricLabel\)/,
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
