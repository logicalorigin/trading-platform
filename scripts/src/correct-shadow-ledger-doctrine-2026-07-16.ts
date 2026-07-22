import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { pool } from "@workspace/db";
import type { PoolClient } from "pg";

import { recomputeAccountAndSnapshot } from "./correct-shadow-ledger-2026-07-15";

const CORRECTION_ID = "1c9b0e29-328e-48cf-bad2-b91528a1ce87";
const ACCOUNT_ID = "shadow";
const DEPLOYMENT_ID = "7e2e4e6f-749f-4e65-a011-87d3559a23b0";
const AUDIT_CUTOFF = "2026-07-16T20:00:00.000Z";
const MANIFEST_PATH =
  "docs/audits/shadow-trading-massive-replay-2026-07-16.json";
const EXPECTED_BASE_ACCOUNT = {
  cash: 155_229.4755,
  realizedPnl: 131_013.4755,
  fees: 5_442.08,
} as const;
const EXPECTED_FINAL_ACCOUNT = {
  cash: 135_249.3455,
  realizedPnl: 135_991.3455,
  fees: 5_347.21,
} as const;
const EXPECTED_MASSIVE_REPLAY_SHA256 =
  "b1736a4b940dd5b40dec7a67d8dd4f9e40b140d91d149ff6a2842eb9393565c6";
const EXPECTED_OPEN_CUTOFF_STOP_STATES_SHA256 =
  "7521bc8b2bba8cce7023e1091c422838d1c22fa7301d5cc4631f74eb526abc27";
const EXPECTED_REWRITE_TARGET_SHA256 =
  "40a58a541d60519710710d4c164690cde21abb9be5de16b4ea9aa087e488183a";
const EXPECTED_FULL_DOCUMENT_SHA256 =
  "cc5970225b372e78637d062010f8f0fbe3bfe5a06332e30cafb5b8949ecebe3d";
const EXPECTED_ALL31_ID_SHA256 =
  "3b6e4bd407ea0f762c5643750c997fb7def27b789e2bec67b861270830b6acc5";
const EXPECTED_EXIT11_ID_SHA256 =
  "91c4cc8a54236e7b070be43bbcca5d06f97eb79c21c96e2963fcf3e41a8eef23";
const EXPECTED_OPEN20_ID_SHA256 =
  "469ab3108323c60ccb9830a3c260d8dbb391cb71ca312baa3b4f455281284c5b";
const BMNG = {
  candidateId: "SIGOPT-7e2e4e6f-BMNG-sell-1783939500000",
  entryEventId: "1eee8c60-ce2c-4a34-bd72-054313265406",
  priorCorrectionId: "597497fa-825a-4a15-921b-b32cc4d699da",
  activeCounts: {
    signal_options_candidate_skipped: 26,
    signal_options_shadow_mark: 96,
    signal_options_shadow_exit: 1,
  },
  idHashes: {
    signal_options_candidate_skipped:
      "d139fb4c9c31f39727507390b6c0a7f05e652859c57a27bb2d5235cab553bc13",
    signal_options_shadow_mark:
      "8f57705f0d060e69cd5f6c8d86e6d47b71a4d90dbc8d308835b61cf1e7ec6d26",
    signal_options_shadow_exit:
      "1165d0ed5d703d714af3281a86ac0f9fa30d89fa504a04e5c2092c73f4a81950",
  },
} as const;

type Mode = "dry-run" | "apply";
type Quote = {
  identity: string;
  at: string;
  bid: number;
  ask: number;
  bidSize: number;
  askSize?: number;
};
type ExitReplay = {
  classification: "exit";
  symbol: string;
  ticker: string;
  entryEventId: string;
  buyOrderId: string;
  buyFillId: string;
  originalExitEventId: string;
  sellOrderId: string;
  sellFillId: string;
  entryAt: string;
  entryPrice: number;
  quantity: number;
  exitFee: number;
  reason: "early_invalidation" | "hard_stop" | "runner_trail_stop";
  source: "unconfirmed_policy" | "double_ask" | "double_last";
  electionAt: string;
  stopPrice: number;
  activeStopKind: "hard_stop" | "trailing_stop";
  peakBid: number;
  peakQuoteIdentity: string | null;
  evidence: unknown[] | null;
  decisionQuote: Quote;
  executionQuote: Quote;
  exitPrice: number;
  realizedPnl: number;
  [key: string]: unknown;
};
type OpenReplay = {
  classification: "open";
  symbol: string;
  ticker: string;
  entryEventId: string;
  buyOrderId: string;
  buyFillId: string;
  originalExitEventId: string;
  sellOrderId: string;
  sellFillId: string;
  entryAt: string;
  entryPrice: number;
  quantity: number;
  removedExitFee: number;
  peakBid: number;
  peakQuoteIdentity: string | null;
  cutoffQuote: Quote;
  markPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  markedNetAfterHypotheticalExitFee: number;
  [key: string]: unknown;
};
type ReplayPosition = ExitReplay | OpenReplay;
type LifecycleLink = {
  symbol: string;
  ticker: string;
  entryEventId: string;
  buyOrderId: string;
  buyFillId: string;
  originalExitEventId: string;
  originalSellOrderId: string;
  originalSellFillId: string;
  positionId: string;
  positionKey: string;
};
type AdditionalCorrection = {
  symbol: "DRAM" | "T";
  ticker: string;
  positionId: string;
  positionKey: string;
  entryEventId: string;
  buyOrderId: string;
  buyFillId: string;
  voidEventIds: string[];
  originalSellOrderId: string;
  originalSellFillId: string;
  entryPrice: number;
  quantity: number;
  electionAt: string;
  reason: "runner_trail_stop";
  source: "double_ask" | "double_last";
  stopPrice: number;
  peakBid: number;
  peakQuoteIdentity: string;
  evidence: string[];
  executionQuote: { identity: string; bidSize: number };
  exitBid: number;
};
type OpenCutoffStopState = {
  entryEventId: string;
  symbol: string;
  ticker: string;
  asOf: string;
  peakBid: number;
  peakQuoteIdentity: string | null;
  cutoffQuoteIdentity: string;
  physicalMarkPrice: number;
  stopInputMarkPrice: number;
  lastStop: {
    hardStopPrice: number;
    activeStopPrice: number;
    activeStopKind: "hard_stop" | "trailing_stop";
    trailActive: boolean;
    trailStopPrice: number | null;
    trailHasTakenOver: boolean;
    givebackPct: number;
    stopPrice: number;
    exitReason: null;
    premiumExitReason: "hard_stop" | null;
    returnPct: number;
    markReturnPct: number;
    barsSinceEntry: number;
    progressiveTrailStep: {
      activationPct: number;
      minLockedGainPct: number;
      givebackPct: number;
    } | null;
    scaleOutArmed: boolean;
    peakEvidenceSource: "executable_bid";
    enforcementSource: "ledger_correction_replay";
  };
};
type ApprovedOverride = {
  id: string;
  symbol: string;
  entryEventId: string;
  evidenceBid: number;
  approvedExitPrice: number;
  quantity: number;
  grossAndRealizedDeltaVsEvidenceBid: number;
  basis: string;
};
type AuditManifest = {
  schemaVersion: string;
  rewriteTargetSchemaVersion: string;
  openCutoffStopStatesSchemaVersion: string;
  cutoff: string;
  hashes: {
    canonicalPositionsSha256: string;
    all31IdRowsSha256: string;
    exit11IdRowsSha256: string;
    open20IdRowsSha256: string;
    openCutoffStopStatesCanonicalSha256: string;
    rewriteTargetCanonicalSha256: string;
    fullDocumentCanonicalSha256: string;
  };
  ledgerImpact: {
    originalEod31: LedgerEconomics;
    replacementExit11: LedgerEconomics;
    eodCorrectionDelta: { cash: number; realizedPnl: number; fees: number };
    dramTConservativeCorrectionDelta: {
      cash: number;
      realizedPnl: number;
      fees: number;
    };
    dramTApprovedCorrectionDelta: {
      cash: number;
      realizedPnl: number;
      fees: number;
    };
    open20Cutoff: {
      marketValue: number;
      physicalUnrealizedPnl: number;
      hypotheticalExitFees: number;
      netAfterHypotheticalExitFees: number;
    };
  };
  positions: ReplayPosition[];
  links: LifecycleLink[];
  openCutoffStopStates: OpenCutoffStopState[];
  additionalCorrections: AdditionalCorrection[];
  approvedOverrides: ApprovedOverride[];
};
type LedgerEconomics = {
  grossProceeds: number;
  fees: number;
  cashDelta: number;
  realizedPnl: number;
};
type SourceRows = {
  events: Map<string, SourceEvent>;
  orders: Map<string, SourceOrder>;
  fills: Map<string, SourceFill>;
  positions: Map<string, SourcePosition>;
  bmngEventIds: string[];
};
type SourceEvent = {
  id: string;
  event_type: string;
  symbol: string | null;
  occurred_at: Date;
  summary: string;
  payload: Record<string, unknown>;
};
type SourceOrder = {
  id: string;
  source_event_id: string | null;
  symbol: string;
  quantity: string;
  average_fill_price: string | null;
  fees: string;
  payload: Record<string, unknown>;
};
type SourceFill = {
  id: string;
  order_id: string;
  source_event_id: string | null;
  symbol: string;
  quantity: string;
  price: string;
  fees: string;
  realized_pnl: string;
  cash_delta: string;
};
type SourcePosition = {
  id: string;
  position_key: string;
  symbol: string;
  status: string;
  opened_at: Date;
  option_contract: Record<string, unknown> | null;
};

const manifestText = readFileSync(
  new URL(`../../${MANIFEST_PATH}`, import.meta.url),
  "utf8",
);
const manifest = JSON.parse(manifestText) as AuditManifest;

function mode(): Mode {
  const value = process.env.SHADOW_LEDGER_CORRECTION_MODE?.trim() || "dry-run";
  if (value !== "dry-run" && value !== "apply") {
    throw new Error("SHADOW_LEDGER_CORRECTION_MODE must be dry-run or apply.");
  }
  return value;
}

function finite(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Expected a finite number, got ${String(value)}.`);
  }
  return parsed;
}

function money(value: number): number {
  return Number(value.toFixed(2));
}

function equal(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}.`);
  }
}

function equalMoney(actual: unknown, expected: number, label: string): void {
  const parsed = finite(actual);
  if (Math.abs(parsed - expected) > 0.00001) {
    throw new Error(`${label}: expected ${expected}, got ${parsed}.`);
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function deepCanonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deepCanonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [
        key,
        deepCanonical((value as Record<string, unknown>)[key]),
      ]),
  );
}

