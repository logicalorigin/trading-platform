import React from "react";
import { AppTooltip } from "@/components/ui/tooltip";
import { Ban, CheckCircle2, Clock } from "lucide-react";
import { cssColorMix, dim, MISSING_VALUE, RADII } from "../../../lib/uiTokens.jsx";
import { SCORE_TRY } from "./thresholds.js";
import { verdictTooltip } from "./tooltips.js";
import { getTone } from "./tones.js";

const isReadyStatusMeta = (statusMeta) =>
  statusMeta?.tone === getTone("buy") ||
  /ready|filled|available/i.test(String(statusMeta?.label || ""));

export const resolveSignalVerdict = ({
  signal,
  signalRecord,
  blocker = MISSING_VALUE,
  statusMeta,
}) => {
  if (blocker !== MISSING_VALUE || signal?.status === "unavailable") {
    return {
      bucket: "pass",
      label: "Pass",
      reason:
        blocker !== MISSING_VALUE
          ? blocker
          : "signal unavailable",
      tone: getTone("sell"),
      Icon: Ban,
    };
  }

  // A closed/exited position is terminal — it should read "Closed", not fall
  // through to the generic "Wait" pill (statusPillMeta tags this lifecycle).
  if (statusMeta?.lifecycle === "closed") {
    return {
      bucket: "closed",
      label: statusMeta.label || "Closed",
      reason: statusMeta.label || "Position closed",
      tone: statusMeta.tone,
      Icon: CheckCircle2,
    };
  }

  const score = Number(signalRecord?.score ?? signal?.score);
  if (
    signal?.fresh === true &&
    Number.isFinite(score) &&
    score >= SCORE_TRY &&
    isReadyStatusMeta(statusMeta)
  ) {
    return {
      bucket: "try",
      label: "Try",
      reason: `fresh score ${score.toFixed(1)}`,
      tone: getTone("directionBuy"),
      Icon: CheckCircle2,
    };
  }

  return {
    bucket: "wait",
    label: "Wait",
    reason: statusMeta?.label || "awaiting confirmation",
    tone: getTone("warn"),
    Icon: Clock,
  };
};

export const VerdictGlyph = ({
  signal,
  signalRecord,
  blocker = MISSING_VALUE,
  statusMeta,
  size = 18,
}) => {
  const verdict = resolveSignalVerdict({
    signal,
    signalRecord,
    blocker,
    statusMeta,
  });
  const Icon = verdict.Icon;
  const blockerLabel = blocker !== MISSING_VALUE ? blocker : null;
  const detail =
    verdict.bucket === "try"
      ? "Fresh signal."
      : verdict.bucket === "pass" && blockerLabel
        ? null
        : verdict.reason;
  const label = verdictTooltip({
    verdict: verdict.label,
    score: signalRecord?.score ?? signal?.score,
    detail,
    blockers: blockerLabel,
  });

  return (
    <AppTooltip content={label}>
      <span
        data-testid={`algo-verdict-${verdict.bucket}`}
        className={[
          "ra-verdict-glyph",
          verdict.bucket ? `ra-verdict-glyph-${verdict.bucket}` : null,
        ]
          .filter(Boolean)
          .join(" ")}
        aria-label={label}
        style={{
          display: "inline-grid",
          placeItems: "center",
          width: dim(22),
          height: dim(22),
          borderRadius: dim(RADII.pill),
          border: `1px solid ${cssColorMix(verdict.tone, 33)}`,
          background: cssColorMix(verdict.tone, 10),
          color: verdict.tone,
          flex: "0 0 auto",
        }}
      >
        <Icon size={size} strokeWidth={1.9} aria-hidden="true" />
      </span>
    </AppTooltip>
  );
};

export default VerdictGlyph;
