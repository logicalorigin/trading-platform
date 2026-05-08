import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readPlatformSource = (relativePath) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("GEX is registered as a native platform screen", () => {
  const registry = readPlatformSource("./screenRegistry.jsx");
  const router = readPlatformSource("./PlatformScreenRouter.jsx");

  assert.match(registry, /GexScreen/);
  assert.match(registry, /\{ id: "gex", label: "GEX"/);
  assert.match(registry, /export const MemoGexScreen = memo\(GexScreen\)/);
  assert.match(router, /case "gex":/);
  assert.match(router, /<MemoGexScreen/);
});

test("GEX ticker does not join the broad flow scanner input", () => {
  const app = readPlatformSource("./PlatformApp.jsx");

  assert.doesNotMatch(app, /const gexScreenActive = screen === "gex"/);
  assert.doesNotMatch(app, /gexScreenActive && sym/);
  assert.match(app, /broadFlowWatchlistSymbols=\{broadFlowWatchlistSymbols\}/);
});
