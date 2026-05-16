import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  __resetSseStreamDiagnosticsForTests,
  getSseStreamDiagnostics,
  recordSseStreamClose,
  recordSseStreamOpen,
} from "./sse-stream-diagnostics";

afterEach(() => {
  __resetSseStreamDiagnosticsForTests();
});

test("records SSE opens and close reasons per stream", () => {
  recordSseStreamOpen("quotes");
  recordSseStreamClose("quotes", "client_close");
  recordSseStreamOpen("quotes");
  recordSseStreamClose("quotes", "write_backpressure_timeout");

  const diagnostics = getSseStreamDiagnostics();

  assert.equal(diagnostics.quotes.opens, 2);
  assert.equal(diagnostics.quotes.closes, 2);
  assert.equal(diagnostics.quotes.lastCloseReason, "write_backpressure_timeout");
  assert.equal(diagnostics.quotes.closeReasons.client_close, 1);
  assert.equal(diagnostics.quotes.closeReasons.write_backpressure_timeout, 1);
  assert.equal(typeof diagnostics.quotes.lastOpenedAt, "string");
  assert.equal(typeof diagnostics.quotes.lastClosedAt, "string");
});
