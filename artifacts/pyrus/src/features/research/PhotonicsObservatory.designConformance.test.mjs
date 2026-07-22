import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const observatorySource = readFileSync(
  new URL("./PhotonicsObservatory.jsx", import.meta.url),
  "utf8",
);
const themeSwitcherSource = readFileSync(
  new URL("./components/ResearchThemeSwitcher.jsx", import.meta.url),
  "utf8",
);
const calendarSource = readFileSync(
  new URL("./components/ResearchCalendarView.jsx", import.meta.url),
  "utf8",
);
const globalCss = readFileSync(new URL("../../index.css", import.meta.url), "utf8");
const platformAppSource = readFileSync(
  new URL("../platform/PlatformApp.jsx", import.meta.url),
  "utf8",
);

test("research exposes honest live-data states", () => {
  assert.match(observatorySource, /dataStatus === "error"/);
  assert.match(observatorySource, /Retry live data/);
  assert.doesNotMatch(observatorySource, />loading…</);
});

test("research interactive graphics are keyboard reachable", () => {
  assert.match(
    observatorySource,
    /\.attr\("role", "button"\)\s*\.attr\("tabindex", 0\)/,
  );
  assert.match(observatorySource, /\.on\("keydown", activateD3OnKey/);
  assert.match(observatorySource, /<svg[^>]*role="group" aria-label="Sector relationship network graph"/);
  assert.match(observatorySource, /<svg[^>]*role="group" aria-label="Value-stream Sankey diagram"/);
  assert.match(observatorySource, /aria-sort=\{sortKey === col\.k/);
  assert.match(observatorySource, /data-testid=\{`research-sort-\$\{col\.k\}`\}/);
});

test("research reserves perpetual edge motion for active relationships", () => {
  assert.match(observatorySource, /\.photonics-edge-flow\.is-active \{ animation:/);
  assert.doesNotMatch(observatorySource, /\.photonics-edge-flow \{ animation:/);
  assert.match(observatorySource, /\.classed\("is-active"/);
});

test("research disables all local motion through both reduced-motion channels", () => {
  assert.match(
    observatorySource,
    /@media \(prefers-reduced-motion: reduce\) \{ \.photonics-research-root \*, \.photonics-research-root \*::before, \.photonics-research-root \*::after \{ animation: none !important; transition: none !important; \} \}/,
  );
  assert.match(
    observatorySource,
    /html\[data-pyrus-reduced-motion="on"\] \.photonics-research-root \*, html\[data-pyrus-reduced-motion="on"\] \.photonics-research-root \*::before, html\[data-pyrus-reduced-motion="on"\] \.photonics-research-root \*::after \{ animation: none !important; transition: none !important; \}/,
  );
  assert.match(
    observatorySource,
    /\.photonics-research-root button:hover, \.photonics-research-root button:active \{ transform: none !important; \}/,
  );
});

test("research theme controls use labels without decorative glyph noise", () => {
  assert.doesNotMatch(themeSwitcherSource, /\{t\.icon\}/);
  assert.match(themeSwitcherSource, /aria-pressed=\{active\}/);
  assert.match(calendarSource, /aria-pressed=\{!themeFilter\}/);
  assert.match(calendarSource, /aria-pressed=\{active\}/);
  assert.match(calendarSource, /<span aria-hidden="true"[\s\S]{0,100}?\{t\.icon\}/);
});

test("every raw Research button declares the touch-height contract", () => {
  for (const [name, source] of [
    ["PhotonicsObservatory", observatorySource],
    ["ResearchCalendarView", calendarSource],
    ["ResearchThemeSwitcher", themeSwitcherSource],
  ]) {
    const inspectableSource = source.replaceAll("=>", "ARROW");
    const rawButtons = [...inspectableSource.matchAll(/<button\b([\s\S]*?)>/g)];
    assert.ok(rawButtons.length > 0, `${name} must expose inspectable raw buttons`);
    for (const [, attributes] of rawButtons) {
      assert.match(
        attributes,
        /className="[^"]*ra-touch-target(?:-y)?[^"]*"/,
        `${name} raw buttons must keep the phone/tablet touch floor`,
      );
    }
  }
});

test("research search has a stable accessible name independent of loading copy", () => {
  assert.match(
    observatorySource,
    /data-testid="research-search-input"[\s\S]{0,180}?aria-label="Search research by ticker or company"/,
  );
});

test("research heatmap owns its phone width instead of clipping ticker labels", () => {
  assert.match(observatorySource, /const heatmapLabelWidth = isPhone \? 84 : 80/);
  assert.match(observatorySource, /const heatmapCompanyMinWidth = isPhone \? 56 : 36/);
  assert.match(observatorySource, /const heatmapMinWidth = Math\.max/);
  assert.match(observatorySource, /data-testid="research-ecosystem-heatmap"/);
  assert.match(observatorySource, /data-preserve-mobile-layout/);
  assert.match(observatorySource, /aria-label="Scrollable ecosystem heatmap"/);
  assert.match(observatorySource, /overflowX: "auto"/);
  assert.match(observatorySource, /minWidth: heatmapMinWidth/);
  assert.match(observatorySource, /minWidth: heatmapCompanyMinWidth/);
  assert.match(observatorySource, /aria-label=\{`\$\{c\.t\}, revenue growth/);
  assert.match(observatorySource, /pct > 24 &&/);
  assert.match(
    globalCss,
    /\.photonics-research-root \[style\*="min-width"\]:not\(\.ra-touch-target\):not\(\[data-preserve-mobile-layout\]\):not\(\[data-preserve-mobile-layout\] \*\)/,
  );
});

test("research reuses shared state surfaces and keeps the Trade handoff review-only", () => {
  assert.match(observatorySource, /<NeuralLoader/);
  assert.match(observatorySource, /<DataUnavailableState/);
  assert.match(
    observatorySource,
    /<Button[\s\S]{0,260}?aria-label=\{`Open \$\{co\.t\} in Trade`\}[\s\S]{0,260}?onClick=\{\(\) => onJumpToTrade\?\.\(co\.t\)\}/,
  );

  const handlerStart = platformAppSource.indexOf(
    "const handleJumpToTradeFromResearch = useCallback",
  );
  const handlerEnd = platformAppSource.indexOf(
    "const handleAccountJumpToTrade",
    handlerStart,
  );
  const handler = platformAppSource.slice(handlerStart, handlerEnd);
  assert.match(handler, /setSym\(normalized\)/);
  assert.match(handler, /setTradeSymPing\(/);
  assert.match(handler, /activateScreen\("trade"\)/);
  assert.doesNotMatch(handler, /\.mutate(?:Async)?\(|submit|placeOrder|previewOrder/i);
});