function deepCanonicalSha256(value: unknown): string {
  return sha256(JSON.stringify(deepCanonical(value)));
}

function sortedByEntryEventId<T extends { entryEventId: string }>(items: T[]): T[] {
  return items.slice().sort((left, right) =>
    left.entryEventId.localeCompare(right.entryEventId),
  );
}

function deterministicUuid(domain: string): string {
  const bytes = createHash("sha256")
    .update(CORRECTION_ID)
    .update("\0")
    .update(domain)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function replayByEntryId(): Map<string, ReplayPosition> {
  return new Map(manifest.positions.map((item) => [item.entryEventId, item]));
}

function linkByEntryId(): Map<string, LifecycleLink> {
  return new Map(manifest.links.map((item) => [item.entryEventId, item]));
}

function openStopStateByEntryId(): Map<string, OpenCutoffStopState> {
  return new Map(
    manifest.openCutoffStopStates.map((item) => [item.entryEventId, item]),
  );
}

function approvedOverrideByEntryId(): Map<string, ApprovedOverride> {
  return new Map(
    manifest.approvedOverrides.map((item) => [item.entryEventId, item]),
  );
}

function approvedExitPrice(item: AdditionalCorrection): number {
  return (
    approvedOverrideByEntryId().get(item.entryEventId)?.approvedExitPrice ??
    item.exitBid
  );
}

function canonicalReplaySha256(): string {
  const canonical = JSON.stringify(
    manifest.positions
      .map((item) =>
        Object.fromEntries(
          Object.entries(item).sort(([left], [right]) =>
            left.localeCompare(right),
          ),
        ),
      )
      .sort((left, right) =>
        String(left.entryEventId).localeCompare(String(right.entryEventId)),
      ),
  );
  return sha256(canonical);
}

function openCutoffStopStatesSha256(): string {
  return deepCanonicalSha256(
    sortedByEntryEventId(manifest.openCutoffStopStates),
  );
}

function rewriteTargetSha256(): string {
  return deepCanonicalSha256({
    schemaVersion: manifest.rewriteTargetSchemaVersion,
    cutoff: manifest.cutoff,
    positions: sortedByEntryEventId(manifest.positions),
    links: sortedByEntryEventId(manifest.links),
    openCutoffStopStates: sortedByEntryEventId(
      manifest.openCutoffStopStates,
    ),
    additionalCorrections: sortedByEntryEventId(
      manifest.additionalCorrections,
    ),
    approvedOverrides: manifest.approvedOverrides
      .slice()
      .sort((left, right) => left.id.localeCompare(right.id)),
  });
}

function fullDocumentSha256(): string {
  const {
    fullDocumentCanonicalSha256: _fullDocumentCanonicalSha256,
    ...hashes
  } = manifest.hashes;
  return deepCanonicalSha256({ ...manifest, hashes });
}

function lifecycleIdLine(item: LifecycleLink): string {
  return [
    item.symbol,
    item.entryEventId,
    item.buyOrderId,
    item.buyFillId,
    item.originalExitEventId,
    item.originalSellOrderId,
    item.originalSellFillId,
    item.ticker,
  ].join("\t");
}

function lifecycleIdSha256(
  items: LifecycleLink[],
  legacyLeadingBlankLine: boolean,
): string {
  const body = items.map(lifecycleIdLine).sort().join("\n") + "\n";
  return sha256(`${legacyLeadingBlankLine ? "\n" : ""}${body}`);
}

function validatePlan() {
  equal(manifest.schemaVersion, "shadow-ledger-massive-replay-v1", "manifest schema");
  equal(
    manifest.rewriteTargetSchemaVersion,
    "shadow-ledger-doctrine-rewrite-v2",
    "rewrite target schema",
  );
  equal(
    manifest.openCutoffStopStatesSchemaVersion,
    "signal-options-cutoff-stop-state-v1",
    "open cutoff stop-state schema",
  );
  equal(manifest.cutoff, AUDIT_CUTOFF, "manifest cutoff");
  equal(manifest.positions.length, 31, "replay position count");
  equal(manifest.links.length, 31, "lifecycle link count");
  equal(manifest.openCutoffStopStates.length, 20, "cutoff stop-state count");
  equal(manifest.additionalCorrections.length, 2, "maintenance replay count");
  equal(manifest.approvedOverrides.length, 1, "approved override count");

  const positions = replayByEntryId();
  const links = linkByEntryId();
  const openStopStates = openStopStateByEntryId();
  const approvedOverrides = approvedOverrideByEntryId();
  equal(positions.size, 31, "unique replay entry IDs");
  equal(links.size, 31, "unique lifecycle entry IDs");
  equal(openStopStates.size, 20, "unique cutoff stop-state entry IDs");
  equal(approvedOverrides.size, 1, "unique approved-override entry IDs");
  for (const [entryEventId, replay] of positions) {
    const link = links.get(entryEventId);
    if (!link) throw new Error(`Missing lifecycle link for ${entryEventId}.`);
    for (const [label, actual, expected] of [
      ["symbol", replay.symbol, link.symbol],
      ["ticker", replay.ticker, link.ticker],
      ["buy order", replay.buyOrderId, link.buyOrderId],
      ["buy fill", replay.buyFillId, link.buyFillId],
      ["exit event", replay.originalExitEventId, link.originalExitEventId],
      ["sell order", replay.sellOrderId, link.originalSellOrderId],
      ["sell fill", replay.sellFillId, link.originalSellFillId],
    ] as const) {
      equal(actual, expected, `${replay.symbol} ${label}`);
    }
  }

  const exits = manifest.positions.filter(
    (item): item is ExitReplay => item.classification === "exit",
  );
  const opens = manifest.positions.filter(
    (item): item is OpenReplay => item.classification === "open",
  );
  const exitLinks = exits.map((item) => links.get(item.entryEventId)!);
  const openLinks = opens.map((item) => links.get(item.entryEventId)!);
  const runnerCount = exits.filter(
    (item) => item.reason === "runner_trail_stop",
  ).length;
  const hardStopCount = exits.filter((item) => item.reason === "hard_stop").length;
  const earlyInvalidationCount = exits.filter(
    (item) => item.reason === "early_invalidation",
  ).length;
  equal(exits.length, 11, "replacement exit count");
  equal(opens.length, 20, "reopened count");
  equal(runnerCount, 4, "runner exit count");
  equal(hardStopCount, 6, "hard-stop exit count");
  equal(earlyInvalidationCount, 1, "early invalidation count");
  equal(
    exits.filter((item) => Array.isArray(item.evidence)).length,
    10,
    "double-confirmed regular exit count",
  );

  for (const item of opens) {
    const stopState = openStopStates.get(item.entryEventId);
    if (!stopState) {
      throw new Error(`Missing cutoff stop state for ${item.symbol}.`);
    }
    equal(stopState.symbol, item.symbol, `${item.symbol} stop-state symbol`);
    equal(stopState.ticker, item.ticker, `${item.symbol} stop-state ticker`);
    equal(stopState.asOf, item.cutoffQuote.at, `${item.symbol} stop-state as-of`);
    equal(
      stopState.cutoffQuoteIdentity,
      item.cutoffQuote.identity,
      `${item.symbol} stop-state cutoff quote`,
    );
    equal(
      stopState.peakQuoteIdentity,
      item.peakQuoteIdentity,
      `${item.symbol} stop-state peak quote`,
    );
    equalMoney(stopState.peakBid, item.peakBid, `${item.symbol} stop-state peak`);
    equalMoney(
      stopState.physicalMarkPrice,
      item.markPrice,
      `${item.symbol} stop-state mark`,
    );
    equalMoney(
      stopState.lastStop.stopPrice,
      stopState.lastStop.activeStopPrice,
      `${item.symbol} active stop`,
    );
    equal(
      stopState.lastStop.peakEvidenceSource,
      "executable_bid",
      `${item.symbol} peak provenance`,
    );
    equal(
      stopState.lastStop.enforcementSource,
      "ledger_correction_replay",
      `${item.symbol} stop-state enforcement source`,
    );
    equal(stopState.lastStop.exitReason, null, `${item.symbol} unconfirmed exit`);
  }
  const openCutoffTrailingStopCount = manifest.openCutoffStopStates.filter(
    (item) => item.lastStop.activeStopKind === "trailing_stop",
  ).length;
  const openCutoffHardStopCount = manifest.openCutoffStopStates.filter(
    (item) => item.lastStop.activeStopKind === "hard_stop",
  ).length;
  equal(openCutoffTrailingStopCount, 6, "cutoff trailing-stop count");
  equal(openCutoffHardStopCount, 14, "cutoff hard-stop count");

  const dram = manifest.additionalCorrections.find(
    (item) => item.symbol === "DRAM",
  );
  if (!dram) throw new Error("Missing DRAM maintenance correction.");
  const dramOverride = approvedOverrides.get(dram.entryEventId);
  if (!dramOverride) throw new Error("Missing approved DRAM execution override.");
  equal(dramOverride.id, "dram-modeled-fill-v1", "DRAM override ID");
  equal(dramOverride.symbol, dram.symbol, "DRAM override symbol");
  equalMoney(dramOverride.evidenceBid, dram.exitBid, "DRAM evidence bid");
  equalMoney(dramOverride.approvedExitPrice, 5.61, "DRAM approved exit price");
  equalMoney(dramOverride.quantity, dram.quantity, "DRAM override quantity");
  equalMoney(
    money(
      (dramOverride.approvedExitPrice - dramOverride.evidenceBid) *
        dramOverride.quantity *
        100,
    ),
    dramOverride.grossAndRealizedDeltaVsEvidenceBid,
    "DRAM approved override delta",
  );

  const massiveReplaySha256 = canonicalReplaySha256();
  const cutoffStopStatesSha256 = openCutoffStopStatesSha256();
  const rewriteSha256 = rewriteTargetSha256();
  const documentSha256 = fullDocumentSha256();
  const all31IdSha256 = lifecycleIdSha256(manifest.links, true);
  const exit11IdSha256 = lifecycleIdSha256(exitLinks, false);
  const open20IdSha256 = lifecycleIdSha256(openLinks, true);
  equal(massiveReplaySha256, EXPECTED_MASSIVE_REPLAY_SHA256, "replay hash");
  equal(
    cutoffStopStatesSha256,
    EXPECTED_OPEN_CUTOFF_STOP_STATES_SHA256,
    "cutoff stop-state hash",
  );
  equal(rewriteSha256, EXPECTED_REWRITE_TARGET_SHA256, "rewrite target hash");
  equal(documentSha256, EXPECTED_FULL_DOCUMENT_SHA256, "full document hash");
  equal(
    manifest.hashes.canonicalPositionsSha256,
    EXPECTED_MASSIVE_REPLAY_SHA256,
    "embedded replay hash",
  );
  equal(
    manifest.hashes.openCutoffStopStatesCanonicalSha256,
    EXPECTED_OPEN_CUTOFF_STOP_STATES_SHA256,
    "embedded cutoff stop-state hash",
  );
  equal(
    manifest.hashes.rewriteTargetCanonicalSha256,
    EXPECTED_REWRITE_TARGET_SHA256,
    "embedded rewrite target hash",
  );
  equal(
    manifest.hashes.fullDocumentCanonicalSha256,
    EXPECTED_FULL_DOCUMENT_SHA256,
    "embedded full document hash",
  );
  equal(all31IdSha256, EXPECTED_ALL31_ID_SHA256, "all-31 ID hash");
  equal(exit11IdSha256, EXPECTED_EXIT11_ID_SHA256, "exit-11 ID hash");
  equal(open20IdSha256, EXPECTED_OPEN20_ID_SHA256, "open-20 ID hash");

  const replacementExit11 = exits.reduce<LedgerEconomics>(
    (totals, item) => {
      const grossProceeds = money(item.exitPrice * item.quantity * 100);
      const realizedPnl = money(
        (item.exitPrice - item.entryPrice) * item.quantity * 100 - item.exitFee,
      );
      equalMoney(realizedPnl, item.realizedPnl, `${item.symbol} replay P&L`);
      totals.grossProceeds = money(totals.grossProceeds + grossProceeds);
      totals.fees = money(totals.fees + item.exitFee);
      totals.cashDelta = money(totals.cashDelta + grossProceeds - item.exitFee);
      totals.realizedPnl = money(totals.realizedPnl + realizedPnl);
      return totals;
    },
    { grossProceeds: 0, fees: 0, cashDelta: 0, realizedPnl: 0 },
  );
  for (const [key, expected] of Object.entries({
    grossProceeds: 12_391,
    fees: 31.61,
    cashDelta: 12_359.39,
    realizedPnl: -1_446.61,
  })) {
    equalMoney(
      replacementExit11[key as keyof LedgerEconomics],
      expected,
      `replacement ${key}`,
    );
  }

  const openMarketValue = money(
    opens.reduce((total, item) => total + item.marketValue, 0),
  );
  const openUnrealizedPnl = money(
    opens.reduce((total, item) => total + item.unrealizedPnl, 0),
  );
  equalMoney(openMarketValue, 28_367, "open market value");
  equalMoney(openUnrealizedPnl, 3_409, "open physical unrealized P&L");

  const eodEconomics = {
    oldGross: manifest.ledgerImpact.originalEod31.grossProceeds,
    oldCash: manifest.ledgerImpact.originalEod31.cashDelta,
    oldRealizedPnl: manifest.ledgerImpact.originalEod31.realizedPnl,
    oldFees: manifest.ledgerImpact.originalEod31.fees,
    newGross: replacementExit11.grossProceeds,
    newCash: replacementExit11.cashDelta,
    newRealizedPnl: replacementExit11.realizedPnl,
    newFees: replacementExit11.fees,
    cashDelta: money(
      replacementExit11.cashDelta -
        manifest.ledgerImpact.originalEod31.cashDelta,
    ),
    realizedPnlDelta: money(
      replacementExit11.realizedPnl -
        manifest.ledgerImpact.originalEod31.realizedPnl,
    ),
    feesDelta: money(
      replacementExit11.fees - manifest.ledgerImpact.originalEod31.fees,
    ),
  };
  const maintenanceEconomics = {
    cashDelta: manifest.ledgerImpact.dramTApprovedCorrectionDelta.cash,
    realizedPnlDelta:
      manifest.ledgerImpact.dramTApprovedCorrectionDelta.realizedPnl,
    feesDelta: manifest.ledgerImpact.dramTApprovedCorrectionDelta.fees,
  };
  equalMoney(maintenanceEconomics.cashDelta, 638, "approved maintenance cash");
  equalMoney(
    maintenanceEconomics.realizedPnlDelta,
    638,
    "approved maintenance realized P&L",
  );
  equalMoney(maintenanceEconomics.feesDelta, 0, "approved maintenance fees");

  return {
    eodExitCount: manifest.positions.length,
    replacementExitCount: exits.length,
    reopenedCount: opens.length,
    maintenanceReplacementCount: manifest.additionalCorrections.length,
    runnerCount,
    hardStopCount,
    earlyInvalidationCount,
    massiveReplaySha256,
    openCutoffStopStateCount: manifest.openCutoffStopStates.length,
    openCutoffTrailingStopCount,
    openCutoffHardStopCount,
    openCutoffStopStatesSha256: cutoffStopStatesSha256,
    rewriteTargetSha256: rewriteSha256,
    fullDocumentSha256: documentSha256,
    all31IdSha256,
    exit11IdSha256,
    open20IdSha256,
    eodEconomics,
    maintenanceEconomics,
    expectedFinalAccount: { ...EXPECTED_FINAL_ACCOUNT },
    openMarketValue,
    openUnrealizedPnl,
  };
}

function correctionMetadata(
  correctedAt: Date,
  reason: string,
  previous?: unknown,
): Record<string, unknown> {
  return {
    id: CORRECTION_ID,
    status: "corrected",
    reason,
    correctedAt: correctedAt.toISOString(),
    source: "Massive historical option tape",
    manifestPath: MANIFEST_PATH,
    manifestSha256: EXPECTED_FULL_DOCUMENT_SHA256,
    rewriteTargetSha256: EXPECTED_REWRITE_TARGET_SHA256,
    replayPositionsSha256: EXPECTED_MASSIVE_REPLAY_SHA256,
    ...(previous === undefined ? {} : { previousLedgerCorrection: previous }),
  };
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function buildOpenRecoveryPayload(input: {
  orderPayload: Record<string, unknown>;
  item: Pick<
    OpenReplay,
    | "entryEventId"
    | "symbol"
    | "peakBid"
    | "peakQuoteIdentity"
    | "markPrice"
  > & { cutoffQuote: Pick<Quote, "at"> };
  stopState: Pick<OpenCutoffStopState, "asOf" | "stopInputMarkPrice"> & {
    lastStop: Record<string, unknown> & { stopPrice: number };
  };
  correctedAt: Date;
}): Record<string, unknown> {
  const position = readRecord(input.orderPayload.position);
  const previousCorrection = input.orderPayload.ledgerCorrection;
  return {
    ...input.orderPayload,
    position: {
      ...position,
      peakPrice: input.item.peakBid,
      stopPrice: input.stopState.lastStop.stopPrice,
      lastMarkPrice: input.item.markPrice,
      lastMarkedAt: input.stopState.asOf,
      lastStop: input.stopState.lastStop,
    },
    ledgerCorrection: {
      ...correctionMetadata(
        input.correctedAt,
        "doctrine_replay_open_recovery_state",
        previousCorrection,
      ),
      originalPositionRecoveryState: {
        peakPrice: position.peakPrice,
        stopPrice: position.stopPrice,
        lastMarkPrice: position.lastMarkPrice,
        lastMarkedAt: position.lastMarkedAt,
        lastStop: position.lastStop,
      },
      replay: {
        cutoff: AUDIT_CUTOFF,
        entryEventId: input.item.entryEventId,
        symbol: input.item.symbol,
        peakPrice: input.item.peakBid,
        peakQuoteIdentity: input.item.peakQuoteIdentity,
        cutoffMarkPrice: input.item.markPrice,
        cutoffMarkedAt: input.item.cutoffQuote.at,
        stopInputMarkPrice: input.stopState.stopInputMarkPrice,
        lastStop: input.stopState.lastStop,
      },
    },
  };
}

function quoteFromIdentity(value: string): Quote {
  const match = value.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z):([^:]+):([^:]+)$/,
  );
  if (!match) throw new Error(`Invalid quote identity: ${value}.`);
  return {
    identity: value,
    at: match[1]!,
    bid: finite(match[2]),
    ask: finite(match[3]),
    bidSize: 0,
  };
}

