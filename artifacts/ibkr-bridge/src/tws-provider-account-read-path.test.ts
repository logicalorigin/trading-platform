import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./tws-provider.ts", import.meta.url), "utf8");

function methodSource(name: string): string {
  const offset = source.indexOf(`async ${name}(`);
  assert.notEqual(offset, -1, `Missing method ${name}`);
  // Slice a generous window; we only assert on the first statements of the body.
  return source.slice(offset, offset + 600);
}

// Regression guard: account/position reads must NOT call refreshSession() on
// every request. refreshSession() runs on the concurrency-1 "control" lane;
// calling it per read serialized all account/position reads behind one global
// slot and produced the 504 storm + account-lane circuit trips. Reads must go
// through ensureSessionReadyForRead(), which skips the refresh on the warm path
// (connected + account list already held) and relies on the periodic tickle().
test("account read path does not refreshSession on every request", () => {
  const listAccounts = methodSource("listAccounts");
  assert.match(listAccounts, /ensureSessionReadyForRead\(\)/);
  assert.doesNotMatch(listAccounts, /await this\.refreshSession\(\)/);

  const listPositions = methodSource("listPositions");
  assert.match(listPositions, /ensureSessionReadyForRead\(\)/);
  assert.doesNotMatch(listPositions, /await this\.refreshSession\(\)/);
});

test("ensureSessionReadyForRead only refreshes on the cold path", () => {
  const body = methodSource("ensureSessionReadyForRead");
  // Warm-path short-circuit: connected AND a known account list -> no refresh.
  assert.match(body, /connectionState === ConnectionState\.Connected/);
  assert.match(body, /managedAccounts\.length > 0/);
  // The full refresh remains as the cold-path fallback.
  assert.match(body, /await this\.refreshSession\(\)/);
});
