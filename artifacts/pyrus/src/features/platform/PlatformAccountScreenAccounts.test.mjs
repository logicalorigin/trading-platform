import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readLocalSource = (filename) =>
  readFileSync(new URL(filename, import.meta.url), "utf8");

// Brokerage account tab strips must always list real brokerage accounts
// (All -> per-account tabs -> Shadow). Real accounts are live-mode entities,
// so tab account lists are fetched with mode "live" and must not depend on the
// environment-driven accountsQuery, which is empty when the trading environment
// is "shadow". Only Account and Algo consume this dedicated list, so unrelated
// active screens must not poll it in the background.

test("PlatformApp fetches a dedicated live-mode account list for the Accounts screen", () => {
  const source = readLocalSource("./PlatformApp.jsx");

  const liveQuery = source.match(
    /const accountScreenAccountsQuery = useListAccounts\(\s*\{ mode: "live" \},[\s\S]*?\);/,
  )?.[0];
  assert.ok(
    liveQuery,
    "PlatformApp must declare accountScreenAccountsQuery with a hard-coded live mode",
  );
  assert.match(
    liveQuery,
    /enabled: accountScreenAccountsQueryEnabled/,
    "the live-mode list must use its own gate that does not wait for the IBKR bridge",
  );
  assert.match(
    source,
    /const accountScreenAccountsQueryEnabled = Boolean\(\s*sessionQuery\.data &&\s*!safeQaMode &&\s*\(screen === "account" \|\| screen === "algo"\),?\s*\);/,
    "the live-mode gate must require an active consumer without adding an IBKR bridge dependency",
  );
  assert.match(
    liveQuery,
    /staleTime: 60_000/,
    "the live-mode list must match the environment-driven query staleTime",
  );

  assert.match(
    source,
    /useListAccounts\(\s*\{ mode: sessionQuery\.data\?\.environment \|\| "shadow" \},/,
    "the environment-driven accountsQuery must remain for its other consumers",
  );
  assert.match(
    source,
    /accountScreenAccounts=\{accountScreenAccounts\}/,
    "PlatformApp must pass the live-mode list to PlatformScreenRouter",
  );
});

test("PlatformScreenRouter feeds the live-mode list to brokerage account tab strips", () => {
  const source = readLocalSource("./PlatformScreenRouter.jsx");

  const accountScreenBlock = source.match(/<MemoAccountScreen[\s\S]*?\/>/)?.[0];
  assert.ok(accountScreenBlock, "Missing MemoAccountScreen render");
  assert.match(
    accountScreenBlock,
    /accounts=\{accountScreenAccounts\}/,
    "the Accounts screen must receive the live-mode account list",
  );

  const algoScreenBlock = source.match(/<MemoAlgoScreen[\s\S]*?\/>/)?.[0];
  assert.ok(algoScreenBlock, "Missing MemoAlgoScreen render");
  assert.match(
    algoScreenBlock,
    /accounts=\{accounts\}/,
    "the algo screen must keep the environment-driven account list for existing internals",
  );
  assert.match(
    algoScreenBlock,
    /accountTabsAccounts=\{accountScreenAccounts\}/,
    "the algo screen account tabs must receive the live-mode account list",
  );
});

test("PlatformScreenRouter preserves the gateway trading block reason", () => {
  const source = readLocalSource("./PlatformScreenRouter.jsx");
  const tradeScreenBlock = source.match(/<MemoTradeScreen[\s\S]*?\/>/)?.[0];

  assert.match(
    source,
    /gatewayTradingMessage,\s*gatewayTradingBlockReason,/,
    "the router must accept the block reason computed by PlatformApp",
  );
  assert.ok(tradeScreenBlock, "Missing MemoTradeScreen render");
  assert.match(
    tradeScreenBlock,
    /gatewayTradingBlockReason=\{gatewayTradingBlockReason\}/,
    "the Trade screen must receive streams_stale instead of falling back to gateway",
  );
});
