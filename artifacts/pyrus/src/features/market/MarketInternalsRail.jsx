import { useMemo } from "react";
import {
  BROAD_MARKET_FLOW_STORE_KEY,
  useMarketFlowSnapshotForStoreKey,
} from "../platform/marketFlowStore";
import {
  DataUnavailableState,
  RadialStrokeGauge,
  SurfacePanel,
} from "../../components/platform/primitives.jsx";
import { toneForDirectionalIntent } from "../platform/semanticToneModel.js";
import { formatSignedPercent, isFiniteNumber } from "../../lib/formatters.js";
import { CSS_COLOR, FONT_WEIGHTS, MISSING_VALUE, RADII, T, cssColorMix, sp, textSize } from "../../lib/uiTokens.jsx";

const SECTOR_LIMIT = 6;

// Section eyebrow (mono-cap label) shared by the sub-panels.
const SectionLabel = ({ children }) => (
  <div
    style={{
      color: CSS_COLOR.textDim,
      fontFamily: T.sans,
      fontSize: textSize("caption"),
      letterSpacing: "0.12em",
      textTransform: "uppercase",
    }}
  >
    {children}
  </div>
);

// Sector rotation as diverging call-vs-put bars around a center line: blue right
// for call-led sectors, red left for put-led. Widths scale to the loudest sector.
const SectorFlowList = ({ sectorFlow }) => {
  const rows = useMemo(() => {
    return [...sectorFlow]
      .map((sector) => ({ ...sector, net: (sector.calls || 0) - (sector.puts || 0) }))
      .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
      .slice(0, SECTOR_LIMIT);
  }, [sectorFlow]);
  const absMax = useMemo(
    () => Math.max(1, ...rows.map((sector) => Math.abs(sector.net))),
    [rows],
  );

  if (!rows.length) {
    return (
      <DataUnavailableState
        variant="neutral"
        title="No live sector flow"
        detail="Sector rotation appears once a live options-flow provider returns data."
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: sp("4px") }}>
      {rows.map((sector) => {
        const widthPct = (Math.abs(sector.net) / absMax) * 50;
        const tone = toneForDirectionalIntent(sector.net >= 0 ? "bullish" : "bearish");
        return (
          <div
            key={sector.sector}
            style={{
              display: "grid",
              gridTemplateColumns: "64px minmax(0, 1fr)",
              gap: sp("9px"),
              alignItems: "center",
            }}
          >
            <span
              style={{
                color: CSS_COLOR.textSec,
                fontFamily: T.sans,
                fontSize: textSize("bodyStrong"),
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {sector.sector}
            </span>
            <span
              style={{
                position: "relative",
                height: 8,
                background: cssColorMix(CSS_COLOR.textMuted, 12),
                borderRadius: RADII.xs,
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: -2,
                  bottom: -2,
                  left: "50%",
                  width: 1,
                  background: CSS_COLOR.borderLight,
                }}
              />
              <span
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: sector.net >= 0 ? "50%" : undefined,
                  right: sector.net < 0 ? "50%" : undefined,
                  width: `${widthPct}%`,
                  background: tone,
                  borderRadius: RADII.xs,
                }}
              />
            </span>
          </div>
        );
      })}
    </div>
  );
};

// Bordered KPI tile matching the mockup's mini-quote box: uppercase label over a
// mono tabular value in a semantic tone.
const InternalsTile = ({ label, value, tone }) => (
  <div
    style={{
      border: `1px solid ${CSS_COLOR.border}`,
      borderRadius: RADII.sm,
      padding: sp("7px 9px"),
      background: CSS_COLOR.bg2,
      minWidth: 0,
    }}
  >
    <div
      style={{
        color: CSS_COLOR.textDim,
        fontFamily: T.sans,
        fontSize: textSize("caption"),
        letterSpacing: "0.06em",
        textTransform: "uppercase",
      }}
    >
      {label}
    </div>
    <div
      style={{
        color: tone,
        fontFamily: T.data,
        fontSize: textSize("displaySmall"),
        fontWeight: FONT_WEIGHTS.label,
        fontVariantNumeric: "tabular-nums",
        lineHeight: 1.1,
      }}
    >
      {value}
    </div>
  </div>
);

