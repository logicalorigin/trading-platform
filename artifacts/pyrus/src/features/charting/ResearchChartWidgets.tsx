// Chart widget components (settings menu, header, footer, sidebar).
// Extracted verbatim from ResearchChartFrame.tsx.
import { useMemo, useState, type CSSProperties } from "react";
// @ts-expect-error JSX module imported into TypeScript context
import { CSS_COLOR, FONT_WEIGHTS, RADII, dim } from "../../lib/uiTokens.jsx";
import type { ChartDisplayType, ChartSurfaceControls } from "./ResearchChartSurface";
import {
  Activity, ArrowUpDown, Camera, ChevronDown, Crosshair, Magnet, Maximize2,
  Minimize2, Minus, MoveVertical, Plus, Redo2, Settings, Star, Square, Trash2, Undo2,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useUserPreferences } from "../preferences/useUserPreferences";
import { TYPE_CSS_VAR } from "../../lib/typography";
import { useViewport } from "../../lib/responsive";
import { AppTooltip } from "@/components/ui/tooltip";
import { IndicatorPickerSheet, TimeframeSheet } from "./ChartMobileSheets";
import {
  useResolvedChartFrameDensity, isCompressedChartFrameDensity, isIconChartFrameDensity,
} from "./chartFrameDensity";
import {
  type WidgetTheme, type RenderedStudyLegendItem, type PanelPalette,
  type ResearchChartWidgetHeaderProps, type ResearchChartWidgetFooterProps,
  type ResearchChartWidgetSidebarProps,
  withAlpha, getPanelPalette, formatPrice, formatPercent, formatVolume, formatTimestamp,
  specBelongsToStudy, resolveStudySpecColor, commonTimeframes, iconStyle, dividerStyle,
  barButtonStyle, ChartSymbolSearchTrigger, railButtonStyle, legendChipStyle,
  chartMenuContentClassName, chartMenuItemClassName, chartMenuLabelClassName,
  chartMenuSeparatorClassName, menuContentStyle, menuItemStyle, menuLabelStyle,
  chartTypeOptions, resolveChartType,
} from "./chartWidgetShared";

