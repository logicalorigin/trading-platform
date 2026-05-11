import { useMemo } from "react";
import { Card, DataUnavailableState } from "../../components/platform/primitives.jsx";
import { useViewportBelow } from "../../lib/responsive";
import { T, dim, fs, sp } from "../../lib/uiTokens";
import { FlowScannerStatusPanel } from "./FlowScannerStatusPanel.jsx";

const RAIL_BREAKPOINT_PX = 1100;
const RAIL_WIDTH_PX = 220;

const COVERAGE_MODE_OPTIONS = [
  ["ranked", "Ranked"],
  ["universe", "Universe"],
];

const SegmentedToggle = ({
  options,
  value,
  onChange,
  ariaLabel,
  testId,
}) => (
  <div
    data-testid={testId}
    aria-label={ariaLabel}
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: sp(2),
      padding: 2,
      border: `1px solid ${T.border}`,
      borderRadius: dim(4),
      background: T.bg2,
    }}
  >
    {options.map(([optionValue, label]) => {
      const active = value === optionValue;
      return (
        <button
          key={optionValue}
          type="button"
          aria-pressed={active}
          onClick={() => onChange?.(optionValue)}
          style={{
            border: "none",
            borderRadius: dim(3),
            background: active ? T.bg3 : "transparent",
            color: active ? T.text : T.textMuted,
            cursor: "pointer",
            fontFamily: T.mono,
            fontSize: fs(8),
            fontWeight: 400,
            padding: "3px 7px",
          }}
        >
          {label}
        </button>
      );
    })}
  </div>
);

const SourceStrip = ({ sourceLabel, sourceTone, sourceWarning, warningTone }) => (
  <div
    style={{
      display: "flex",
      flexDirection: "column",
      gap: sp(2),
      minWidth: 0,
    }}
  >
    {sourceLabel ? (
      <span
        style={{
          color: sourceTone,
          fontFamily: T.mono,
          fontSize: fs(7),
          fontWeight: 400,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {sourceLabel}
      </span>
    ) : null}
    {sourceWarning ? (
      <div
        title={sourceWarning}
        style={{
          color: warningTone || T.amber,
          fontFamily: T.mono,
          fontSize: fs(7),
          fontWeight: 400,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          minWidth: 0,
        }}
      >
        {sourceWarning}
      </div>
    ) : null}
  </div>
);

export const FlowDistributionScannerPanel = ({
  query,
  timeframe,
  onTimeframeChange,
  coverageMode,
  onCoverageModeChange,
  timeframeOptions,
  widgetCount,
  selectedSymbol,
  onWidgetSelect,
  renderWidget,
  sourceLabel,
  sourceTone,
  sourceWarning,
  warningTone,
  showCoverageMode = true,
  scannerStatus,
  testId = "flow-distribution-scanner-panel",
}) => {
  const widgets = query?.data?.widgets || [];
  const loading = Boolean(query?.isLoading || query?.isPending);
  const empty =
    !loading &&
    !widgets.length &&
    (query?.isError ||
      query?.data?.status === "unconfigured" ||
      query?.data?.status === "empty");
  const detail = query?.isError
    ? "Premium distribution is unavailable."
    : query?.data?.source?.errorMessage ||
      "Polygon premium snapshots have not produced ranked symbols yet.";
  const narrow = useViewportBelow(RAIL_BREAKPOINT_PX);

  const totalWidgetSlots = Math.max(
    Number.isFinite(widgetCount) ? widgetCount : 0,
    widgets.length,
  );
  const renderableSlots = useMemo(
    () => Array.from({ length: totalWidgetSlots }),
    [totalWidgetSlots],
  );

  const widgetGrid = empty ? (
    <Card
      data-testid="flow-premium-distribution-empty"
      style={{ padding: "8px 10px" }}
    >
      <DataUnavailableState
        title="Premium distribution unavailable"
        detail={detail}
        tone={query?.data?.status === "unconfigured" ? T.amber : T.textDim}
        minHeight={96}
      />
    </Card>
  ) : (
    <div
      data-testid="flow-distribution-widget-grid"
      style={{
        display: "grid",
        gridTemplateColumns:
          "repeat(auto-fit, minmax(min(100%, 116px), 1fr))",
        gap: 5,
        minWidth: 0,
      }}
    >
      {renderableSlots.map((_, index) => {
        const widget = widgets[index];
        const symbol = widget?.symbol;
        const selected = Boolean(symbol && symbol === selectedSymbol);
        const content =
          renderWidget?.({
            widget,
            loading: loading && !widget,
            selected,
            onSelect: () =>
              symbol ? onWidgetSelect?.(symbol) : undefined,
          }) || null;
        return (
          <div
            key={symbol || `premium_${index}`}
            style={{ minWidth: 0, display: "flex" }}
          >
            {content}
          </div>
        );
      })}
    </div>
  );

  const distributionControls = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: sp(6),
        flexWrap: "wrap",
        minWidth: 0,
      }}
    >
      {timeframeOptions ? (
        <SegmentedToggle
          options={timeframeOptions}
          value={timeframe}
          onChange={onTimeframeChange}
          ariaLabel="Premium distribution timeframe"
          testId="flow-premium-distribution-timeframe"
        />
      ) : null}
      {showCoverageMode ? (
        <SegmentedToggle
          options={COVERAGE_MODE_OPTIONS}
          value={coverageMode}
          onChange={onCoverageModeChange}
          ariaLabel="Premium distribution coverage mode"
          testId="flow-premium-distribution-coverage-mode"
        />
      ) : null}
    </div>
  );

  const headerRow = (
    <div
      style={{
        display: "flex",
        flexDirection: narrow ? "column" : "row",
        alignItems: narrow ? "stretch" : "center",
        justifyContent: "space-between",
        gap: sp(narrow ? 4 : 8),
        minWidth: 0,
      }}
    >
      <SourceStrip
        sourceLabel={sourceLabel}
        sourceTone={sourceTone}
        sourceWarning={sourceWarning}
        warningTone={warningTone}
      />
      {distributionControls}
    </div>
  );

  const statusRail = (
    <FlowScannerStatusPanel
      {...scannerStatus}
      layout={narrow ? "horizontal" : "vertical"}
      dense={narrow}
      testId="flow-distribution-status-rail"
    />
  );

  return (
    <div
      data-testid={testId}
      style={{
        display: "grid",
        gridTemplateColumns: narrow ? "minmax(0, 1fr)" : `minmax(0, 1fr) ${RAIL_WIDTH_PX}px`,
        gridTemplateRows: narrow ? "auto auto" : "auto",
        gap: 6,
        minWidth: 0,
        alignItems: "stretch",
      }}
    >
      {narrow ? statusRail : null}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: sp(4),
          minWidth: 0,
        }}
      >
        {headerRow}
        {widgetGrid}
      </div>
      {narrow ? null : statusRail}
    </div>
  );
};

export default FlowDistributionScannerPanel;
