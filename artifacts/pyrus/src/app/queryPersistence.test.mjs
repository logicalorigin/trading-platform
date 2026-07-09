import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const providersSource = readFileSync(
  new URL("./AppProviders.tsx", import.meta.url),
  "utf8",
);
const packageJson = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
);

test("live query cache updates are not subscribed to whole-cache persistence", () => {
  assert.doesNotMatch(
    providersSource,
    /PersistQueryClientProvider|createPyrusPersistOptions/,
  );
  assert.match(providersSource, /<QueryClientProvider client=\{queryClient\}>/);
  assert.equal(
    packageJson.devDependencies["@tanstack/query-sync-storage-persister"],
    undefined,
  );
  assert.equal(
    packageJson.devDependencies["@tanstack/react-query-persist-client"],
    undefined,
  );
});

test("retired unscoped query data is removed from local storage", () => {
  assert.match(
    providersSource,
    /RETIRED_QUERY_CACHE_KEY = "pyrus-react-query-cache"/,
  );
  assert.match(
    providersSource,
    /localStorage\?\.removeItem\(RETIRED_QUERY_CACHE_KEY\)/,
  );
});
