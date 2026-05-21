import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MicroSparkline } from "./primitives.jsx";

const here = dirname(fileURLToPath(import.meta.url));
const readPrimitivesSource = () =>
  readFileSync(join(here, "primitives.jsx"), "utf8");
const readSrcSource = (...segments) =>
  readFileSync(join(here, "..", "..", ...segments), "utf8");

test("SegmentedControl uses a sliding indicator driven by measured offsets", () => {
  // Root-cause guard: the indicator's translateX position must come from
  // the active button's measured offsetLeft / offsetWidth via useLayoutEffect,
  // not from CSS-only assumptions about equal option widths (those break
  // the moment one option has a longer label). The first render must
  // hide the indicator (opacity 0) until the initial measurement lands,
  // otherwise users see a 0→target flash.
  const source = readPrimitivesSource();

  assert.match(source, /export const SegmentedControl = /);
  assert.match(
    source,
    /useLayoutEffect\([\s\S]*?activeButton\.offsetLeft/,
    "indicator must measure offsetLeft from the active button ref",
  );
  assert.match(
    source,
    /transform: `translateX\(\$\{indicator\.left\}px\)`/,
    "indicator must position via transform translateX",
  );
  assert.match(
    source,
    /className="ra-segmented-indicator"/,
    "indicator must carry the .ra-segmented-indicator class for the reduced-motion override",
  );
  assert.match(
    source,
    /opacity: indicator\.ready \? 1 : 0/,
    "indicator must be hidden until first measurement",
  );
  // Buttons stay transparent — the indicator carries the active fill,
  // matching iOS / Linear's affordance. Confirm the button render path
  // inside SegmentedControl has the transparent background.
  const segmentedSlice = source.match(
    /export const SegmentedControl =[\s\S]*?\n\};/,
  );
  assert.ok(segmentedSlice, "SegmentedControl declaration not found");
  assert.match(segmentedSlice[0], /background: "transparent"/);
});

test("TextField paints focus ring on wrapper, not native input", () => {
  // The bare <input> must be borderless / outline-less; the wrapper
  // .ra-textfield class paints the focus ring via :focus-within. This
  // is what lets leading icons + trailing nodes share the focused
  // visual without each one needing its own ring.
  const source = readPrimitivesSource();

  const textFieldSlice = source.match(
    /export const TextField =[\s\S]*?\n\};/,
  );
  assert.ok(textFieldSlice, "TextField declaration not found");
  const slice = textFieldSlice[0];

  // Wrapper carries the focus-ring-bearing class.
  assert.match(slice, /ra-textfield ra-textfield--error|"ra-textfield"/);

  // Input is bare — no border, no outline (focus ring lives on wrapper).
  assert.match(slice, /border: "none"/);
  assert.match(slice, /outline: "none"/);

  // aria-invalid wires the input to assistive tech in error state.
  assert.match(slice, /aria-invalid=\{hasError \|\| undefined\}/);

  // Helper text has role="alert" when in error state.
  assert.match(slice, /role=\{hasError \? "alert" : undefined\}/);
});