/**
 * MarketInternalsRail — the right-column internals card of the Market dashboard:
 * a breadth radial gauge + advance/decline split, the 5D+/Sectors+ stats, P/C
 * and VIX tiles, and live sector rotation as diverging call/put bars. Breadth,
 * P/C, and VIX arrive from the parent so they read identically to the top bar's
 * stat row (single source of truth); sector flow is read from the broad-market
 * flow snapshot store.
 */
export default function MarketInternalsRail({ breadth = {}, putCall = null, volPct = null }) {
  const snapshot = useMarketFlowSnapshotForStoreKey(BROAD_MARKET_FLOW_STORE_KEY);
  const sectorFlow = snapshot?.sectorFlow ?? [];

  const advancePct = isFiniteNumber(breadth.advancePct) ? breadth.advancePct : null;
  const hasBreadth = advancePct != null && breadth.total > 0;
  const upPct = advancePct ?? 0;
  const downPct = advancePct != null ? 100 - advancePct : 0;

  const advTone = toneForDirectionalIntent("bullish");
  const decTone = toneForDirectionalIntent("bearish");
  const gaugeTone =
    advancePct == null
      ? CSS_COLOR.textDim
      : advancePct >= 50
        ? advTone
        : decTone;
  const putCallTone =
    !isFiniteNumber(putCall)
      ? CSS_COLOR.textDim
      : toneForDirectionalIntent(putCall <= 1 ? "bullish" : "bearish");
  const volTone =
    !isFiniteNumber(volPct)
      ? CSS_COLOR.textDim
      : toneForDirectionalIntent(volPct <= 0 ? "bullish" : "bearish");

  const fiveDayLabel = isFiniteNumber(breadth.positive5dPct)
    ? `${breadth.positive5dPct.toFixed(0)}%`
    : MISSING_VALUE;
  const sectorLabel = breadth.sectorCoverage
    ? `${breadth.positiveSectors}/${breadth.sectorCoverage}`
    : MISSING_VALUE;

  return (
    <SurfacePanel title="Market internals" compact style={{ alignSelf: "stretch" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: sp("12px") }}>
        <div style={{ display: "flex", alignItems: "center", gap: sp("14px") }}>
          <RadialStrokeGauge
            value={advancePct}
            max={100}
            size={72}
            tone={gaugeTone}
            gradient={false}
            valueLabel={advancePct != null ? `${Math.round(advancePct)}%` : MISSING_VALUE}
            valueColor={gaugeTone}
            label="Breadth"
            ariaLabel={
              advancePct != null
                ? `Breadth ${Math.round(advancePct)} percent advancing`
                : "Breadth unavailable"
            }
          />
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: sp("7px") }}>
            <span
              style={{
                display: "flex",
                height: 9,
                borderRadius: RADII.pill,
                overflow: "hidden",
                background: cssColorMix(CSS_COLOR.textMuted, 12),
              }}
            >
              <span style={{ width: `${upPct}%`, background: advTone }} />
              <span style={{ width: `${downPct}%`, background: decTone }} />
            </span>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                gap: sp("6px"),
                fontFamily: T.sans,
                fontSize: textSize("bodyStrong"),
              }}
            >
              <span style={{ color: advTone, fontVariantNumeric: "tabular-nums" }}>
                {hasBreadth ? `${breadth.advancers} adv` : MISSING_VALUE}
              </span>
              <span style={{ color: CSS_COLOR.textDim, fontFamily: T.data, fontSize: textSize("caption") }}>
                5D+ {fiveDayLabel} · Sect+ {sectorLabel}
              </span>
              <span style={{ color: decTone, fontVariantNumeric: "tabular-nums" }}>
                {hasBreadth ? `${breadth.decliners} dec` : MISSING_VALUE}
              </span>
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: sp("8px") }}>
          <InternalsTile
            label="Put / Call"
            value={isFiniteNumber(putCall) ? putCall.toFixed(2) : MISSING_VALUE}
            tone={putCallTone}
          />
          <InternalsTile
            label="VIX"
            value={isFiniteNumber(volPct) ? formatSignedPercent(volPct) : MISSING_VALUE}
            tone={volTone}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: sp("7px") }}>
          <SectionLabel>Sector flow · call vs put</SectionLabel>
          <SectorFlowList sectorFlow={sectorFlow} />
        </div>
      </div>
    </SurfacePanel>
  );
}
