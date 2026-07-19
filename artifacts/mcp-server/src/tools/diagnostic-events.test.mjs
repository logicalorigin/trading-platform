import assert from "node:assert/strict";
import test from "node:test";

import { drizzle } from "drizzle-orm/node-postgres";
import { diagnosticEventsTable } from "@workspace/db/schema";
import { z } from "zod";
import {
  buildDiagnosticEventsQuery,
  diagnosticEventsTool,
  handleListDiagnosticEvents,
} from "./diagnostic-events.ts";

const from = new Date("2026-07-08T12:00:00.000Z");
const to = new Date("2026-07-09T12:00:00.000Z");
const eventRow = {
  id: "7ddaf8a1-6fd7-4c99-aa2c-e8eb0ca0f497",
  incidentKey: "api:test-warning",
  subsystem: "api",
  category: "request-pressure",
  code: null,
  severity: "warning",
  status: "open",
  message: "Test warning",
  firstSeenAt: new Date("2026-07-09T10:00:00.000Z"),
  lastSeenAt: new Date("2026-07-09T11:00:00.000Z"),
  eventCount: 3,
  dimensions: { route: "/api/test" },
  raw: { p95Ms: 1200 },
  createdAt: new Date("2026-07-09T10:00:00.000Z"),
  updatedAt: new Date("2026-07-09T11:00:00.000Z"),
};

test("preserves the historical MCP input contract", () => {
  assert.deepEqual(Object.keys(diagnosticEventsTool.inputShape), [
    "subsystem",
    "severity",
    "from",
    "to",
  ]);
});

test("SDK input schema enforces bounded normalized diagnostic filters", () => {
  const schema = z.object(diagnosticEventsTool.inputShape);
  const overlongDate = `2026-07-19T12:00:00.${"1".repeat(44)}Z`;
  const invalidInputs = [
    ["blank subsystem", { subsystem: "   " }],
    ["49-character subsystem", { subsystem: "x".repeat(49) }],
    ["invalid severity", { severity: "error" }],
    ["blank from", { from: "   " }],
    ["blank to", { to: "   " }],
    ["malformed from", { from: "not-a-date" }],
    ["timezone-free to", { to: "2026-07-19T12:00:00" }],
    ["overlong to", { to: overlongDate }],
    ["non-finite native date", { from: "2026-07-19T12:00:00+99:99" }],
  ];
  const validInput = {
    subsystem: " api ",
    severity: "warning",
    from: "  2026-07-19T12:00:00Z  ",
    to: "  2026-07-19T08:00:00-04:00  ",
  };
  const validResult = schema.safeParse(validInput);

  assert.equal(overlongDate.length, 65);
  assert.deepEqual(
    {
      rejected: Object.fromEntries(
        invalidInputs.map(([label, input]) => [label, !schema.safeParse(input).success]),
      ),
      valid: validResult.success,
      normalized: validResult.success ? validResult.data : null,
    },
    {
      rejected: Object.fromEntries(invalidInputs.map(([label]) => [label, true])),
      valid: true,
      normalized: {
        subsystem: "api",
        severity: "warning",
        from: "2026-07-19T12:00:00Z",
        to: "2026-07-19T08:00:00-04:00",
      },
    },
  );
});

test("direct tool rejects invalid input before pressure or DB reads", async () => {
  const overlongDate = `2026-07-19T12:00:00.${"1".repeat(44)}Z`;
  const invalidInputs = [
    ["wrong subsystem type", { subsystem: 7 }],
    ["blank subsystem", { subsystem: "   " }],
    ["49-character subsystem", { subsystem: "x".repeat(49) }],
    ["invalid severity", { severity: "error" }],
    ["wrong from type", { from: 7 }],
    ["blank from", { from: "   " }],
    ["blank to", { to: "   " }],
    ["malformed from", { from: "not-a-date" }],
    ["timezone-free to", { to: "2026-07-19T12:00:00" }],
    ["overlong to", { to: overlongDate }],
    ["non-finite native date", { from: "2026-07-19T12:00:00+99:99" }],
    [
      "reversed window",
      {
        from: "2026-07-19T13:00:00Z",
        to: "2026-07-19T12:00:00Z",
      },
    ],
  ];
  const actual = [];

  for (const [label, input] of invalidInputs) {
    let pressureCalls = 0;
    let dbCalls = 0;
    const result = await diagnosticEventsTool.run(
      input,
      async () => {
        dbCalls += 1;
        return [];
      },
      async () => {
        pressureCalls += 1;
        return "normal";
      },
    );
    actual.push([
      label,
      {
        text: result.content[0].text,
        isError: result.isError,
        pressureCalls,
        dbCalls,
      },
    ]);
  }

  assert.deepEqual(
    actual,
    invalidInputs.map(([label]) => [
      label,
      {
        text: "list_diagnostic_events failed: invalid input.",
        isError: true,
        pressureCalls: 0,
        dbCalls: 0,
      },
    ]),
  );
});

