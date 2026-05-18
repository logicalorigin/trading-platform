import { Star } from "lucide-react";
// @ts-expect-error JSX import from a .jsx module
import { BottomSheet } from "../../components/platform/BottomSheet.jsx";
// @ts-expect-error JSX import from a .jsx module
import { FONT_WEIGHTS, RADII, T, dim, fs, sp } from "../../lib/uiTokens.jsx";

export type TimeframeSheetOption = {
  value: string;
  label: string;
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
