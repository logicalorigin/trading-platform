import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./PlatformAlgoMonitorSidebar.jsx", import.meta.url),
  "utf8",
);
const strategyTagSource = readFileSync(
  new URL("../../components/platform/signal-language/StrategyTag.jsx", import.meta.url),
  "utf8",
);
const attentionStripSource = readFileSync(
  new URL("../../screens/algo/OperationsAttentionStrip.jsx", import.meta.url),
  "utf8",
);

test("algo signal rows keep semantic color in content, not decorative card rails", () => {
  const rows = source.slice(
    source.indexOf("const SignalActionMetaCell"),
    source.indexOf("const CompactMetric"),
  );

  assert.doesNotMatch(rows, /<MetricChip/);
  assert.doesNotMatch(rows, /linear-gradient/);
  assert.doesNotMatch(rows, /inset 3px 0 0/);
  assert.match(rows, /border: `1px solid \$\{CSS_COLOR\.border\}`/);
});

test("algo signal status is one flat semantic glyph and label", () => {
  const status = source.slice(
    source.indexOf("const SignalActionStatusPill"),
    source.indexOf("const SignalActionMetaCell"),
  );

  assert.match(status, /resolveSignalVerdict/);
  assert.doesNotMatch(status, /<StatusPill/);
  assert.doesNotMatch(status, /<VerdictGlyph/);
  assert.match(status, /background: "transparent"/);
});

test("algo summary and intake internals avoid tinted chip mosaics", () => {
  const summary = source.slice(
    source.indexOf("const CompactMetric"),
    source.indexOf("const pipelineStageTone"),
  );
  const intake = source.slice(
    source.indexOf("const IntakeMiniFunnel"),
    source.indexOf("const PositionTile"),
  );

  assert.doesNotMatch(summary, /borderRadius: dim\(RADII\.xs\)/);
  assert.doesNotMatch(summary, /background: CSS_COLOR\.bg1/);
  assert.doesNotMatch(intake, /cssColorAlpha\(tone/);
  assert.match(intake, /borderLeft: index > 0/);
});

test("algo position records are flat rows rather than nested cards", () => {
  const position = source.slice(
    source.indexOf("const PositionTile"),
    source.indexOf("export const PlatformAlgoMonitorSidebar"),
  );

  assert.doesNotMatch(position, /borderRadius: dim\(RADII\.xs\)/);
  assert.doesNotMatch(position, /background: CSS_COLOR\.bg1/);
  assert.match(position, /borderBottom: `1px solid \$\{CSS_COLOR\.border\}`/);
});

test("strategy tags are neutral identifiers, not arbitrary category-color chips", () => {
  assert.doesNotMatch(strategyTagSource, /const strategyTone/);
  assert.doesNotMatch(strategyTagSource, /cssColorMix/);
  assert.doesNotMatch(strategyTagSource, /background:/);
  assert.doesNotMatch(strategyTagSource, /border:/);
  assert.match(strategyTagSource, /color: CSS_COLOR\.textMuted/);
});

test("algo attention uses the app icon language instead of emoji glyphs", () => {
  assert.doesNotMatch(attentionStripSource, /⚠/);
  assert.match(attentionStripSource, /AlertTriangle/);
  assert.match(attentionStripSource, /Info/);
  assert.match(attentionStripSource, /<Glyph[\s\S]*?aria-hidden="true"/);
});