function exitEventAt(item: ExitReplay): string {
  return new Date(item.executionQuote.at).getTime() > new Date(item.electionAt).getTime()
    ? item.executionQuote.at
    : item.electionAt;
}

function replacementIds(domain: string) {
  return {
    eventId: deterministicUuid(`${domain}:event`),
    orderId: deterministicUuid(`${domain}:order`),
    fillId: deterministicUuid(`${domain}:fill`),
    positionId: deterministicUuid(`${domain}:position`),
  };
}

async function loadAndValidateSourceRows(client: PoolClient): Promise<SourceRows> {
  const plan = validatePlan();
  const eventIds = [
    ...manifest.links.flatMap((item) => [item.entryEventId, item.originalExitEventId]),
    ...manifest.additionalCorrections.flatMap((item) => [
      item.entryEventId,
      ...item.voidEventIds,
    ]),
    BMNG.entryEventId,
  ];
  const orderIds = [
    ...manifest.links.flatMap((item) => [item.buyOrderId, item.originalSellOrderId]),
    ...manifest.additionalCorrections.flatMap((item) => [
      item.buyOrderId,
      item.originalSellOrderId,
    ]),
  ];
  const fillIds = [
    ...manifest.links.flatMap((item) => [item.buyFillId, item.originalSellFillId]),
    ...manifest.additionalCorrections.flatMap((item) => [
      item.buyFillId,
      item.originalSellFillId,
    ]),
  ];
  const positionIds = [
    ...manifest.links.map((item) => item.positionId),
    ...manifest.additionalCorrections.map((item) => item.positionId),
  ];

  const accountResult = await client.query<{
    cash: string;
    realized_pnl: string;
    fees: string;
  }>(
    `select cash::text, realized_pnl::text, fees::text
       from shadow_accounts where id = $1 for update`,
    [ACCOUNT_ID],
  );
  equal(accountResult.rowCount, 1, "shadow account row count");
  equalMoney(accountResult.rows[0]!.cash, EXPECTED_BASE_ACCOUNT.cash, "base cash");
  equalMoney(
    accountResult.rows[0]!.realized_pnl,
    EXPECTED_BASE_ACCOUNT.realizedPnl,
    "base realized P&L",
  );
  equalMoney(accountResult.rows[0]!.fees, EXPECTED_BASE_ACCOUNT.fees, "base fees");

  const laterFills = await client.query<{ count: number }>(
    `select count(*)::int count
       from shadow_fills f
       join shadow_orders o on o.id = f.order_id
      where f.account_id = $1 and f.occurred_at > $2::timestamptz
        and lower(coalesce(o.payload->>'forwardTest', 'false')) <> 'true'
        and coalesce(o.client_order_id, '') not like 'shadow-equity-forward-%'`,
    [ACCOUNT_ID, AUDIT_CUTOFF],
  );
  equal(laterFills.rows[0]!.count, 0, "included fills after audit cutoff");

  const eventResult = await client.query<SourceEvent>(
    `select id::text, event_type, symbol, occurred_at, summary, payload
       from execution_events where id = any($1::uuid[]) for update`,
    [eventIds],
  );
  const orderResult = await client.query<SourceOrder>(
    `select id::text, source_event_id::text, symbol, quantity::text,
            average_fill_price::text, fees::text, payload
       from shadow_orders where id = any($1::uuid[]) for update`,
    [orderIds],
  );
  const fillResult = await client.query<SourceFill>(
    `select id::text, order_id::text, source_event_id::text, symbol,
            quantity::text, price::text, fees::text, realized_pnl::text,
            cash_delta::text
       from shadow_fills where id = any($1::uuid[]) for update`,
    [fillIds],
  );
  const positionResult = await client.query<SourcePosition>(
    `select id::text, position_key, symbol, status, opened_at, option_contract
       from shadow_positions where id = any($1::uuid[]) for update`,
    [positionIds],
  );
  equal(eventResult.rowCount, eventIds.length, "source event row count");
  equal(orderResult.rowCount, orderIds.length, "source order row count");
  equal(fillResult.rowCount, fillIds.length, "source fill row count");
  equal(positionResult.rowCount, positionIds.length, "source position row count");
  const events = new Map(eventResult.rows.map((row) => [row.id, row]));
  const orders = new Map(orderResult.rows.map((row) => [row.id, row]));
  const fills = new Map(fillResult.rows.map((row) => [row.id, row]));
  const positions = new Map(positionResult.rows.map((row) => [row.id, row]));

  for (const replay of manifest.positions) {
    const link = linkByEntryId().get(replay.entryEventId)!;
    const entryEvent = events.get(link.entryEventId)!;
    const exitEvent = events.get(link.originalExitEventId)!;
    const buyOrder = orders.get(link.buyOrderId)!;
    const sellOrder = orders.get(link.originalSellOrderId)!;
    const buyFill = fills.get(link.buyFillId)!;
    const sellFill = fills.get(link.originalSellFillId)!;
    const position = positions.get(link.positionId)!;
    equal(entryEvent.event_type, "signal_options_shadow_entry", `${link.symbol} entry type`);
    equal(exitEvent.event_type, "signal_options_shadow_exit", `${link.symbol} exit type`);
    equal(readRecord(exitEvent.payload).reason, "overnight_risk_exit", `${link.symbol} old exit reason`);
    equal(buyOrder.source_event_id, link.entryEventId, `${link.symbol} buy source event`);
    equal(sellOrder.source_event_id, link.originalExitEventId, `${link.symbol} sell source event`);
    equal(buyFill.order_id, link.buyOrderId, `${link.symbol} buy fill order`);
    equal(sellFill.order_id, link.originalSellOrderId, `${link.symbol} sell fill order`);
    equal(readRecord(sellOrder.payload).forwardTest, undefined, `${link.symbol} old sell inclusion`);
    if (replay.classification === "open") {
      equal(
        readRecord(buyOrder.payload).forwardTest,
        undefined,
        `${link.symbol} open buy inclusion`,
      );
      equal(
        readRecord(buyOrder.payload).ledgerCorrection,
        undefined,
        `${link.symbol} open buy prior correction`,
      );
    }
    equal(position.position_key, link.positionKey, `${link.symbol} position key`);
    equal(position.status, "closed", `${link.symbol} position status`);
    equal(readRecord(position.option_contract).ticker, link.ticker, `${link.symbol} position ticker`);
    equalMoney(buyFill.quantity, replay.quantity, `${link.symbol} buy quantity`);
    equalMoney(buyFill.price, replay.entryPrice, `${link.symbol} entry price`);
    equalMoney(sellFill.quantity, replay.quantity, `${link.symbol} old sell quantity`);
  }

  const oldEconomics = manifest.links.reduce<LedgerEconomics>(
    (totals, link) => {
      const fill = fills.get(link.originalSellFillId)!;
      const gross = money(finite(fill.price) * finite(fill.quantity) * 100);
      totals.grossProceeds = money(totals.grossProceeds + gross);
      totals.fees = money(totals.fees + finite(fill.fees));
      totals.cashDelta = money(totals.cashDelta + finite(fill.cash_delta));
      totals.realizedPnl = money(totals.realizedPnl + finite(fill.realized_pnl));
      return totals;
    },
    { grossProceeds: 0, fees: 0, cashDelta: 0, realizedPnl: 0 },
  );
  for (const [key, expected] of Object.entries({
    grossProceeds: plan.eodEconomics.oldGross,
    fees: plan.eodEconomics.oldFees,
    cashDelta: plan.eodEconomics.oldCash,
    realizedPnl: plan.eodEconomics.oldRealizedPnl,
  })) {
    equalMoney(oldEconomics[key as keyof LedgerEconomics], expected, `old EOD ${key}`);
  }

  for (const item of manifest.additionalCorrections) {
    const entryEvent = events.get(item.entryEventId)!;
    const buyOrder = orders.get(item.buyOrderId)!;
    const buyFill = fills.get(item.buyFillId)!;
    const sellOrder = orders.get(item.originalSellOrderId)!;
    const sellFill = fills.get(item.originalSellFillId)!;
    const position = positions.get(item.positionId)!;
    equal(entryEvent.event_type, "signal_options_shadow_entry", `${item.symbol} entry type`);
    equal(buyOrder.source_event_id, item.entryEventId, `${item.symbol} buy source event`);
    equal(buyFill.order_id, item.buyOrderId, `${item.symbol} buy fill order`);
    equal(sellOrder.source_event_id, null, `${item.symbol} maintenance sell source`);
    equal(sellFill.order_id, item.originalSellOrderId, `${item.symbol} maintenance fill order`);
    equal(readRecord(sellOrder.payload).forwardTest, undefined, `${item.symbol} old sell inclusion`);
    equal(position.position_key, item.positionKey, `${item.symbol} position key`);
    equal(position.status, "closed", `${item.symbol} position status`);
    equalMoney(buyFill.price, item.entryPrice, `${item.symbol} entry price`);
    equalMoney(buyFill.quantity, item.quantity, `${item.symbol} entry quantity`);
    for (const eventId of item.voidEventIds) {
      equal(events.get(eventId)!.event_type, "signal_options_shadow_exit", `${item.symbol} bad exit type`);
    }
  }
  const maintenanceCorrectionDelta = money(
    manifest.additionalCorrections.reduce((total, item) => {
      const sellFill = fills.get(item.originalSellFillId)!;
      return (
        total +
        (approvedExitPrice(item) - finite(sellFill.price)) *
          item.quantity *
          100
      );
    }, 0),
  );
  equalMoney(
    maintenanceCorrectionDelta,
    plan.maintenanceEconomics.cashDelta,
    "approved maintenance source-fill delta",
  );

  const bmngEntry = events.get(BMNG.entryEventId)!;
  equal(bmngEntry.event_type, "signal_options_shadow_entry_voided", "BMNG entry type");
  equal(
    readRecord(readRecord(bmngEntry.payload).ledgerCorrection).id,
    BMNG.priorCorrectionId,
    "BMNG prior correction",
  );
  const bmngResult = await client.query<{
    id: string;
    event_type: keyof typeof BMNG.activeCounts;
  }>(
    `select id::text, event_type
       from execution_events
      where (payload#>>'{position,candidateId}' = $1
          or payload#>>'{candidate,id}' = $1
          or payload->>'candidateId' = $1)
        and event_type = any($2::text[])
      order by id for update`,
    [BMNG.candidateId, Object.keys(BMNG.activeCounts)],
  );
  const bmngEventIds: string[] = [];
  for (const eventType of Object.keys(BMNG.activeCounts) as Array<
    keyof typeof BMNG.activeCounts
  >) {
    const ids = bmngResult.rows
      .filter((row) => row.event_type === eventType)
      .map((row) => row.id)
      .sort();
    equal(ids.length, BMNG.activeCounts[eventType], `BMNG ${eventType} count`);
    equal(sha256(ids.join(",")), BMNG.idHashes[eventType], `BMNG ${eventType} ID hash`);
    bmngEventIds.push(...ids);
  }
  equal(bmngEventIds.length, 123, "BMNG stale event total");

  return { events, orders, fills, positions, bmngEventIds };
}

