import {
  Activity,
  CircleAlert,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { AppTooltip } from "@/components/ui/tooltip";
import { CSS_COLOR, FONT_WEIGHTS, RADII, T, dim, fs, sp, textSize } from "../../lib/uiTokens.jsx";

const WL_DOTS = 16;

const renderDots = (winCount, lossCount) => {
  const total = Math.max(0, Math.floor(winCount) + Math.floor(lossCount));
  const dots = [];
  for (let i = 0; i < WL_DOTS; i += 1) {
    let kind;
    if (i < Math.floor(winCount)) {
      kind = "win";
    } else if (i < total) {
      kind = "loss";
    } else {
      kind = "empty";
    }
    dots.push(kind);
  }
  return dots;
};

const SidebarTile = ({ icon: Icon, label, value, detail, tone }) => {
  const accent = tone || CSS_COLOR.text;
  return (
    <div
      data-testid={`algo-hero-side-${String(label).toLowerCase()}`}
      style={{
        display: "grid",
        gridTemplateColumns: "auto minmax(0, 1fr)",
        alignItems: "center",
        gap: sp(10),
        padding: sp("11px 13px"),
        background: CSS_COLOR.bg1,
        border: "none",
        borderRadius: dim(RADII.md),
        minWidth: 0,
      }}
    >
      <div
        style={{
          width: dim(30),
          height: dim(30),
          borderRadius: dim(RADII.pill),
          background: CSS_COLOR.bg1,
          color: accent,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Icon size={14} />
      </div>
      <div style={{ minWidth: 0, display: "grid", gap: sp(2) }}>
        <div
          style={{
            color: CSS_COLOR.textMuted,
            fontFamily: T.sans,
            fontSize: textSize("caption"),
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            fontWeight: FONT_WEIGHTS.medium,
          }}
        >
          {label}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: sp(5),
            minWidth: 0,
          }}
        >
          <span
            style={{
              color: accent,
              fontFamily: T.sans,
              fontSize: fs(13),
              fontVariantNumeric: "tabular-nums",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {value}
          </span>
          {detail ? (
            <span
              style={{
                color: CSS_COLOR.textDim,
                fontFamily: T.sans,
                fontSize: fs(8),
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {detail}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
};

const InlineIndicator = ({ icon: Icon, label, value, tone }) => {
  const accent = tone || CSS_COLOR.text;
  return (
    <AppTooltip content={label}>
      <div
        data-testid={`algo-hero-inline-${String(label).toLowerCase()}`}
        style={{
          display: "inline-flex",
          alignItems: "baseline",
          gap: sp(3),
          padding: sp("4px 8px"),
          background: CSS_COLOR.bg1,
          borderRadius: dim(RADII.pill),
          flexShrink: 0,
          minWidth: 0,
        }}
      >
      <Icon size={12} color={accent} aria-label={label} style={{ alignSelf: "center" }} />
      <span
        style={{
          color: accent,
          fontFamily: T.sans,
          fontSize: fs(12),
          fontVariantNumeric: "tabular-nums",
          fontWeight: FONT_WEIGHTS.medium,
          lineHeight: 1,
        }}
      >
        {value}
      </span>
      </div>
    </AppTooltip>
  );
};

export const HeroKpi = ({
  pnlValue,
  pnlValueDisplay,
  pnlPercentDisplay,
  wins,
  losses,
  activePositions,
  unrealizedDisplay,
  freshSignals,
  freshSignalsDetail,
  rulesState,
  rulesDetail,
  candidates,
  candidatesDetail,
  todayFired,
  todayFiredDetail,
  narrow = false,
}) => {
  const pnlTone =
    Number(pnlValue) < 0
      ? CSS_COLOR.red
      : Number(pnlValue) > 0
        ? CSS_COLOR.green
        : CSS_COLOR.text;
  const TrendIcon =
    Number(pnlValue) < 0
      ? TrendingDown
      : Number(pnlValue) > 0
        ? TrendingUp
        : Activity;
  const rulesTone =
    rulesState === "FAIL"
      ? CSS_COLOR.red
      : rulesState === "REVIEW"
        ? CSS_COLOR.amber
        : CSS_COLOR.green;
  const RulesIcon = rulesState === "FAIL" ? CircleAlert : ShieldCheck;
  const dots = renderDots(wins, losses);

  return (
    <div
      data-testid="algo-hero-kpi"
      style={{
        display: "grid",
        gridTemplateColumns: narrow
          ? "minmax(0, 1fr)"
          : "minmax(0, 2.2fr) minmax(0, 1fr)",
        gap: sp(10),
        minWidth: 0,
      }}
    >
      <div
        style={{
          position: "relative",
          background: CSS_COLOR.bg1,
          border: "none",
          borderRadius: dim(RADII.md),
          padding: sp(narrow ? "16px 18px" : "22px 26px"),
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          gap: sp(12),
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: sp(10),
          }}
        >
          <span
            style={{
              color: CSS_COLOR.textMuted,
              fontFamily: T.sans,
              fontSize: fs(10),
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              fontWeight: FONT_WEIGHTS.medium,
            }}
          >
            Today
          </span>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: sp(4),
              color: pnlTone,
              fontFamily: T.sans,
              fontSize: textSize("caption"),
              letterSpacing: "0.04em",
            }}
          >
            <TrendIcon size={13} aria-hidden="true" />
            <span>{pnlPercentDisplay || "—"}</span>
          </div>
        </div>
        <div
          style={{
            position: "relative",
            color: pnlTone,
            fontFamily: T.sans,
            fontSize: fs(narrow ? 28 : 36),
            fontVariantNumeric: "tabular-nums",
            letterSpacing: 0,
            lineHeight: 1,
          }}
        >
          {pnlValueDisplay}
        </div>
        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            gap: sp(5),
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: sp(4),
              flexWrap: "wrap",
            }}
          >
            {dots.map((kind, idx) => (
              <span
                key={idx}
                aria-hidden="true"
                style={{
                  width: dim(8),
                  height: dim(8),
                  borderRadius: dim(RADII.pill),
                  background:
                    kind === "win"
                      ? CSS_COLOR.green
                      : kind === "loss"
                        ? CSS_COLOR.red
                        : "transparent",
                  border:
                    kind === "empty"
                      ? `1px solid ${CSS_COLOR.border}`
                      : `1px solid transparent`,
                  flexShrink: 0,
                }}
              />
            ))}
          </div>
          <div
            style={{
              color: CSS_COLOR.textDim,
              fontFamily: T.sans,
              fontSize: fs(8),
              letterSpacing: "0.04em",
            }}
          >
            {wins} win · {losses} loss
            {unrealizedDisplay ? ` · unreal ${unrealizedDisplay}` : ""}
          </div>
        </div>
      </div>

      {narrow ? (
        <div
          className="ra-hide-scrollbar"
          style={{
            display: "flex",
            alignItems: "center",
            gap: sp(3),
            overflowX: "auto",
            minWidth: 0,
          }}
        >
          <InlineIndicator
            icon={Activity}
            label="Active"
            value={activePositions ?? 0}
            tone={activePositions > 0 ? CSS_COLOR.cyan : CSS_COLOR.textDim}
          />
          <InlineIndicator
            icon={Sparkles}
            label="Fresh"
            value={freshSignals ?? 0}
            tone={freshSignals > 0 ? CSS_COLOR.green : CSS_COLOR.textDim}
          />
          <InlineIndicator
            icon={RulesIcon}
            label="Rules"
            value={rulesState}
            tone={rulesTone}
          />
          <InlineIndicator
            icon={Activity}
            label="Candidates"
            value={candidates ?? 0}
            tone={candidates > 0 ? CSS_COLOR.cyan : CSS_COLOR.textDim}
          />
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr)",
            gridAutoRows: "minmax(0, 1fr)",
            gap: sp(7),
            minWidth: 0,
          }}
        >
          <SidebarTile
            icon={Activity}
            label="Active"
            value={activePositions ?? 0}
            detail={unrealizedDisplay ? unrealizedDisplay : null}
            tone={activePositions > 0 ? CSS_COLOR.cyan : CSS_COLOR.textDim}
          />
          <SidebarTile
            icon={Sparkles}
            label="Fresh"
            value={freshSignals ?? 0}
            detail={freshSignalsDetail}
            tone={freshSignals > 0 ? CSS_COLOR.green : CSS_COLOR.textDim}
          />
          <SidebarTile
            icon={RulesIcon}
            label="Rules"
            value={rulesState}
            detail={rulesDetail}
            tone={rulesTone}
          />
          <SidebarTile
            icon={Activity}
            label="Candidates"
            value={candidates ?? 0}
            detail={candidatesDetail}
            tone={candidates > 0 ? CSS_COLOR.cyan : CSS_COLOR.textDim}
          />
        </div>
      )}
    </div>
  );
};
