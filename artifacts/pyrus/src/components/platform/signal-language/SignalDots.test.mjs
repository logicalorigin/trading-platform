import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
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

test("signal dots mark aged display signals for the amber attention ring", () => {
  const meta = resolveSignalDotHydrationMeta({
    status: "ok",
    currentSignalDirection: "buy",
    currentSignalAt: "2026-06-09T18:10:00.000Z",
    latestBarAt: "2026-06-09T18:15:00.000Z",
    fresh: false,
  });

  assert.equal(meta.hydrationState, "stale");
  assert.equal(meta.stale, true);
  assert.equal(meta.unhydrated, false);
  assert.equal(meta.attention, true);
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

test("glyph: an aged buy stays blue (never amber) — the 'red for buy' fix", () => {
  const glyph = resolveSignalDotGlyph({
    status: "ok",
    currentSignalDirection: "buy",
    currentSignalAt: "2026-06-09T18:10:00.000Z",
    latestBarAt: "2026-06-09T18:15:00.000Z",
    fresh: false,
  });

  assert.equal(glyph.kind, "buy");
  assert.equal(glyph.tone, CSS_COLOR.blue); // direction drives color, not staleness
  assert.equal(glyph.attention, true); // staleness -> amber accent dot, not recolor
  assert.equal(glyph.opacity, 0.76);
});

test("glyph: an aged sell stays red, flags attention separately", () => {
  const glyph = resolveSignalDotGlyph({
    status: "ok",
    currentSignalDirection: "sell",
    currentSignalAt: "2026-06-09T18:10:00.000Z",
    latestBarAt: "2026-06-09T18:15:00.000Z",
    fresh: false,
  });

  assert.equal(glyph.kind, "sell"); // direction (down) preserved
  assert.equal(glyph.tone, CSS_COLOR.red); // color stays red, never amber
  assert.equal(glyph.attention, true);
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
