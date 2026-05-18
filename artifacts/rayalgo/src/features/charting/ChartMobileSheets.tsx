import { Check, Minus, MoveHorizontal, MoveVertical, Square, Star, Trash2 } from "lucide-react";
// @ts-expect-error JSX import from a .jsx module
import { BottomSheet } from "../../components/platform/BottomSheet.jsx";
// @ts-expect-error JSX import from a .jsx module
import { FONT_WEIGHTS, RADII, T, dim, fs, sp } from "../../lib/uiTokens.jsx";

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
                  border: `1px solid ${isOn ? T.accent : T.border}`,
                  background: isOn ? `${T.accent}1a` : T.bg1,
                  borderRadius: dim(RADII.sm),
                  color: T.text,
                  fontFamily: T.sans,
                  fontSize: fs(12),
                  fontWeight: isOn ? FONT_WEIGHTS.medium : FONT_WEIGHTS.regular,
                  letterSpacing: "-0.005em",
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
                    border: `1px solid ${isOn ? T.accent : T.border}`,
                    background: isOn ? T.accent : "transparent",
                    color: T.onAccent,
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
          <div style={{ color: T.textSec, fontSize: fs(12), padding: sp(8) }}>
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
  onSelectTool: (id: DrawingToolOption["id"]) => void;
  drawingCount?: number;
  onClearAll?: () => void;
};

export const DrawingToolsSheet = ({
  open,
  onClose,
  tools,
  activeTool,
  onSelectTool,
  drawingCount = 0,
  onClearAll,
}: DrawingToolsSheetProps) => (
  <BottomSheet open={open} onClose={onClose} title="Drawing tools" testId="chart-mobile-drawings-sheet" maxHeight="62dvh">
    <div
      style={{
        display: "grid",
        gap: sp(10),
        padding: sp("10px 12px max(14px, env(safe-area-inset-bottom))"),
      }}
    >
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
                onSelectTool(tool.id);
                onClose();
              }}
              style={{
                display: "grid",
                gap: sp(3),
                minHeight: dim(76),
                padding: sp("10px 12px"),
                border: `1px solid ${isActive ? T.accent : T.border}`,
                background: isActive ? `${T.accent}1a` : T.bg1,
                borderRadius: dim(RADII.sm),
                color: T.text,
                fontFamily: T.sans,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: sp(5), color: isActive ? T.accent : T.textSec }}>
                <Icon size={16} strokeWidth={1.6} />
                <span style={{ fontSize: fs(12), fontWeight: FONT_WEIGHTS.medium, color: T.text }}>
                  {tool.label}
                </span>
              </span>
              <span style={{ fontSize: fs(10), color: T.textSec, lineHeight: 1.3 }}>{tool.description}</span>
            </button>
          );
        })}
      </div>
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
            minHeight: dim(40),
            padding: sp("0 14px"),
            border: `1px solid ${T.border}`,
            background: T.bg1,
            color: T.red,
            borderRadius: dim(RADII.sm),
            fontFamily: T.sans,
            fontSize: fs(12),
            fontWeight: FONT_WEIGHTS.medium,
            cursor: "pointer",
          }}
        >
          <Trash2 size={14} />
          <span>Clear {drawingCount} drawing{drawingCount === 1 ? "" : "s"}</span>
        </button>
      ) : null}
    </div>
  </BottomSheet>
);

const SheetSection = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section style={{ display: "grid", gap: sp(6), minWidth: 0 }}>
    <div
      style={{
        color: T.textSec,
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
            minHeight: dim(44),
            borderRadius: dim(RADII.sm),
            border: `1px solid ${isActive ? T.accent : T.border}`,
            background: isActive ? `${T.accent}1f` : T.bg1,
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
              color: isActive ? T.text : T.textSec,
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
                width: dim(36),
                border: "none",
                background: "transparent",
                color: isFavorite ? T.amber : T.textMuted,
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