async function voidEvents(
  client: PoolClient,
  eventIds: string[],
  correctedAt: Date,
  reason: string,
): Promise<void> {
  const result = await client.query(
    `update execution_events
        set event_type = event_type || '_voided',
            summary = '[VOIDED ' || $2 || '] ' || summary,
            payload = payload || jsonb_build_object(
              'ledgerCorrection', $3::jsonb || jsonb_build_object(
                'previousLedgerCorrection', payload->'ledgerCorrection',
                'originalEventType', event_type,
                'originalSummary', summary
              )
            ),
            updated_at = $4::timestamptz
      where id = any($1::uuid[])
        and event_type not like '%\\_voided' escape '\\'`,
    [
      eventIds,
      CORRECTION_ID,
      JSON.stringify(correctionMetadata(correctedAt, reason)),
      correctedAt.toISOString(),
    ],
  );
  equal(result.rowCount, eventIds.length, `${reason} voided event count`);
}

async function excludeOrders(
  client: PoolClient,
  orderIds: string[],
  correctedAt: Date,
  reason: string,
): Promise<void> {
  const result = await client.query(
    `update shadow_orders
        set payload = payload || jsonb_build_object(
              'forwardTest', true,
              'ledgerCorrection', $2::jsonb || jsonb_build_object(
                'previousLedgerCorrection', payload->'ledgerCorrection',
                'originalForwardTestPresent', payload ? 'forwardTest',
                'originalForwardTest', payload->'forwardTest'
              )
            ),
            updated_at = $3::timestamptz
      where id = any($1::uuid[])
        and lower(coalesce(payload->>'forwardTest', 'false')) <> 'true'`,
    [
      orderIds,
      JSON.stringify(correctionMetadata(correctedAt, reason)),
      correctedAt.toISOString(),
    ],
  );
  equal(result.rowCount, orderIds.length, `${reason} excluded order count`);
}