const SettingsMenu = ({
  theme,
  palette,
  controls,
  dense,
}: {
  theme: WidgetTheme;
  palette: PanelPalette;
  controls: ChartSurfaceControls;
  dense: boolean;
}) => (
  <DropdownMenu>
    <AppTooltip content="Settings">
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Settings"
          style={barButtonStyle({ theme, palette, dense })}
        >
          <Settings style={iconStyle(dense)} />
        </button>
      </DropdownMenuTrigger>
    </AppTooltip>
    <DropdownMenuContent
      align="end"
      className={chartMenuContentClassName}
      sideOffset={6}
      style={menuContentStyle(theme, palette, 240)}
    >
      <DropdownMenuLabel
        className={chartMenuLabelClassName}
        style={menuLabelStyle(theme)}
      >
        Display
      </DropdownMenuLabel>
      <DropdownMenuCheckboxItem
        className={chartMenuItemClassName}
        checked={controls.showVolume}
        onCheckedChange={() => controls.setShowVolume((value) => !value)}
        style={menuItemStyle(theme)}
      >
        Volume
      </DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem
        className={chartMenuItemClassName}
        checked={controls.showFlowEvents}
        onCheckedChange={() => controls.setShowFlowEvents((value) => !value)}
        style={menuItemStyle(theme)}
      >
        Flow events
      </DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem
        className={chartMenuItemClassName}
        checked={controls.showGrid}
        onCheckedChange={() => controls.setShowGrid((value) => !value)}
        style={menuItemStyle(theme)}
      >
        Grid
      </DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem
        className={chartMenuItemClassName}
        checked={controls.showPriceLine}
        onCheckedChange={() => controls.setShowPriceLine((value) => !value)}
        style={menuItemStyle(theme)}
      >
        Last price line
      </DropdownMenuCheckboxItem>
      {controls.positionOverlaysAvailable ? (
        <DropdownMenuCheckboxItem
          className={chartMenuItemClassName}
          checked={controls.positionOverlaysEnabled}
          onCheckedChange={() =>
            controls.setPositionOverlaysEnabled((value) => !value)
          }
          style={menuItemStyle(theme)}
        >
          Positions
        </DropdownMenuCheckboxItem>
      ) : null}
      <DropdownMenuCheckboxItem
        className={chartMenuItemClassName}
        checked={controls.showTimeScale}
        onCheckedChange={() => controls.setShowTimeScale((value) => !value)}
        style={menuItemStyle(theme)}
      >
        Time scale
      </DropdownMenuCheckboxItem>
      <DropdownMenuSeparator className={chartMenuSeparatorClassName} />
      <DropdownMenuLabel
        className={chartMenuLabelClassName}
        style={menuLabelStyle(theme)}
      >
        Footprint
      </DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={controls.footprintDisplayMode}
        onValueChange={(next) =>
          controls.setFootprintDisplayMode(
            next as ChartSurfaceControls["footprintDisplayMode"],
          )
        }
      >
        <DropdownMenuRadioItem
          className={chartMenuItemClassName}
          value="split"
          disabled={!controls.footprintAvailable}
          style={menuItemStyle(theme)}
        >
          Bid x ask
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem
          className={chartMenuItemClassName}
          value="delta"
          disabled={!controls.footprintAvailable}
          style={menuItemStyle(theme)}
        >
          Delta
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem
          className={chartMenuItemClassName}
          value="total"
          disabled={!controls.footprintAvailable}
          style={menuItemStyle(theme)}
        >
          Total
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
      <DropdownMenuRadioGroup
        value={String(controls.footprintTicksPerRow)}
        onValueChange={(next) => controls.setFootprintTicksPerRow(Number(next))}
      >
        {[1, 2, 4].map((ticks) => (
          <DropdownMenuRadioItem
            className={chartMenuItemClassName}
            key={ticks}
            value={String(ticks)}
            disabled={!controls.footprintAvailable}
            style={menuItemStyle(theme)}
          >
            {ticks} tick row
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
      <DropdownMenuRadioGroup
        value={String(controls.footprintImbalancePercent)}
        onValueChange={(next) =>
          controls.setFootprintImbalancePercent(Number(next))
        }
      >
        {[300, 400, 500].map((percent) => (
          <DropdownMenuRadioItem
            className={chartMenuItemClassName}
            key={percent}
            value={String(percent)}
            disabled={!controls.footprintAvailable}
            style={menuItemStyle(theme)}
          >
            {percent}% imbalance
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator className={chartMenuSeparatorClassName} />
      <DropdownMenuLabel
        className={chartMenuLabelClassName}
        style={menuLabelStyle(theme)}
      >
        Crosshair
      </DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={controls.crosshairMode}
        onValueChange={(next) =>
          controls.setCrosshairMode(next as "magnet" | "free")
        }
      >
        <DropdownMenuRadioItem
          className={chartMenuItemClassName}
          value="magnet"
          style={menuItemStyle(theme)}
        >
          Magnet
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem
          className={chartMenuItemClassName}
          value="free"
          style={menuItemStyle(theme)}
        >
          Free
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator className={chartMenuSeparatorClassName} />
      <DropdownMenuLabel
        className={chartMenuLabelClassName}
        style={menuLabelStyle(theme)}
      >
        Scale
      </DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={controls.scaleMode}
        onValueChange={(next) =>
          controls.setScaleMode(next as ChartSurfaceControls["scaleMode"])
        }
      >
        <DropdownMenuRadioItem
          className={chartMenuItemClassName}
          value="linear"
          style={menuItemStyle(theme)}
        >
          Linear
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem
          className={chartMenuItemClassName}
          value="log"
          style={menuItemStyle(theme)}
        >
          Log
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem
          className={chartMenuItemClassName}
          value="percentage"
          style={menuItemStyle(theme)}
        >
          Percent
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem
          className={chartMenuItemClassName}
          value="indexed"
          style={menuItemStyle(theme)}
        >
          Indexed
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator className={chartMenuSeparatorClassName} />
      <DropdownMenuCheckboxItem
        className={chartMenuItemClassName}
        checked={controls.autoScale}
        onCheckedChange={() => controls.setAutoScale((value) => !value)}
        style={menuItemStyle(theme)}
      >
        Auto scale
      </DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem
        className={chartMenuItemClassName}
        checked={controls.invertScale}
        onCheckedChange={() => controls.setInvertScale((value) => !value)}
        style={menuItemStyle(theme)}
      >
        Invert scale
      </DropdownMenuCheckboxItem>
      <DropdownMenuSeparator className={chartMenuSeparatorClassName} />
      <DropdownMenuItem
        className={chartMenuItemClassName}
        onClick={controls.fit}
        style={menuItemStyle(theme)}
      >
        Fit content
      </DropdownMenuItem>
      <DropdownMenuItem
        className={chartMenuItemClassName}
        onClick={controls.realtime}
        disabled={!controls.canFollowRealtime}
        style={menuItemStyle(theme)}
      >
        Jump to realtime
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);

export const ResearchChartWidgetHeader = ({
  theme,
  controls,
  symbol,
  name,
  price,
  priceLabel = null,
  changePercent,
  statusLabel,
  statusTone,
  timeframe,
  timeframeOptions,
  favoriteTimeframes,
  onChangeTimeframe,
  onToggleFavoriteTimeframe,
  onPrewarmTimeframe,
  onOpenSearch,
  onSearchIntent,
  searchOpen,
  onSearchOpenChange,
  searchContent,
  dense = false,
  density,
  meta = null,
  showInlineLegend = true,
  studies = [],
  selectedStudies = [],
  studySpecs = [],
  onToggleStudy,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  showUndoRedo = false,
  showSnapshotButton = true,
  showSettingsButton = true,
  showFullscreenButton = true,
  onFocusChart,
  focusChartActive = false,
  focusChartTitle = "Focus chart",
  onEnterSoloMode,
  soloChartTitle = "Expand chart",
  rightSlot = null,
  identitySlot = null,
  contextSlot = null,
}: ResearchChartWidgetHeaderProps) => {
  const { preferences: userPreferences } = useUserPreferences();
  const viewport = useViewport();
  const isPhone = viewport.flags.isPhone;
  const [timeframeSheetOpen, setTimeframeSheetOpen] = useState(false);
  const [indicatorSheetOpen, setIndicatorSheetOpen] = useState(false);
  const frameDensity = useResolvedChartFrameDensity(dense, density);
  const chromeDense = isCompressedChartFrameDensity(frameDensity);
  const iconOnlyChrome = isIconChartFrameDensity(frameDensity);
  const minimalChrome = frameDensity === "minimal";
  const palette = useMemo(() => getPanelPalette(theme), [theme]);
  const headerHeight = chromeDense ? 28 : 40;
  const timeframes = commonTimeframes(timeframeOptions);
  const selectTimeframe = (nextTimeframe: string) => {
    if (!nextTimeframe || nextTimeframe === timeframe) {
      return;
    }
    onChangeTimeframe?.(nextTimeframe);
  };
  const favoriteTimeframeLookup = useMemo(
    () => new Set(favoriteTimeframes || []),
    [favoriteTimeframes],
  );
  const resolvedChartType = resolveChartType(controls.chartDisplayType);
  const hasAnchoredSearch = typeof onSearchOpenChange === "function";
  const canSearch = typeof onOpenSearch === "function" || hasAnchoredSearch;
  const activeBar = controls.activeBar;
  const resolvedRightSlot =
    typeof rightSlot === "function"
      ? rightSlot({
          density: frameDensity,
          dense: chromeDense,
          iconOnly: iconOnlyChrome,
        })
      : rightSlot;
  const resolvedMeta = {
    open: activeBar?.open ?? meta?.open ?? null,
    high: activeBar?.high ?? meta?.high ?? null,
    low: activeBar?.low ?? meta?.low ?? null,
    close: activeBar?.close ?? meta?.close ?? null,
    volume: activeBar?.volume ?? meta?.volume ?? null,
    vwap: activeBar?.vwap ?? meta?.vwap ?? null,
    sessionVwap: activeBar?.sessionVwap ?? meta?.sessionVwap ?? null,
    accumulatedVolume:
      activeBar?.accumulatedVolume ?? meta?.accumulatedVolume ?? null,
    averageTradeSize:
      activeBar?.averageTradeSize ?? meta?.averageTradeSize ?? null,
    timestamp: activeBar?.ts ?? meta?.timestamp ?? null,
    sourceLabel:
      activeBar?.source === "ibkr-websocket-derived"
        ? "WS"
        : activeBar?.source === "massive-delayed-websocket"
          ? "DELAYED WS"
        : activeBar?.source === "ibkr+massive-gap-fill"
          ? "IBKR + GAP"
          : activeBar?.source === "ibkr-history"
            ? "IBKR"
            : (meta?.sourceLabel ?? (activeBar?.source ? "REST" : "")),
  };
  const displayPrice = price ?? resolvedMeta.close ?? null;
  const positive = (changePercent ?? 0) >= 0;
  const changeColor = positive ? theme.green : theme.red;
  const statusColor =
    statusTone === "good"
      ? theme.green
      : statusTone === "warn"
        ? theme.amber
        : statusTone === "bad"
          ? theme.red
          : statusTone === "neutral" || statusTone === "info"
            ? (theme.accent ?? theme.text)
            : statusLabel && /live|open|stream|massive|ibkr/i.test(statusLabel)
              ? theme.green
              : theme.textDim || theme.textMuted;
  const showTrailingActions =
    (!minimalChrome && showSnapshotButton) ||
    showSettingsButton ||
    showFullscreenButton ||
    (!minimalChrome && typeof onFocusChart === "function") ||
    (!minimalChrome && typeof onEnterSoloMode === "function") ||
    (!minimalChrome && rightSlot != null);
  const showContextSlot =
    contextSlot != null && !iconOnlyChrome && !minimalChrome;
  const studyLookup = useMemo(
    () => new Map(studies.map((study) => [study.id, study.label])),
    [studies],
  );
  const renderedStudyItems = useMemo<RenderedStudyLegendItem[]>(
    () =>
      selectedStudies.reduce<RenderedStudyLegendItem[]>((items, studyId) => {
        const visibleSpecs = studySpecs.filter(
          (spec) =>
            specBelongsToStudy(spec.key, studyId) &&
            spec.options?.visible !== false &&
            spec.data.length > 0,
        );
        if (!visibleSpecs.length) {
          return items;
        }

        const colors = Array.from(
          new Set(
            visibleSpecs
              .map(resolveStudySpecColor)
              .filter((value): value is string => Boolean(value)),
          ),
        );

        items.push({
          id: studyId,
          label: studyLookup.get(studyId) || studyId,
          colors: colors.length ? colors : [theme.accent || theme.text],
        });
        return items;
      }, []),
    [selectedStudies, studyLookup, studySpecs, theme.accent, theme.text],
  );

  return (
    <div
      data-chart-control-root
      style={{ position: "relative", pointerEvents: "none" }}
    >
      <div
        style={{
          height: headerHeight,
          background: palette.panel,
          borderBottom: `1px solid ${theme.border}`,
          display: "flex",
          alignItems: "center",
          padding: chromeDense ? "0 2px" : "0 4px",
          gap: 2,
          overflow: "hidden",
          fontFamily: theme.mono,
          pointerEvents: "auto",
        }}
      >
        <ChartSymbolSearchTrigger
          theme={theme}
          palette={palette}
          symbol={symbol}
          canSearch={canSearch}
          hasAnchoredSearch={hasAnchoredSearch}
          searchOpen={searchOpen}
          onOpenSearch={onOpenSearch}
          onSearchIntent={onSearchIntent}
          onSearchOpenChange={onSearchOpenChange}
          searchContent={searchContent}
          chromeDense={chromeDense}
          minimalChrome={minimalChrome}
          iconOnlyChrome={iconOnlyChrome}
          identitySlot={identitySlot}
        />

        {showContextSlot ? (
          <div
            data-testid="chart-header-context-slot"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 3,
              minWidth: 0,
              maxWidth: chromeDense ? 280 : 420,
              overflow: "hidden",
              flex: "0 1 auto",
            }}
          >
            {contextSlot}
          </div>
        ) : null}

        <div style={dividerStyle(theme, chromeDense)} />

        {isPhone ? (
          <>
            <AppTooltip content="More timeframes">
              <button
                type="button"
                data-testid="chart-timeframe-menu-trigger"
                data-chart-timeframe={timeframe}
                style={barButtonStyle({ theme, palette, dense: chromeDense })}
                onClick={() => setTimeframeSheetOpen(true)}
              >
                <span>{timeframe}</span>
                <ChevronDown style={iconStyle(chromeDense)} />
              </button>
            </AppTooltip>
            <TimeframeSheet
              open={timeframeSheetOpen}
              onClose={() => setTimeframeSheetOpen(false)}
              timeframe={timeframe}
              options={timeframes}
              favoriteTimeframes={favoriteTimeframes}
              onSelect={selectTimeframe}
              onToggleFavorite={onToggleFavoriteTimeframe}
              onPrewarm={onPrewarmTimeframe}
            />
          </>
        ) : (
        <DropdownMenu>
          <AppTooltip content="More timeframes">
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                data-testid="chart-timeframe-menu-trigger"
                data-chart-timeframe={timeframe}
                style={barButtonStyle({ theme, palette, dense: chromeDense })}
              >
                <span>{timeframe}</span>
                <ChevronDown style={iconStyle(chromeDense)} />
              </button>
            </DropdownMenuTrigger>
          </AppTooltip>
          <DropdownMenuContent
            align="start"
            className={chartMenuContentClassName}
            sideOffset={6}
            style={menuContentStyle(theme, palette, 160)}
          >
            <DropdownMenuLabel
              className={chartMenuLabelClassName}
              style={menuLabelStyle(theme)}
            >
              Timeframe
            </DropdownMenuLabel>
            {timeframes.map((option) => {
              const active = option.value === timeframe;
              const favorite = favoriteTimeframeLookup.has(option.value);
              return (
                <DropdownMenuItem
                  className={chartMenuItemClassName}
                  key={option.value}
                  data-testid={`chart-timeframe-option-${option.value}`}
                  data-active={active ? "true" : "false"}
                  onFocus={() => onPrewarmTimeframe?.(option.value)}
                  onMouseEnter={() => onPrewarmTimeframe?.(option.value)}
                  onClick={() => selectTimeframe(option.value)}
                  onSelect={() => selectTimeframe(option.value)}
                  style={{
                    ...menuItemStyle(theme),
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 8,
                    background: active ? withAlpha(theme.accent || theme.text, "20") : undefined,
                    fontWeight: FONT_WEIGHTS.regular,
                    cursor: "pointer",
                  }}
                >
                  <button
                    type="button"
                    data-testid={`chart-timeframe-favorite-${option.value}`}
                    aria-label={
                      favorite
                        ? `Remove ${option.label} favorite`
                        : `Favorite ${option.label}`
                    }
                    onPointerDown={(event) => {
                      // Radix DropdownMenuItem selects on native pointer events,
                      // so stop them here or favoriting also picks the timeframe.
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onPointerUp={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onToggleFavoriteTimeframe?.(option.value);
                    }}
                    style={{
                      width: 18,
                      height: 18,
                      border: "none",
                      background: "transparent",
                      color: favorite ? theme.amber : theme.textMuted,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      padding: 0,
                      flexShrink: 0,
                    }}
                  >
                    <Star
                      style={{
                        width: 13,
                        height: 13,
                        fill: favorite ? "currentColor" : "none",
                      }}
                    />
                  </button>
                  <span style={{ flex: 1 }}>{option.label}</span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
        )}

        {!minimalChrome ? (
          <DropdownMenu>
            <AppTooltip content="Chart type">
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Chart type"
                  style={barButtonStyle({ theme, palette, dense: chromeDense })}
                >
                  <resolvedChartType.Icon style={iconStyle(chromeDense)} />
                  {iconOnlyChrome ? null : <span>{resolvedChartType.label}</span>}
                  <ChevronDown style={iconStyle(chromeDense)} />
                </button>
              </DropdownMenuTrigger>
            </AppTooltip>
            <DropdownMenuContent
              align="start"
              className={chartMenuContentClassName}
              sideOffset={6}
              style={menuContentStyle(theme, palette, 210)}
            >
              <DropdownMenuLabel
                className={chartMenuLabelClassName}
                style={menuLabelStyle(theme)}
              >
                Chart type
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={controls.chartDisplayType}
                onValueChange={(next) =>
                  controls.setChartDisplayType(next as ChartDisplayType)
                }
              >
                {chartTypeOptions.map((option) => (
                  <DropdownMenuRadioItem
                    className={chartMenuItemClassName}
                    key={option.value}
                    value={option.value}
                    disabled={
                      option.value === "footprint" && !controls.footprintAvailable
                    }
                    style={menuItemStyle(theme)}
                  >
                    <option.Icon
                      style={{ ...iconStyle(chromeDense), marginRight: 6 }}
                    />
                    {option.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}

        {!minimalChrome ? (
          isPhone ? (
            <>
              <AppTooltip content="Indicators">
                <button
                  type="button"
                  data-testid="chart-indicators-menu-trigger"
                  aria-label={
                    selectedStudies.length > 0
                      ? `Indicators ${selectedStudies.length}`
                      : "Indicators"
                  }
                  style={barButtonStyle({ theme, palette, dense: chromeDense })}
                  onClick={() => setIndicatorSheetOpen(true)}
                >
                  <Plus style={iconStyle(chromeDense)} />
                  {iconOnlyChrome ? (
                    selectedStudies.length > 0 ? (
                      <span>{selectedStudies.length}</span>
                    ) : null
                  ) : (
                    <span>
                      {chromeDense
                        ? selectedStudies.length > 0
                          ? `Ind ${selectedStudies.length}`
                          : "Ind"
                        : `Indicators ${
                            selectedStudies.length > 0 ? selectedStudies.length : ""
                          }`.trim()}
                    </span>
                  )}
                  <ChevronDown style={iconStyle(chromeDense)} />
                </button>
              </AppTooltip>
              <IndicatorPickerSheet
                open={indicatorSheetOpen}
                onClose={() => setIndicatorSheetOpen(false)}
                indicators={studies}
                selectedIds={selectedStudies}
                onToggle={(id) => onToggleStudy?.(id)}
              />
            </>
          ) : (
            <DropdownMenu>
              <AppTooltip content="Indicators">
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    data-testid="chart-indicators-menu-trigger"
                    aria-label={
                      selectedStudies.length > 0
                        ? `Indicators ${selectedStudies.length}`
                        : "Indicators"
                    }
                    style={barButtonStyle({ theme, palette, dense: chromeDense })}
                  >
                    <Plus style={iconStyle(chromeDense)} />
                    {iconOnlyChrome ? (
                      selectedStudies.length > 0 ? (
                        <span>{selectedStudies.length}</span>
                      ) : null
                    ) : (
                      <span>
                        {chromeDense
                          ? selectedStudies.length > 0
                            ? `Ind ${selectedStudies.length}`
                            : "Ind"
                          : `Indicators ${
                              selectedStudies.length > 0 ? selectedStudies.length : ""
                            }`.trim()}
                      </span>
                    )}
                    <ChevronDown style={iconStyle(chromeDense)} />
                  </button>
                </DropdownMenuTrigger>
              </AppTooltip>
              <DropdownMenuContent
                align="start"
                className={chartMenuContentClassName}
                sideOffset={6}
                style={menuContentStyle(theme, palette, 220)}
              >
                <DropdownMenuLabel
                  className={chartMenuLabelClassName}
                  style={menuLabelStyle(theme)}
                >
                  Indicators
                </DropdownMenuLabel>
                {studies.length ? (
                  studies.map((study) => (
                    <DropdownMenuCheckboxItem
                      className={chartMenuItemClassName}
                      key={study.id}
                      checked={selectedStudies.includes(study.id)}
                      onCheckedChange={() => onToggleStudy?.(study.id)}
                      style={menuItemStyle(theme)}
                    >
                      {study.label}
                    </DropdownMenuCheckboxItem>
                  ))
                ) : (
                  <DropdownMenuItem
                    className={chartMenuItemClassName}
                    disabled
                    style={menuItemStyle(theme)}
                  >
                    No indicators available
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )
        ) : null}

        <div style={{ flex: 1 }} />

        {showUndoRedo && !minimalChrome ? (
          <>
            <AppTooltip content="Undo"><button
              type="button"
              aria-label="Undo"
              onClick={onUndo}
              disabled={!canUndo}
              style={barButtonStyle({
                theme,
                palette,
                dense: chromeDense,
                disabled: !canUndo,
              })}
            >
              <Undo2 style={iconStyle(chromeDense)} />
            </button></AppTooltip>
            <AppTooltip content="Redo"><button
              type="button"
              aria-label="Redo"
              onClick={onRedo}
              disabled={!canRedo}
              style={barButtonStyle({
                theme,
                palette,
                dense: chromeDense,
                disabled: !canRedo,
              })}
            >
              <Redo2 style={iconStyle(chromeDense)} />
            </button></AppTooltip>
          </>
        ) : null}

        {showTrailingActions ? (
          <div style={dividerStyle(theme, chromeDense)} />
        ) : null}

        {typeof onFocusChart === "function" && !minimalChrome ? (
          <AppTooltip content={focusChartTitle}><button
            type="button"
            aria-label={focusChartTitle}
            onClick={onFocusChart}
            style={barButtonStyle({
              theme,
              palette,
              dense: chromeDense,
              active: focusChartActive,
            })}
          >
            <Crosshair style={iconStyle(chromeDense)} />
            {iconOnlyChrome ? null : <span>Focus</span>}
          </button></AppTooltip>
        ) : null}

        {typeof onEnterSoloMode === "function" && !minimalChrome ? (
          <AppTooltip content={soloChartTitle}><button
            type="button"
            aria-label={soloChartTitle}
            onClick={onEnterSoloMode}
            style={barButtonStyle({ theme, palette, dense: chromeDense })}
          >
            <Maximize2 style={iconStyle(chromeDense)} />
            {iconOnlyChrome ? null : <span>Solo</span>}
          </button></AppTooltip>
        ) : null}

        {showSnapshotButton && !minimalChrome ? (
          <AppTooltip content="Screenshot"><button
            type="button"
            aria-label="Screenshot"
            onClick={controls.takeSnapshot}
            style={barButtonStyle({ theme, palette, dense: chromeDense })}
          >
            <Camera style={iconStyle(chromeDense)} />
          </button></AppTooltip>
        ) : null}

        {showSettingsButton ? (
          <SettingsMenu
            theme={theme}
            palette={palette}
            controls={controls}
            dense={chromeDense}
          />
        ) : null}

        {showFullscreenButton ? (
          <AppTooltip content={
              controls.isFullscreen ? "Exit fullscreen" : "Enter fullscreen"
            }><button
            type="button"
            aria-label={controls.isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            onClick={controls.toggleFullscreen}
            style={barButtonStyle({ theme, palette, dense: chromeDense })}
          >
            {controls.isFullscreen ? (
              <Minimize2 style={iconStyle(chromeDense)} />
            ) : (
              <Maximize2 style={iconStyle(chromeDense)} />
            )}
          </button></AppTooltip>
        ) : null}

        {minimalChrome ? null : resolvedRightSlot}
      </div>

      {showInlineLegend ? (
        <div
          style={{
            position: "absolute",
            top: headerHeight + 6,
            left: chromeDense ? 8 : 12,
            right: 12,
            display: "flex",
            flexDirection: "column",
            gap: chromeDense ? 2 : 3,
            pointerEvents: "none",
            maxWidth: "calc(100% - 104px)",
          }}
        >
        <div
          style={{
            display: "flex",
            alignItems: "center",
              gap: chromeDense ? 6 : 8,
            flexWrap: "wrap",
          }}
        >
          <span
            style={legendChipStyle({
              theme,
              palette,
              color: theme.text,
              dense: chromeDense,
            })}
          >
            <span style={{ fontWeight: FONT_WEIGHTS.regular }}>{symbol}</span>
            {name && !chromeDense ? (
              <span style={{ color: theme.textMuted }}>{name}</span>
            ) : null}
            <span style={{ color: theme.textMuted }}>{timeframe}</span>
            {statusLabel ? (
              <span style={{ color: statusColor }}>{statusLabel}</span>
            ) : null}
          </span>

          <span
            style={legendChipStyle({
              theme,
              palette,
              color: theme.text,
              dense: chromeDense,
            })}
          >
            {priceLabel ? (
              <span style={{ color: theme.textMuted }}>{priceLabel}</span>
            ) : null}
            <span>{formatPrice(displayPrice)}</span>
            <span style={{ color: changeColor, fontWeight: FONT_WEIGHTS.regular }}>
              {formatPercent(changePercent)}
            </span>
          </span>

          <span style={legendChipStyle({ theme, palette, dense: chromeDense })}>
            <span style={{ color: theme.textMuted }}>
              {`Bar ${timeframe}`}
            </span>{" "}
            O{" "}
            <span style={{ color: theme.text }}>
              {formatPrice(resolvedMeta.open)}
            </span>
            H{" "}
            <span style={{ color: theme.green }}>
              {formatPrice(resolvedMeta.high)}
            </span>
            L{" "}
            <span style={{ color: theme.red }}>
              {formatPrice(resolvedMeta.low)}
            </span>
            C{" "}
            <span style={{ color: theme.text }}>
              {formatPrice(resolvedMeta.close)}
            </span>
            V{" "}
            <span style={{ color: theme.text }}>
              {formatVolume(resolvedMeta.volume)}
            </span>
          </span>

          {!chromeDense && resolvedMeta.vwap != null ? (
            <span style={legendChipStyle({ theme, palette, dense: chromeDense })}>
              VWAP{" "}
              <span style={{ color: theme.text }}>
                {formatPrice(resolvedMeta.vwap)}
              </span>
            </span>
          ) : null}

          {!chromeDense && resolvedMeta.sessionVwap != null ? (
            <span style={legendChipStyle({ theme, palette, dense: chromeDense })}>
              SVWAP{" "}
              <span style={{ color: theme.text }}>
                {formatPrice(resolvedMeta.sessionVwap)}
              </span>
            </span>
          ) : null}

          {!chromeDense && (resolvedMeta.timestamp || resolvedMeta.sourceLabel) ? (
            <span style={legendChipStyle({ theme, palette, dense: chromeDense })}>
              {[
                formatTimestamp(resolvedMeta.timestamp, userPreferences),
                resolvedMeta.sourceLabel,
              ]
                .filter(Boolean)
                .join("  ")}
            </span>
          ) : null}
        </div>

        {renderedStudyItems.length ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              flexWrap: "wrap",
            }}
          >
            {renderedStudyItems.map((study) => (
              <span
                key={study.id}
                style={legendChipStyle({
                  theme,
                  palette,
                  dense: chromeDense,
                  color: theme.textMuted,
                })}
              >
                {study.colors.map((color, index) => (
                  <span
                    key={`${study.id}-${color}-${index}`}
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: dim(RADII.pill),
                      background: color,
                      display: "inline-block",
                    }}
                  />
                ))}
                {study.label}
              </span>
            ))}
          </div>
        ) : null}
        </div>
      ) : null}
    </div>
  );
};

export const ResearchChartWidgetFooter = ({
  theme,
  controls,
  studies: _studies = [],
  selectedStudies: _selectedStudies = [],
  studySpecs: _studySpecs = [],
  onToggleStudy: _onToggleStudy,
  dense = false,
  density,
  statusText: _statusText = null,
}: ResearchChartWidgetFooterProps) => {
  const frameDensity = useResolvedChartFrameDensity(dense, density);
  if (frameDensity === "minimal") {
    return null;
  }
  const chromeDense = isCompressedChartFrameDensity(frameDensity);
  const palette = getPanelPalette(theme);
  const footerHeight = chromeDense ? 16 : 22;
  const scaleModes = [
    {
      key: "linear",
      label: chromeDense ? "Ln" : "Lin",
      title: "Linear scale",
      onClick: () => controls.setScaleMode("linear"),
    },
    {
      key: "log",
      label: "L",
      title: "Log scale",
      onClick: () => controls.setScaleMode("log"),
    },
    {
      key: "percentage",
      label: "%",
      title: "Percent scale",
      onClick: () => controls.setScaleMode("percentage"),
    },
    {
      key: "indexed",
      label: "100",
      title: "Indexed scale",
      onClick: () => controls.setScaleMode("indexed"),
    },
  ];
  const scaleButtonHeight = chromeDense ? 14 : 18;
  const scaleButtonStyle = ({
    active = false,
    wide = false,
  }: {
    active?: boolean;
    wide?: boolean;
  }): CSSProperties => ({
    width: wide ? (chromeDense ? 22 : 26) : chromeDense ? 16 : 20,
    height: scaleButtonHeight,
    background: active ? theme.accent || theme.text : "transparent",
    color: active ? CSS_COLOR.onAccent : theme.textDim || theme.textMuted,
    border: "none",
    borderRadius: RADII.none,
    cursor: "pointer",
    fontFamily: theme.mono,
    fontSize: chromeDense ? TYPE_CSS_VAR.label : TYPE_CSS_VAR.body,
    fontWeight: FONT_WEIGHTS.regular,
    padding: 0,
  });
  return (
    <div
      data-chart-control-root
      style={{ position: "relative", pointerEvents: "none" }}
    >
      <div
        style={{
          height: footerHeight,
          background: palette.panel,
          borderTop: `1px solid ${theme.border}`,
          display: "flex",
          alignItems: "center",
          padding: chromeDense ? "0 8px" : "0 10px",
          gap: chromeDense ? 6 : 10,
          fontFamily: theme.mono,
          fontSize: chromeDense ? TYPE_CSS_VAR.label : TYPE_CSS_VAR.body,
          color: theme.textMuted,
          pointerEvents: "auto",
          whiteSpace: "nowrap",
          overflow: "hidden",
        }}
      >
        <div style={{ flex: 1 }} />
        <div
          data-chart-footer-scale-controls
          style={{
            height: chromeDense ? 16 : 20,
            display: "flex",
            alignItems: "center",
            gap: 1,
            background: palette.panel,
            border: `1px solid ${theme.border}`,
            borderRadius: RADII.none,
            boxSizing: "border-box",
            padding: 0,
            fontFamily: theme.mono,
            fontSize: chromeDense ? TYPE_CSS_VAR.label : TYPE_CSS_VAR.body,
            pointerEvents: "auto",
            flexShrink: 0,
          }}
        >
          {scaleModes.map((mode) => {
            const active =
              mode.key === "linear"
                ? controls.scaleMode === "linear"
                : controls.scaleMode === mode.key;
            return (
              <AppTooltip key={mode.key} content={mode.title}><button
                key={mode.key}
                type="button"
                onClick={mode.onClick}
                style={scaleButtonStyle({
                  active,
                  wide: mode.key === "indexed" || mode.key === "linear",
                })}
              >
                {mode.label}
              </button></AppTooltip>
            );
          })}

          <div
            style={{
              width: 1,
              alignSelf: "stretch",
              background: theme.border,
              margin: "0 1px",
            }}
          />

          <AppTooltip content="Auto-scale main price pane"><button
            type="button"
            onClick={() => controls.setAutoScale((value) => !value)}
            style={scaleButtonStyle({ active: controls.autoScale })}
          >
            A
          </button></AppTooltip>

          <AppTooltip content="Invert scale"><button
            type="button"
            onClick={() => controls.setInvertScale((value) => !value)}
            style={{
              ...scaleButtonStyle({ active: controls.invertScale }),
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <ArrowUpDown style={iconStyle(true)} />
          </button></AppTooltip>
        </div>
      </div>
    </div>
  );
};

export const ResearchChartWidgetSidebar = ({
  theme,
  controls,
  drawMode = null,
  drawingCount = 0,
  onToggleDrawMode,
  onClearDrawings,
  dense = false,
  density,
}: ResearchChartWidgetSidebarProps) => {
  const frameDensity = useResolvedChartFrameDensity(dense, density);
  if (frameDensity === "minimal") {
    return null;
  }
  const chromeDense = isCompressedChartFrameDensity(frameDensity);
  const railWidth = frameDensity === "icon" ? 26 : chromeDense ? 30 : 40;
  const palette = getPanelPalette(theme);
  const groups = [
    [
      {
        key: "crosshair",
        title: "Crosshair / pan",
        icon: <Crosshair style={iconStyle(chromeDense)} />,
        active: !drawMode,
        onClick: () => onToggleDrawMode?.(null),
      },
    ],
    [
      {
        key: "horizontal",
        title: "Horizontal line",
        icon: <Minus style={iconStyle(chromeDense)} />,
        active: drawMode === "horizontal",
        onClick: () =>
          onToggleDrawMode?.(drawMode === "horizontal" ? null : "horizontal"),
      },
      {
        key: "vertical",
        title: "Vertical line",
        icon: <MoveVertical style={iconStyle(chromeDense)} />,
        active: drawMode === "vertical",
        onClick: () =>
          onToggleDrawMode?.(drawMode === "vertical" ? null : "vertical"),
      },
      {
        key: "box",
        title: "Rectangle",
        icon: <Square style={iconStyle(chromeDense)} />,
        active: drawMode === "box",
        onClick: () => onToggleDrawMode?.(drawMode === "box" ? null : "box"),
      },
    ],
    [
      {
        key: "magnet",
        title:
          controls.crosshairMode === "free"
            ? "Free crosshair"
            : "Magnet crosshair",
        icon:
          controls.crosshairMode === "free" ? (
            <Crosshair style={iconStyle(chromeDense)} />
          ) : (
            <Magnet style={iconStyle(chromeDense)} />
          ),
        active: controls.crosshairMode === "free",
        onClick: () =>
          controls.setCrosshairMode((value) =>
            value === "free" ? "magnet" : "free",
          ),
      },
      {
        key: "realtime",
        title: controls.realtimeFollow ? "Following realtime" : "Follow realtime",
        icon: <Activity style={iconStyle(chromeDense)} />,
        active: controls.realtimeFollow,
        disabled: !controls.canFollowRealtime,
        onClick: controls.realtime,
      },
    ],
  ];

  return (
    <div
      data-chart-control-root
      style={{
        width: railWidth,
        height: "100%",
        background: palette.panel,
        borderRight: `1px solid ${theme.border}`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: chromeDense ? "4px 0" : "6px 0",
        gap: 2,
        overflowY: "auto",
      }}
    >
      {groups.map((group, groupIndex) => (
        <div
          key={groupIndex}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 2,
            width: "100%",
          }}
        >
          {groupIndex > 0 ? (
            <div
              style={{
                width: chromeDense ? 14 : 20,
                height: 1,
                background: theme.border,
                margin: "3px 0",
              }}
            />
          ) : null}

          {group.map((button) => (
            <AppTooltip key={button.key} content={button.title}><button
              key={button.key}
              type="button"
              aria-pressed={button.active}
              aria-disabled={button.disabled ? "true" : undefined}
              disabled={button.disabled}
              onClick={button.onClick}
              style={railButtonStyle({
                theme,
                palette,
                active: button.active,
                dense: chromeDense,
                disabled: button.disabled,
              })}
            >
              {button.icon}
            </button></AppTooltip>
          ))}
        </div>
      ))}

      <div style={{ flex: 1, minHeight: 8 }} />

      <AppTooltip content={
          drawingCount
            ? `Remove all drawings (${drawingCount})`
            : "No drawings to remove"
        }><button
        type="button"
        onClick={onClearDrawings}
        disabled={!drawingCount}
        style={railButtonStyle({
          theme,
          palette,
          dense: chromeDense,
          danger: true,
          disabled: !drawingCount,
        })}
      >
        <Trash2 style={iconStyle(chromeDense)} />
      </button></AppTooltip>
    </div>
  );
};
