import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { msUntilNextLocalDay } from "./AccountReturnsPanel.jsx";

const source = readFileSync(new URL("./AccountReturnsPanel.jsx", import.meta.url), "utf8");
const accountScreenSource = readFileSync(new URL("../AccountScreen.jsx", import.meta.url), "utf8");
const accountUtilsSource = readFileSync(new URL("./accountUtils.jsx", import.meta.url), "utf8");
const cssSource = readFileSync(new URL("../../index.css", import.meta.url), "utf8");

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
  assert.match(source, /<Panel\s+title=\{isPhone \? "P&L" : "P&L Calendar"\}\s+rightRail=\{periodLabel\}\s+compact=\{isPhone\}/);
  assert.match(source, /data-testid="account-pnl-calendar"/);
  assert.match(source, /<DailyPnlCalendar[\s\S]*?trades=\{tradesData\?\.trades \|\| \[\]\}/);
  assert.match(source, /dailyPnl=\{dailyPnl\}/);
  assert.match(accountScreenSource, /dailyPnl=\{displaySummaryData\?\.metrics\?\.dayPnl\}/);
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

test("account pnl calendar has a phone compact mode for two-up overview", () => {
  assert.match(source, /const CalendarViewToggle = \(\{ value, onChange, calendarStyle, compact = false \}\)/);
  assert.match(source, /const cellHeight = dim\(compact \? 21 : isPhone \? 32 : 44\)/);
  assert.match(source, /minHeight:\s*dim\(compact \? 20 : isPhone \? 32 : 24\)/);
  assert.match(source, /minHeight:\s*dim\(20\)/);
  assert.match(source, /<CalendarViewToggle[\s\S]*compact=\{isPhone\}/);
  assert.match(source, /view === "month" && !isPhone/);
  assert.match(source, /<CalendarSummary[\s\S]*compact=\{isPhone\}/);
});

test("account phone overview keeps pnl calendar and exposure on one row", () => {
  assert.match(cssSource, /\[data-testid="account-screen"\] \.ra-account-overview-grid[\s\S]*grid-template-columns: minmax\(0, 1\.16fr\) minmax\(0, 0\.84fr\) !important;/);
  assert.match(cssSource, /\[data-testid="account-screen"\] \.ra-account-overview-equity[\s\S]*grid-column: 1 \/ -1;/);
  assert.match(accountScreenSource, /<LazyPortfolioExposurePanel[\s\S]*isPhone=\{accountIsPhone\}/);
});

test("account panel container titles use the compact visual scale", () => {
  const panelSource = accountUtilsSource.match(
    /export const Panel = \(\{[\s\S]*?export const SectionHeader/,
  )?.[0] ?? "";
  assert.match(panelSource, /fontSize:\s*textSize\("bodyStrong"\)/);
  assert.doesNotMatch(panelSource, /fontSize:\s*compact \? textSize\("bodyStrong"\) : sectionTitleStyle\.fontSize/);
});

test("month calendar aligns weekdays without empty spacer tile elements", () => {
  const monthGridSource = source.match(
    /const MonthCalendarGrid = \({[\s\S]*?const CalendarDayDetail/,
  )?.[0] ?? "";
  assert.match(source, /PNL_CALENDAR_WEEKDAYS/);
  assert.match(source, /const calendarWeeks = \[\]/);
  assert.match(source, /calendarWeeks\.push\(model\.days\.slice\(index, index \+ 7\)\)/);
  assert.match(source, /const renderedWeeks = calendarWeeks\.filter\(\(week\) => week\.some\(\(day\) => day\.inMonth\)\)/);
  assert.match(source, /const renderedDays = renderedWeeks\.flatMap\(\(week, weekIndex\) =>/);
  assert.match(source, /const monthGridGap = dim\(compact \? 0 : 1\)/);
  assert.match(source, /day\.inMonth[\s\S]*gridColumnStart:\s*dayIndex \+ 1/);
  assert.match(source, /gridRowStart:\s*weekIndex \+ 1/);
  assert.match(source, /PNL_CALENDAR_WEEKDAYS\.map\(\(day\) =>/);
  assert.match(source, /\{compact \? day\.slice\(0, 1\) : day\}/);
  assert.match(source, /renderedDays\.map\(\(\{ day, gridColumnStart, gridRowStart \}\) =>/);
  assert.match(source, /gridColumnStart,\s*[\s\S]*gridRowStart,/);
  assert.match(monthGridSource, /gap:\s*monthGridGap/);
  assert.match(monthGridSource, /boxSizing:\s*"border-box"/);
  assert.match(monthGridSource, /fontSize:\s*compact \? dim\(8\) : fs\(isPhone \? 8 : 10\)/);
  assert.match(monthGridSource, /display:\s*"block"[\s\S]*width:\s*"100%"[\s\S]*maxWidth:\s*"100%"/);
  assert.doesNotMatch(source, /const renderedDays = model\.days\.filter\(\(day\) => day\.inMonth\)/);
  assert.doesNotMatch(source, /if \(!day\.inMonth\) \{/);
  assert.doesNotMatch(source, /aria-hidden="true"/);
  assert.doesNotMatch(source, /visibility:\s*"hidden"/);
  assert.doesNotMatch(monthGridSource, /background:\s*calendarStyle\.gridLine/);
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
