import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { __shadowMassiveOptionsAuditInternalsForTests as audit } from "./shadow-massive-options-audit";

const scriptSource = await readFile(
  new URL("./shadow-massive-options-audit.ts", import.meta.url),
  "utf8",
);

test("configuration is blank-safe and keeps a valid fallback Massive key", () => {
  const config = audit.readConfig(
    {
      MASSIVE_API_KEY: "",
      MASSIVE_MARKET_DATA_API_KEY: " fallback-key ",
      MASSIVE_API_BASE_URL: "",
      SHADOW_MASSIVE_AUDIT_ACCOUNT_ID: "",
      SHADOW_MASSIVE_AUDIT_CONCURRENCY: "",
      SHADOW_MASSIVE_AUDIT_MAX_ROWS: "",
      SHADOW_MASSIVE_AUDIT_REPORT_DIR: "",
    },
    "/repo",
    new Date("2026-07-14T12:34:56.789Z"),
  );

  assert.equal(config.accountId, "shadow");
  assert.equal(config.concurrency, 4);
  assert.equal(config.maxRows, null);
  assert.equal(
    config.reportDir,
    path.resolve(
      "/repo",
      "reports/shadow-massive-options-audit/2026-07-14T12-34-56-789Z",
    ),
  );
  assert.deepEqual(config.provider, {
    name: "massive",
    baseUrl: "https://api.massive.com",
    apiKey: "fallback-key",
  });
});

test("configuration scopes the audit to an inclusive UTC date window", () => {
  const config = audit.readConfig({
    MASSIVE_API_KEY: "key",
    SHADOW_MASSIVE_AUDIT_START: "2026-07-13",
    SHADOW_MASSIVE_AUDIT_END: "2026-07-14",
  });

  assert.equal(config.start, "2026-07-13");
  assert.equal(config.end, "2026-07-14");
  assert.throws(
    () =>
      audit.readConfig({
        MASSIVE_API_KEY: "key",
        SHADOW_MASSIVE_AUDIT_START: "2026-07-15",
        SHADOW_MASSIVE_AUDIT_END: "2026-07-14",
      }),
    /window start must not exceed end/u,
  );
  assert.throws(
    () =>
      audit.readConfig({
        MASSIVE_API_KEY: "key",
        SHADOW_MASSIVE_AUDIT_START: "07\/13\/2026",
      }),
    /SHADOW_MASSIVE_AUDIT_START must use YYYY-MM-DD/u,
  );
});

test("ledger evidence excludes forward-test orders and positions", () => {
  assert.match(
    scriptSource,
    /lower\(coalesce\(o\.payload->>'forwardTest', 'false'\)\) <> 'true'/u,
  );
  assert.match(
    scriptSource,
    /position_key not like 'shadow_equity_forward:%'/u,
  );
});

test("internal ledger summary uses the audited fill window", () => {
  const query = audit.internalLedgerSummaryQuery(
    "shadow",
    "2026-07-13",
    "2026-07-14",
  );
  const sql = query.text.replace(/\s+/gu, " ");

  assert.deepEqual(query.values, ["shadow", "2026-07-13", "2026-07-14"]);
  assert.match(
    sql,
    /\(\$2::date is null or f\.occurred_at >= \$2::date\)/u,
  );
  assert.match(
    sql,
    /\(\$3::date is null or f\.occurred_at < \$3::date \+ interval '1 day'\)/u,
  );
  assert.match(
    sql,
    /exists \(select 1 from active_fills f where f\.order_id = o\.id\)/u,
  );
  assert.match(
    sql,
    /not exists \(select 1 from shadow_fills f where f\.order_id = o\.id\).*o\.placed_at >= \$2::date.*o\.placed_at < \$3::date \+ interval '1 day'/u,
  );
});

test("invalid numeric configuration fails instead of widening the audit", () => {
  for (const [name, value] of [
    ["SHADOW_MASSIVE_AUDIT_MAX_ROWS", "invalid"],
    ["SHADOW_MASSIVE_AUDIT_MAX_ROWS", "0"],
    ["SHADOW_MASSIVE_AUDIT_MAX_ROWS", "1.5"],
    ["SHADOW_MASSIVE_AUDIT_MAX_ROWS", "1e3"],
    ["SHADOW_MASSIVE_AUDIT_CONCURRENCY", "0"],
    ["SHADOW_MASSIVE_AUDIT_CONCURRENCY", "17"],
  ] as const) {
    assert.throws(
      () => audit.readConfig({ MASSIVE_API_KEY: "key", [name]: value }),
      new RegExp(name),
    );
  }
});

