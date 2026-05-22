import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { msUntilNextLocalDay } from "./AccountReturnsPanel.jsx";

const source = readFileSync(new URL("./AccountReturnsPanel.jsx", import.meta.url), "utf8");
const accountScreenSource = readFileSync(new URL("../AccountScreen.jsx", import.meta.url), "utf8");

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

test("month calendar hides out-of-month cells while trimming empty padded weeks", () => {
  assert.match(source, /const calendarWeeks = \[\]/);
  assert.match(source, /calendarWeeks\.push\(model\.days\.slice\(index, index \+ 7\)\)/);
  assert.match(source, /\.filter\(\(week\) => week\.some\(\(day\) => day\.inMonth\)\)/);
  assert.match(source, /const renderedDays = calendarWeeks/);
  assert.match(source, /renderedDays\.map\(\(day\) =>/);
  assert.match(source, /if \(!day\.inMonth\) \{/);
  assert.match(source, /aria-hidden="true"/);
  assert.match(source, /visibility:\s*"hidden"/);
  assert.doesNotMatch(source, /model\.days\.map\(\(day\) =>/);
  assert.doesNotMatch(source, /opacity:\s*day\.inMonth \? 1 : 0\.5/);
});

test("month calendar day hover is local and exposes a detail strip", () => {
  assert.match(source, /const \[hoveredDayIso, setHoveredDayIso\] = useState\(null\)/);
  assert.match(source, /const \[pinnedDayIso, setPinnedDayIso\] = useState\(null\)/);
  assert.match(source, /resolveActivePnlCalendarDay\(/);
  assert.match(source, /onPointerEnter=\{\(\) => onHoverDay\(day\.iso\)\}/);
  assert.match(source, /onFocus=\{\(\) => onHoverDay\(day\.iso\)\}/);
  assert.match(source, /onClick=\{\(\) => onPinDay\(day\.iso\)\}/);
  assert.match(source, /onPointerLeave=\{\(\) => setHoveredDayIso\(null\)\}/);
  assert.match(source, /setPinnedDayIso\(null\)/);
  assert.match(source, /data-testid="account-pnl-calendar-day-detail"/);
  assert.match(source, /data-testid="account-pnl-calendar-active-date"/);
});

test("pnl calendar hover does not wire into account inspection queries", () => {
  const usageIndex = accountScreenSource.indexOf("<AccountReturnsPanel");
  assert.ok(usageIndex >= 0, "AccountReturnsPanel must render on AccountScreen");
  const usageBlock = accountScreenSource.slice(usageIndex, usageIndex + 500);
  assert.doesNotMatch(usageBlock, /onHoverInspectionDate/);
  assert.doesNotMatch(usageBlock, /onPinInspectionDate/);
  assert.doesNotMatch(usageBlock, /activeInspectionDate/);
});
