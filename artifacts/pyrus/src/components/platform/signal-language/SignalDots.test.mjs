import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  SignalDots,
  resolveSignalDotGlyph,
  resolveSignalDotHydrationMeta,
} from "./SignalDots.jsx";
import { CSS_COLOR, cssColorMix } from "../../../lib/uiTokens.jsx";

const NEUTRAL_TONE = cssColorMix(CSS_COLOR.textDim, 58);
const SIGNAL_LANGUAGE_DIR = dirname(fileURLToPath(import.meta.url));

test("signal-language public surface excludes retired confluence helpers", () => {
  const indexSource = readFileSync(join(SIGNAL_LANGUAGE_DIR, "index.js"), "utf8");
  const tooltipSource = readFileSync(join(SIGNAL_LANGUAGE_DIR, "tooltips.js"), "utf8");

  assert.doesNotMatch(indexSource, /\bConfluenceChip\b/);
  assert.doesNotMatch(indexSource, /\bdirectionGlyphTone\b/);
  assert.doesNotMatch(tooltipSource, /\bconfluenceTooltip\b/);
});

test("signal dots classify an aged display signal as aged (directional), not stale", () => {
  const meta = resolveSignalDotHydrationMeta({
    status: "ok",
    currentSignalDirection: "buy",
    currentSignalAt: "2026-06-09T18:10:00.000Z",
    latestBarAt: "2026-06-09T18:15:00.000Z",
    fresh: false,
  });

  // "stale" is reserved for MISSING signals; a present-but-old signal is "aged".
  assert.equal(meta.hydrationState, "aged");
  assert.equal(meta.stale, false);
  assert.equal(meta.aged, true);
  assert.equal(meta.unhydrated, false);
  assert.equal(meta.attention, false);
});

test("signal dots mark pending, missing, and telemetry-free cells as unhydrated", () => {
  assert.equal(resolveSignalDotHydrationMeta(null).hydrationState, "unhydrated");
  assert.equal(
    resolveSignalDotHydrationMeta({ status: "pending", latestBarAt: "2026-06-09T18:15:00.000Z" })
      .hydrationState,
    "unhydrated",
  );
  assert.equal(
    resolveSignalDotHydrationMeta({ status: "ok", currentSignalDirection: "sell" })
      .hydrationState,
    "unhydrated",
  );
});

test("signal dots leave hydrated no-signal cells unmarked", () => {
  const meta = resolveSignalDotHydrationMeta({
    status: "ok",
    latestBarAt: "2026-06-09T18:15:00.000Z",
    fresh: false,
  });

  assert.equal(meta.hydrationState, "hydrated");
  assert.equal(meta.attention, false);
});

test("glyph: a fresh buy is an up arrow in blue at full opacity", () => {
  const glyph = resolveSignalDotGlyph({
    status: "ok",
    currentSignalDirection: "buy",
    currentSignalAt: "2026-06-09T18:10:00.000Z",
    latestBarAt: "2026-06-09T18:15:00.000Z",
    fresh: true,
  });

  assert.equal(glyph.kind, "buy");
  assert.equal(glyph.tone, CSS_COLOR.blue);
  assert.equal(glyph.attention, false);
  assert.equal(glyph.fresh, true);
  assert.equal(glyph.opacity, 1);
});

test("glyph: a fresh sell is a down arrow in red", () => {
  const glyph = resolveSignalDotGlyph({
    status: "ok",
    currentSignalDirection: "sell",
    currentSignalAt: "2026-06-09T18:10:00.000Z",
    latestBarAt: "2026-06-09T18:15:00.000Z",
    fresh: true,
  });

  assert.equal(glyph.kind, "sell");
  assert.equal(glyph.tone, CSS_COLOR.red);
});

test("glyph: an aged (ok, fresh=false) buy stays a blue up arrow, dimmed (not amber)", () => {
  const glyph = resolveSignalDotGlyph({
    status: "ok",
    currentSignalDirection: "buy",
    currentSignalAt: "2026-06-09T18:10:00.000Z",
    latestBarAt: "2026-06-09T18:15:00.000Z",
    fresh: false,
  });

  assert.equal(glyph.kind, "buy"); // last-known direction preserved
  assert.equal(glyph.tone, CSS_COLOR.blue); // aged keeps its directional color
  assert.equal(glyph.attention, false); // aged is not an attention state
  assert.equal(glyph.staleDirectional, false); // amber reserved for stale/missing
  assert.equal(glyph.opacity, 0.76); // dimmed to convey aged
});

