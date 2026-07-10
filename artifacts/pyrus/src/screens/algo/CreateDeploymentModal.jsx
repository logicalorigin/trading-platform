import { useEffect, useRef, useState } from "react";
import {
  CSS_COLOR,
  ELEVATION,
  FONT_WEIGHTS,
  RADII,
  T,
  cssColorMix,
  dim,
  fs,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { Select } from "../../components/platform/primitives.jsx";
import { ALGO_DEPLOYMENT_KIND } from "./algoHelpers";

const OVERNIGHT_SESSIONS = [
  { value: "overnight", label: "Overnight" },
  { value: "overnight_plus_day", label: "Overnight + Day" },
];
const OVERNIGHT_TIMEFRAMES = ["5m", "15m", "1h"];

const fieldStyle = {
  width: "100%",
  background: CSS_COLOR.bg0,
  border: `1px solid ${CSS_COLOR.border}`,
  borderRadius: dim(RADII.sm),
  padding: sp("8px 10px"),
  color: CSS_COLOR.text,
  fontSize: fs(12),
  fontFamily: T.sans,
};

const labelStyle = {
  display: "block",
  marginBottom: sp(3),
  color: CSS_COLOR.textMuted,
  fontFamily: T.sans,
  fontSize: textSize("caption"),
  fontWeight: FONT_WEIGHTS.medium,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
};

const Field = ({ label, children }) => (
  <label style={{ display: "block" }}>
    <span style={labelStyle}>{label}</span>
    {children}
  </label>
);

// Create-deployment modal used by both the deployment tab-bar "+" and (later)
// other entry points. Supports two algo kinds: Options reuses the existing
// strategy-draft flow; Overnight constructs an overnight-spot SHADOW config.
// Type-specific fields are gathered here; the actual create call + guards live in
// AlgoScreen's handleCreateDeployment(kind, overnightFields), invoked via onCreate.
export const CreateDeploymentModal = ({
  open,
  onClose,
  candidateDrafts = [],
  selectedDraft = null,
  setSelectedDraftId,
  deploymentName,
  setDeploymentName,
  symbolUniverseInput,
  setSymbolUniverseInput,
  createPending = false,
  onCreate,
}) => {
  const [algoKind, setAlgoKind] = useState(ALGO_DEPLOYMENT_KIND.SIGNAL_OPTIONS);
  const [defaultOrderNotional, setDefaultOrderNotional] = useState("1000");
  const [maxOrderNotional, setMaxOrderNotional] = useState("2000");
  const [tradingSession, setTradingSession] = useState("overnight");
  const [signalTimeframe, setSignalTimeframe] = useState("15m");
  const dialogRef = useRef(null);
  const restoreFocusRef = useRef(null);

  const getFocusables = () => {
    const node = dialogRef.current;
    if (!node) return [];
    return Array.from(
      node.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => el instanceof HTMLElement && el.offsetParent !== null);
  };

  // Move focus into the dialog on open; restore to the trigger on close (WCAG).
  useEffect(() => {
    if (!open) return undefined;
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const initial = getFocusables();
    if (initial.length) initial[0].focus();
    else dialogRef.current?.focus();
    return () => restoreFocusRef.current?.focus?.();
  }, [open]);

  // Escape to close (unless pending); Tab/Shift+Tab trapped within the dialog.
  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !createPending) {
        onClose?.();
        return;
      }
      if (event.key !== "Tab") return;
      const items = getFocusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open, createPending]);

  if (!open) return null;

  const isOvernight = algoKind === ALGO_DEPLOYMENT_KIND.OVERNIGHT_SPOT;
  const kindTabs = [
    { kind: ALGO_DEPLOYMENT_KIND.SIGNAL_OPTIONS, label: "Options" },
    { kind: ALGO_DEPLOYMENT_KIND.OVERNIGHT_SPOT, label: "Overnight" },
  ];

  const handleSubmit = () => {
    onCreate?.(
      algoKind,
      isOvernight
        ? {
            defaultOrderNotional: Number(defaultOrderNotional),
            maxOrderNotional: Number(maxOrderNotional),
            tradingSession,
            signalTimeframe,
          }
        : null,
    );
  };

  return (
    <div
      data-testid="create-deployment-modal-backdrop"
      onClick={(event) => {
        if (!createPending && event.target === event.currentTarget) onClose?.();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 210,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: sp(16),
        background: cssColorMix(CSS_COLOR.bg0, 72),
      }}
    >
      <div
        ref={dialogRef}
        data-testid="create-deployment-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-deployment-modal-title"
        tabIndex={-1}
        style={{
          width: "min(100%, 460px)",
          background: CSS_COLOR.bg1,
          border: `1px solid ${cssColorMix(CSS_COLOR.accent, 33)}`,
          borderRadius: dim(RADII.md),
          boxShadow: ELEVATION.lg,
          padding: sp("20px 22px"),
          display: "flex",
          flexDirection: "column",
          gap: sp(14),
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: sp(4) }}>
          <span
            style={{
              fontSize: textSize("caption"),
              fontWeight: FONT_WEIGHTS.medium,
              color: CSS_COLOR.accent,
              fontFamily: T.sans,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            New deployment
          </span>
          <span
            id="create-deployment-modal-title"
            style={{
              fontSize: fs(20),
              fontWeight: FONT_WEIGHTS.label,
              color: CSS_COLOR.text,
              fontFamily: T.sans,
              lineHeight: 1.2,
            }}
          >
            Create algo deployment
          </span>
        </div>

        {/* Algo-kind picker */}
        <div
          role="tablist"
          aria-label="Algo type"
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: sp(6),
          }}
        >
          {kindTabs.map((tab) => {
            const active = tab.kind === algoKind;
            return (
              <button
                key={tab.kind}
                type="button"
                role="tab"
                id={`create-deployment-tab-${tab.kind}`}
                aria-selected={active}
                aria-controls="create-deployment-tabpanel"
                data-testid={`create-deployment-kind-${tab.kind}`}
                onClick={() => setAlgoKind(tab.kind)}
                className="ra-interactive ra-touch-target"
                style={{
                  padding: sp("8px 10px"),
                  border: `1px solid ${active ? CSS_COLOR.accent : CSS_COLOR.border}`,
                  borderRadius: dim(RADII.sm),
                  background: active
                    ? cssColorMix(CSS_COLOR.accent, 10)
                    : "transparent",
                  color: active ? CSS_COLOR.text : CSS_COLOR.textSec,
                  fontFamily: T.sans,
                  fontSize: fs(13),
                  fontWeight: active ? FONT_WEIGHTS.medium : FONT_WEIGHTS.regular,
                  cursor: "pointer",
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div
          role="tabpanel"
          id="create-deployment-tabpanel"
          aria-labelledby={`create-deployment-tab-${algoKind}`}
          style={{ display: "grid", gap: sp(10) }}
        >
          {!isOvernight ? (
            <Field label="Strategy draft">
              <Select
                selectProps={{ "data-testid": "create-deployment-draft" }}
                value={selectedDraft?.id || ""}
                onChange={(next) => setSelectedDraftId?.(next)}
                options={[
                  ...(candidateDrafts.length === 0
                    ? [
                        {
                          value: "",
                          label: "No strategy drafts — create one in Strategy first",
                        },
                      ]
                    : []),
                  ...candidateDrafts.map((draft) => ({
                    value: draft.id,
                    label: `${draft.name} · ${draft.mode} · ${draft.symbolUniverse.length} syms`,
                  })),
                ]}
                style={{ width: "100%" }}
              />
            </Field>
          ) : null}

          <Field label="Deployment name">
            <input
              data-testid="create-deployment-name"
              value={deploymentName}
              onChange={(event) => setDeploymentName?.(event.target.value)}
              placeholder={isOvernight ? "Overnight SPY/QQQ" : "Deployment name"}
              style={fieldStyle}
            />
          </Field>

          <Field label="Symbols">
            <input
              data-testid="create-deployment-symbols"
              value={symbolUniverseInput}
              onChange={(event) => setSymbolUniverseInput?.(event.target.value)}
              placeholder="SPY, QQQ, NVDA"
              style={fieldStyle}
            />
          </Field>

          {isOvernight ? (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: sp(10),
                }}
              >
                <Field label="Order notional ($)">
                  <input
                    data-testid="create-deployment-notional"
                    type="number"
                    min="1"
                    value={defaultOrderNotional}
                    onChange={(event) =>
                      setDefaultOrderNotional(event.target.value)
                    }
                    style={fieldStyle}
                  />
                </Field>
                <Field label="Max notional ($)">
                  <input
                    data-testid="create-deployment-max-notional"
                    type="number"
                    min="1"
                    value={maxOrderNotional}
                    onChange={(event) => setMaxOrderNotional(event.target.value)}
                    style={fieldStyle}
                  />
                </Field>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: sp(10),
                }}
              >
                <Field label="Session">
                  <Select
                    selectProps={{ "data-testid": "create-deployment-session" }}
                    value={tradingSession}
                    onChange={(next) => setTradingSession(next)}
                    options={OVERNIGHT_SESSIONS}
                    style={{ width: "100%" }}
                  />
                </Field>
                <Field label="Signal timeframe">
                  <Select
                    selectProps={{ "data-testid": "create-deployment-timeframe" }}
                    value={signalTimeframe}
                    onChange={(next) => setSignalTimeframe(next)}
                    options={OVERNIGHT_TIMEFRAMES}
                    style={{ width: "100%" }}
                  />
                </Field>
              </div>
              <span
                style={{
                  fontSize: fs(11),
                  color: CSS_COLOR.textMuted,
                  fontFamily: T.sans,
                  lineHeight: 1.5,
                }}
              >
                Created as a paused SHADOW deployment. Enable it from its tab to
                start the overnight worker; signals require the symbols and
                timeframe to be in the active signal-monitor watchlist.
              </span>
            </>
          ) : null}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: sp(10),
          }}
        >
          <Button
            variant="secondary"
            disabled={createPending}
            onClick={onClose}
            fullWidth
            style={{ borderRadius: dim(RADII.sm), padding: sp("12px 0") }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={createPending}
            disabled={createPending || (!isOvernight && !selectedDraft?.id)}
            onClick={handleSubmit}
            fullWidth
            dataTestId="create-deployment-submit"
            style={{ borderRadius: dim(RADII.sm), padding: sp("12px 0") }}
          >
            {createPending
              ? "Creating..."
              : isOvernight
                ? "Create Overnight"
                : "Create Options"}
          </Button>
        </div>
      </div>
    </div>
  );
};