async function persistOpenRecoveryState(
  client: PoolClient,
  item: OpenReplay,
  stopState: OpenCutoffStopState,
  sourceRows: SourceRows,
  correctedAt: Date,
): Promise<void> {
  const link = linkByEntryId().get(item.entryEventId)!;
  const order = sourceRows.orders.get(link.buyOrderId)!;
  const payload = buildOpenRecoveryPayload({
    orderPayload: order.payload,
    item,
    stopState,
    correctedAt,
  });
  const result = await client.query(
    `update shadow_orders
        set payload = $2::jsonb,
            updated_at = $3::timestamptz
      where id = $1::uuid
        and source_event_id = $4::uuid
        and payload->'ledgerCorrection' is null
        and lower(coalesce(payload->>'forwardTest', 'false')) <> 'true'`,
    [
      link.buyOrderId,
      JSON.stringify(payload),
      correctedAt.toISOString(),
      item.entryEventId,
    ],
  );
  equal(result.rowCount, 1, `${item.symbol} open recovery payload update`);
}

async function tombstonePositions(
  client: PoolClient,
  correctedAt: Date,
): Promise<void> {
  for (const item of [...manifest.links, ...manifest.additionalCorrections]) {
    const result = await client.query(
      `update shadow_positions
          set position_key = 'shadow_equity_forward:ledger_correction:' || $2 || ':' || position_key,
              option_contract = coalesce(option_contract, '{}'::jsonb) ||
                jsonb_build_object('ledgerDoctrineCorrection', $3::jsonb),
              updated_at = $4::timestamptz
        where id = $1::uuid and position_key = $5 and status = 'closed'`,
      [
        item.positionId,
        CORRECTION_ID,
        JSON.stringify(
          correctionMetadata(
            correctedAt,
            "superseded_materialized_position",
            undefined,
          ),
        ),
        correctedAt.toISOString(),
        item.positionKey,
      ],
    );
    equal(result.rowCount, 1, `${item.symbol} position tombstone`);
  }
}

function replacementEventPayload(input: {
  entryPayload: Record<string, unknown>;
  symbol: string;
  quantity: number;
  entryPrice: number;
  exitPrice: number;
  eventAt: string;
  electionAt: string;
  reason: string;
  source: string;
  stopPrice: number;
  peakPrice: number;
  peakQuoteIdentity: string | null;
  evidence: unknown;
  executionQuote: Quote;
  correctedAt: Date;
}): Record<string, unknown> {
  const position = readRecord(input.entryPayload.position);
  const grossPnl = money(
    (input.exitPrice - input.entryPrice) * input.quantity * 100,
  );
  const quote = {
    ...input.executionQuote,
    mark: money((input.executionQuote.bid + input.executionQuote.ask) / 2),
    updatedAt: input.executionQuote.at,
    quoteUpdatedAt: input.executionQuote.at,
    dataUpdatedAt: input.executionQuote.at,
    marketDataMode: "historical",
    quoteFreshness: "historical_replay",
  };
  return {
    ...input.entryPayload,
    pnl: grossPnl,
    reason: input.reason,
    exitReason: input.reason,
    exitPrice: input.exitPrice,
    exitQuantity: input.quantity,
    occurredAt: input.eventAt,
    partial: false,
    mirrorRequired: true,
    fillQuoteSource: "massive_historical_replay",
    quote,
    position: {
      ...position,
      peakPrice: input.peakPrice,
      stopPrice: input.stopPrice,
      lastMarkPrice: input.exitPrice,
      lastMarkedAt: input.eventAt,
    },
    stopElection: {
      elected: input.reason !== "early_invalidation",
      source: input.source,
      evidence: input.evidence,
      electionAt: input.electionAt,
      stopPrice: input.stopPrice,
    },
    ledgerCorrection: {
      ...correctionMetadata(input.correctedAt, "doctrine_replay_replacement_exit"),
      replay: {
        electionAt: input.electionAt,
        source: input.source,
        stopPrice: input.stopPrice,
        peakPrice: input.peakPrice,
        peakQuoteIdentity: input.peakQuoteIdentity,
        evidence: input.evidence,
        executionQuote: input.executionQuote,
      },
    },
  };
}

async function insertReplacementExit(
  client: PoolClient,
  input: {
    domain: string;
    symbol: string;
    entryEventId: string;
    sourceExitEventId: string;
    sourceSellOrderId: string;
    sourceSellFillId: string;
    quantity: number;
    entryPrice: number;
    exitPrice: number;
    eventAt: string;
    electionAt: string;
    reason: string;
    source: string;
    stopPrice: number;
    peakPrice: number;
    peakQuoteIdentity: string | null;
    evidence: unknown;
    executionQuote: Quote;
  },
  sourceRows: SourceRows,
  correctedAt: Date,
): Promise<ReturnType<typeof replacementIds>> {
  const ids = replacementIds(input.domain);
  const entryEvent = sourceRows.events.get(input.entryEventId)!;
  const sourceFill = sourceRows.fills.get(input.sourceSellFillId)!;
  const exitFee = finite(sourceFill.fees);
  const grossAmount = money(input.exitPrice * input.quantity * 100);
  const realizedPnl = money(
    (input.exitPrice - input.entryPrice) * input.quantity * 100 - exitFee,
  );
  const cashDelta = money(grossAmount - exitFee);
  const payload = replacementEventPayload({
    entryPayload: entryEvent.payload,
    symbol: input.symbol,
    quantity: input.quantity,
    entryPrice: input.entryPrice,
    exitPrice: input.exitPrice,
    eventAt: input.eventAt,
    electionAt: input.electionAt,
    reason: input.reason,
    source: input.source,
    stopPrice: input.stopPrice,
    peakPrice: input.peakPrice,
    peakQuoteIdentity: input.peakQuoteIdentity,
    evidence: input.evidence,
    executionQuote: input.executionQuote,
    correctedAt,
  });
  const eventResult = await client.query(
    `insert into execution_events
       (id, deployment_id, provider_account_id, event_type, symbol, summary,
        payload, occurred_at, created_at, updated_at)
     values ($1, $2, $3, 'signal_options_shadow_exit', $4, $5, $6::jsonb,
             $7::timestamptz, $8::timestamptz, $8::timestamptz)`,
    [
      ids.eventId,
      DEPLOYMENT_ID,
      ACCOUNT_ID,
      input.symbol,
      `${input.symbol} doctrine replay exit ${input.reason} at ${input.exitPrice.toFixed(2)}`,
      JSON.stringify(payload),
      input.eventAt,
      correctedAt.toISOString(),
    ],
  );
  equal(eventResult.rowCount, 1, `${input.symbol} replacement event insert`);

  const orderResult = await client.query(
    `insert into shadow_orders
       (id, account_id, source, source_event_id, client_order_id, symbol,
        asset_class, position_type, side, type, time_in_force, status, quantity,
        filled_quantity, limit_price, stop_price, average_fill_price, fees,
        rejection_reason, option_contract, payload, placed_at, filled_at,
        created_at, updated_at)
     select $1::uuid, account_id, source, $2::uuid,
            'shadow-ledger-doctrine-exit-' || $2::text, symbol, asset_class,
            position_type, side, type, time_in_force, status, quantity,
            filled_quantity, $3::numeric, stop_price, $3::numeric, fees,
            rejection_reason, option_contract, $4::jsonb,
            $5::timestamptz, $5::timestamptz, $6::timestamptz, $6::timestamptz
       from shadow_orders where id = $7::uuid`,
    [
      ids.orderId,
      ids.eventId,
      input.exitPrice,
      JSON.stringify(payload),
      input.eventAt,
      correctedAt.toISOString(),
      input.sourceSellOrderId,
    ],
  );
  equal(orderResult.rowCount, 1, `${input.symbol} replacement order insert`);

  const fillResult = await client.query(
    `insert into shadow_fills
       (id, account_id, order_id, source_event_id, symbol, asset_class,
        position_type, side, quantity, price, gross_amount, fees, realized_pnl,
        cash_delta, option_contract, occurred_at, created_at, updated_at)
     select $1::uuid, account_id, $2::uuid, $3::uuid, symbol, asset_class,
            position_type, side, quantity, $4::numeric, $5::numeric, fees,
            $6::numeric, $7::numeric, option_contract, $8::timestamptz,
            $9::timestamptz, $9::timestamptz
       from shadow_fills where id = $10::uuid`,
    [
      ids.fillId,
      ids.orderId,
      ids.eventId,
      input.exitPrice,
      grossAmount,
      realizedPnl,
      cashDelta,
      input.eventAt,
      correctedAt.toISOString(),
      input.sourceSellFillId,
    ],
  );
  equal(fillResult.rowCount, 1, `${input.symbol} replacement fill insert`);
  return ids;
}

async function contractEconomics(
  client: PoolClient,
  ticker: string,
): Promise<{ realizedPnl: number; fees: number }> {
  const result = await client.query<{ realized_pnl: string; fees: string }>(
    `select coalesce(sum(f.realized_pnl), 0)::text realized_pnl,
            coalesce(sum(f.fees), 0)::text fees
       from shadow_fills f
       join shadow_orders o on o.id = f.order_id
      where f.account_id = $1
        and coalesce(f.option_contract->>'ticker', '') = $2
        and lower(coalesce(o.payload->>'forwardTest', 'false')) <> 'true'
        and coalesce(o.client_order_id, '') not like 'shadow-equity-forward-%'`,
    [ACCOUNT_ID, ticker],
  );
  return {
    realizedPnl: finite(result.rows[0]!.realized_pnl),
    fees: finite(result.rows[0]!.fees),
  };
}

