import {
  Camera,
  Check,
  Minus,
  MoveHorizontal,
  MoveVertical,
  Redo2,
  Square,
  Star,
  Trash2,
  Undo2,
} from "lucide-react";
// @ts-expect-error JSX import from a .jsx module
import { BottomSheet } from "../../components/platform/BottomSheet.jsx";
// @ts-expect-error JSX import from a .jsx module
import { CSS_COLOR, cssColorMix, FONT_WEIGHTS, RADII, T, dim, fs, sp } from "../../lib/uiTokens.jsx";

export type TimeframeSheetOption = {
  value: string;
  label: string;
};

export type IndicatorOption = {
  id: string;
  label: string;
};

export type DrawingToolOption = {
  id: "horizontal" | "vertical" | "box";
  label: string;
  description: string;
};

type TimeframeSheetProps = {
  open: boolean;
  onClose: () => void;
  timeframe: string;
  options: TimeframeSheetOption[];
  favoriteTimeframes?: string[];
  onSelect: (next: string) => void;
  onToggleFavorite?: (next: string) => void;
  onPrewarm?: (next: string) => void;
};

export const TimeframeSheet = ({
  open,
  onClose,
  timeframe,
  options,
  favoriteTimeframes = [],
  onSelect,
  onToggleFavorite,
  onPrewarm,
}: TimeframeSheetProps) => {
  const favoriteSet = new Set(favoriteTimeframes);
  const favoriteOptions = options.filter((opt) => favoriteSet.has(opt.value));
  const otherOptions = options.filter((opt) => !favoriteSet.has(opt.value));

  return (
    <BottomSheet open={open} onClose={onClose} title="Timeframe" testId="chart-mobile-timeframe-sheet" maxHeight="68dvh">
      <div
        style={{
          display: "grid",
          gap: sp(12),
          padding: sp("12px 12px max(14px, env(safe-area-inset-bottom))"),
        }}
      >
        {favoriteOptions.length ? (
          <SheetSection title="Favorites">
            <TimeframeGrid
              options={favoriteOptions}
              activeValue={timeframe}
              favoriteSet={favoriteSet}
              onSelect={(value) => {
                onSelect(value);
                onClose();
              }}
              onToggleFavorite={onToggleFavorite}
              onPrewarm={onPrewarm}
            />
          </SheetSection>
        ) : null}
        <SheetSection title={favoriteOptions.length ? "All timeframes" : "Timeframes"}>
          <TimeframeGrid
            options={otherOptions.length ? otherOptions : options}
            activeValue={timeframe}
            favoriteSet={favoriteSet}
            onSelect={(value) => {
              onSelect(value);
              onClose();
            }}
            onToggleFavorite={onToggleFavorite}
            onPrewarm={onPrewarm}
          />
        </SheetSection>
      </div>
    </BottomSheet>
  );
};

type IndicatorPickerSheetProps = {
  open: boolean;
  onClose: () => void;
  indicators: IndicatorOption[];
  selectedIds: string[];
  onToggle: (id: string) => void;
};

