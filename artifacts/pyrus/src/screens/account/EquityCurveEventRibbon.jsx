import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CircleDollarSign,
  Minus,
  Plus,
} from "lucide-react";
import { RADII, T, dim } from "../../lib/uiTokens.jsx";
import { AppTooltip } from "@/components/ui/tooltip";

const RIBBON_HEIGHT = 22;
const GLYPH_SIZE = 14;

const toneColor = (value) => {
  if (value == null || Number.isNaN(Number(value))) return T.textDim;
  return Number(value) >= 0 ? T.green : T.red;
};

export const equityEventColor = (event) => {
  if (event?.type === "withdrawal") return T.red;
  if (event?.type === "dividend") return T.accent;
  if (event?.type === "trade_buy") return T.cyan;
  if (event?.type === "trade_sell") return toneColor(event?.realizedPnl ?? event?.amount);
  if (event?.type === "deposit") return T.green;
  return T.textSec;
};

export const equityEventTitle = (event) => {
  if (!event) return "Event";
  if (event.symbol && event.side) {
    return `${event.symbol} ${String(event.side).toUpperCase()}`;
  }
  return String(event.type || "event").replace(/_/g, " ").toUpperCase();
};

const EventGlyph = ({ type, color, size }) => {
  const stroke = color;
  const sharedProps = { size, strokeWidth: 2.25, color: stroke };
  switch (type) {
    case "trade_buy":
      return <Plus {...sharedProps} />;
    case "trade_sell":
      return <Minus {...sharedProps} />;
    case "dividend":
      return <CircleDollarSign {...sharedProps} />;
    case "withdrawal":
      return <ArrowUpFromLine {...sharedProps} />;
    case "deposit":
      return <ArrowDownToLine {...sharedProps} />;
    default:
      return <Plus {...sharedProps} />;
  }
};

const EquityCurveEventRibbonInner = ({
  chart,
  events,
  onActiveEventChange,
  compact = false,
}) => {
  const containerRef = useRef(null);
  const [positions, setPositions] = useState([]);
  const [containerWidth, setContainerWidth] = useState(0);

  const reposition = useCallback(() => {
    if (!chart || !containerRef.current) {
      setPositions([]);
      return;
    }
    const timeScale = chart.timeScale();
    if (!timeScale) {
      setPositions([]);
      return;
    }
    const next = events
      .map((event) => {
        const timeSeconds = Math.floor(Number(event.timestampMs) / 1000);
        if (!Number.isFinite(timeSeconds)) return null;
        const coordinate = timeScale.timeToCoordinate(timeSeconds);
        if (coordinate == null || !Number.isFinite(coordinate)) return null;
        return {
          key: `${event.timestampMs}:${event.type}:${event.symbol || "cash"}`,
          event,
          left: Number(coordinate),
        };
      })
      .filter(Boolean);
    setPositions(next);
  }, [chart, events]);

  useEffect(() => {
    reposition();
  }, [reposition]);

  useEffect(() => {
    if (!chart) return undefined;
    const timeScale = chart.timeScale();
    if (!timeScale?.subscribeVisibleLogicalRangeChange) return undefined;
    const handler = () => reposition();
    timeScale.subscribeVisibleLogicalRangeChange(handler);
    return () => {
      try {
        timeScale.unsubscribeVisibleLogicalRangeChange(handler);
      } catch (error) {
        // ignore unsubscribe errors during HMR
      }
    };
  }, [chart, reposition]);

  useEffect(() => {
    if (!containerRef.current || typeof ResizeObserver === "undefined") {
      return undefined;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setContainerWidth(entry.contentRect.width);
      reposition();
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [reposition]);

  const visiblePositions = useMemo(
    () => positions.filter((entry) => entry.left >= 0 && entry.left <= containerWidth + 4),
    [containerWidth, positions],
  );

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        width: "100%",
        height: dim(compact ? RIBBON_HEIGHT - 4 : RIBBON_HEIGHT),
        borderTop: `1px solid ${T.border}`,
      }}
    >
      {visiblePositions.map(({ key, event, left }) => {
        const color = equityEventColor(event);
        const size = dim(compact ? GLYPH_SIZE - 2 : GLYPH_SIZE);
        return (
          <AppTooltip key={key} content={equityEventTitle(event)}>
            <button
              type="button"
              onMouseEnter={() => onActiveEventChange?.(event)}
              onMouseLeave={() => onActiveEventChange?.(null)}
              onFocus={() => onActiveEventChange?.(event)}
              onBlur={() => onActiveEventChange?.(null)}
              className="ra-interactive"
              style={{
                position: "absolute",
                top: "50%",
                left,
                transform: "translate(-50%, -50%)",
                border: "none",
                background: "transparent",
                padding: 0,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: size + dim(4),
                height: size + dim(4),
                borderRadius: dim(RADII.pill),
                color,
              }}
            >
              <EventGlyph type={event.type} color={color} size={size} />
            </button>
          </AppTooltip>
        );
      })}
    </div>
  );
};

EquityCurveEventRibbonInner.displayName = "EquityCurveEventRibbon";

export const EquityCurveEventRibbon = memo(EquityCurveEventRibbonInner);

export default EquityCurveEventRibbon;