async function insertReplacementPosition(
  client: PoolClient,
  input: {
    domain: string;
    link: { positionId: string; positionKey: string; ticker: string };
    quantity: number;
    entryPrice: number;
    markPrice: number;
    marketValue: number;
    unrealizedPnl: number;
    status: "open" | "closed";
    asOf: string;
    closedAt: string | null;
  },
  correctedAt: Date,
): Promise<string> {
  const newPositionId = replacementIds(input.domain).positionId;
  const economics = await contractEconomics(client, input.link.ticker);
  const result = await client.query(
    `insert into shadow_positions
       (id, account_id, position_key, symbol, asset_class, position_type,
        quantity, average_cost, mark, market_value, unrealized_pnl,
        realized_pnl, fees, option_contract, opened_at, closed_at, as_of,
        status, created_at, updated_at)
     select $1::uuid, account_id, $2, symbol, asset_class, position_type,
            $3::numeric, $4::numeric, $5::numeric, $6::numeric, $7::numeric,
            $8::numeric, $9::numeric,
            coalesce(option_contract, '{}'::jsonb) ||
              jsonb_build_object('ledgerDoctrineCorrection', $10::jsonb),
            opened_at, $11::timestamptz, $12::timestamptz, $13,
            $14::timestamptz, $14::timestamptz
       from shadow_positions where id = $15::uuid`,
    [
      newPositionId,
      input.link.positionKey,
      input.status === "open" ? input.quantity : 0,
      input.entryPrice,
      input.markPrice,
      input.marketValue,
      input.unrealizedPnl,
      economics.realizedPnl,
      economics.fees,
      JSON.stringify(
        correctionMetadata(
          correctedAt,
          input.status === "open"
            ? "doctrine_replay_open_at_cutoff"
            : "doctrine_replay_replacement_exit",
        ),
      ),
      input.closedAt,
      input.asOf,
      input.status,
      correctedAt.toISOString(),
      input.link.positionId,
    ],
  );
  equal(result.rowCount, 1, `${input.link.ticker} replacement position insert`);
  return newPositionId;
}

async function insertOpenMark(
  client: PoolClient,
  item: OpenReplay,
  stopState: OpenCutoffStopState,
  link: LifecycleLink,
  sourceRows: SourceRows,
  newPositionId: string,
  correctedAt: Date,
): Promise<void> {
  const eventId = deterministicUuid(`eod:${item.entryEventId}:mark`);
  const entryPayload = sourceRows.events.get(item.entryEventId)!.payload;
  const position = readRecord(entryPayload.position);
  const payload = {
    ...entryPayload,
    reason: "ledger_correction_replay_mark",
    markPrice: item.markPrice,
    quote: {
      ...item.cutoffQuote,
      mark: money((item.cutoffQuote.bid + item.cutoffQuote.ask) / 2),
      updatedAt: item.cutoffQuote.at,
      quoteUpdatedAt: item.cutoffQuote.at,
      dataUpdatedAt: item.cutoffQuote.at,
      marketDataMode: "historical",
      quoteFreshness: "historical_replay",
    },
    position: {
      ...position,
      peakPrice: item.peakBid,
      stopPrice: stopState.lastStop.stopPrice,
      lastMarkPrice: item.markPrice,
      lastMarkedAt: item.cutoffQuote.at,
      lastStop: stopState.lastStop,
    },
    ledgerCorrection: {
      ...correctionMetadata(correctedAt, "doctrine_replay_open_at_cutoff"),
      replay: {
        cutoff: AUDIT_CUTOFF,
        peakPrice: item.peakBid,
        peakQuoteIdentity: item.peakQuoteIdentity,
        cutoffQuote: item.cutoffQuote,
        stopInputMarkPrice: stopState.stopInputMarkPrice,
        lastStop: stopState.lastStop,
      },
    },
  };
  const eventResult = await client.query(
    `insert into execution_events
       (id, deployment_id, provider_account_id, event_type, symbol, summary,
        payload, occurred_at, created_at, updated_at)
     values ($1, $2, $3, 'signal_options_shadow_mark', $4, $5, $6::jsonb,
             $7::timestamptz, $8::timestamptz, $8::timestamptz)`,
    [
      eventId,
      DEPLOYMENT_ID,
      ACCOUNT_ID,
      item.symbol,
      `${item.symbol} doctrine replay mark ${item.markPrice.toFixed(2)} at cutoff`,
      JSON.stringify(payload),
      item.cutoffQuote.at,
      correctedAt.toISOString(),
    ],
  );
  equal(eventResult.rowCount, 1, `${item.symbol} replay mark event insert`);
  const peakMarkId = deterministicUuid(
    `eod:${item.entryEventId}:peak-mark`,
  );
  const peakMarkedAt = item.peakQuoteIdentity
    ? quoteFromIdentity(item.peakQuoteIdentity).at
    : item.entryAt;
  const peakMarketValue = money(item.peakBid * item.quantity * 100);
  const peakUnrealizedPnl = money(
    (item.peakBid - item.entryPrice) * item.quantity * 100,
  );
  const peakMarkResult = await client.query(
    `insert into shadow_position_marks
       (id, account_id, position_id, mark, market_value, unrealized_pnl,
        source, as_of, created_at, updated_at)
     values ($1::uuid, $2, $3::uuid, $4, $5, $6,
             'ledger_correction_executable_bid', $7::timestamptz,
             $8::timestamptz, $8::timestamptz)`,
    [
      peakMarkId,
      ACCOUNT_ID,
      newPositionId,
      item.peakBid,
      peakMarketValue,
      peakUnrealizedPnl,
      peakMarkedAt,
      correctedAt.toISOString(),
    ],
  );
  equal(
    peakMarkResult.rowCount,
    1,
    `${link.symbol} physical executable-bid peak insert`,
  );
  const cutoffMarkResult = await client.query(
    `insert into shadow_position_marks
       (id, account_id, position_id, mark, market_value, unrealized_pnl,
        source, as_of, created_at, updated_at)
     values ($1::uuid, $2, $3::uuid, $4, $5, $6,
             'ledger_correction_cutoff_bid', $7::timestamptz,
             $8::timestamptz, $8::timestamptz)`,
    [
      eventId,
      ACCOUNT_ID,
      newPositionId,
      item.markPrice,
      item.marketValue,
      item.unrealizedPnl,
      item.cutoffQuote.at,
      correctedAt.toISOString(),
    ],
  );
  equal(
    cutoffMarkResult.rowCount,
    1,
    `${link.symbol} physical replay cutoff mark insert`,
  );
}

async function applyReplay(
  client: PoolClient,
  sourceRows: SourceRows,
  correctedAt: Date,
): Promise<void> {
  await voidEvents(
    client,
    manifest.links.map((item) => item.originalExitEventId),
    correctedAt,
    "invalid_blanket_eod_floor",
  );
  await voidEvents(
    client,
    manifest.additionalCorrections.flatMap((item) => item.voidEventIds),
    correctedAt,
    "invalid_maintenance_stop_bypass",
  );
  await voidEvents(
    client,
    sourceRows.bmngEventIds,
    correctedAt,
    "stale_voided_bmng_lifecycle_residue",
  );
  await excludeOrders(
    client,
    manifest.links.map((item) => item.originalSellOrderId),
    correctedAt,
    "invalid_blanket_eod_floor",
  );
  await excludeOrders(
    client,
    manifest.additionalCorrections.map((item) => item.originalSellOrderId),
    correctedAt,
    "invalid_maintenance_stop_bypass",
  );
  await tombstonePositions(client, correctedAt);

  const links = linkByEntryId();
  const openStopStates = openStopStateByEntryId();
  for (const item of manifest.positions) {
    const link = links.get(item.entryEventId)!;
    const domain = `eod:${item.entryEventId}`;
    if (item.classification === "exit") {
      const eventAt = exitEventAt(item);
      await insertReplacementExit(
        client,
        {
          domain,
          symbol: item.symbol,
          entryEventId: item.entryEventId,
          sourceExitEventId: item.originalExitEventId,
          sourceSellOrderId: link.originalSellOrderId,
          sourceSellFillId: link.originalSellFillId,
          quantity: item.quantity,
          entryPrice: item.entryPrice,
          exitPrice: item.exitPrice,
          eventAt,
          electionAt: item.electionAt,
          reason: item.reason,
          source: item.source,
          stopPrice: item.stopPrice,
          peakPrice: item.peakBid,
          peakQuoteIdentity: item.peakQuoteIdentity,
          evidence: item.evidence,
          executionQuote: item.executionQuote,
        },
        sourceRows,
        correctedAt,
      );
      await insertReplacementPosition(
        client,
        {
          domain,
          link,
          quantity: item.quantity,
          entryPrice: item.entryPrice,
          markPrice: item.exitPrice,
          marketValue: 0,
          unrealizedPnl: 0,
          status: "closed",
          asOf: eventAt,
          closedAt: eventAt,
        },
        correctedAt,
      );
      continue;
    }
    const stopState = openStopStates.get(item.entryEventId)!;
    await persistOpenRecoveryState(
      client,
      item,
      stopState,
      sourceRows,
      correctedAt,
    );
    const newPositionId = await insertReplacementPosition(
      client,
      {
        domain,
        link,
        quantity: item.quantity,
        entryPrice: item.entryPrice,
        markPrice: item.markPrice,
        marketValue: item.marketValue,
        unrealizedPnl: item.unrealizedPnl,
        status: "open",
        asOf: item.cutoffQuote.at,
        closedAt: null,
      },
      correctedAt,
    );
    await insertOpenMark(
      client,
      item,
      stopState,
      link,
      sourceRows,
      newPositionId,
      correctedAt,
    );
  }

  for (const item of manifest.additionalCorrections) {
    const domain = `maintenance:${item.entryEventId}`;
    const executionQuote = quoteFromIdentity(item.executionQuote.identity);
    executionQuote.bidSize = item.executionQuote.bidSize;
    const exitPrice = approvedExitPrice(item);
    await insertReplacementExit(
      client,
      {
        domain,
        symbol: item.symbol,
        entryEventId: item.entryEventId,
        sourceExitEventId: item.voidEventIds[0]!,
        sourceSellOrderId: item.originalSellOrderId,
        sourceSellFillId: item.originalSellFillId,
        quantity: item.quantity,
        entryPrice: item.entryPrice,
        exitPrice,
        eventAt: item.electionAt,
        electionAt: item.electionAt,
        reason: item.reason,
        source: item.source,
        stopPrice: item.stopPrice,
        peakPrice: item.peakBid,
        peakQuoteIdentity: item.peakQuoteIdentity,
        evidence: item.evidence,
        executionQuote,
      },
      sourceRows,
      correctedAt,
    );
    await insertReplacementPosition(
      client,
      {
        domain,
        link: item,
        quantity: item.quantity,
        entryPrice: item.entryPrice,
        markPrice: exitPrice,
        marketValue: 0,
        unrealizedPnl: 0,
        status: "closed",
        asOf: item.electionAt,
        closedAt: item.electionAt,
      },
      correctedAt,
    );
  }
}