export const IndicatorPickerSheet = ({
  open,
  onClose,
  indicators,
  selectedIds,
  onToggle,
}: IndicatorPickerSheetProps) => {
  const selectedSet = new Set(selectedIds);
  return (
    <BottomSheet open={open} onClose={onClose} title="Indicators" testId="chart-mobile-indicator-sheet" maxHeight="74dvh">
      <div
        style={{
          display: "grid",
          gap: sp(6),
          padding: sp("10px 12px max(14px, env(safe-area-inset-bottom))"),
        }}
      >
        {indicators.length ? (
          indicators.map((indicator) => {
            const isOn = selectedSet.has(indicator.id);
            return (
              <button
                key={indicator.id}
                type="button"
                data-testid={`chart-mobile-indicator-${indicator.id}`}
                data-active={isOn ? "true" : "false"}
                onClick={() => onToggle(indicator.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: sp(8),
                  minHeight: dim(48),
                  padding: sp("0 12px"),
                  border: `1px solid ${isOn ? CSS_COLOR.accent : CSS_COLOR.border}`,
                  background: isOn ? `${cssColorMix(CSS_COLOR.accent, 10)}` : CSS_COLOR.bg1,
                  borderRadius: dim(RADII.sm),
                  color: CSS_COLOR.text,
                  fontFamily: T.sans,
                  fontSize: fs(12),
                  fontWeight: isOn ? FONT_WEIGHTS.medium : FONT_WEIGHTS.regular,
                  letterSpacing: 0,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: dim(20),
                    height: dim(20),
                    borderRadius: dim(RADII.xs),
                    border: `1px solid ${isOn ? CSS_COLOR.accent : CSS_COLOR.border}`,
                    background: isOn ? CSS_COLOR.accent : "transparent",
                    color: CSS_COLOR.onAccent,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  {isOn ? <Check size={12} strokeWidth={3} /> : null}
                </span>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {indicator.label}
                </span>
              </button>
            );
          })
        ) : (
          <div style={{ color: CSS_COLOR.textSec, fontSize: fs(12), padding: sp(8) }}>
            No indicators available for this chart.
          </div>
        )}
      </div>
    </BottomSheet>
  );
};

const DRAWING_TOOL_ICON = {
  horizontal: MoveHorizontal,
  vertical: MoveVertical,
  box: Square,
} as const;

type DrawingToolsSheetProps = {
  open: boolean;
  onClose: () => void;
  tools: DrawingToolOption[];
  activeTool?: DrawingToolOption["id"] | null;
  onSelectTool?: (id: DrawingToolOption["id"]) => void;
  drawingCount?: number;
  onClearAll?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onSnapshot?: () => void;
};

const ToolActionButton = ({
  testId,
  label,
  icon,
  disabled = false,
  onClick,
}: {
  testId: string;
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    data-testid={testId}
    disabled={disabled}
    onClick={onClick}
    style={{
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: sp(5),
      minHeight: dim(44),
      minWidth: 0,
      padding: sp("0 10px"),
      border: `1px solid ${CSS_COLOR.border}`,
      background: CSS_COLOR.bg1,
      color: CSS_COLOR.text,
      borderRadius: dim(RADII.sm),
      fontFamily: T.sans,
      fontSize: fs(11),
      fontWeight: FONT_WEIGHTS.medium,
      cursor: disabled ? "default" : "pointer",
      opacity: disabled ? 0.45 : 1,
    }}
  >
    {icon}
    <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{label}</span>
  </button>
);

export const DrawingToolsSheet = ({
  open,
  onClose,
  tools,
  activeTool,
  onSelectTool,
  drawingCount = 0,
  onClearAll,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  onSnapshot,
}: DrawingToolsSheetProps) => {
  const hasActions = Boolean(onUndo || onRedo || onSnapshot);
  return (
    <BottomSheet open={open} onClose={onClose} title="Chart tools" testId="chart-mobile-drawings-sheet" maxHeight="68dvh">
      <div
        style={{
          display: "grid",
          gap: sp(10),
          padding: sp("10px 12px max(14px, env(safe-area-inset-bottom))"),
        }}
      >
        {tools.length ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
              gap: sp(6),
            }}
          >
            {tools.map((tool) => {
              const isActive = tool.id === activeTool;
              const Icon = DRAWING_TOOL_ICON[tool.id] || Minus;
              return (
                <button
                  key={tool.id}
                  type="button"
                  data-testid={`chart-mobile-drawing-${tool.id}`}
                  data-active={isActive ? "true" : "false"}
                  onClick={() => {
                    onSelectTool?.(tool.id);
                    onClose();
                  }}
                  style={{
                    display: "grid",
                    gap: sp(3),
                    minHeight: dim(76),
                    minWidth: 0,
                    padding: sp("10px 12px"),
                    border: `1px solid ${isActive ? CSS_COLOR.accent : CSS_COLOR.border}`,
                    background: isActive ? `${cssColorMix(CSS_COLOR.accent, 10)}` : CSS_COLOR.bg1,
                    borderRadius: dim(RADII.sm),
                    color: CSS_COLOR.text,
                    fontFamily: T.sans,
                    cursor: "pointer",
                    textAlign: "left",
                    overflowWrap: "anywhere",
                  }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: sp(5), minWidth: 0, color: isActive ? CSS_COLOR.accent : CSS_COLOR.textSec }}>
                    <Icon size={16} strokeWidth={1.6} style={{ flexShrink: 0 }} />
                    <span style={{ minWidth: 0, fontSize: fs(12), fontWeight: FONT_WEIGHTS.medium, color: CSS_COLOR.text, overflowWrap: "anywhere" }}>
                      {tool.label}
                    </span>
                  </span>
                  <span style={{ fontSize: fs(10), color: CSS_COLOR.textSec, lineHeight: 1.3, overflowWrap: "anywhere" }}>{tool.description}</span>
                </button>
              );
            })}
          </div>
        ) : null}
        {hasActions ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(88px, 1fr))",
              gap: sp(6),
            }}
          >
            {onUndo ? (
              <ToolActionButton
                testId="chart-mobile-tool-undo"
                label="Undo"
                icon={<Undo2 size={15} />}
                disabled={!canUndo}
                onClick={onUndo}
              />
            ) : null}
            {onRedo ? (
              <ToolActionButton
                testId="chart-mobile-tool-redo"
                label="Redo"
                icon={<Redo2 size={15} />}
                disabled={!canRedo}
                onClick={onRedo}
              />
            ) : null}
            {onSnapshot ? (
              <ToolActionButton
                testId="chart-mobile-tool-snapshot"
                label="Snapshot"
                icon={<Camera size={15} />}
                onClick={onSnapshot}
              />
            ) : null}
          </div>
        ) : null}
        {drawingCount > 0 && onClearAll ? (
          <button
            type="button"
            data-testid="chart-mobile-drawing-clear-all"
            onClick={() => {
              onClearAll();
              onClose();
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: sp(5),
              minHeight: dim(44),
              minWidth: 0,
              padding: sp("0 14px"),
              border: `1px solid ${CSS_COLOR.border}`,
              background: CSS_COLOR.bg1,
              color: CSS_COLOR.red,
              borderRadius: dim(RADII.sm),
              fontFamily: T.sans,
              fontSize: fs(12),
              fontWeight: FONT_WEIGHTS.medium,
              cursor: "pointer",
              overflowWrap: "anywhere",
            }}
          >
            <Trash2 size={14} />
            <span>Clear {drawingCount} drawing{drawingCount === 1 ? "" : "s"}</span>
          </button>
        ) : null}
      </div>
    </BottomSheet>
  );
};

