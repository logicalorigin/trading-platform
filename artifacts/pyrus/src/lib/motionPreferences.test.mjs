import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
const primitives = readFileSync(
  new URL("../components/platform/primitives.jsx", import.meta.url),
  "utf8",
);
const bigDirectionGlyph = readFileSync(
  new URL(
    "../components/platform/signal-language/BigDirectionGlyph.jsx",
    import.meta.url,
  ),
  "utf8",
);
const surfacePanel = primitives.slice(
  primitives.indexOf("export const SurfacePanel"),
  primitives.indexOf("export const ThresholdHistogram"),
);
const expandableRow = primitives.slice(
  primitives.indexOf("export const TableExpandableRow"),
  primitives.indexOf("export const CardTitle"),
);

test("OS and app reduced-motion preferences override inline control transitions", () => {
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?button,[\s\S]*?\[role="button"\][\s\S]*?transition: none !important;/,
  );
  assert.match(
    css,
    /html\[data-pyrus-reduced-motion="on"\] button,[\s\S]*?html\[data-pyrus-reduced-motion="on"\] \[role="button"\][\s\S]*?transition: none !important;/,
  );
});

test("unit-39 inline motion surfaces have targeted reduced-motion hooks", () => {
  assert.match(primitives, /className="ra-loading-spinner"/);
  assert.doesNotMatch(surfacePanel, /className="ra-expandable-row-content"/);
  assert.match(
    expandableRow,
    /className="ra-expandable-row-content"[\s\S]*?maxHeight:/,
  );
  assert.match(bigDirectionGlyph, /className="ra-big-direction-freshness"/);

  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.ra-big-direction-freshness,[\s\S]*?\.ra-expandable-row-content[\s\S]*?transition: none !important;[\s\S]*?\.ra-loading-spinner[\s\S]*?animation: none !important;/,
  );
  assert.match(
    css,
    /html\[data-pyrus-reduced-motion="on"\] \.ra-big-direction-freshness,[\s\S]*?html\[data-pyrus-reduced-motion="on"\] \.ra-expandable-row-content[\s\S]*?transition: none !important;[\s\S]*?html\[data-pyrus-reduced-motion="on"\] \.ra-loading-spinner[\s\S]*?animation: none !important;/,
  );
});