test("glyph: an aged (ok, fresh=false) sell stays a red down arrow, dimmed (not amber)", () => {
  const glyph = resolveSignalDotGlyph({
    status: "ok",
    currentSignalDirection: "sell",
    currentSignalAt: "2026-06-09T18:10:00.000Z",
    latestBarAt: "2026-06-09T18:15:00.000Z",
    fresh: false,
  });

  assert.equal(glyph.kind, "sell"); // last-known direction (down) preserved
  assert.equal(glyph.tone, CSS_COLOR.red); // aged keeps its directional color
  assert.equal(glyph.attention, false);
  assert.equal(glyph.staleDirectional, false);
  assert.equal(glyph.opacity, 0.76);
});

test("glyph: a stale buy is an amber up arrow with no accent dot", () => {
  const glyph = resolveSignalDotGlyph({
    status: "stale",
    currentSignalDirection: "buy",
    currentSignalAt: "2026-06-09T18:10:00.000Z",
    latestBarAt: "2026-06-09T18:15:00.000Z",
    fresh: false,
  });

  assert.equal(glyph.kind, "buy"); // last-known direction preserved
  assert.equal(glyph.tone, CSS_COLOR.amber); // whole arrow recolored amber
  assert.equal(glyph.staleDirectional, true); // -> renderer drops the dot
  assert.equal(glyph.attention, true);
});

test("glyph: a stale sell is an amber down arrow with no accent dot", () => {
  const glyph = resolveSignalDotGlyph({
    status: "stale",
    currentSignalDirection: "sell",
    currentSignalAt: "2026-06-09T18:10:00.000Z",
    latestBarAt: "2026-06-09T18:15:00.000Z",
    fresh: false,
  });

  assert.equal(glyph.kind, "sell"); // last-known direction (down) preserved
  assert.equal(glyph.tone, CSS_COLOR.amber); // whole arrow recolored amber
  assert.equal(glyph.staleDirectional, true);
  assert.equal(glyph.attention, true);
});

test("glyph: an idle directional cell keeps its latched directional color, dimmed (not amber)", () => {
  const glyph = resolveSignalDotGlyph({
    status: "idle",
    currentSignalDirection: "buy",
    currentSignalAt: "2026-06-09T18:10:00.000Z",
    latestBarAt: "2026-06-09T18:15:00.000Z",
    fresh: false,
  });

  // Idle (market idle) with a latched signal is aged, not missing -> directional.
  assert.equal(glyph.kind, "buy"); // latched direction preserved
  assert.equal(glyph.tone, CSS_COLOR.blue); // aged/idle keeps its color, amber is for stale
  assert.equal(glyph.staleDirectional, false);
  assert.equal(glyph.opacity, 0.76);
});

test("glyph: a hydrated no-signal cell is a neutral muted marker", () => {
  const glyph = resolveSignalDotGlyph({
    status: "ok",
    latestBarAt: "2026-06-09T18:15:00.000Z",
    fresh: false,
  });

  assert.equal(glyph.kind, "neutral");
  assert.equal(glyph.tone, NEUTRAL_TONE);
  assert.equal(glyph.attention, false);
  assert.equal(glyph.opacity, 0.88);
});

test("glyph: a pending cell is a dimmed neutral marker flagged for attention", () => {
  const glyph = resolveSignalDotGlyph({
    status: "pending",
    latestBarAt: "2026-06-09T18:15:00.000Z",
  });

  assert.equal(glyph.kind, "neutral");
  assert.equal(glyph.pending, true);
  assert.equal(glyph.attention, true);
  assert.equal(glyph.tone, NEUTRAL_TONE);
  assert.equal(glyph.opacity, 0.72);
});

test("glyph: a missing cell is a neutral attention marker", () => {
  const glyph = resolveSignalDotGlyph(null);

  assert.equal(glyph.kind, "neutral");
  assert.equal(glyph.attention, true);
  assert.equal(glyph.tone, NEUTRAL_TONE);
});

test("only directional signal dots render as actionable targets", () => {
  const markup = renderToStaticMarkup(
    React.createElement(SignalDots, {
      timeframes: ["1m", "5m"],
      onSelect: () => {},
      statesByTimeframe: {
        "1m": {
          status: "ok",
          currentSignalDirection: "buy",
          currentSignalAt: "2026-06-09T18:10:00.000Z",
          latestBarAt: "2026-06-09T18:15:00.000Z",
          fresh: true,
        },
        "5m": {
          status: "pending",
          latestBarAt: "2026-06-09T18:15:00.000Z",
        },
      },
    }),
  );

  assert.equal(markup.match(/<button/g)?.length, 1);
  assert.match(
    markup,
    /<button[^>]*data-timeframe="1m"[^>]*class="[^"]*ra-touch-target-y[^"]*"/,
  );
  assert.match(markup, /<span[^>]*data-timeframe="5m"[^>]*role="img"/);
});
