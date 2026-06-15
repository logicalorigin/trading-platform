/**
 * Shared hit-testing for market chart pointer interactions.
 *
 * Extracted from the previously-duplicated copies in MarketChartCell.jsx and
 * MultiChartGrid.jsx. Per-file extras (shell-control predicate, click/move
 * tolerances) stay local to their callers.
 */
export const MARKET_CHART_INTERACTIVE_TARGET_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "[contenteditable='true']",
  "[role='button']",
  "[role='checkbox']",
  "[role='menu']",
  "[role='menuitem']",
  "[role='option']",
  "[role='radio']",
  "[role='switch']",
  "[data-chart-control-root]",
  "[data-grid-resize-handle]",
  "[data-radix-popper-content-wrapper]",
  "[data-testid='ticker-search-popover']",
].join(",");

export const isMarketChartInteractiveTarget = (target) =>
  typeof Element !== "undefined" &&
  target instanceof Element &&
  Boolean(target.closest(MARKET_CHART_INTERACTIVE_TARGET_SELECTOR));

export const isMarketChartPlotTarget = (target) =>
  typeof Element !== "undefined" &&
  target instanceof Element &&
  Boolean(target.closest("[data-chart-plot-root]"));