async function stateDigest(
  client: PoolClient,
  bmngEventIds: string[],
  correctedAt: Date,
): Promise<string> {
  const oldEventIds = [
    ...manifest.links.flatMap((item) => [item.entryEventId, item.originalExitEventId]),
    ...manifest.additionalCorrections.flatMap((item) => [
      item.entryEventId,
      ...item.voidEventIds,
    ]),
    ...bmngEventIds,
    CORRECTION_ID,
  ];
  const newEventIds = [
    ...manifest.positions
      .filter((item): item is ExitReplay => item.classification === "exit")
      .map((item) => replacementIds(`eod:${item.entryEventId}`).eventId),
    ...manifest.positions
      .filter((item): item is OpenReplay => item.classification === "open")
      .map((item) => deterministicUuid(`eod:${item.entryEventId}:mark`)),
    ...manifest.additionalCorrections.map((item) =>
      replacementIds(`maintenance:${item.entryEventId}`).eventId,
    ),
  ];
  const orderIds = [
    ...manifest.links.map((item) => item.originalSellOrderId),
    ...manifest.positions
      .filter((item): item is OpenReplay => item.classification === "open")
      .map((item) => item.buyOrderId),
    ...manifest.additionalCorrections.map((item) => item.originalSellOrderId),
    ...manifest.positions
      .filter((item): item is ExitReplay => item.classification === "exit")
      .map((item) => replacementIds(`eod:${item.entryEventId}`).orderId),
    ...manifest.additionalCorrections.map((item) =>
      replacementIds(`maintenance:${item.entryEventId}`).orderId,
    ),
  ];
  const fillIds = [
    ...manifest.links.map((item) => item.originalSellFillId),
    ...manifest.additionalCorrections.map((item) => item.originalSellFillId),
    ...manifest.positions
      .filter((item): item is ExitReplay => item.classification === "exit")
      .map((item) => replacementIds(`eod:${item.entryEventId}`).fillId),
    ...manifest.additionalCorrections.map((item) =>
      replacementIds(`maintenance:${item.entryEventId}`).fillId,
    ),
  ];
  const positionIds = [
    ...manifest.links.flatMap((item) => [
      item.positionId,
      replacementIds(`eod:${item.entryEventId}`).positionId,
    ]),
    ...manifest.additionalCorrections.flatMap((item) => [
      item.positionId,
      replacementIds(`maintenance:${item.entryEventId}`).positionId,
    ]),
  ];
  const physicalMarkIds = manifest.positions
    .filter((item): item is OpenReplay => item.classification === "open")
    .flatMap((item) => [
      deterministicUuid(`eod:${item.entryEventId}:mark`),
      deterministicUuid(`eod:${item.entryEventId}:peak-mark`),
    ]);
  const account = await client.query(
        `select id, cash::text, realized_pnl::text, fees::text, updated_at
           from shadow_accounts where id = $1`,
        [ACCOUNT_ID],
      );
  const events = await client.query(
        `select id::text, event_type, symbol, occurred_at, summary, payload
           from execution_events where id = any($1::uuid[]) order by id`,
        [[...oldEventIds, ...newEventIds]],
      );
  const orders = await client.query(
        `select id::text, source_event_id::text, client_order_id, status,
                quantity::text, average_fill_price::text, fees::text, payload
           from shadow_orders where id = any($1::uuid[]) order by id`,
        [orderIds],
      );
  const fills = await client.query(
        `select id::text, order_id::text, source_event_id::text, quantity::text,
                price::text, fees::text, realized_pnl::text, cash_delta::text
           from shadow_fills where id = any($1::uuid[]) order by id`,
        [fillIds],
      );
  const positions = await client.query(
        `select id::text, position_key, quantity::text, average_cost::text,
                mark::text, market_value::text, unrealized_pnl::text,
                realized_pnl::text, fees::text, opened_at, closed_at, as_of,
                status, option_contract
           from shadow_positions where id = any($1::uuid[]) order by id`,
        [positionIds],
      );
  const marks = await client.query(
        `select id::text, position_id::text, mark::text, market_value::text,
                unrealized_pnl::text, source, as_of
          from shadow_position_marks
          where id = any($1::uuid[]) order by id`,
        [physicalMarkIds],
      );
  const snapshots = await client.query(
        `select count(*)::int count, max(as_of) max_as_of
           from shadow_balance_snapshots
          where source = 'ledger_correction' and as_of = $1::timestamptz`,
        [correctedAt.toISOString()],
      );
  return sha256(
    JSON.stringify({
      account: account.rows,
      events: events.rows,
      orders: orders.rows,
      fills: fills.rows,
      positions: positions.rows,
      marks: marks.rows,
      snapshots: snapshots.rows,
    }),
  );
}

async function verifyOpenRecoveryRows(client: PoolClient): Promise<void> {
  const opens = manifest.positions.filter(
    (item): item is OpenReplay => item.classification === "open",
  );
  const stopStates = openStopStateByEntryId();
  const orders = await client.query<{
    id: string;
    payload: Record<string, unknown>;
  }>(
    `select id::text, payload
       from shadow_orders
      where id = any($1::uuid[])
      order by id`,
    [opens.map((item) => item.buyOrderId)],
  );
  const events = await client.query<{
    id: string;
    payload: Record<string, unknown>;
  }>(
    `select id::text, payload
       from execution_events
      where id = any($1::uuid[])
      order by id`,
    [
      opens.map((item) =>
        deterministicUuid(`eod:${item.entryEventId}:mark`),
      ),
    ],
  );
  const marks = await client.query<{
    id: string;
    position_id: string;
    mark: string;
    source: string;
    as_of: Date;
  }>(
    `select id::text, position_id::text, mark::text, source, as_of
       from shadow_position_marks
      where id = any($1::uuid[])
      order by id`,
    [
      opens.flatMap((item) => [
        deterministicUuid(`eod:${item.entryEventId}:mark`),
        deterministicUuid(`eod:${item.entryEventId}:peak-mark`),
      ]),
    ],
  );
  equal(orders.rowCount, 20, "open recovery order verification count");
  equal(events.rowCount, 20, "open recovery event verification count");
  equal(marks.rowCount, 40, "open recovery mark verification count");
  const ordersById = new Map(orders.rows.map((row) => [row.id, row]));
  const eventsById = new Map(events.rows.map((row) => [row.id, row]));
  const marksById = new Map(marks.rows.map((row) => [row.id, row]));

  for (const item of opens) {
    const stopState = stopStates.get(item.entryEventId)!;
    const expectedStop = JSON.stringify(deepCanonical(stopState.lastStop));
    const verifyPosition = (
      payload: Record<string, unknown>,
      label: string,
    ) => {
      const position = readRecord(payload.position);
      equalMoney(position.peakPrice, item.peakBid, `${item.symbol} ${label} peak`);
      equalMoney(
        position.stopPrice,
        stopState.lastStop.stopPrice,
        `${item.symbol} ${label} stop`,
      );
      equalMoney(
        position.lastMarkPrice,
        item.markPrice,
        `${item.symbol} ${label} last mark`,
      );
      equal(
        position.lastMarkedAt,
        stopState.asOf,
        `${item.symbol} ${label} last marked at`,
      );
      equal(
        JSON.stringify(deepCanonical(position.lastStop)),
        expectedStop,
        `${item.symbol} ${label} last stop`,
      );
    };

    const order = ordersById.get(item.buyOrderId)!;
    verifyPosition(order.payload, "buy payload");
    const orderCorrection = readRecord(order.payload.ledgerCorrection);
    equal(orderCorrection.id, CORRECTION_ID, `${item.symbol} buy correction ID`);
    equal(
      orderCorrection.manifestSha256,
      EXPECTED_FULL_DOCUMENT_SHA256,
      `${item.symbol} buy manifest hash`,
    );
    equal(
      order.payload.forwardTest,
      undefined,
      `${item.symbol} corrected buy inclusion`,
    );

    const cutoffEventId = deterministicUuid(`eod:${item.entryEventId}:mark`);
    const peakMarkId = deterministicUuid(
      `eod:${item.entryEventId}:peak-mark`,
    );
    verifyPosition(
      eventsById.get(cutoffEventId)!.payload,
      "cutoff event",
    );
    const newPositionId = replacementIds(
      `eod:${item.entryEventId}`,
    ).positionId;
    const peakMark = marksById.get(peakMarkId)!;
    equal(
      peakMark.position_id,
      newPositionId,
      `${item.symbol} peak mark position`,
    );
    equal(
      peakMark.source,
      "ledger_correction_executable_bid",
      `${item.symbol} peak mark source`,
    );
    equalMoney(peakMark.mark, item.peakBid, `${item.symbol} physical peak`);
    equal(
      peakMark.as_of.toISOString(),
      item.peakQuoteIdentity
        ? quoteFromIdentity(item.peakQuoteIdentity).at
        : item.entryAt,
      `${item.symbol} peak marked at`,
    );
    const cutoffMark = marksById.get(cutoffEventId)!;
    equal(
      cutoffMark.position_id,
      newPositionId,
      `${item.symbol} cutoff mark position`,
    );
    equal(
      cutoffMark.source,
      "ledger_correction_cutoff_bid",
      `${item.symbol} cutoff mark source`,
    );
    equalMoney(cutoffMark.mark, item.markPrice, `${item.symbol} cutoff mark`);
    equal(
      cutoffMark.as_of.toISOString(),
      stopState.asOf,
      `${item.symbol} cutoff marked at`,
    );
  }
}

