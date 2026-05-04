import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import test from "node:test";

const repoRoot = new URL("../../../../..", import.meta.url);
const rayalgoSrcRoot = new URL("../../", import.meta.url);

const sourceExtensions = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);

const collectSourceFiles = (directoryUrl) => {
  const directoryPath = directoryUrl instanceof URL ? directoryUrl.pathname : directoryUrl;
  const entries = readdirSync(directoryPath);
  const files = [];

  for (const entry of entries) {
    const path = join(directoryPath, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...collectSourceFiles(path));
      continue;
    }
    if (sourceExtensions.has(extname(path))) {
      files.push(path);
    }
  }

  return files;
};

test("platform root no longer depends on the retired RayAlgoPlatform module", () => {
  const retiredRootPath = new URL("../../RayAlgoPlatform.jsx", import.meta.url);
  assert.equal(existsSync(retiredRootPath), false);

  const appSource = readFileSync(new URL("../../app/App.tsx", import.meta.url), "utf8");
  assert.match(appSource, /features\/platform\/PlatformApp\.jsx/);
  assert.doesNotMatch(appSource, /RayAlgoPlatform/);

  const sourceHits = collectSourceFiles(rayalgoSrcRoot)
    .filter((filePath) => !filePath.endsWith("platformRootSource.test.js"))
    .map((filePath) => ({
      filePath,
      source: readFileSync(filePath, "utf8"),
    }))
    .filter(({ source }) => /RayAlgoPlatform/.test(source))
    .map(({ filePath }) => relative(repoRoot.pathname, filePath));

  assert.deepEqual(sourceHits, []);
});

test("flow scanner threshold changes are part of the live scanner effect contract", () => {
  const source = readFileSync(
    new URL("./useLiveMarketFlow.js", import.meta.url),
    "utf8",
  );
  const effectDependencyLists = [...source.matchAll(/useEffect\([\s\S]*?\n  \]\);/g)].map(
    (match) => match[0],
  );

  assert.ok(
    effectDependencyLists.some(
      (effectSource) =>
        effectSource.includes("listFlowEventsRequest") &&
        effectSource.includes("normalizedThreshold"),
    ),
    "scanner effect must rerun when unusualThreshold changes",
  );
});

test("Market avoids the shared all-flow runtime while chart UOA scanner owns Market flow", () => {
  const source = readFileSync(new URL("./PlatformApp.jsx", import.meta.url), "utf8");
  const flowRuntimeProp = source.match(
    /flowRuntimeEnabled=\{[\s\S]*?\}\s*flowRuntimeIntervalMs=/,
  )?.[0];

  assert.ok(flowRuntimeProp, "PlatformApp must pass flowRuntimeEnabled");
  assert.match(flowRuntimeProp, /flowScreenActive/);
  assert.doesNotMatch(
    flowRuntimeProp,
    /marketScreenActive/,
    "Market chart UOA scanner should own Market flow to avoid a second all-flow path",
  );
});
