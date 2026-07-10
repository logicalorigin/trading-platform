import {
  CSS_COLOR,
  FONT_WEIGHTS,
  RADII,
  T,
  cssColorMix,
  dim,
  fs,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import { motionVars } from "../../lib/motion.jsx";
import { formatMoney } from "./algoHelpers";
import { normalizeLegacyAlgoBrandText } from "./algoBranding.js";

const HIDE_SCROLLBAR_STYLE = {
  scrollbarWidth: "none",
  msOverflowStyle: "none",
};

// lastError wins over enabled so a running-but-errored deployment reads red.
// `shape` is a non-color cue so run status is legible without relying on hue:
// filled circle = running, hollow ring = paused, filled square = errored.
const resolveStatusDot = (deployment) => {
  if (deployment?.lastError)
    return { color: CSS_COLOR.red, label: "errored", shape: "square" };
  if (deployment?.enabled)
    return { color: CSS_COLOR.green, label: "running", shape: "filled" };
  return { color: CSS_COLOR.amber, label: "paused", shape: "ring" };
};

// Shadow/live toggle chip. Nested inside the tab (which is a div, not a button,
// to keep this a valid interactive child). Click stops propagation so it never
// also switches tabs. The actual mode change (and the LIVE confirmation) is
// handled by the parent via onToggle — this only signals intent.
const ModeToggle = ({ deployment, pending, onToggle }) => {
  const mode = String(deployment?.mode || "").toUpperCase();
  const isLive = mode === "LIVE";
  return (
    <button
      type="button"
      data-testid={`algo-deployment-mode-${deployment.id}`}
      aria-label={`Mode ${mode || "shadow"}. Switch to ${isLive ? "shadow" : "live"}.`}
      disabled={pending}
      onClick={(event) => {
        event.stopPropagation();
        onToggle?.(deployment);
      }}
      onKeyDown={(event) => {
        // Keep keyboard activation on the toggle itself: don't let Enter/Space
        // bubble to the tab's onKeyDown (which would also select the tab and
        // preventDefault the button's native Space activation).
        if (event.key === "Enter" || event.key === " ") {
          event.stopPropagation();
        }
      }}
      className="ra-interactive ra-touch-target"
      style={{
        flexShrink: 0,
        padding: sp("1px 6px"),
        border: `1px solid ${isLive ? CSS_COLOR.red : CSS_COLOR.border}`,
        borderRadius: dim(RADII.pill),
        background: isLive ? cssColorMix(CSS_COLOR.red, 12) : "transparent",
        color: isLive ? CSS_COLOR.red : CSS_COLOR.textMuted,
        fontFamily: T.sans,
        fontSize: textSize("caption"),
        fontWeight: FONT_WEIGHTS.medium,
        letterSpacing: "0.04em",
        cursor: pending ? "default" : "pointer",
        opacity: pending ? 0.5 : 1,
      }}
    >
      {mode || "SHADOW"}
    </button>
  );
};

const AlgoDeploymentTab = ({
  deployment,
  active,
  algoIsPhone,
  pnl,
  onSelect,
  onToggleMode,
  modeChangePending,
}) => {
  const accent = CSS_COLOR.accent;
  const dot = resolveStatusDot(deployment);
  const name =
    normalizeLegacyAlgoBrandText(deployment?.name || "") || "Deployment";
  // On phone, keep tabs to dot + name; reveal P&L + mode toggle only when active.
  const showDetail = !algoIsPhone || active;
  const pnlValue = pnl?.todayPnl;
  // Hide P&L when absent/unavailable (null or missing). Guard against null
  // first: Number(null) is 0 (finite), which would wrongly render "$0" for a
  // failed/absent computation. A genuine 0 still shows "$0".
  const hasPnl = pnlValue != null && Number.isFinite(Number(pnlValue));
  const pnlColor =
    Number(pnlValue) > 0
      ? CSS_COLOR.green
      : Number(pnlValue) < 0
        ? CSS_COLOR.red
        : CSS_COLOR.textSec;

  return (
    <div
      role="tab"
      tabIndex={0}
      aria-selected={active}
      data-testid={`algo-deployment-tab-${deployment.id}`}
      title={deployment?.name || name}
      onClick={() => onSelect?.(deployment.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect?.(deployment.id);
        }
      }}
      className="ra-interactive ra-touch-target"
      style={{
        ...motionVars({ accent }),
        display: "inline-flex",
        alignItems: "center",
        gap: sp(algoIsPhone ? 4 : 6),
        flexShrink: 0,
        maxWidth: dim(algoIsPhone ? 180 : 280),
        padding: sp(algoIsPhone ? "5px 8px" : "6px 12px"),
        borderBottom: `2px solid ${active ? accent : "transparent"}`,
        background: active ? cssColorMix(accent, 6) : "transparent",
        color: active ? CSS_COLOR.text : CSS_COLOR.textSec,
        fontFamily: T.sans,
        fontSize: fs(algoIsPhone ? 11 : 13),
        fontWeight: active ? FONT_WEIGHTS.medium : FONT_WEIGHTS.regular,
        cursor: "pointer",
        whiteSpace: "nowrap",
        transition:
          "background-color var(--ra-motion-standard) var(--ra-motion-ease), color var(--ra-motion-standard) var(--ra-motion-ease)",
      }}
    >
      <span
        role="img"
        aria-label={`Status: ${dot.label}`}
        style={{
          flexShrink: 0,
          width: dim(8),
          height: dim(8),
          borderRadius: dot.shape === "square" ? dim(1) : dim(RADII.pill),
          background: dot.shape === "ring" ? "transparent" : dot.color,
          border: dot.shape === "ring" ? `1.5px solid ${dot.color}` : "none",
          boxSizing: "border-box",
        }}
      />
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {name}
      </span>
      {showDetail && hasPnl ? (
        <span
          style={{
            flexShrink: 0,
            fontVariantNumeric: "tabular-nums",
            color: pnlColor,
          }}
        >
          {formatMoney(pnlValue, 0)}
        </span>
      ) : null}
      {showDetail ? (
        <ModeToggle
          deployment={deployment}
          pending={modeChangePending}
          onToggle={onToggleMode}
        />
      ) : null}
    </div>
  );
};

