import {
  Activity,
  CircleAlert,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { RADII, T, dim, fs, sp } from "../../lib/uiTokens.jsx";

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
  const accent = tone || T.text;
  return (
    <div
      data-testid={`algo-hero-side-${String(label).toLowerCase()}`}
      style={{
        display: "grid",
        gridTemplateColumns: "auto minmax(0, 1fr)",
        alignItems: "center",
        gap: sp(10),
        padding: sp("11px 13px"),
        background: T.bg1,
        border: "none",
        borderRadius: dim(RADII.md),
        minWidth: 0,
      }}
    >
      <div
        style={{
          width: dim(30),
          height: dim(30),
          borderRadius: "50%",
          background: T.bg2,
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
            color: T.textMuted,
            fontFamily: T.sans,
            fontSize: fs(9),
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            fontWeight: 500,
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
                color: T.textDim,
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
      ? T.red
      : Number(pnlValue) > 0
        ? T.green
        : T.text;
  const TrendIcon =
    Number(pnlValue) < 0
      ? TrendingDown
      : Number(pnlValue) > 0
        ? TrendingUp
        : Activity;
  const rulesTone =
    rulesState === "FAIL"
      ? T.red
      : rulesState === "REVIEW"
        ? T.amber
        : T.green;
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
          background: T.bg1,
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
              color: T.textMuted,
              fontFamily: T.sans,
              fontSize: fs(10),
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              fontWeight: 500,
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
              fontSize: fs(9),
              letterSpacing: "0.04em",
            }}
          >
            <TrendIcon size={13} />
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
            letterSpacing: "-0.02em",
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
                  borderRadius: "50%",
                  background:
                    kind === "win"
                      ? T.green
                      : kind === "loss"
                        ? T.red
                        : "transparent",
                  border:
                    kind === "empty"
                      ? `1px solid ${T.border}`
                      : `1px solid transparent`,
                  flexShrink: 0,
                }}
              />
            ))}
          </div>
          <div
            style={{
              color: T.textDim,
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

      <div
        style={{
          display: "grid",
          gridTemplateColumns: narrow
            ? "repeat(2, minmax(0, 1fr))"
            : "minmax(0, 1fr)",
          gridAutoRows: narrow ? undefined : "minmax(0, 1fr)",
          gap: sp(7),
          minWidth: 0,
        }}
      >
        <SidebarTile
          icon={Activity}
          label="Active"
          value={activePositions ?? 0}
          detail={unrealizedDisplay ? unrealizedDisplay : null}
          tone={activePositions > 0 ? T.cyan : T.textDim}
        />
        <SidebarTile
          icon={Sparkles}
          label="Fresh"
          value={freshSignals ?? 0}
          detail={freshSignalsDetail}
          tone={freshSignals > 0 ? T.green : T.textDim}
        />
        <SidebarTile
          icon={RulesIcon}
          label="Rules"
          value={rulesState}
          detail={rulesDetail}
          tone={rulesTone}
        />
        {narrow ? null : (
          <SidebarTile
            icon={Activity}
            label="Candidates"
            value={candidates ?? 0}
            detail={candidatesDetail}
            tone={candidates > 0 ? T.cyan : T.textDim}
          />
        )}
      </div>
    </div>
  );
};
