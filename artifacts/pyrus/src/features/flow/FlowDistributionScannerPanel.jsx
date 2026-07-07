import {
  useCallback,
  useMemo,
  useState,
} from "react";
import { AppTooltip } from "@/components/ui/tooltip";
import { Card, DataUnavailableState, SegmentedControl } from "../../components/platform/primitives.jsx";
import { useViewportBelow } from "../../lib/responsive";
import { CSS_COLOR, cssColorMix, FONT_WEIGHTS, RADII, T, dim, fs, sp } from "../../lib/uiTokens";
import { FlowScannerStatusPanel } from "./FlowScannerStatusPanel.jsx";

const RAIL_BREAKPOINT_PX = 1100;
const RAIL_WIDTH_PX = 160;
const DEFAULT_VISIBLE_BUCKETS = ["small", "medium", "large"];
const BUCKET_TOGGLE_OPTIONS = [
  ["small", "S"],
  ["medium", "M"],
  ["large", "L"],
];

const COVERAGE_MODE_OPTIONS = [
  ["ranked", "Ranked"],
  ["universe", "Universe"],
];

const BucketVisibilityToggle = ({ visibleBuckets, onToggleBucket }) => (
  <div
    data-testid="flow-premium-bucket-visibility"
    aria-label="Premium bucket visibility"
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: sp(2),
      padding: sp(2),
      border: `1px solid ${CSS_COLOR.border}`,
      borderRadius: dim(RADII.xs),
      background: CSS_COLOR.bg1,
    }}
  >
    {BUCKET_TOGGLE_OPTIONS.map(([bucket, label]) => {
      const active = visibleBuckets.has(bucket);
      return (
        <button
          key={bucket}
          type="button"
          data-testid={`flow-premium-bucket-toggle-${bucket}`}
          aria-pressed={active}
          onClick={() => onToggleBucket?.(bucket)}
          style={{
            minWidth: dim(24),
            border: "none",
            borderRadius: dim(RADII.sm),
            background: active ? `${cssColorMix(CSS_COLOR.accent, 8)}` : "transparent",
            color: active ? CSS_COLOR.accent : CSS_COLOR.textMuted,
            cursor: "pointer",
            fontFamily: T.sans,
            fontSize: fs(8),
            fontWeight: FONT_WEIGHTS.regular,
            padding: sp("3px 7px"),
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
          fontFamily: T.sans,
          fontSize: fs(7),
          fontWeight: FONT_WEIGHTS.regular,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {sourceLabel}
      </span>
    ) : null}
    {sourceWarning ? (
      <AppTooltip content={sourceWarning}>
        <div
          style={{
            color: warningTone || CSS_COLOR.amber,
            fontFamily: T.sans,
            fontSize: fs(7),
            fontWeight: FONT_WEIGHTS.regular,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
          }}
        >
          {sourceWarning}
        </div>
      </AppTooltip>
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
  const [visibleBuckets, setVisibleBuckets] = useState(
    () => new Set(DEFAULT_VISIBLE_BUCKETS),
  );
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
      "Massive premium snapshots have not produced ranked symbols yet.";
  const narrow = useViewportBelow(RAIL_BREAKPOINT_PX);

  const totalWidgetSlots = Math.max(
    Number.isFinite(widgetCount) ? widgetCount : 0,
    widgets.length,
  );
  const renderableSlots = useMemo(
    () => Array.from({ length: totalWidgetSlots }),
    [totalWidgetSlots],
  );
  const maxAbsNetKilo = useMemo(
    () =>
      widgets.reduce((maxValue, widget) => {
        const netKilo = Math.abs(Number(widget?.netPremium) || 0) / 1_000;
        return Math.max(maxValue, netKilo);
      }, 0),
    [widgets],
  );
  const classificationSummary = useMemo(() => {
    if (!widgets.length) return null;
    const averageCoverage =
      widgets.reduce((sum, widget) => {
        const coverage = Number(widget?.classificationCoverage);
        return sum + (Number.isFinite(coverage) ? coverage : 0);
      }, 0) / widgets.length;
    return `${widgets.length} syms · ${Math.round(
      Math.max(0, Math.min(1, averageCoverage)) * 100,
    )}% classified avg`;
  }, [widgets]);
  const handleToggleBucket = useCallback((bucket) => {
    setVisibleBuckets((current) => {
      const next = new Set(current);
      if (next.has(bucket)) {
        next.delete(bucket);
      } else {
        next.add(bucket);
      }
      return next.size ? next : new Set(DEFAULT_VISIBLE_BUCKETS);
    });
  }, []);

  const widgetGrid = empty ? (
    <Card
      data-testid="flow-premium-distribution-empty"
      style={{ padding: sp("8px 10px") }}
    >
      <DataUnavailableState
        title="Premium distribution unavailable"
        detail={detail}
        tone={query?.data?.status === "unconfigured" ? CSS_COLOR.amber : CSS_COLOR.textDim}
        minHeight={96}
      />
    </Card>
  ) : (
    <div
      data-testid="flow-distribution-widget-grid"
      style={{
        display: "grid",
        gridTemplateColumns:
          "repeat(auto-fill, minmax(min(100%, 280px), 1fr))",
        gap: sp(3),
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
            visibleBuckets,
            maxAbsNetKilo,
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
        <SegmentedControl
          options={timeframeOptions.map(([value, label]) => ({ value, label }))}
          value={timeframe}
          onChange={onTimeframeChange}
          ariaLabel="Premium distribution timeframe"
          radioGroup
          buttonTestId="flow-premium-distribution-timeframe"
        />
      ) : null}
      {showCoverageMode ? (
        <SegmentedControl
          options={COVERAGE_MODE_OPTIONS.map(([value, label]) => ({ value, label }))}
          value={coverageMode}
          onChange={onCoverageModeChange}
          ariaLabel="Premium distribution coverage mode"
          radioGroup
          buttonTestId="flow-premium-distribution-coverage-mode"
        />
      ) : null}
      <BucketVisibilityToggle
        visibleBuckets={visibleBuckets}
        onToggleBucket={handleToggleBucket}
      />
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
      {classificationSummary ? (
        <span
          style={{
            flex: "0 0 auto",
            color: CSS_COLOR.textMuted,
            fontFamily: T.sans,
            fontSize: fs(7),
            fontWeight: FONT_WEIGHTS.regular,
            whiteSpace: "nowrap",
          }}
        >
          {classificationSummary}
        </span>
      ) : null}
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
        gap: sp(6),
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
        <div style={{ display: "flex", flexDirection: "column", gap: sp(2) }}>
          <span
            style={{
              fontSize: fs(12),
              fontWeight: FONT_WEIGHTS.regular,
              fontFamily: T.sans,
              color: CSS_COLOR.text,
            }}
          >
            Premium Distribution
          </span>
        </div>
        {headerRow}
        {widgetGrid}
      </div>
      {narrow ? null : statusRail}
    </div>
  );
};

export default FlowDistributionScannerPanel;
