import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  CSS_COLOR,
  cssColorMix,
  dim,
  ELEVATION,
  FONT_WEIGHTS,
  fs,
  RADII,
  sp,
  T,
  textSize,
} from "../../lib/uiTokens.jsx";
import { Button } from "../../components/ui/Button.jsx";

// Editor for a position's protective stop, opened from the Stop cell icon or the
// row action menu's "Adjust". It places (or replaces) a real broker stop order
// via the onSubmit handler. Trailing stops are stubbed disabled: there is no
// write path or server-side ratchet for trail overlays on live positions yet
// (see positionTradeManagement.js — trail is read/display only), so exposing an
// editable trail here would imply a ratchet nothing enforces.

const optionMultiplier = (position) => {
  const contract = position?.optionContract;
  if (!contract) return 1;
  const value = Number(contract.multiplier) || Number(contract.sharesPerContract);
  return Number.isFinite(value) && value > 0 ? value : 100;
};

const maskText = "••••";

export const PositionProtectionEditor = ({
  position,
  management,
  mark,
  maskValues = false,
  canSubmit = true,
  disabledReason = null,
  accountId,
  onSubmit,
  onClose,
}) => {
  const open = Boolean(position);
  const dialogRef = useRef(null);
  const restoreFocusRef = useRef(null);

  const existingStop =
    management?.stop?.source === "broker" ? management.stop : management?.stop || null;
  const isLong = (position?.quantity ?? 0) >= 0;
  const exitSide = isLong ? "SELL" : "BUY";
  const multiplier = optionMultiplier(position);
  const quantity = Math.abs(Number(position?.quantity) || 0);

  // Seed the input with the live stop if one exists, else a sane protective
  // default (5% below mark for longs, 5% above for shorts) so the user starts
  // from a real level rather than a blank field.
  const seedStop = useMemo(() => {
    if (existingStop?.price != null) return Number(existingStop.price);
    if (Number.isFinite(mark) && mark > 0) {
      return Number((isLong ? mark * 0.95 : mark * 1.05).toFixed(2));
    }
    return null;
  }, [existingStop?.price, mark, isLong]);

  const [stopInput, setStopInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  // Reset local state each time the editor opens for a (different) position.
  useEffect(() => {
    if (!open) return;
    setStopInput(seedStop != null ? String(seedStop) : "");
    setPending(false);
    setError(null);
  }, [open, position?.id, seedStop]);

  const getFocusables = () => {
    const node = dialogRef.current;
    if (!node) return [];
    return Array.from(
      node.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => el instanceof HTMLElement && el.offsetParent !== null);
  };

  // Move focus into the dialog on open (onto the price input) and restore it to
  // the trigger on close. Keyed on `open` only so a mid-edit pending toggle
  // never bounces focus.
  useEffect(() => {
    if (!open) return undefined;
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = getFocusables();
    if (focusables.length) {
      focusables[0].focus();
    } else {
      dialogRef.current?.focus();
    }
    return () => {
      restoreFocusRef.current?.focus?.();
    };
  }, [open]);

  // Escape to cancel (unless pending); Tab/Shift+Tab trapped within the dialog.
  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !pending) {
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
  }, [onClose, open, pending]);

  if (!open) return null;

  const stopValue = Number(stopInput);
  const stopValid = Number.isFinite(stopValue) && stopValue > 0;
  // A protective stop must sit on the loss side of the mark: below for longs,
  // above for shorts. Wrong-side stops are hard-blocked before submission.
  const wrongSide =
    stopValid && Number.isFinite(mark) && mark > 0 && (isLong ? stopValue >= mark : stopValue <= mark);
  const wrongSideMessage = "Stop must be below mark for a long and above mark for a short.";

  const distancePct =
    stopValid && Number.isFinite(mark) && mark > 0
      ? ((isLong ? mark - stopValue : stopValue - mark) / mark) * 100
      : null;
  const riskAmount =
    stopValid && Number.isFinite(mark) && mark > 0
      ? Math.abs(mark - stopValue) * quantity * multiplier
      : null;

  const fmtPrice = (v) =>
    maskValues ? maskText : Number.isFinite(v) ? Number(v).toFixed(2) : "—";
  const fmtPct = (v) =>
    maskValues ? "••" : Number.isFinite(v) ? `${v.toFixed(1)}%` : "—";
  const fmtMoney = (v) =>
    maskValues ? maskText : Number.isFinite(v) ? `$${Math.abs(v).toFixed(2)}` : "—";

  const submitDisabled = pending || !canSubmit || !stopValid || wrongSide;

  const handleSubmit = async () => {
    if (submitDisabled) return;
    setError(null);
    setPending(true);
    try {
      await onSubmit?.(Number(stopValue.toFixed(2)));
      onClose?.();
    } catch (submitError) {
      setError(submitError?.message || "The stop order could not be submitted.");
      setPending(false);
    }
  };

  const tone = CSS_COLOR.amber;
  const replacing = existingStop?.source === "broker" && existingStop?.order?.id;

  const contextLines = [
    { label: "Account", value: maskValues ? maskText : accountId || "—" },
    { label: "Symbol", value: position?.symbol || "—" },
    { label: "Side", value: `${exitSide} to close` },
    { label: "Qty", value: maskValues ? maskText : String(quantity) },
    { label: "Mark", value: fmtPrice(mark) },
  ];

  return (
    <div
      data-testid="position-protection-editor-backdrop"
      onClick={(event) => {
        if (!pending && event.target === event.currentTarget) {
          onClose?.();
        }
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
        backdropFilter: "blur(8px)",
      }}
    >
      <div
        ref={dialogRef}
        data-testid="position-protection-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="position-protection-editor-title"
        tabIndex={-1}
        style={{
          width: "min(100%, 460px)",
          background: CSS_COLOR.bg1,
          border: `1px solid ${cssColorMix(tone, 33)}`,
          borderRadius: dim(RADII.md),
          boxShadow: ELEVATION.lg,
          padding: sp("20px 22px"),
          display: "flex",
          flexDirection: "column",
          gap: sp(14),
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: sp(6) }}>
          <span
            style={{
              fontSize: textSize("caption"),
              fontWeight: FONT_WEIGHTS.medium,
              color: tone,
              fontFamily: T.sans,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            Protective stop
          </span>
          <span
            id="position-protection-editor-title"
            style={{
              fontSize: fs(20),
              fontWeight: FONT_WEIGHTS.label,
              color: CSS_COLOR.text,
              fontFamily: T.sans,
              lineHeight: 1.2,
            }}
          >
            {position?.symbol || "Position"}
          </span>
          <span
            style={{
              fontSize: fs(13),
              color: CSS_COLOR.textSec,
              fontFamily: T.sans,
              lineHeight: 1.5,
            }}
          >
            {replacing
              ? "Replace the working broker stop order for this position."
              : "Place a protective broker stop order for this position."}
          </span>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) auto",
            gap: sp(8),
            padding: sp("12px 14px"),
            background: CSS_COLOR.bg0,
            border: `1px solid ${CSS_COLOR.borderLight}`,
            borderRadius: dim(RADII.sm),
            fontFamily: T.sans,
          }}
        >
          {contextLines.map((line) => (
            <Fragment key={line.label}>
              <span
                style={{
                  fontSize: textSize("caption"),
                  color: CSS_COLOR.textMuted,
                  letterSpacing: "0.04em",
                  fontWeight: FONT_WEIGHTS.medium,
                  textTransform: "uppercase",
                }}
              >
                {line.label}
              </span>
              <span
                style={{
                  fontSize: fs(11),
                  color: CSS_COLOR.text,
                  fontFamily: T.data,
                  fontVariantNumeric: "tabular-nums",
                  textAlign: "right",
                }}
              >
                {line.value}
              </span>
            </Fragment>
          ))}
        </div>

        <label style={{ display: "flex", flexDirection: "column", gap: sp(5) }}>
          <span
            style={{
              fontSize: textSize("caption"),
              color: CSS_COLOR.textMuted,
              letterSpacing: "0.04em",
              fontWeight: FONT_WEIGHTS.medium,
              textTransform: "uppercase",
            }}
          >
            Stop price
          </span>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={stopInput}
            onChange={(event) => setStopInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") handleSubmit();
            }}
            disabled={pending}
            data-testid="position-protection-editor-stop-input"
            style={{
              height: dim(36),
              padding: sp("0 12px"),
              border: `1px solid ${wrongSide ? cssColorMix(CSS_COLOR.red, 50) : CSS_COLOR.border}`,
              background: CSS_COLOR.bg0,
              borderRadius: dim(RADII.sm),
              color: CSS_COLOR.text,
              fontFamily: T.data,
              fontSize: fs(16),
              fontVariantNumeric: "tabular-nums",
              textAlign: "right",
            }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", gap: sp(8) }}>
            <span
              style={{
                fontSize: fs(11),
                color: wrongSide ? CSS_COLOR.red : CSS_COLOR.textMuted,
                fontFamily: T.sans,
              }}
            >
              {wrongSide
                ? wrongSideMessage
                : `Distance ${fmtPct(distancePct)} · Risk ${fmtMoney(riskAmount)}`}
            </span>
            {existingStop?.price != null ? (
              <span
                style={{
                  fontSize: fs(11),
                  color: CSS_COLOR.textMuted,
                  fontFamily: T.data,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                Current {fmtPrice(existingStop.price)}
              </span>
            ) : null}
          </div>
        </label>

        {/* Trailing stop — disabled stub. No live write/enforce path exists yet. */}
        <div
          aria-disabled="true"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: sp(4),
            padding: sp("10px 12px"),
            border: `1px dashed ${CSS_COLOR.border}`,
            borderRadius: dim(RADII.sm),
            opacity: 0.6,
          }}
        >
          <span
            style={{
              fontSize: textSize("caption"),
              color: CSS_COLOR.textMuted,
              letterSpacing: "0.04em",
              fontWeight: FONT_WEIGHTS.medium,
              textTransform: "uppercase",
            }}
          >
            Trailing stop
          </span>
          <span style={{ fontSize: fs(11), color: CSS_COLOR.textDim, fontFamily: T.sans }}>
            Trailing stops require the automation engine — coming separately.
          </span>
        </div>

        {error ? (
          <div
            data-testid="position-protection-editor-error"
            role="alert"
            style={{
              background: cssColorMix(CSS_COLOR.red, 7),
              border: `1px solid ${cssColorMix(CSS_COLOR.red, 27)}`,
              borderRadius: dim(RADII.sm),
              color: CSS_COLOR.red,
              fontSize: fs(12),
              fontFamily: T.sans,
              lineHeight: 1.5,
              padding: sp("10px 14px"),
            }}
          >
            {error}
          </div>
        ) : null}

        {!canSubmit && disabledReason ? (
          <div
            style={{
              fontSize: fs(12),
              color: CSS_COLOR.amber,
              fontFamily: T.sans,
              lineHeight: 1.5,
            }}
          >
            {disabledReason}
          </div>
        ) : (
          <div
            style={{
              fontSize: fs(12),
              color: CSS_COLOR.textMuted,
              fontFamily: T.sans,
              lineHeight: 1.5,
            }}
          >
            Sends a live broker stop instruction. Review the price before continuing.
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: sp(10) }}>
          <Button
            variant="secondary"
            disabled={pending}
            onClick={onClose}
            fullWidth
            style={{ borderRadius: dim(RADII.sm), padding: sp("12px 0") }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            color={tone}
            loading={pending}
            disabled={submitDisabled}
            onClick={handleSubmit}
            fullWidth
            data-testid="position-protection-editor-submit"
            style={{ borderRadius: dim(RADII.sm), padding: sp("12px 0") }}
          >
            {pending ? "Submitting..." : replacing ? "Replace stop" : "Set stop"}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default PositionProtectionEditor;
