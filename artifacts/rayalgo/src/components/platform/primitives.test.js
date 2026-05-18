import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const readPrimitivesSource = () =>
  readFileSync(join(here, "primitives.jsx"), "utf8");

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