test("Massive base URLs reject credential-bearing and non-HTTP scopes", () => {
  for (const baseUrl of [
    "file:///tmp/provider.json",
    "https://operator:secret@example.test",
    "https://example.test/api?token=secret",
    "https://example.test/api#fragment",
  ]) {
    assert.throws(
      () =>
        audit.readConfig({
          MASSIVE_API_KEY: "key",
          MASSIVE_API_BASE_URL: baseUrl,
        }),
      /MASSIVE_API_BASE_URL/u,
    );
  }
});

test("provider URLs retain an explicitly configured reverse-proxy base path", () => {
  const url = audit.providerUrl(
    {
      name: "massive",
      baseUrl: "https://example.test/provider/api",
      apiKey: "test-key",
    },
    "/v3/trades/O%3AAAPL260717C00200000",
  );

  assert.equal(url.pathname, "/provider/api/v3/trades/O%3AAAPL260717C00200000");
  assert.equal(url.searchParams.get("apiKey"), "test-key");
});

test("external numeric parsing rejects coercive non-values", () => {
  for (const value of [null, undefined, "", "   ", true, false, [], [1], {}]) {
    assert.equal(audit.finiteNumber(value), null);
  }
  assert.equal(audit.finiteNumber("12.5"), 12.5);
  assert.equal(audit.finiteNumber(12.5), 12.5);
});

test("provider trade timestamps normalize seconds through nanoseconds", () => {
  for (const rawTimestamp of [
    1_720_958_400.123, 1_720_958_400_123, 1_720_958_400_123_456,
    1_720_958_400_123_456_789,
  ]) {
    const trade = audit.parseProviderTrade({
      price: 1,
      sip_timestamp: rawTimestamp,
    });
    assert.equal(trade.timestampMs, 1_720_958_400_123);
    assert.equal(trade.timestampIso, "2024-07-14T12:00:00.123Z");
  }
});

test("quote cross-check distinguishes an exact recorded snapshot from market-range support", () => {
  const quotes = [
    audit.parseProviderQuote({
      bid_price: 1.8,
      ask_price: 2,
      sip_timestamp: 1_783_950_053_710_123_456,
    }),
    audit.parseProviderQuote({
      bid_price: 1.85,
      ask_price: 2.05,
      sip_timestamp: 1_783_950_054_000_000_000,
    }),
  ].filter((quote) => quote !== null);

  const evidence = audit.quoteWindowEvidence(
    quotes,
    {
      bid: 1.8,
      ask: 2,
      timestampMs: 1_783_950_053_710,
      timestampIso: "2026-07-13T13:40:53.710Z",
    },
    1.99,
  );

  assert.equal(evidence.exactSnapshot?.timestampMs, 1_783_950_053_710);
  assert.equal(evidence.exactTimestampMatch, true);
  assert.equal(evidence.fillInsideSpread?.timestampMs, 1_783_950_053_710);
});

test("quote cross-check detects a recorded snapshot superseded before the fill", () => {
  const recordedAt = 1_783_950_053_710;
  const fillAt = recordedAt + 5_000;
  const quotes = [
    audit.parseProviderQuote({
      bid_price: 1.8,
      ask_price: 2,
      sip_timestamp: String(BigInt(recordedAt) * 1_000_000n),
    }),
    audit.parseProviderQuote({
      bid_price: 1.6,
      ask_price: 1.8,
      sip_timestamp: String(BigInt(fillAt - 1_000) * 1_000_000n),
    }),
  ].filter((quote) => quote !== null);

  const evidence = audit.quoteWindowEvidence(
    quotes,
    {
      bid: 1.8,
      ask: 2,
      timestampMs: recordedAt,
      timestampIso: new Date(recordedAt).toISOString(),
    },
    1.99,
    fillAt,
  );

  assert.equal(evidence.exactTimestampMatch, true);
  assert.equal(evidence.latestAtOrBeforeFill?.bid, 1.6);
  assert.equal(evidence.recordedSnapshotCurrentAtFill, false);
});