// Full-width tab row: one tab per algo deployment. Each deployment is a distinct
// algo the user names, so the tab label is the deployment NAME. Shadow/live is a
// MODE of the algo (mutable), shown as an in-tab toggle — not a separate tab.
//   pnlByDeploymentId  optional map id -> { todayPnl } (P&L hidden when absent).
//   onToggleMode       optional (deployment) => void; renders the mode toggle when provided.
//   onAddDeployment    optional; renders a "+" to create a deployment when provided.
export const AlgoDeploymentTabs = ({
  deployments = [],
  focusedDeploymentId = null,
  onSelectDeployment,
  algoIsPhone = false,
  pnlByDeploymentId = null,
  onToggleMode,
  modeChangePending = false,
  onAddDeployment,
  dataTestId = "algo-operations-deployment-tabs",
}) => {
  if (!deployments.length) return null;

  return (
    <div
      role="tablist"
      data-testid={dataTestId}
      data-active-deployment-id={focusedDeploymentId || ""}
      aria-label="Algo deployments"
      style={{
        display: "flex",
        alignItems: "stretch",
        gap: sp(algoIsPhone ? 2 : 4),
        width: "100%",
        overflowX: "auto",
        background: CSS_COLOR.bg0,
        borderBottom: `1px solid ${CSS_COLOR.border}`,
        ...HIDE_SCROLLBAR_STYLE,
      }}
    >
      {deployments.map((deployment) => (
        <AlgoDeploymentTab
          key={deployment.id}
          deployment={deployment}
          active={deployment.id === focusedDeploymentId}
          algoIsPhone={algoIsPhone}
          pnl={pnlByDeploymentId?.[deployment.id] ?? null}
          onSelect={onSelectDeployment}
          onToggleMode={onToggleMode}
          modeChangePending={modeChangePending}
        />
      ))}
      {onAddDeployment ? (
        <button
          type="button"
          data-testid="algo-operations-deployment-add"
          onClick={() => onAddDeployment()}
          aria-label="Create deployment"
          title="Create deployment"
          className="ra-interactive ra-touch-target"
          style={{
            flexShrink: 0,
            alignSelf: "center",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: dim(26),
            height: dim(26),
            marginLeft: sp(4),
            border: `1px solid ${CSS_COLOR.border}`,
            borderRadius: dim(RADII.pill),
            background: "transparent",
            color: CSS_COLOR.accent,
            fontSize: fs(15),
            lineHeight: 1,
            cursor: "pointer",
          }}
        >
          +
        </button>
      ) : null}
    </div>
  );
};
