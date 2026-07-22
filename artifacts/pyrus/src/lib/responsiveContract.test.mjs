import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { BREAKPOINTS, responsiveFlags } from "./responsive.ts";

const designSource = readFileSync(
  new URL("../../../../DESIGN.md", import.meta.url),
  "utf8",
);
const responsiveSource = readFileSync(
  new URL("./responsive.ts", import.meta.url),
  "utf8",
);
const signalsScreenSource = readFileSync(
  new URL("../screens/SignalsScreen.jsx", import.meta.url),
  "utf8",
);

test("exports the canonical viewport breakpoints", () => {
  assert.deepEqual(BREAKPOINTS, {
    phone: 768,
    desktop: 1024,
  });
});

test("classifies every exact semantic viewport boundary", () => {
  const cases = [
    [-1, [false, false, false, false]],
    [0, [false, false, false, false]],
    [767, [true, false, true, false]],
    [768, [false, true, true, false]],
    [1023, [false, true, true, false]],
    [1024, [false, false, false, true]],
  ];

  for (const [width, expected] of cases) {
    const flags = responsiveFlags(width);
    assert.deepEqual(
      [flags.isPhone, flags.isTablet, flags.isNarrow, flags.isDesktop],
      expected,
      `unexpected flags at ${width}px`,
    );
  }
});

test("keeps viewport hooks wired to the shared authority", () => {
  assert.match(responsiveSource, /flags: responsiveFlags\(size\.width\)/);
  assert.match(
    responsiveSource,
    /viewport\.width > 0 && viewport\.width < resolveBreakpoint\(breakpoint\)/,
  );
});

test("keeps Signals phone semantics on the shared flag", () => {
  assert.match(
    signalsScreenSource,
    /const compact = viewport\.width > 0 && viewport\.width < 980;/,
  );
  assert.match(signalsScreenSource, /const phone = viewport\.flags\.isPhone;/);
  assert.doesNotMatch(signalsScreenSource, /const phone = viewport\.width/);
});

test("documents viewport authority and measured-container limits", () => {
  const authority = designSource.match(
    /## Responsive Authority\n[\s\S]*?(?=\n## )/,
  )?.[0];

  assert.ok(authority, "DESIGN.md must define Responsive Authority");
  assert.match(authority, /Phone.*`width > 0 && width < 768`/);
  assert.match(authority, /Tablet.*`width >= 768 && width < 1024`/);
  assert.match(authority, /Desktop.*`width >= 1024`/);
  assert.match(authority, /width.*0 or less[\s\S]*all semantic flags are false/i);
  assert.match(authority, /measured-container exceptions are local layout adaptations/i);
  assert.match(authority, /must never redefine the semantic phone, tablet, or desktop flags/i);
  assert.match(authority, /route-specific thresholds[\s\S]*must not create a competing device class/i);
});
