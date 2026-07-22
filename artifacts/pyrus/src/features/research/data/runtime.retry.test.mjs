import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./runtime.js", import.meta.url), "utf8");

test("failed research metadata imports can be attempted again", () => {
  assert.match(
    source,
    /\.catch\(\(error\) => \{\s*cachedResearchMetaPromise = null;\s*throw error;\s*\}\)/,
  );
});

test("failed theme imports clear in-flight state without caching empty data", () => {
  const datasetLoaderSource = source.slice(
    source.indexOf("retryDynamicImport(loader"),
    source.indexOf("export function prefetchResearchThemeDataset"),
  );
  const failureBlock = datasetLoaderSource.match(
    /\.catch\(\(error\) => \{([\s\S]*?)throw error;\s*\}\)/,
  )?.[1] || "";

  assert.match(failureBlock, /cachedThemeDatasetPromises\.delete\(normalizedThemeId\)/);
  assert.doesNotMatch(failureBlock, /cachedThemeDatasets\.set\(/);
});

test("mounted research consumers expose load failure and an explicit retry", () => {
  const hookSource = source.slice(source.indexOf("export function useResearchRuntimeData"));

  assert.match(hookSource, /\.catch\(\(error\) => \{\s*if \(cancelled\) return;\s*setState/);
  assert.match(hookSource, /error: state\.error/);
  assert.match(hookSource, /const retry = useCallback/);
  assert.match(hookSource, /setRetryVersion\(\(version\) => version \+ 1\)/);
  assert.match(hookSource, /\[normalizedThemeId, retryVersion\]/);
});
