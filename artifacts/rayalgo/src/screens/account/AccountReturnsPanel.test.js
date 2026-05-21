import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { msUntilNextLocalDay } from "./AccountReturnsPanel.jsx";

const source = readFileSync(new URL("./AccountReturnsPanel.jsx", import.meta.url), "utf8");

test("account returns calendar schedules today refresh at local midnight", () => {
  const now = new Date(2026, 4, 13, 23, 59, 30, 0);
  const delay = msUntilNextLocalDay(now);

  assert.equal(delay, 30_025);
});

test("account returns calendar midnight refresh delay is bounded for bad dates", () => {
  assert.equal(msUntilNextLocalDay("not-a-date"), 60_000);
});

test("account returns overview is the standalone P&L calendar panel", () => {
  assert.match(source, /className="ra-account-pnl-calendar-panel"/);
  assert.match(source, /<Panel\s+title="P&L Calendar"\s+rightRail=\{periodLabel\}/);
  assert.match(source, /data-testid="account-pnl-calendar"/);
  assert.match(source, /<DailyPnlCalendar[\s\S]*?trades=\{tradesData\?\.trades \|\| \[\]\}/);
  assert.doesNotMatch(source, /className="ra-account-returns-stack"/);
  assert.doesNotMatch(source, /data-testid="account-returns-stack"/);
  assert.doesNotMatch(source, /<Panel\s+title="Performance"/);
  assert.doesNotMatch(source, /data-testid="account-performance-summary"/);
  assert.doesNotMatch(source, /label:\s*"Adj return"/);
  assert.doesNotMatch(source, /label:\s*"P&L Δ"/);
  assert.doesNotMatch(source, /const metrics = \[/);
  assert.doesNotMatch(source, /<span style=\{mutedLabelStyle\}>P&L Calendar<\/span>/);
  assert.doesNotMatch(source, /\bpanelStyle\b/);
  assert.doesNotMatch(source, /\bsectionTitleStyle\b/);
  assert.doesNotMatch(source, /<SectionHeader\s+title="P&L Calendar"/);
  assert.doesNotMatch(source, /aria-labelledby=\{calendarTitleId\}/);
  assert.doesNotMatch(source, /data-testid="account-pnl-calendar-title"/);
  assert.doesNotMatch(source, /data-testid="account-performance-panel-title"/);
});