test("trade matches require one provider row to carry the recorded price and timestamp", () => {
  const splitEvidence = [
    { price: 10, timestampMs: 1_000, timestampIso: null, rawTimestamp: 1_000 },
    { price: 12, timestampMs: 2_000, timestampIso: null, rawTimestamp: 2_000 },
    { price: 11, timestampMs: 3_000, timestampIso: null, rawTimestamp: 3_000 },
  ];

  assert.equal(audit.tradeWindowMatches(splitEvidence, 10, 12, 3_000), false);
  assert.equal(audit.tradeWindowMatches(splitEvidence, 10, 12, 2_000), true);
  assert.equal(audit.tradeWindowMatches(splitEvidence, 10, null, 2_000), false);
});

test("invalid aggregate timestamps are ignored rather than throwing", () => {
  assert.equal(audit.parseProviderAggregate({ t: null, c: 2 }), null);
  assert.equal(
    audit.parseProviderAggregate({ t: Number.MAX_VALUE, c: 2 }),
    null,
  );
});

test("declared oversized provider responses are cancelled without being read", async () => {
  let cancelled = false;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    }),
    { headers: { "content-length": "4" } },
  );

  await assert.rejects(
    audit.readResponseText(response, 3),
    /exceeded the 3-byte limit/u,
  );
  assert.equal(cancelled, true);
});

test("streamed provider responses enforce the byte limit", async () => {
  let cancelled = false;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{}"));
        controller.enqueue(new TextEncoder().encode("{}"));
      },
      cancel() {
        cancelled = true;
      },
    }),
  );

  await assert.rejects(
    audit.readResponseText(response, 3),
    /exceeded the 3-byte limit/u,
  );
  assert.equal(cancelled, true);
});

test("provider responses reject malformed UTF-8", async () => {
  const response = new Response(
    Uint8Array.from([
      0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d,
    ]),
  );

  await assert.rejects(audit.readResponseText(response), /invalid UTF-8/u);
});