const SheetSection = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section style={{ display: "grid", gap: sp(6), minWidth: 0 }}>
    <div
      style={{
        color: CSS_COLOR.textSec,
        fontSize: fs(9),
        fontFamily: T.sans,
        fontWeight: FONT_WEIGHTS.medium,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
      }}
    >
      {title}
    </div>
    {children}
  </section>
);

type TimeframeGridProps = {
  options: TimeframeSheetOption[];
  activeValue: string;
  favoriteSet: Set<string>;
  onSelect: (value: string) => void;
  onToggleFavorite?: (value: string) => void;
  onPrewarm?: (value: string) => void;
};

const TimeframeGrid = ({
  options,
  activeValue,
  favoriteSet,
  onSelect,
  onToggleFavorite,
  onPrewarm,
}: TimeframeGridProps) => (
  <div
    style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))",
      gap: sp(5),
    }}
  >
    {options.map((opt) => {
      const isActive = opt.value === activeValue;
      const isFavorite = favoriteSet.has(opt.value);
      return (
        <div
          key={opt.value}
          style={{
            display: "flex",
            alignItems: "stretch",
            minHeight: dim(46),
            borderRadius: dim(RADII.sm),
            border: `1px solid ${isActive ? CSS_COLOR.accent : CSS_COLOR.border}`,
            background: isActive ? `${cssColorMix(CSS_COLOR.accent, 12)}` : CSS_COLOR.bg1,
            overflow: "hidden",
          }}
        >
          <button
            type="button"
            data-testid={`chart-mobile-timeframe-${opt.value}`}
            data-active={isActive ? "true" : "false"}
            onClick={() => onSelect(opt.value)}
            onPointerEnter={() => onPrewarm?.(opt.value)}
            style={{
              flex: 1,
              minWidth: 0,
              border: "none",
              background: "transparent",
              color: isActive ? CSS_COLOR.text : CSS_COLOR.textSec,
              fontFamily: T.sans,
              fontSize: fs(12),
              fontWeight: isActive ? FONT_WEIGHTS.medium : FONT_WEIGHTS.regular,
              letterSpacing: "0.02em",
              textAlign: "left",
              padding: sp("0 10px"),
              cursor: "pointer",
            }}
          >
            {opt.label}
          </button>
          {onToggleFavorite ? (
            <button
              type="button"
              data-testid={`chart-mobile-timeframe-favorite-${opt.value}`}
              aria-label={isFavorite ? `Remove ${opt.label} favorite` : `Favorite ${opt.label}`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onToggleFavorite(opt.value);
              }}
              style={{
                width: dim(44),
                border: "none",
                background: "transparent",
                color: isFavorite ? CSS_COLOR.amber : CSS_COLOR.textMuted,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Star size={14} style={{ fill: isFavorite ? "currentColor" : "none" }} />
            </button>
          ) : null}
        </div>
      );
    })}
  </div>
);
