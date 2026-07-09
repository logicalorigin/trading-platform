import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the market route preloads and renders the promoted market screen only", () => {
  const preloader = read("./screenModulePreloader.js");
  const registry = read("./screenRegistry.jsx");
  const viteConfig = read("../../../vite.config.ts");

  assert.match(
    preloader,
    /market:\s*\(\) => import\("\.\.\/\.\.\/screens\/MarketDemoScreen\.jsx"\)/,
  );
  assert.doesNotMatch(preloader, /screens\/MarketScreen\.jsx/);
  assert.match(
    registry,
    /const MarketScreen = createPreloadableScreen\("market", "MarketDemoScreen"\)/,
  );
  assert.match(viteConfig, /clientFiles:[\s\S]*screens\/MarketDemoScreen\.jsx/);
  assert.equal(
    existsSync(new URL("../../screens/MarketScreen.jsx", import.meta.url)),
    false,
  );
});