async function verifyPostState(client: PoolClient): Promise<void> {
  const account = await client.query<{
    cash: string;
    realized_pnl: string;
    fees: string;
  }>("select cash::text, realized_pnl::text, fees::text from shadow_accounts where id = $1", [
    ACCOUNT_ID,
  ]);
  equalMoney(account.rows[0]!.cash, EXPECTED_FINAL_ACCOUNT.cash, "final cash");
  equalMoney(
    account.rows[0]!.realized_pnl,
    EXPECTED_FINAL_ACCOUNT.realizedPnl,
    "final realized P&L",
  );
  equalMoney(account.rows[0]!.fees, EXPECTED_FINAL_ACCOUNT.fees, "final fees");

  const counts = await client.query<{
    old_events: number;
    old_orders: number;
    replacement_exits: number;
    replacement_marks: number;
    replacement_orders: number;
    replacement_fills: number;
    old_positions: number;
    new_positions: number;
    physical_marks: number;
    open_positions: number;
    market_value: string;
    unrealized_pnl: string;
    bmng_events: number;
    correction_events: number;
    corrected_buy_orders: number;
  }>(
    `select
       (select count(*)::int from execution_events
         where id = any($1::uuid[]) and event_type like '%\\_voided' escape '\\'
           and payload#>>'{ledgerCorrection,id}' = $2) old_events,
       (select count(*)::int from shadow_orders
         where id = any($3::uuid[])
           and lower(coalesce(payload->>'forwardTest', 'false')) = 'true'
           and payload#>>'{ledgerCorrection,id}' = $2) old_orders,
       (select count(*)::int from execution_events
         where id = any($4::uuid[]) and event_type = 'signal_options_shadow_exit') replacement_exits,
       (select count(*)::int from execution_events
         where id = any($5::uuid[]) and event_type = 'signal_options_shadow_mark') replacement_marks,
       (select count(*)::int from shadow_orders where id = any($6::uuid[])) replacement_orders,
       (select count(*)::int from shadow_fills where id = any($7::uuid[])) replacement_fills,
       (select count(*)::int from shadow_positions
         where id = any($8::uuid[])
           and position_key like 'shadow_equity_forward:ledger_correction:%') old_positions,
       (select count(*)::int from shadow_positions where id = any($9::uuid[])) new_positions,
       (select count(*)::int from shadow_position_marks where id = any($11::uuid[])) physical_marks,
       (select count(*)::int from shadow_positions
         where id = any($9::uuid[]) and status = 'open') open_positions,
       (select coalesce(sum(market_value), 0)::text from shadow_positions
         where id = any($9::uuid[]) and status = 'open') market_value,
       (select coalesce(sum(unrealized_pnl), 0)::text from shadow_positions
         where id = any($9::uuid[]) and status = 'open') unrealized_pnl,
       (select count(*)::int from execution_events
         where (payload#>>'{position,candidateId}' = $10
             or payload#>>'{candidate,id}' = $10
             or payload->>'candidateId' = $10)
           and payload#>>'{ledgerCorrection,id}' = $2) bmng_events,
       (select count(*)::int from execution_events
         where id = $2::uuid
           and event_type = 'signal_options_ledger_correction') correction_events,
       (select count(*)::int from shadow_orders
         where id = any($12::uuid[])
           and lower(coalesce(payload->>'forwardTest', 'false')) <> 'true'
           and payload#>>'{ledgerCorrection,id}' = $2
           and payload#>>'{position,lastStop,peakEvidenceSource}' =
               'executable_bid') corrected_buy_orders`,
    [
      [
        ...manifest.links.map((item) => item.originalExitEventId),
        ...manifest.additionalCorrections.flatMap((item) => item.voidEventIds),
      ],
      CORRECTION_ID,
      [
        ...manifest.links.map((item) => item.originalSellOrderId),
        ...manifest.additionalCorrections.map((item) => item.originalSellOrderId),
      ],
      [
        ...manifest.positions
          .filter((item): item is ExitReplay => item.classification === "exit")
          .map((item) => replacementIds(`eod:${item.entryEventId}`).eventId),
        ...manifest.additionalCorrections.map((item) =>
          replacementIds(`maintenance:${item.entryEventId}`).eventId,
        ),
      ],
      manifest.positions
        .filter((item): item is OpenReplay => item.classification === "open")
        .map((item) => deterministicUuid(`eod:${item.entryEventId}:mark`)),
      [
        ...manifest.positions
          .filter((item): item is ExitReplay => item.classification === "exit")
          .map((item) => replacementIds(`eod:${item.entryEventId}`).orderId),
        ...manifest.additionalCorrections.map((item) =>
          replacementIds(`maintenance:${item.entryEventId}`).orderId,
        ),
      ],
      [
        ...manifest.positions
          .filter((item): item is ExitReplay => item.classification === "exit")
          .map((item) => replacementIds(`eod:${item.entryEventId}`).fillId),
        ...manifest.additionalCorrections.map((item) =>
          replacementIds(`maintenance:${item.entryEventId}`).fillId,
        ),
      ],
      [
        ...manifest.links.map((item) => item.positionId),
        ...manifest.additionalCorrections.map((item) => item.positionId),
      ],
      [
        ...manifest.links.map((item) =>
          replacementIds(`eod:${item.entryEventId}`).positionId,
        ),
        ...manifest.additionalCorrections.map((item) =>
          replacementIds(`maintenance:${item.entryEventId}`).positionId,
        ),
      ],
      BMNG.candidateId,
      manifest.positions
        .filter((item): item is OpenReplay => item.classification === "open")
        .flatMap((item) => [
          deterministicUuid(`eod:${item.entryEventId}:mark`),
          deterministicUuid(`eod:${item.entryEventId}:peak-mark`),
        ]),
      manifest.positions
        .filter((item): item is OpenReplay => item.classification === "open")
        .map((item) => item.buyOrderId),
    ],
  );
  const row = counts.rows[0]!;
  equal(row.old_events, 35, "voided economic event count");
  equal(row.old_orders, 33, "excluded order count");
  equal(row.replacement_exits, 13, "replacement exit event count");
  equal(row.replacement_marks, 20, "replacement mark event count");
  equal(row.replacement_orders, 13, "replacement order count");
  equal(row.replacement_fills, 13, "replacement fill count");
  equal(row.old_positions, 33, "tombstoned position count");
  equal(row.new_positions, 33, "replacement position count");
  equal(row.physical_marks, 40, "replacement physical mark count");
  equal(row.open_positions, 20, "replacement open position count");
  equalMoney(row.market_value, 28_367, "replacement open market value");
  equalMoney(row.unrealized_pnl, 3_409, "replacement open unrealized P&L");
  equal(row.bmng_events, 123, "voided BMNG stale event count");
  equal(row.correction_events, 1, "correction event count");
  equal(row.corrected_buy_orders, 20, "corrected open buy order count");
  await verifyOpenRecoveryRows(client);
}

async function insertCorrectionEvent(
  client: PoolClient,
  correctedAt: Date,
  before: typeof EXPECTED_BASE_ACCOUNT,
  after: Awaited<ReturnType<typeof recomputeAccountAndSnapshot>>,
  sourceRows: SourceRows,
): Promise<void> {
  const result = await client.query(
    `insert into execution_events
       (id, deployment_id, provider_account_id, event_type, summary, payload,
        occurred_at, created_at, updated_at)
     values ($1, $2, $3, 'signal_options_ledger_correction', $4, $5::jsonb,
             $6::timestamptz, $6::timestamptz, $6::timestamptz)`,
    [
      CORRECTION_ID,
      DEPLOYMENT_ID,
      ACCOUNT_ID,
      "Replayed July 14-16 EOD exits under approved doctrine and repaired DRAM/T maintenance exits",
      JSON.stringify({
        correctionId: CORRECTION_ID,
        status: "applied",
        correctedAt: correctedAt.toISOString(),
        auditCutoff: AUDIT_CUTOFF,
        manifestPath: MANIFEST_PATH,
        manifestSha256: EXPECTED_FULL_DOCUMENT_SHA256,
        rewriteTargetSha256: EXPECTED_REWRITE_TARGET_SHA256,
        replayPositionsSha256: EXPECTED_MASSIVE_REPLAY_SHA256,
        counts: {
          voidedEodExits: 31,
          replacementExits: 11,
          reopenedAtCutoff: 20,
          replacementMaintenanceExits: 2,
          voidedBmngStaleEvents: sourceRows.bmngEventIds.length,
        },
        bmng: {
          candidateId: BMNG.candidateId,
          eventIdsSha256: sha256(sourceRows.bmngEventIds.slice().sort().join(",")),
        },
        before,
        after,
        deltas: {
          cash: money(after.cash - before.cash),
          realizedPnl: money(after.realizedPnl - before.realizedPnl),
          fees: money(after.fees - before.fees),
        },
      }),
      correctedAt.toISOString(),
    ],
  );
  equal(result.rowCount, 1, "correction audit event insert");
}

async function run(modeValue = mode()): Promise<Record<string, unknown>> {
  const plan = validatePlan();
  const client = await pool.connect();
  const correctedAt = new Date();
  try {
    await client.query("begin");
    await client.query("set local lock_timeout = '15s'");
    await client.query("set local statement_timeout = '120s'");
    await client.query(
      "select pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`shadow-ledger-correction:${CORRECTION_ID}`],
    );
    await client.query(
      `lock table execution_events, shadow_orders, shadow_fills,
                  shadow_positions, shadow_position_marks, shadow_accounts,
                  shadow_balance_snapshots in share row exclusive mode`,
    );
    const existing = await client.query(
      "select 1 from execution_events where id = $1::uuid",
      [CORRECTION_ID],
    );
    equal(existing.rowCount, 0, "existing correction event count");
    const sourceRows = await loadAndValidateSourceRows(client);
    const beforeDigest = await stateDigest(
      client,
      sourceRows.bmngEventIds,
      correctedAt,
    );
    const before = { ...EXPECTED_BASE_ACCOUNT };

    await applyReplay(client, sourceRows, correctedAt);
    const after = await recomputeAccountAndSnapshot(
      client,
      correctedAt,
      "ledger_correction",
    );
    await insertCorrectionEvent(client, correctedAt, before, after, sourceRows);
    await verifyPostState(client);
    equalMoney(after.cash, EXPECTED_FINAL_ACCOUNT.cash, "recomputed cash");
    equalMoney(
      after.realizedPnl,
      EXPECTED_FINAL_ACCOUNT.realizedPnl,
      "recomputed realized P&L",
    );
    equalMoney(after.fees, EXPECTED_FINAL_ACCOUNT.fees, "recomputed fees");
    const appliedDigest = await stateDigest(
      client,
      sourceRows.bmngEventIds,
      correctedAt,
    );

    if (modeValue === "dry-run") {
      await client.query("rollback");
      const afterRollbackDigest = await stateDigest(
        client,
        sourceRows.bmngEventIds,
        correctedAt,
      );
      equal(afterRollbackDigest, beforeDigest, "dry-run rollback state digest");
      return {
        correctionId: CORRECTION_ID,
        mode: modeValue,
        status: "validated_rolled_back",
        manifestSha256: plan.fullDocumentSha256,
        rewriteTargetSha256: plan.rewriteTargetSha256,
        replayPositionsSha256: plan.massiveReplaySha256,
        before,
        projectedAfter: after,
        rollbackProof: {
          beforeDigest,
          appliedDigest,
          afterRollbackDigest,
          restored: true,
        },
      };
    }

    await client.query("commit");
    return {
      correctionId: CORRECTION_ID,
      mode: modeValue,
      status: "applied_transaction_verified",
      manifestSha256: plan.fullDocumentSha256,
      rewriteTargetSha256: plan.rewriteTargetSha256,
      replayPositionsSha256: plan.massiveReplaySha256,
      before,
      after,
      committedDigest: appliedDigest,
    };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export const __shadowLedgerDoctrineCorrection20260716InternalsForTests = {
  CORRECTION_ID,
  buildOpenRecoveryPayloadForTests: buildOpenRecoveryPayload,
  deterministicUuid,
  mode,
  validatePlan,
};

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  run()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end();
    });
}