test("provider JSON must have a valid object root", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("[]", { status: 200 });
  try {
    await assert.rejects(
      audit.fetchJson(new URL("https://example.test/trades"), 100),
      /JSON object/u,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("failed provider responses cancel their untrusted bodies", async () => {
  const originalFetch = globalThis.fetch;
  let cancelled = false;
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("untrusted failure"));
        },
        cancel() {
          cancelled = true;
        },
      }),
      { status: 503 },
    );
  try {
    await assert.rejects(
      audit.fetchJson(new URL("https://example.test/trades"), 100),
      /HTTP 503/u,
    );
    assert.equal(cancelled, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("provider requests time out and refuse credential-forwarding redirects", async () => {
  const originalFetch = globalThis.fetch;
  let redirect: RequestInit["redirect"];
  globalThis.fetch = async (_input, init) => {
    redirect = init?.redirect;
    return await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(init.signal?.reason),
        {
          once: true,
        },
      );
    });
  };
  try {
    await assert.rejects(
      audit.fetchJson(new URL("https://example.test/trades?apiKey=secret"), 5),
      /timed out/u,
    );
    assert.equal(redirect, "error");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("CSV cells neutralize spreadsheet formulas without changing numeric values", () => {
  assert.equal(audit.csvCell("=1+1"), "'=1+1");
  assert.equal(audit.csvCell("+cmd|'/C calc'!A0"), "'+cmd|'/C calc'!A0");
  assert.equal(audit.csvCell(-12.5), "-12.5");
});

test("operator errors redact credentials, controls, bidi, and unbounded text", () => {
  const message = audit.errorMessage(
    new Error(
      `https://operator:super-secret@example.test/path?apiKey=query-secret \u001b[31mline\nnext\u202e${"x".repeat(2_000)}`,
    ),
  );

  assert.match(message, /https:\/\/\[redacted\]@example\.test\/path/u);
  assert.doesNotMatch(message, /super-secret/u);
  assert.doesNotMatch(message, /query-secret/u);
  assert.doesNotMatch(
    message,
    /[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]/u,
  );
  assert.ok(message.length <= 1_000);
});

test("terminal JSON sanitizes persisted strings", () => {
  const rendered = audit.jsonText({
    source: "source\nforged\u2028next\u2029last\u202e",
    url: "https://operator:secret@example.test/path",
  });

  assert.doesNotMatch(rendered, /secret/u);
  assert.doesNotMatch(rendered, /[\u2028\u2029\u202e]/u);
  assert.match(rendered, /\[redacted\]@example\.test/u);
});

test("Markdown reports cannot be structurally rewritten by persisted data", () => {
  const markdown = audit.buildMarkdown({
    summary: {
      generatedAt: "2026-07-14T00:00:00.000Z",
      accountId: "shadow\n# FORGED ACCOUNT",
      auditWindow: { start: "2026-07-13", end: "2026-07-14" },
      provider: {
        name: "massive" as const,
        baseUrl: "https://example.test/<script>alert(1)</script>",
      },
      reportDir: "/tmp/report|forged",
      internal: {
        ledger: {
          fills: 1,
          orders: 1,
          distinctFillOrders: 1,
          ordersWithoutFills: 0,
          symbols: 1,
          optionTickers: 1,
          buyFills: 1,
          sellFills: 0,
          realizedPnl: 0,
          fees: 0,
          cashDelta: -100,
          firstFillAt: new Date("2026-07-14T00:00:00.000Z"),
          lastFillAt: new Date("2026-07-14T00:00:00.000Z"),
        },
        positions: [
          {
            status: "open|forged\n# FORGED POSITION",
            positions: 1,
            netQuantity: 1,
            realizedPnl: 0,
            fees: 0,
          },
        ],
        snapshots: [
          {
            source: "[forged](https://example.test)",
            snapshots: 1,
            minNetLiquidation: 1,
            maxNetLiquidation: 1,
            firstAsOf: new Date("2026-07-14T00:00:00.000Z"),
            lastAsOf: new Date("2026-07-14T00:00:00.000Z"),
          },
        ],
      },
      external: {
        total: 1,
        matched: 0,
        unresolved: 1,
        providerErrors: 1,
        recordedSnapshotsSupersededBeforeFill: 0,
        bySource: [
          {
            key: "source|forged\n# FORGED BUCKET",
            total: 1,
            matched: 0,
            nearbyCloseOnly: 0,
            unresolved: 1,
            providerErrors: 1,
          },
        ],
        bySideAndSource: [],
      },
    },
    results: [
      {
        fillId: "fill",
        orderId: "order",
        symbol: "AAPL|forged\n# FORGED SYMBOL",
        optionTicker: "O:AAPL",
        side: "buy" as const,
        quantity: 1,
        fillPrice: 1,
        occurredAt: "2026-07-14T00:00:00.000Z",
        orderSource: "automation",
        provenanceSource: "massive-option-trade",
        status: "provider_error" as const,
        reason: "[forged](https://example.test)\n<script>alert(1)</script>",
        providerResultCount: 0,
        recordedTradeAt: null,
        recordedTradePrice: null,
        recordedMarkPrice: null,
      },
    ],
  });

  assert.doesNotMatch(markdown, /^# FORGED/mu);
  assert.doesNotMatch(markdown, /<script/iu);
  assert.doesNotMatch(markdown, /\[forged\]\(https:/u);
  assert.match(markdown, /\\\|/u);
  assert.match(markdown, /## Position Summary \(All-History Context\)/u);
  assert.match(markdown, /## Balance Snapshots \(All-History Context\)/u);
  assert.match(
    markdown,
    /not restricted to the audited fill window/gu,
  );
});

test("report files publish as one directory and never overwrite prior evidence", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "shadow-massive-audit-"));
  const reportDir = path.join(root, "report");
  const original = {
    "results.json": "original json\n",
    "results.csv": "original csv\n",
    "report.md": "original markdown\n",
  };

  try {
    await assert.doesNotReject(
      audit.assertReportDestinationAvailable(reportDir),
    );
    await audit.publishReportFiles(reportDir, original);
    assert.deepEqual((await readdir(reportDir)).sort(), [
      "report.md",
      "results.csv",
      "results.json",
    ]);

    await assert.rejects(
      audit.assertReportDestinationAvailable(reportDir),
      /Report destination already exists/u,
    );
    await assert.rejects(
      audit.publishReportFiles(reportDir, {
        "results.json": "replacement json\n",
        "results.csv": "replacement csv\n",
        "report.md": "replacement markdown\n",
      }),
    );
    assert.equal(
      await readFile(path.join(reportDir, "results.json"), "utf8"),
      original["results.json"],
    );
    assert.deepEqual(
      (await readdir(root)).filter((name) => name.includes(".tmp-")),
      [],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
