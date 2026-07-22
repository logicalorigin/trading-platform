import assert from "node:assert/strict";
import test from "node:test";

import { logger } from "../lib/logger";
import { __diagnosticsInternalsForTests } from "./diagnostics";

const {
  buildDiagnosticsCollectorFailure,
  incidentKey,
  sanitizeBrowserDiagnosticEventForPersistence,
  sanitizeBrowserReportForPersistence,
  shouldPersistDiagnosticEventToDb,
  warnDbFailure,
} = __diagnosticsInternalsForTests as typeof __diagnosticsInternalsForTests & {
  buildDiagnosticsCollectorFailure: (error: unknown) => unknown;
  sanitizeBrowserReportForPersistence: (report: unknown) => {
    message: string;
    dimensions: Record<string, unknown>;
    raw: Record<string, unknown>;
  };
  sanitizeBrowserDiagnosticEventForPersistence: (input: {
    actorUserId: string;
    category?: string;
    code?: string | null;
    message?: string;
    dimensions?: Record<string, unknown>;
    raw?: Record<string, unknown>;
  }) => {
    provenance: {
      source: "browser_client_event" | "browser_report";
      trust: "untrusted";
      actorScope: string;
    };
    message: string;
    dimensions: Record<string, unknown>;
    raw: Record<string, unknown>;
  };
  incidentKey: (input: {
    subsystem: string;
    category: string;
    code?: string | null;
    provenance?: {
      source: "browser_client_event" | "browser_report";
      trust: "untrusted";
      actorScope: string;
    };
  }) => string;
  warnDbFailure: (error: unknown, operation: string) => void;
};

const TOUCH_MS = 5 * 60 * 1000;
const sig = (over: Partial<{
  status: "open" | "resolved";
  severity: "info" | "warning";
  message: string;
  lastSeenAtMs: number;
}> = {}) => ({
  status: "open" as const,
  severity: "warning" as const,
  message: "unchanged incident",
  lastSeenAtMs: 1_000_000,
  ...over,
});

test("diagnostic-event upsert persists the first time an incident is seen", () => {
  assert.equal(
    shouldPersistDiagnosticEventToDb(undefined, sig(), TOUCH_MS),
    true,
  );
});

test("diagnostic-event upsert is skipped when nothing changed within the touch window", () => {
  const last = sig({ lastSeenAtMs: 1_000_000 });
  // Same status/severity/message, 4m59s later — still inside the 5m touch window.
  const next = sig({ lastSeenAtMs: 1_000_000 + TOUCH_MS - 1_000 });
  assert.equal(shouldPersistDiagnosticEventToDb(last, next, TOUCH_MS), false);
});

test("diagnostic-event upsert does a coarse touch once past the 5m window", () => {
  const last = sig({ lastSeenAtMs: 1_000_000 });
  const next = sig({ lastSeenAtMs: 1_000_000 + TOUCH_MS });
  assert.equal(shouldPersistDiagnosticEventToDb(last, next, TOUCH_MS), true);
});

test("diagnostic-event upsert always persists a material change (severity/message/status)", () => {
  const last = sig();
  assert.equal(
    shouldPersistDiagnosticEventToDb(last, sig({ severity: "info" }), TOUCH_MS),
    true,
  );
  assert.equal(
    shouldPersistDiagnosticEventToDb(last, sig({ message: "now different" }), TOUCH_MS),
    true,
  );
  assert.equal(
    shouldPersistDiagnosticEventToDb(last, sig({ status: "resolved" }), TOUCH_MS),
    true,
  );
});

test("nontransient database warnings never log credential-bearing errors", () => {
  const secret = "diagnostics-nontransient-secret";
  const mutableLogger = logger as typeof logger & {
    warn: typeof logger.warn;
  };
  const originalWarn = mutableLogger.warn;
  let logged: unknown;
  mutableLogger.warn = ((payload: unknown) => {
    logged = payload;
  }) as typeof logger.warn;

  try {
    warnDbFailure(
      new Error(`failed for postgres://collector:${secret}@db.internal/pyrus`),
      "test diagnostic write",
    );
  } finally {
    mutableLogger.warn = originalWarn;
  }

  assert.equal(JSON.stringify(logged).includes(secret), false);
  assert.deepEqual(logged, {
    dbError: {
      name: "Error",
      message: "Database operation failed",
      code: null,
    },
    operation: "test diagnostic write",
  });
});

test("collector failure events retain no arbitrary exception text", () => {
  const secret = "diagnostics-collector-secret";
  const failure = buildDiagnosticsCollectorFailure(
    new Error(`collector failed with password=${secret}`),
  );

  assert.equal(JSON.stringify(failure).includes(secret), false);
  assert.deepEqual(failure, {
    subsystem: "storage",
    category: "collector",
    code: "collection_failed",
    severity: "warning",
    message: "Diagnostics collection failed",
    raw: {},
  });
});

