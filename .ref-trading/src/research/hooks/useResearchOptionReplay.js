import { useMemo } from "react";
import {
  AUTO_STRIKE_SLOT_LABEL,
  clampStrikeSlot,
  formatStrikeSlotLabel,
} from "../options/strikeSelection.js";

function clampDte(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(60, Math.max(0, numeric));
}

function normalizeSelectionWindow(optionSelectionSpec = {}) {
  const hasMinDte = Number.isFinite(Number(optionSelectionSpec?.minDte));
  const hasMaxDte = Number.isFinite(Number(optionSelectionSpec?.maxDte));
  const hasTargetDte = Number.isFinite(Number(optionSelectionSpec?.targetDte));

  let minDte = hasMinDte ? clampDte(optionSelectionSpec?.minDte, 0) : null;
  let maxDte = hasMaxDte ? clampDte(optionSelectionSpec?.maxDte, 10) : null;

  if (minDte == null && maxDte == null && hasTargetDte) {
    const targetDte = clampDte(optionSelectionSpec?.targetDte, 5);
    minDte = targetDte;
    maxDte = targetDte;
  } else {
    if (minDte == null) {
      minDte = maxDte ?? 0;
    }
    if (maxDte == null) {
      maxDte = minDte ?? 10;
    }
  }

  return {
    minDte,
    maxDte: Math.max(minDte, maxDte),
  };
}

function normalizeSelectionSpec(optionSelectionSpec = {}) {
  const selectionWindow = normalizeSelectionWindow(optionSelectionSpec);
  const hasTargetDte = Number.isFinite(Number(optionSelectionSpec?.targetDte));
  const hasStrikeSlot = Number.isFinite(Number(optionSelectionSpec?.strikeSlot));
  const rawMoneyness = String(optionSelectionSpec?.moneyness || "").trim().toLowerCase();
  const hasLegacyMoneyness = ["itm", "atm", "otm"].includes(rawMoneyness);
  const hasLegacyStrikeSteps = Number.isFinite(Number(optionSelectionSpec?.strikeSteps));

  return {
    targetDte: hasTargetDte ? clampDte(optionSelectionSpec?.targetDte, 5) : null,
    minDte: selectionWindow.minDte,
    maxDte: selectionWindow.maxDte,
    strikeSlot: hasStrikeSlot ? clampStrikeSlot(optionSelectionSpec?.strikeSlot) : null,
    moneyness: hasLegacyMoneyness ? rawMoneyness : null,
    strikeSteps: hasLegacyStrikeSteps
      ? Math.min(25, Math.max(0, Math.round(Number(optionSelectionSpec?.strikeSteps))))
      : null,
  };
}

function formatLegacySelectionLabel({ moneyness, strikeSteps }) {
  const tone = String(moneyness || "").trim().toUpperCase();
  if (!tone) {
    return AUTO_STRIKE_SLOT_LABEL;
  }
  if (tone === "ATM") {
    return "ATM";
  }
  const steps = Number.isFinite(Number(strikeSteps)) ? Number(strikeSteps) : 1;
  return `${tone} ${steps} step${steps === 1 ? "" : "s"}`;
}

function formatSelectionLabel({ minDte, maxDte, strikeSlot, moneyness, strikeSteps }) {
  const dteLabel = minDte === maxDte ? `${minDte}D` : `${minDte}-${maxDte}D`;
  const strikeLabel = Number.isFinite(Number(strikeSlot))
    ? formatStrikeSlotLabel(strikeSlot)
    : (moneyness ? formatLegacySelectionLabel({ moneyness, strikeSteps }) : AUTO_STRIKE_SLOT_LABEL);
  return `${dteLabel} · ${strikeLabel}`;
}

export function useResearchOptionReplay({
  apiCreds = {},
  apiCredStatus = {},
  executionMode = "option_history",
  optionSelectionSpec = {},
} = {}) {
  void executionMode;
  const normalizedInputSpec = optionSelectionSpec && typeof optionSelectionSpec === "object"
    ? optionSelectionSpec
    : {};
  const selectionMinDte = normalizedInputSpec.minDte;
  const selectionMaxDte = normalizedInputSpec.maxDte;
  const selectionTargetDte = normalizedInputSpec.targetDte;
  const selectionStrikeSlot = normalizedInputSpec.strikeSlot;
  const selectionMoneyness = normalizedInputSpec.moneyness;
  const selectionStrikeSteps = normalizedInputSpec.strikeSteps;
  const replayApiKey = apiCreds.MASSIVE_API_KEY || apiCreds.POLYGON_API_KEY || "";
  const hasMassiveStatus = Boolean(apiCredStatus?.MASSIVE_API_KEY?.configured);
  const hasPolygonStatus = Boolean(apiCredStatus?.POLYGON_API_KEY?.configured);
  const replayCredentialsReady = Boolean(replayApiKey) || hasMassiveStatus || hasPolygonStatus;
  const replayCredentialSource = apiCreds.MASSIVE_API_KEY || hasMassiveStatus
    ? "Massive"
    : (apiCreds.POLYGON_API_KEY || hasPolygonStatus ? "Polygon" : null);

  const normalizedSelectionSpec = useMemo(
    () => normalizeSelectionSpec({
      minDte: selectionMinDte,
      maxDte: selectionMaxDte,
      targetDte: selectionTargetDte,
      strikeSlot: selectionStrikeSlot,
      moneyness: selectionMoneyness,
      strikeSteps: selectionStrikeSteps,
    }),
    [
      selectionMaxDte,
      selectionMinDte,
      selectionMoneyness,
      selectionStrikeSlot,
      selectionStrikeSteps,
      selectionTargetDte,
    ],
  );

  const optionRuntimeConfig = useMemo(() => (
    {
      executionMode: "option_history",
      replayApiKey,
      replayCredentialsReady,
      optionSelectionSpec: normalizedSelectionSpec,
    }
  ), [normalizedSelectionSpec, replayApiKey, replayCredentialsReady]);

  return {
    replayCredentialsReady,
    replayCredentialSource,
    optionRuntimeConfig,
    selectionSummaryLabel: formatSelectionLabel(normalizedSelectionSpec),
  };
}