test("TextField error state has its own CSS class for the red ring", () => {
  const css = readFileSync(
    join(here, "..", "..", "index.css"),
    "utf8",
  );
  assert.match(
    css,
    /\.ra-textfield \{[\s\S]*?transition:[\s\S]*?border-color/,
  );
  assert.match(
    css,
    /\.ra-textfield:focus-within \{[\s\S]*?box-shadow: var\(--ra-focus-ring\)/,
  );
  assert.match(
    css,
    /\.ra-textfield--error \{[\s\S]*?border-color: color-mix\([\s\S]*?--ra-color-pnl-negative/,
  );
  assert.match(
    css,
    /\.ra-textfield--error:focus-within \{[\s\S]*?box-shadow: 0 0 0 2px color-mix\([\s\S]*?--ra-color-pnl-negative/,
  );
});

test("Icon primitive defaults size + strokeWidth per context", () => {
  // Each context locks the visual rhythm: nav = 18px/1.5 stroke,
  // inline = 14px/2, control = 16px/2. Consumers can override per-call,
  // but the defaults must be wired through so a no-prop call renders
  // at the right baseline.
  const source = readPrimitivesSource();

  assert.match(source, /export const Icon = /);
  assert.match(
    source,
    /const ICON_CONTEXT_DEFAULTS = \{[\s\S]*?nav: \{ size: 18, strokeWidth: 1\.5/,
  );
  assert.match(
    source,
    /inline: \{ size: 14, strokeWidth: 2/,
  );
  assert.match(
    source,
    /control: \{ size: 16, strokeWidth: 2/,
  );

  // Forwards other props (aria-*, className, etc.) to the lucide
  // component so accessibility attributes still reach the SVG.
  const slice = source.match(/export const Icon =[\s\S]*?\n\};/);
  assert.ok(slice, "Icon declaration not found");
  assert.match(slice[0], /\.\.\.rest/);
  assert.match(slice[0], /size=\{size \?\? defaults\.size\}/);
});

test("extractSparklineValues handles raw numbers + close/c/v shapes", () => {
  // Centralized normalizer for sparkline data — Watchlist + KPI Strip
  // were keeping their own copies; this test pins the shape support
  // matrix so a future change can't silently regress one consumer.
  const source = readPrimitivesSource();

  assert.match(source, /export const extractSparklineValues = /);
  assert.match(source, /typeof point === "number"/);
  assert.match(source, /point\?\.close/);
  assert.match(source, /point\?\.c\b/);
  assert.match(source, /point\?\.v\b/);
  assert.match(source, /\.filter\(\(value\) => Number\.isFinite\(value\)\)/);
});

test("MicroSparkline + RowSparkValue are exported and composable", () => {
  // Single-source-of-truth: MicroSparkline used to live in three places
  // (Watchlist, HeaderKpiStrip, and the trade-row chart). RowSparkValue
  // wraps it with a value + delta slot for the dense-row use case.
  const source = readPrimitivesSource();

  assert.match(source, /export const MicroSparkline = /);
  assert.match(source, /export const RowSparkValue = /);

  // Sparkline returns null when there's nothing to draw (caller doesn't
  // need to guard).
  const sparkSlice = source.match(
    /export const MicroSparkline =[\s\S]*?^\};/m,
  );
  assert.ok(sparkSlice, "MicroSparkline declaration not found");
  assert.match(sparkSlice[0], /if \(values\.length < 2\) \{\s*return null/);

  // RowSparkValue's sparkline data is optional — without it, the row
  // is just value + delta.
  const rowSlice = source.match(
    /export const RowSparkValue =[\s\S]*?\n\);/,
  );
  assert.ok(rowSlice, "RowSparkValue declaration not found");
  assert.match(rowSlice[0], /\{sparklineData \? \(/);
});

test("MicroSparkline renders sharper detail cues from raw points", () => {
  const source = readPrimitivesSource();
  const html = renderToStaticMarkup(
    createElement(MicroSparkline, {
      data: [10, 10.3, 9.8, 10.6, 10.1],
      color: "#123456",
      className: "ra-sparkline",
      ariaLabel: "sample sparkline",
      width: 64,
      height: 24,
    }),
  );

  assert.match(html, /class="ra-sparkline"/);
  assert.match(html, /aria-label="sample sparkline"/);
  assert.match(html, /role="img"/);
  assert.match(html, /stroke="#123456"/);
  assert.match(html, /class="ra-sparkline-baseline"/);
  assert.match(html, /class="ra-sparkline-line"/);
  assert.equal(
    (html.match(/class="ra-sparkline-extreme"/g) || []).length,
    2,
  );
  assert.equal(
    (html.match(/class="ra-sparkline-point"/g) || []).length,
    1,
  );
  assert.match(html, /class="ra-sparkline-tail"/);
  assert.match(source, /strokeLinejoin="miter"/);
  assert.match(source, /strokeLinecap="butt"/);
  assert.match(source, /isTurningPoint/);
  assert.match(source, /vectorEffect="non-scaling-stroke"/);
});

test("MicroSparkline centers flat series without invalid coordinates", () => {
  const html = renderToStaticMarkup(
    createElement(MicroSparkline, {
      data: [7, 7, 7],
      width: 60,
      height: 20,
    }),
  );

  assert.doesNotMatch(html, /NaN|Infinity/);
  assert.match(html, /y1="10"/);
  assert.match(html, /cy="10"/);
  assert.equal(
    (html.match(/class="ra-sparkline-extreme"/g) || []).length,
    0,
  );
});

test("named app sparkline surfaces compose the shared MicroSparkline", () => {
  const surfaces = [
    ["features/flow/FlowScannerStatusPanel.jsx", 1],
    ["features/market/MiniChartPremiumFlowIndicator.jsx", 1],
    ["features/research/PhotonicsObservatory.jsx", 3],
    ["screens/DiagnosticsScreen.jsx", 1],
  ];

  surfaces.forEach(([path, expectedCount]) => {
    const source = readSrcSource(...path.split("/"));
    assert.equal(
      (source.match(/<MicroSparkline\b/g) || []).length,
      expectedCount,
      `${path} should render its named sparklines through MicroSparkline`,
    );
  });
});

test("DataUnavailableState supports semantic variants + icon + action slots", () => {
  // Empty/Error states had one shape: dashed border + optional spinner.
  // Variants give the message a tone (info/error/warning) without forcing
  // consumers to roll their own colored wrapper. icon + action slots
  // are optional ReactNodes so consumers can drop in a lucide glyph at
  // the top and a retry button at the bottom.
  const source = readPrimitivesSource();

  const slice = source.match(
    /export const DataUnavailableState =[\s\S]*?^\};/m,
  );
  assert.ok(slice, "DataUnavailableState declaration not found");
  const body = slice[0];

  // Variant config maps semantic names to tones (no hardcoded colors).
  assert.match(
    source,
    /const DATA_STATE_VARIANT_TONES = \{[\s\S]*?neutral:[\s\S]*?info:[\s\S]*?error:[\s\S]*?warning:/,
  );

  // role="alert" is set for the error variant so assistive tech is informed.
  assert.match(body, /role=\{variant === "error" \? "alert" : undefined\}/);

  // The accent wash on the background fades the variant tone into bg1
  // — non-neutral variants get the gradient, neutral stays solid bg1.
  assert.match(
    body,
    /variant === "neutral"[\s\S]*?T\.bg1[\s\S]*?linear-gradient/,
  );

  // icon + action slots are conditionally rendered (no slot = no chrome).
  assert.match(body, /\{icon \? \(/);
  assert.match(body, /\{action \? \(/);
});

test("Tables: selected-row class uses motion-accent for tone customization", () => {
  // .ra-table-row--selected must paint its left gutter + fill via
  // var(--ra-motion-accent) so consumers can pin the tone (cyan for
  // "inspect", red for danger, etc.) by setting --ra-motion-accent
  // inline. The default accent comes from motionVars / theme.
  const css = readFileSync(
    join(here, "..", "..", "index.css"),
    "utf8",
  );

  assert.match(
    css,
    /\.ra-table-row--selected \{[\s\S]*?background: color-mix\(in srgb, var\(--ra-motion-accent\)/,
  );
  assert.match(
    css,
    /\.ra-table-row--selected \{[\s\S]*?box-shadow: inset 3px 0 0 var\(--ra-motion-accent\)/,
  );
  // Hover/focus state adds an inset 1px ring glow on top of the gutter.
  assert.match(
    css,
    /\.ra-table-row--selected:hover[\s\S]*?inset 0 0 0 1px color-mix/,
  );
  // Sticky header has a drop shadow that separates it from scrolling rows.
  assert.match(
    css,
    /\.ra-table-header-sticky \{[\s\S]*?box-shadow:[\s\S]*?0 6px 14px/,
  );
});

test("SegmentedControl indicator respects reduced motion", () => {
  // The .ra-segmented-indicator class must have its transform/width
  // transitions zeroed out under prefers-reduced-motion or the
  // data-rayalgo-reduced-motion="on" opt-in; opacity transition is fine
  // (no spatial motion).
  const css = readFileSync(
    join(here, "..", "..", "index.css"),
    "utf8",
  );
  assert.match(
    css,
    /\.ra-segmented-indicator \{[\s\S]*?transition:[\s\S]*?transform[\s\S]*?width[\s\S]*?opacity/,
  );
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.ra-segmented-indicator[\s\S]*?transition: opacity/,
  );
  assert.match(
    css,
    /html\[data-rayalgo-reduced-motion="on"\] \.ra-segmented-indicator[\s\S]*?transition: opacity/,
  );
});
