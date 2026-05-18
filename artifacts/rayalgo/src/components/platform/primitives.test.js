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
