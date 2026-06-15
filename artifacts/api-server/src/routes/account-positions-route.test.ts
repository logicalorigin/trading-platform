import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./platform.ts", import.meta.url), "utf8");

function routeSource(path: string, method = "get"): string {
  const start = source.indexOf(`router.${method}("${path}",`);
  assert.notEqual(start, -1, `Missing ${path}`);
  const next = source.indexOf("\nrouter.", start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}

test("account positions route supports explicit quote and fast-detail controls", () => {
  const handler = routeSource("/accounts/:accountId/positions");
  assert.match(handler, /req\.query\.liveQuotes === "false"/);
  assert.match(handler, /req\.query\.detail === "fast"/);
  assert.match(handler, /detail,/);
  assert.doesNotMatch(
    handler,
    /SHADOW_ACCOUNT_ID/,
    "shadow accounts must not be opted out of live quotes by default",
  );
});

test("real account routes and streams require account admission", () => {
  [
    "/accounts",
    "/accounts/:accountId/summary",
    "/accounts/:accountId/equity-history",
    "/accounts/:accountId/allocation",
    "/accounts/:accountId/positions",
    "/accounts/:accountId/positions-at-date",
    "/accounts/:accountId/closed-trades",
    "/accounts/:accountId/orders",
    "/accounts/:accountId/risk",
    "/accounts/:accountId/cash-activity",
    "/streams/accounts/page",
    "/streams/accounts",
  ].forEach((path) => {
    assert.match(
      routeSource(path),
      /admitAccountRoute\(res/,
      `${path} should guard real-account access when IBKR is unconfigured`,
    );
  });
});

test("public Trade option-chain routes avoid artificial metadata waits", () => {
  const chainHandler = routeSource("/options/chains");
  assert.match(chainHandler, /bypassBridgeBackoff:\s*true/);
  assert.match(chainHandler, /allowDelayedSnapshotHydration:\s*false/);
  assert.match(chainHandler, /emptyRetryDelaysMs:\s*\[\]/);
  assert.match(chainHandler, /timeoutMs:\s*OPTION_CHAIN_PUBLIC_METADATA_TIMEOUT_MS/);

  const batchHandler = routeSource("/options/chains/batch", "post");
  assert.match(batchHandler, /bypassBridgeBackoff:\s*true/);
  assert.match(batchHandler, /allowDelayedSnapshotHydration:\s*false/);
  assert.match(batchHandler, /emptyRetryDelaysMs:\s*\[\]/);
  assert.match(batchHandler, /timeoutMs:\s*OPTION_CHAIN_PUBLIC_METADATA_TIMEOUT_MS/);
});

test("option-chain stream announces readiness before background snapshots", () => {
  const handler = routeSource("/streams/options/chains");
  assert.match(handler, /writeEvent\(\s*"ready"/s);
  assert.match(handler, /subscribeOptionChains\(underlyings/);
  assert.doesNotMatch(handler, /fetchOptionChainSnapshotPayload/);
});

test("session route re-merges runtime.ibkr passthrough fields stripped by zod", () => {
  // GetSessionResponse only enumerates a subset of SessionIbkrRuntime keys, so
  // the route must re-merge the source runtime.ibkr (openapi additionalProperties:
  // true) to keep bridge-status fields like brokerServerConnected / streamState /
  // strictReason in the response. Guard against silently dropping that merge.
  const handler = routeSource("/session");
  assert.match(handler, /GetSessionResponse\.parse\(session\)/);
  assert.match(handler, /data\.runtime\.ibkr\s*=\s*\{/s);
  assert.match(handler, /\.\.\.session\.runtime\.ibkr/);
});