test("builds a parameterized, newest-first diagnostic event query", () => {
  const database = drizzle.mock({ schema: { diagnosticEventsTable } });
  const query = buildDiagnosticEventsQuery(database, {
    from,
    to,
    subsystem: "api",
    severity: "warning",
    limit: 200,
  }).toSQL();

  assert.match(query.sql, /from "diagnostic_events"/u);
  assert.match(query.sql, /"last_seen_at" >= \$1/u);
  assert.match(query.sql, /"last_seen_at" <= \$2/u);
  assert.match(query.sql, /"subsystem" = \$3/u);
  assert.match(query.sql, /"severity" = \$4/u);
  assert.match(query.sql, /order by "diagnostic_events"\."last_seen_at" desc/u);
  assert.match(query.sql, /limit \$5/u);
  assert.deepEqual(query.params, [
    from.toISOString(),
    to.toISOString(),
    "api",
    "warning",
    200,
  ]);
});

test("handler maps DB rows to the HTTP result shape", async () => {
  let receivedInput;
  const result = await handleListDiagnosticEvents(
    {
      subsystem: " api ",
      severity: "warning",
      from: from.toISOString(),
      to: to.toISOString(),
    },
    async (input) => {
      receivedInput = input;
      return [eventRow];
    },
    async () => "normal",
  );

  assert.deepEqual(receivedInput, {
    from,
    to,
    subsystem: "api",
    severity: "warning",
    limit: 200,
  });
  assert.equal(result.isError, undefined);
  assert.deepEqual(JSON.parse(result.content[0].text), {
    from: from.toISOString(),
    to: to.toISOString(),
    events: [
      {
        id: "7ddaf8a1-6fd7-4c99-aa2c-e8eb0ca0f497",
        incidentKey: "api:test-warning",
        subsystem: "api",
        category: "request-pressure",
        code: null,
        severity: "warning",
        status: "open",
        message: "Test warning",
        firstSeenAt: "2026-07-09T10:00:00.000Z",
        lastSeenAt: "2026-07-09T11:00:00.000Z",
        eventCount: 3,
        dimensions: { route: "/api/test" },
        raw: { p95Ms: 1200 },
      },
    ],
    limits: {
      requestedLimit: 200,
      appliedLimit: 200,
      maxLimit: 1000,
      absoluteMaxLimit: 1000,
      pressureLevel: "normal",
      pressureLimited: false,
    },
  });
});

test("handler applies the API raw suppression and size cap", async () => {
  const result = await handleListDiagnosticEvents(
    { from: from.toISOString(), to: to.toISOString() },
    async () => [
      { ...eventRow, id: "info-event", severity: "info", raw: { secret: true } },
      { ...eventRow, id: "warning-event", raw: { detail: "x".repeat(2_001) } },
    ],
    async () => "normal",
  );
  const { events } = JSON.parse(result.content[0].text);

  assert.deepEqual(events[0].raw, {});
  assert.equal(events[1].raw.detail, `${"x".repeat(2_000)}...`);
});

test("handler preserves the API event limit while high pressure remains observable", async () => {
  let appliedLimit;
  const result = await handleListDiagnosticEvents(
    { from: from.toISOString(), to: to.toISOString() },
    async (input) => {
      appliedLimit = input.limit;
      return [];
    },
    async () => "high",
  );

  assert.equal(appliedLimit, 200);
  assert.deepEqual(JSON.parse(result.content[0].text).limits, {
    requestedLimit: 200,
    appliedLimit: 200,
    maxLimit: 1000,
    absoluteMaxLimit: 1000,
    pressureLevel: "high",
    pressureLimited: false,
  });
});

test("handler returns a structured DB-unreachable error without a stack", async () => {
  const result = await handleListDiagnosticEvents(
    {},
    async () => {
      const error = new Error("connect ECONNREFUSED secret-host:5432");
      error.stack = "Error: connect ECONNREFUSED\n    at secret/path.ts:42";
      throw error;
    },
    async () => "normal",
  );

  assert.equal(result.isError, true);
  assert.equal(result.content[0].text, "list_diagnostic_events failed: DB unreachable.");
  assert.ok(!result.content[0].text.includes("secret"));
  assert.ok(!result.content[0].text.includes("\n"));
});

test("tool boundary maps unexpected handler failures without exposing details", async () => {
  const marker = "synthetic-diagnostic-mapper-secret";
  const result = await diagnosticEventsTool.run(
    {},
    async () => [
      {
        ...eventRow,
        firstSeenAt: {
          toISOString() {
            throw new Error(marker);
          },
        },
      },
    ],
    async () => "normal",
  );

  assert.equal(result.isError, true);
  assert.equal(
    result.content[0].text,
    "list_diagnostic_events failed: internal tool error.",
  );
  assert.doesNotMatch(result.content[0].text, new RegExp(marker));
});
