import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  AUDIT_PAGE_SIZE,
  auditRowMatchesQuery,
  buildAuditSummary,
  normalizeAuditEvent,
} from "./algoAuditModel.js";

const source = readFileSync(new URL("./AlgoAuditPanel.jsx", import.meta.url), "utf8");
const modelSource = readFileSync(new URL("./algoAuditModel.js", import.meta.url), "utf8");
const algoScreenSource = readFileSync(new URL("../AlgoScreen.jsx", import.meta.url), "utf8");

test("algo audit panel paginates filtered execution events", () => {
  assert.equal(AUDIT_PAGE_SIZE, 40);
  assert.match(modelSource, /AUDIT_PAGE_SIZE = 40/);
  assert.match(source, /paginateRows\(filteredEvents,\s*page,\s*AUDIT_PAGE_SIZE\)/);
  assert.match(source, /pageEvents\.map/);
  assert.match(source, /dataTestId="algo-audit-pagination"/);
});

test("algo audit panel exposes dense table columns and larger event history", () => {
  assert.match(source, /data-testid="algo-audit-table"/);
  assert.match(source, /data-testid="algo-audit-summary"/);
  assert.match(source, />Bid \/ Ask</);
  assert.match(source, />Qty \/ Risk</);
  assert.match(source, />Acct \/ Source</);
  assert.match(source, /Search symbol, reason, contract/);
  assert.match(algoScreenSource, /limit:\s*100/);
  assert.match(algoScreenSource, /algoIsPhone=\{algoIsPhone\}/);
});

test("algo audit model extracts trade context from entry payloads", () => {
  const row = normalizeAuditEvent({
    id: "evt-entry",
    providerAccountId: "shadow",
    symbol: "AMZN",
    eventType: "signal_options_shadow_entry",
    summary: "AMZN shadow CALL 150 2026-06-19 x2",
    occurredAt: "2026-05-22T15:00:00.000Z",
    payload: {
      metadata: {
        deploymentName: "Pyrus Signals Options Shadow Paper",
        runSource: "scan",
      },
      selectedContract: {
        underlying: "AMZN",
        expirationDate: "2026-06-19",
        strike: 150,
        right: "call",
        providerContractId: "twsopt:123456",
      },
      quote: {
        bid: 9,
        ask: 9.55,
        mark: 9.25,
        marketDataMode: "live",
      },
      orderPlan: {
        premiumAtRisk: 1850,
      },
      position: {
        quantity: 2,
        premiumAtRisk: 1850,
      },
    },
  });

  assert.equal(row.stage.id, "submitted");
  assert.equal(row.symbol, "AMZN");
  assert.equal(row.account, "shadow");
  assert.equal(row.source, "scan");
  assert.equal(row.contract.label, "2026-06-19 150C");
  assert.equal(row.contract.providerContractId, "twsopt:123456");
  assert.equal(row.quote.bid, 9);
  assert.equal(row.quote.ask, 9.55);
  assert.equal(row.quantity, 2);
  assert.equal(row.premiumAtRisk, 1850);
  assert.equal(auditRowMatchesQuery(row, "twsopt:123456"), true);
});

test("algo audit model extracts blockers and summary counts", () => {
  const blocked = normalizeAuditEvent({
    id: "evt-blocked",
    providerAccountId: "shadow",
    eventType: "signal_options_gateway_blocked",
    summary: "Signal-options scan blocked: bridge unavailable",
    occurredAt: "2026-05-22T15:01:00.000Z",
    payload: {
      source: "scan",
      count: 3,
      readiness: {
        reason: "bridge_unavailable",
        message: "Gateway is unavailable",
      },
    },
  });
  const closed = normalizeAuditEvent({
    id: "evt-exit",
    symbol: "SMCI",
    eventType: "signal_options_shadow_exit",
    summary: "SMCI shadow exit stop at 2.50",
    payload: {
      pnl: -125,
      position: { quantity: 1 },
      selectedContract: {
        underlying: "SMCI",
        expirationDate: "2026-06-19",
        strike: 45,
        right: "put",
      },
    },
  });
  const config = normalizeAuditEvent({
    id: "evt-config",
    eventType: "signal_options_profile_updated",
    summary: "Updated signal-options profile",
    payload: {
      metadata: {
        deploymentName: "Pyrus Signals Options Shadow Paper",
      },
    },
  });
  const summary = buildAuditSummary([blocked, closed, config]);

  assert.equal(blocked.stage.id, "blocked");
  assert.equal(blocked.reason, "bridge_unavailable");
  assert.equal(blocked.detailText, "bridge_unavailable");
  assert.equal(blocked.count, 3);
  assert.equal(auditRowMatchesQuery(blocked, "Gateway is unavailable"), true);
  assert.equal(closed.stage.id, "closed");
  assert.equal(closed.contract.label, "2026-06-19 45P");
  assert.equal(closed.pnl, -125);
  assert.equal(config.stage.id, "config");
  assert.deepEqual(
    {
      blocked: summary.blocked,
      config: summary.config,
      trades: summary.trades,
    },
    {
      blocked: 1,
      config: 1,
      trades: 1,
    },
  );
});
