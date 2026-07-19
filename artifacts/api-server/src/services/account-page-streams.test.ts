import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import * as ts from "typescript";
import {
  __accountPageStreamInternalsForTests,
  clearAccountPageSnapshotCache,
  subscribeAccountPageSnapshots,
  type AccountPageDerivedPayload,
  type AccountPageLivePayload,
} from "./account-page-streams";
import {
  __resetSseStreamDiagnosticsForTests,
  getSseEmitCounters,
  serializeSseEventData,
} from "./sse-stream-diagnostics";
import { runWithShadowAccountId } from "./shadow-account-context";
import { notifyShadowAccountChanged } from "./shadow-account-events";

const source = readFileSync(new URL("./account-page-streams.ts", import.meta.url), "utf8");
const sourceFile = ts.createSourceFile(
  "account-page-streams.ts",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);

function propertyNameText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

function findFunctionDeclaration(name: string): ts.FunctionDeclaration {
  for (const statement of sourceFile.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === name
    ) {
      return statement;
    }
  }
  throw new Error(`Missing ${name}`);
}

function functionSource(name: string): string {
  const target = findFunctionDeclaration(name);
  return source.slice(target.pos, target.end);
}

function getAccountPositionLiveQuoteFlags(functionName: string): string[] {
  const target = findFunctionDeclaration(functionName);
  const flags: string[] = [];

  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "getAccountPositions"
    ) {
      const [input] = node.arguments;
      if (input && ts.isObjectLiteralExpression(input)) {
        for (const property of input.properties) {
          if (
            ts.isPropertyAssignment(property) &&
            propertyNameText(property.name) === "liveQuotes"
          ) {
            flags.push(property.initializer.kind === ts.SyntaxKind.TrueKeyword ? "true" : "false");
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(target);
  return flags;
}

type TimerHandle = {
  callback: () => void;
  unref: () => void;
};

function createFakeTimers() {
  const timeouts = new Set<TimerHandle>();
  return {
    setTimeout: ((callback: () => void) => {
      const handle = { callback, unref: () => {} };
      timeouts.add(handle);
      return handle as never;
    }) as unknown as typeof setTimeout,
    clearTimeout: ((handle: TimerHandle) => {
      timeouts.delete(handle);
    }) as unknown as typeof clearTimeout,
    fireTimeouts: () => {
      for (const handle of [...timeouts]) {
        timeouts.delete(handle);
        handle.callback();
      }
    },
  };
}

async function flushAsyncWork() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function livePayload(input: {
  stamp: string;
  accountFetchStamp?: string;
  quoteStamp?: string;
  quantity?: number;
  netLiquidation?: number;
  equityValue?: number;
}): AccountPageLivePayload {
  const buildUpdatedAt = new Date(input.stamp);
  const accountFetchUpdatedAt = new Date(
    input.accountFetchStamp ?? input.stamp,
  );
  const quoteUpdatedAt = new Date(
    input.quoteStamp ?? "2026-07-07T00:00:00.000Z",
  );
  return {
    stream: "account-page-live",
    accountId: "account-test",
    mode: "live",
    orderTab: "working",
    assetClass: null,
    updatedAt: input.stamp,
    summary: {
      updatedAt: accountFetchUpdatedAt,
      accounts: [{ updatedAt: accountFetchUpdatedAt }],
      fx: { timestamp: accountFetchUpdatedAt },
      metrics: {
        netLiquidation: {
          value: input.netLiquidation ?? 100,
          updatedAt: accountFetchUpdatedAt,
        },
      },
    } as never,
    intradayEquity: {
      asOf: accountFetchUpdatedAt,
      latestSnapshotAt: accountFetchUpdatedAt,
      liveTerminalIncluded: true,
      terminalPointSource: "live_account_summary",
      points: [
        {
          timestamp: accountFetchUpdatedAt,
          netLiquidation: input.equityValue ?? 100,
          source: "IBKR_ACCOUNT_SUMMARY",
        },
      ],
    } as never,
    allocation: { updatedAt: accountFetchUpdatedAt } as never,
    positions: {
      updatedAt: accountFetchUpdatedAt,
      positions: [
        {
          id: "position-1",
          quantity: input.quantity ?? 1,
          quote: {
            mark: 100,
            updatedAt: quoteUpdatedAt,
            dataUpdatedAt: quoteUpdatedAt,
            ageMs: input.stamp.endsWith("01.000Z") ? 1_000 : 2_000,
            cacheAgeMs: input.stamp.endsWith("01.000Z") ? 1_000 : 2_000,
          },
        },
      ],
    } as never,
    orders: { updatedAt: buildUpdatedAt, orders: [] } as never,
    risk: { updatedAt: accountFetchUpdatedAt } as never,
  };
}

function derivedPayload(input: {
  stamp: string;
  settledCash?: number;
  equityValue?: number;
}): AccountPageDerivedPayload {
  const updatedAt = new Date(input.stamp);
  const equityHistory = {
    asOf: updatedAt,
    latestSnapshotAt: updatedAt,
    liveTerminalIncluded: true,
    terminalPointSource: "live_account_summary",
    points: [
      {
        timestamp: updatedAt,
        netLiquidation: input.equityValue ?? 100,
        source: "IBKR_ACCOUNT_SUMMARY",
      },
    ],
  };
  return {
    stream: "account-page-derived",
    accountId: "account-test",
    mode: "live",
    range: "1D",
    tradeFilters: {
      from: null,
      to: null,
      symbol: null,
      assetClass: null,
      pnlSign: null,
      holdDuration: null,
    },
    performanceCalendarFrom: null,
    updatedAt: input.stamp,
    equityHistory: equityHistory as never,
    benchmarkEquityHistory: {
      SPY: equityHistory,
      QQQ: equityHistory,
      DIA: equityHistory,
    } as never,
    performanceCalendarEquity: equityHistory as never,
    performanceCalendarTrades: { updatedAt, trades: [] } as never,
    closedTrades: { updatedAt, trades: [] } as never,
    cashActivity: {
      updatedAt,
      settledCash: input.settledCash ?? 50,
      activities: [],
      dividends: [],
    } as never,
    flexHealth: { lastStatus: "completed" } as never,
  };
}

test("shadow account-page live positions keep quote hydration", () => {
  const flags = getAccountPositionLiveQuoteFlags("fetchAccountPageLivePayload");
  assert.ok(
    flags.includes("true"),
    "fetchAccountPageLivePayload must request liveQuotes:true for shadow account positions",
  );
  assert.ok(
    !flags.includes("false"),
    "fetchAccountPageLivePayload must not disable live quotes for shadow account positions",
  );
});

test("real account-page live positions use fast live quote hydration", () => {
  const body = functionSource("fetchAccountPageLivePayload");
  assert.match(
    body,
    /const \[primary,\s*livePositions,\s*intradayEquity\] = await Promise\.all\(\[[\s\S]*?fetchAccountPagePrimaryPayload\(normalized\)[\s\S]*?getAccountPositions\(\{[\s\S]*?detail:\s*"fast"[\s\S]*?liveQuotes:\s*true[\s\S]*?\}\)[\s\S]*?\]\);[\s\S]*?positions:\s*livePositions/,
    "real account live payload must refresh positions with liveQuotes:true instead of reusing primary.positions",
  );
  assert.doesNotMatch(
    body,
    /positions:\s*primary\.positions/,
    "real account live payload must not publish quote-free primary positions",
  );
});

test("real account-page primary positions use fast quote-free first paint", () => {
  const body = functionSource("fetchAccountPagePrimaryPayload");
  assert.match(
    body,
    /getAccountPositions\(\{[\s\S]*?detail:\s*"fast"[\s\S]*?liveQuotes:\s*false[\s\S]*?\}\)/,
  );
  assert.match(
    body,
    /isShadow[\s\S]*?getAccountPositions\(\{[\s\S]*?liveQuotes:\s*true[\s\S]*?\}\)/,
  );
});

test("shadow account-page primary fetches canonical orders", () => {
  const body = functionSource("fetchAccountPagePrimaryPayload");
  assert.match(
    body,
    /const \[shadowPositions,\s*shadowOrders\] = await Promise\.all\(\[[\s\S]*?getAccountPositions\([\s\S]*?getAccountOrders\(\{[\s\S]*?tab:\s*normalized\.orderTab[\s\S]*?\}\)[\s\S]*?\]\);/,
  );
  assert.match(body, /orders\s*=\s*shadowOrders/);
  assert.doesNotMatch(source, /deferredShadowOrders/);
});

test("shadow account-page fast risk owns its deferred-history semantics", () => {
  assert.doesNotMatch(source, /deferredShadowClosedTrades/);
  for (const functionName of [
    "fetchAccountPageLivePayload",
    "fetchAccountPagePrimaryPayload",
  ]) {
    const body = functionSource(functionName);
    assert.doesNotMatch(body, /closedTrades:\s*/);
    assert.match(
      body,
      /getShadowAccountRisk\(\{[\s\S]*?positionsResponse:[\s\S]*?detail:\s*"fast"[\s\S]*?\}\)/,
    );
  }
});

test("account-page subscriptions wait for a current live payload", () => {
  const body = functionSource("subscribeAccountPageSnapshots");
  assert.doesNotMatch(body, /writeCachedAccountPageLivePayload/);
  assert.doesNotMatch(body, /readCachedAccountPageLivePayload/);
  assert.doesNotMatch(body, /queueMicrotask/);
  assert.doesNotMatch(body, /refreshing:\s*true/);
});

test("account-page streams have no last-live replay cache", () => {
  assert.doesNotMatch(source, /accountPageLastLiveCache/);
  assert.doesNotMatch(source, /readCachedAccountPageLivePayload/);
  assert.doesNotMatch(source, /writeCachedAccountPageLivePayload/);
  assert.doesNotMatch(source, /ACCOUNT_PAGE_LAST_LIVE_/);
});

test("account-page caches isolate the resolved shadow account scope", () => {
  const { cacheKeyForInput } = __accountPageStreamInternalsForTests;
  const input = {
    accountId: "shadow",
    appUserId: "app-user-1",
    mode: "shadow",
  } as const;
  const first = runWithShadowAccountId("shadow-user-1", () =>
    cacheKeyForInput(input),
  );
  const second = runWithShadowAccountId("shadow-user-2", () =>
    cacheKeyForInput(input),
  );
  const sameScopeOtherUser = runWithShadowAccountId("shadow-user-1", () =>
    cacheKeyForInput({ ...input, appUserId: "app-user-2" }),
  );

  assert.notEqual(first, second);
  assert.equal(first, sameScopeOtherUser);
});

test("account-page caches isolate real accounts by authenticated user", () => {
  const { cacheKeyForInput } = __accountPageStreamInternalsForTests;

  assert.notEqual(
    cacheKeyForInput({
      accountId: "combined",
      appUserId: "app-user-1",
      mode: "live",
    }),
    cacheKeyForInput({
      accountId: "combined",
      appUserId: "app-user-2",
      mode: "live",
    }),
  );
  assert.notEqual(
    cacheKeyForInput({
      accountId: "combined",
      appUserId: "app-user-1",
      allowDirectIbkr: false,
      mode: "live",
    }),
    cacheKeyForInput({
      accountId: "combined",
      appUserId: "app-user-1",
      allowDirectIbkr: true,
      mode: "live",
    }),
  );
});

test("real account-page custom cache keys include authenticated user scope", () => {
  for (const functionName of [
    "fetchAccountPageLivePayload",
    "fetchAccountPagePrimaryPayload",
    "fetchAccountPageBenchmarkEquityHistory",
  ]) {
    const body = functionSource(functionName);
    const keyStart = body.indexOf("const cacheKey = stableStringify({");
    const keyEnd = body.indexOf("\n  });", keyStart);
    assert.notEqual(keyStart, -1, `${functionName} must build a cache key`);
    assert.notEqual(keyEnd, -1, `${functionName} cache key must be bounded`);
    assert.match(
      body.slice(keyStart, keyEnd),
      /appUserId/,
      `${functionName} cache key must include appUserId`,
    );
    assert.match(
      body.slice(keyStart, keyEnd),
      /allowDirectIbkr/,
      `${functionName} cache key must include direct IBKR access`,
    );
  }
});

test("account-page service calls propagate direct IBKR access", () => {
  for (const functionName of [
    "fetchAccountPageLivePayload",
    "fetchAccountPagePrimaryPayload",
    "fetchAccountPageDerivedPayload",
  ]) {
    assert.match(
      functionSource(functionName),
      /allowDirectIbkr:\s*normalized\.allowDirectIbkr/,
    );
  }
  assert.match(
    functionSource("fetchAccountPageBenchmarkEquityHistory"),
    /allowDirectIbkr:\s*input\.allowDirectIbkr/,
  );
});

test("account-page payload identity ignores build stamps but keeps source changes", () => {
  const { retainAccountPagePayload } = __accountPageStreamInternalsForTests;
  const live = retainAccountPagePayload(null, livePayload({
    stamp: "2026-07-07T00:00:01.000Z",
  }));
  const sameLive = retainAccountPagePayload(live, livePayload({
    stamp: "2026-07-07T00:00:02.000Z",
  }));
  const changedLive = retainAccountPagePayload(live, livePayload({
    stamp: "2026-07-07T00:00:03.000Z",
    quantity: 2,
  }));
  const refreshedLive = retainAccountPagePayload(live, livePayload({
    stamp: "2026-07-07T00:00:03.000Z",
    quoteStamp: "2026-07-07T00:00:03.000Z",
  }));
  const changedSummary = retainAccountPagePayload(live, livePayload({
    stamp: "2026-07-07T00:00:03.000Z",
    netLiquidation: 101,
  }));
  const changedEquity = retainAccountPagePayload(live, livePayload({
    stamp: "2026-07-07T00:00:03.000Z",
    equityValue: 101,
  }));
  assert.strictEqual(sameLive, live);
  assert.notStrictEqual(changedLive, live);
  assert.notStrictEqual(refreshedLive, live);
  assert.notStrictEqual(changedSummary, live);
  assert.notStrictEqual(changedEquity, live);

  const derived = retainAccountPagePayload(null, derivedPayload({
    stamp: "2026-07-07T00:00:01.000Z",
  }));
  const sameDerived = retainAccountPagePayload(derived, derivedPayload({
    stamp: "2026-07-07T00:00:02.000Z",
  }));
  const changedDerived = retainAccountPagePayload(derived, derivedPayload({
    stamp: "2026-07-07T00:00:03.000Z",
    settledCash: 51,
  }));
  const changedDerivedEquity = retainAccountPagePayload(derived, derivedPayload({
    stamp: "2026-07-07T00:00:03.000Z",
    equityValue: 101,
  }));
  assert.strictEqual(sameDerived, derived);
  assert.notStrictEqual(changedDerived, derived);
  assert.notStrictEqual(changedDerivedEquity, derived);
});

test("account-page live polling waits a full interval after an overrun settles", async () => {
  const timers = createFakeTimers();
  const firstPayload = livePayload({ stamp: "2026-07-07T00:00:01.000Z" });
  let resolveFirstLive!: (payload: AccountPageLivePayload) => void;
  const firstLive = new Promise<AccountPageLivePayload>((resolve) => {
    resolveFirstLive = resolve;
  });
  let liveFetches = 0;
  const unsubscribe = subscribeAccountPageSnapshots(
    {
      accountId: "account-test",
      appUserId: "app-user-test",
      mode: "live",
    },
    () => {},
    () => {},
    {
      fetchLivePayload: async () => {
        liveFetches += 1;
        return liveFetches === 1
          ? firstLive
          : livePayload({ stamp: "2026-07-07T00:00:02.000Z" });
      },
      fetchDerivedPayload: async () =>
        derivedPayload({ stamp: "2026-07-07T00:00:01.000Z" }),
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
    },
  );

  try {
    timers.fireTimeouts();
    await flushAsyncWork();
    assert.equal(liveFetches, 1);

    timers.fireTimeouts();
    resolveFirstLive(firstPayload);
    await flushAsyncWork();
    assert.equal(liveFetches, 1);

    timers.fireTimeouts();
    await flushAsyncWork();
    assert.equal(liveFetches, 2);
  } finally {
    unsubscribe();
  }
});

test("shadow changes coalesce during a live fetch and refresh promptly when idle", async () => {
  const timers = createFakeTimers();
  let resolveFirstLive!: (payload: AccountPageLivePayload) => void;
  const firstLive = new Promise<AccountPageLivePayload>((resolve) => {
    resolveFirstLive = resolve;
  });
  let liveFetches = 0;
  const unsubscribe = subscribeAccountPageSnapshots(
    {
      accountId: "shadow",
      appUserId: "app-user-test",
      mode: "shadow",
    },
    () => {},
    () => {},
    {
      fetchLivePayload: async () => {
        liveFetches += 1;
        return liveFetches === 1
          ? firstLive
          : livePayload({ stamp: `2026-07-07T00:00:0${liveFetches}.000Z` });
      },
      fetchDerivedPayload: async () =>
        derivedPayload({ stamp: "2026-07-07T00:00:01.000Z" }),
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
    },
  );

  try {
    timers.fireTimeouts();
    await flushAsyncWork();
    assert.equal(liveFetches, 1);

    notifyShadowAccountChanged();
    notifyShadowAccountChanged();
    await flushAsyncWork();
    assert.equal(liveFetches, 1);

    resolveFirstLive(livePayload({ stamp: "2026-07-07T00:00:01.000Z" }));
    await flushAsyncWork();
    assert.equal(liveFetches, 1);

    timers.fireTimeouts();
    await flushAsyncWork();
    assert.equal(liveFetches, 2);

    notifyShadowAccountChanged();
    await flushAsyncWork();
    assert.equal(liveFetches, 3);
  } finally {
    unsubscribe();
    clearAccountPageSnapshotCache();
  }
});

test("unsubscribe during a live fetch prevents emission and future polling", async () => {
  const timers = createFakeTimers();
  let resolveLive!: (payload: AccountPageLivePayload) => void;
  const pendingLive = new Promise<AccountPageLivePayload>((resolve) => {
    resolveLive = resolve;
  });
  let liveFetches = 0;
  let liveEmits = 0;
  let unsubscribed = false;
  const unsubscribe = subscribeAccountPageSnapshots(
    {
      accountId: "account-test",
      appUserId: "app-user-test",
      mode: "live",
    },
    () => {
      liveEmits += 1;
    },
    () => {},
    {
      fetchLivePayload: async () => {
        liveFetches += 1;
        return pendingLive;
      },
      fetchDerivedPayload: async () =>
        derivedPayload({ stamp: "2026-07-07T00:00:01.000Z" }),
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
    },
  );

  try {
    timers.fireTimeouts();
    await flushAsyncWork();
    assert.equal(liveFetches, 1);

    unsubscribe();
    unsubscribed = true;
    resolveLive(livePayload({ stamp: "2026-07-07T00:00:01.000Z" }));
    await flushAsyncWork();
    timers.fireTimeouts();
    await flushAsyncWork();

    assert.equal(liveFetches, 1);
    assert.equal(liveEmits, 0);
  } finally {
    if (!unsubscribed) {
      unsubscribe();
      resolveLive(livePayload({ stamp: "2026-07-07T00:00:01.000Z" }));
    }
  }
});

test("account-page subscriber emits and serializes each changed lane exactly once", async () => {
  __resetSseStreamDiagnosticsForTests();
  clearAccountPageSnapshotCache();
  const timers = createFakeTimers();
  const { retainAccountPagePayload } = __accountPageStreamInternalsForTests;
  const initialLive = retainAccountPagePayload(null, livePayload({
    stamp: "2026-07-07T00:00:01.000Z",
  }));
  const unchangedLive = retainAccountPagePayload(initialLive, livePayload({
    stamp: "2026-07-07T00:00:02.000Z",
  }));
  const changedLive = retainAccountPagePayload(initialLive, livePayload({
    stamp: "2026-07-07T00:00:03.000Z",
    quantity: 2,
  }));
  const initialDerived = retainAccountPagePayload(null, derivedPayload({
    stamp: "2026-07-07T00:00:01.000Z",
  }));
  const unchangedDerived = retainAccountPagePayload(initialDerived, derivedPayload({
    stamp: "2026-07-07T00:00:02.000Z",
  }));
  const changedDerived = retainAccountPagePayload(initialDerived, derivedPayload({
    stamp: "2026-07-07T00:00:03.000Z",
    settledCash: 51,
  }));
  const livePayloads = [unchangedLive, changedLive];
  const derivedPayloads = [unchangedDerived, changedDerived];
  const liveEmits: AccountPageLivePayload[] = [];
  const derivedEmits: AccountPageDerivedPayload[] = [];
  let liveFetches = 0;
  let derivedFetches = 0;
  const unsubscribe = subscribeAccountPageSnapshots(
    {
      accountId: "account-test",
      appUserId: "app-user-test",
      mode: "live",
    },
    (payload) => {
      liveEmits.push(payload);
      serializeSseEventData(payload);
    },
    (payload) => {
      derivedEmits.push(payload);
      serializeSseEventData(payload);
    },
    {
      initialLivePayload: initialLive,
      initialDerivedPayload: initialDerived,
      fetchLivePayload: async () => livePayloads[liveFetches++]!,
      fetchDerivedPayload: async () => derivedPayloads[derivedFetches++]!,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
    },
  );

  try {
    timers.fireTimeouts();
    await flushAsyncWork();
    assert.equal(getSseEmitCounters().events, 0);
    assert.equal(liveEmits.length, 0);
    assert.equal(derivedEmits.length, 0);

    timers.fireTimeouts();
    await flushAsyncWork();
    assert.equal(getSseEmitCounters().events, 2);
    assert.equal(liveEmits.length, 1);
    assert.equal(derivedEmits.length, 1);
  } finally {
    unsubscribe();
    clearAccountPageSnapshotCache();
    __resetSseStreamDiagnosticsForTests();
  }
});

test("account-page subscription change detection is object-identity only", () => {
  const body = functionSource("subscribeAccountPageSnapshots");
  assert.doesNotMatch(body, /stableStringify/);
  assert.match(body, /snapshot\s*!==\s*lastLivePayload/);
  assert.match(body, /snapshot\s*!==\s*lastDerivedPayload/);

  const liveBuilder = functionSource("fetchAccountPageLivePayload");
  assert.match(
    liveBuilder,
    /return retainAccountPageLivePayload\(cacheKey, value, version\)/,
  );
  assert.match(
    liveBuilder,
    /shadowAccountId:\s*shadowAccountIdForCache\(normalized\.accountId\)/,
  );
  const primaryBuilder = functionSource("fetchAccountPagePrimaryPayload");
  assert.match(
    primaryBuilder,
    /shadowAccountId:\s*shadowAccountIdForCache\(normalized\.accountId\)/,
  );
  const benchmarkBuilder = functionSource("fetchAccountPageBenchmarkEquityHistory");
  assert.match(
    benchmarkBuilder,
    /shadowAccountId:\s*shadowAccountIdForCache\(input\.accountId\)/,
  );
  const derivedBuilder = functionSource("fetchAccountPageDerivedPayload");
  assert.match(derivedBuilder, /const value = retainAccountPagePayload\(/);
});