test("browser reports retain only a credential-free origin and recursively redact raw secrets", () => {
  const secret = "synthetic-browser-report-secret";
  const sanitized = sanitizeBrowserReportForPersistence({
    type: "coep",
    body: {
      blockedURL: `https://demo:${secret}@cdn.invalid/file.js?token=${secret}#${secret}`,
      disposition: "enforce",
      nested: {
        authorization: `Bearer ${secret}`,
        safe: "script blocked",
      },
    },
  });
  const serialized = JSON.stringify(sanitized);

  assert.equal(sanitized.dimensions.blockedOrigin, "https://cdn.invalid");
  assert.match(sanitized.message, /https:\/\/cdn\.invalid/u);
  assert.doesNotMatch(serialized, new RegExp(secret, "u"));
  assert.doesNotMatch(serialized, /Bearer|\?token=|#synthetic/u);
  assert.match(serialized, /script blocked/u);
});

test("browser diagnostics redact common secret keys, opaque API keys, and hostile property names", () => {
  const apiKey = `sk-${"a".repeat(48)}`;
  const sanitized = sanitizeBrowserReportForPersistence({
    type: "coep",
    body: {
      apiKey,
      session: "session-secret",
      code: "oauth-code-secret",
      signature: "signed-secret",
      [`field-${apiKey}`]: "nested",
      safe: "kept",
    },
  });
  const serialized = JSON.stringify(sanitized);

  assert.doesNotMatch(serialized, /sk-|session-secret|oauth-code|signed-secret/u);
  assert.match(serialized, /kept/u);
});

test("generic browser diagnostic events use the same recursive secret scrubber", () => {
  const secret = "generic-browser-event-secret";
  const sanitized = sanitizeBrowserDiagnosticEventForPersistence({
    actorUserId: "11111111-1111-4111-8111-111111111111",
    message: `failed at https://demo:${secret}@browser.invalid/path`,
    dimensions: { apiKey: `sk-${"b".repeat(48)}`, safe: "dimension" },
    raw: { nested: { authorization: `Bearer ${secret}` }, safe: "raw" },
  });
  const serialized = JSON.stringify(sanitized);

  assert.doesNotMatch(serialized, new RegExp(secret, "u"));
  assert.doesNotMatch(serialized, /sk-|Bearer/u);
  assert.match(serialized, /dimension|raw/u);
});

test("browser diagnostic provenance is server-owned and incident identity is user-scoped", () => {
  const category = "member-controlled-category";
  const code = "member-controlled-code";
  const first = sanitizeBrowserDiagnosticEventForPersistence({
    actorUserId: "11111111-1111-4111-8111-111111111111",
    category,
    code,
    dimensions: {
      __pyrusProvenance: {
        source: "server",
        trust: "trusted",
        actorScope: null,
      },
    },
  });
  const sameActor = sanitizeBrowserDiagnosticEventForPersistence({
    actorUserId: "11111111-1111-4111-8111-111111111111",
    category,
    code,
  });
  const otherActor = sanitizeBrowserDiagnosticEventForPersistence({
    actorUserId: "22222222-2222-4222-8222-222222222222",
    category,
    code,
  });

  assert.equal(first.provenance.source, "browser_client_event");
  assert.equal(first.provenance.trust, "untrusted");
  assert.match(first.provenance.actorScope, /^usr_[a-f0-9]{64}$/u);
  assert.equal(first.provenance.actorScope, sameActor.provenance.actorScope);
  assert.notEqual(first.provenance.actorScope, otherActor.provenance.actorScope);
  assert.equal(first.dimensions?.__pyrusProvenance, undefined);

  const firstKey = incidentKey(first);
  assert.equal(firstKey, incidentKey(sameActor));
  assert.notEqual(firstKey, incidentKey(otherActor));
  assert.notEqual(
    firstKey,
    incidentKey({
      ...first,
      provenance: { ...first.provenance, source: "browser_report" },
    }),
  );
  assert.match(firstKey, /^browser:member:[a-f0-9]{64}$/u);
  assert.doesNotMatch(firstKey, /member-controlled|11111111/u);
});

test("invalid browser-report URLs are omitted instead of persisted verbatim", () => {
  const secret = "invalid-browser-url-secret";
  const sanitized = sanitizeBrowserReportForPersistence({
    type: "coep",
    body: {
      blockedURL: `not a url password=${secret}`,
    },
  });
  const serialized = JSON.stringify(sanitized);

  assert.equal(sanitized.dimensions.blockedOrigin, null);
  assert.doesNotMatch(serialized, new RegExp(secret, "u"));
  assert.doesNotMatch(sanitized.message, /not a url/u);
});
