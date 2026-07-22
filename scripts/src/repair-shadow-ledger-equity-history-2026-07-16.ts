import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import type { PoolClient } from "pg";

const ACCOUNT_ID = "shadow";
const CURRENCY = "USD";
const SOURCE = "ledger_correction_history";
const LEDGER_CORRECTION_ID = "1c9b0e29-328e-48cf-bad2-b91528a1ce87";
const REPAIR_ID = "e8ff6dd7-a338-5838-bc35-6b985844be52";
const EXPECTED_ECONOMICS_SHA256 =
  "ef1a4cb832b54cf6e9bdef3655c3c1cc6e7dbe5febafb49ddc060e0c08a3603f";
const EXPECTED_FULL_DOCUMENT_SHA256 =
  "36c67d1590fc5e0b3c0933505e583c2dbf2a39082e969b113b14aecbdab4ff27";
const EXPECTED_CLAMPED_SELL_IDS = [
  "3c9a5881-2c97-4934-80e7-ae32904269d8",
  "44ca353d-66af-4ff7-bf16-c680243f26cf",
  "652a8d74-5148-4ab2-a4e8-894442110838",
] as const;
const EXPECTED_CLAMPED_SELL_IDS_SHA256 =
  "d7442501ba00f78cf6b8d3ffdc62d37196140b15389830c67bd20f6037304849";
const MANIFEST_URL = new URL(
  "./shadow-ledger-equity-history-repair-2026-07-16.json",
  import.meta.url,
);

type Mode = "dry-run" | "apply";
type QuoteEvidence = {
  asOf: string;
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
};
type PersistedMarkEvidence = {
  id: string;
  source: string;
  asOf: string;
};
type PositionEvidence = {
  positionKey: string;
  positionId: string;
  entryEventId: string | null;
  symbol: string;
  ticker: string | null;
  quantity: number;
  multiplier: number;
  averageCost: number;
  costBasis: number;
  mark: number;
  marketValue: number;
  unrealizedPnl: number;
  source: "massive_close_bid" | "persisted_mark" | "pinned_massive_replay";
  quote?: QuoteEvidence;
  persistedMark?: PersistedMarkEvidence;
  repairMarkId?: string;
};
type Anchor = {
  snapshotId: string;
  asOf: string;
  cash: number;
  buyingPower: number;
  marketValue: number;
  netLiquidation: number;
  realizedPnl: number;
  unrealizedPnl: number;
  fees: number;
  positions: PositionEvidence[];
};
type Manifest = {
  schemaVersion: string;
  accountId: string;
  currency: string;
  source: string;
  ledgerCorrectionId: string;
  repairId: string;
  replayManifest: {
    path: string;
    canonicalSha256: string;
  };
  valuationPolicy: {
    correctedOptions: string;
    unaffectedPositions: string;
  };
  massiveQuery: Record<string, unknown>;
  anchors: Anchor[];
  hashes: {
    economicsCanonicalSha256: string;
    fullDocumentCanonicalSha256: string;
  };
};
type ValidatedPlan = {
  manifest: Manifest;
  anchors: Anchor[];
  economicsCanonicalSha256: string;
  fullDocumentCanonicalSha256: string;
};
type RepairMark = {
  id: string;
  positionId: string;
  mark: number;
  marketValue: number;
  unrealizedPnl: number;
  asOf: string;
};
type LedgerBookFill = {
  id: string;
  positionKey: string;
  symbol: string;
  ticker: string | null;
  assetClass: "equity" | "option";
  side: "buy" | "sell";
  quantity: number;
  price: number;
  multiplier: number;
};
type LedgerBookPosition = Omit<LedgerBookFill, "id" | "side" | "price"> & {
  averageCost: number;
  costBasis: number;
};
type LedgerBookRow = {
  id: string;
  occurred_at: Date;
  fill_symbol: string;
  fill_asset_class: string;
  fill_side: string;
  fill_quantity: string;
  fill_price: string;
  fill_cash_delta: string;
  fill_realized_pnl: string;
  fill_fees: string;
  fill_option_contract: unknown;
  order_symbol: string;
  order_asset_class: string;
  order_source: string;
  order_client_order_id: string | null;
  order_option_contract: unknown;
  order_payload: unknown;
};

const EXPECTED_ANCHORS = [
  {
    asOf: "2026-07-13T20:00:00.000Z",
    cash: 162_674.9955,
    marketValue: 1_310.925,
    netLiquidation: 163_985.9205,
    realizedPnl: 137_630.2355,
    unrealizedPnl: 135.275,
    fees: 4_906.56,
    positionCount: 2,
  },
  {
    asOf: "2026-07-14T20:00:00.000Z",
    cash: 147_558.7355,
    marketValue: 12_951.4,
    netLiquidation: 160_510.1355,
    realizedPnl: 135_743.9755,
    unrealizedPnl: -1_380.25,
    fees: 5_008.82,
    positionCount: 13,
  },
  {
    asOf: "2026-07-15T20:00:00.000Z",
    cash: 134_801.3555,
    marketValue: 24_489.175,
    netLiquidation: 159_290.5305,
    realizedPnl: 137_226.2655,
    unrealizedPnl: -3_935.475,
    fees: 5_271.2,
    positionCount: 22,
  },
  {
    asOf: "2026-07-16T20:00:00.000Z",
    cash: 135_249.3455,
    marketValue: 30_690.975,
    netLiquidation: 165_940.3205,
    realizedPnl: 135_991.3455,
    unrealizedPnl: 3_996.325,
    fees: 5_347.21,
    positionCount: 22,
  },
] as const;

const manifest = JSON.parse(readFileSync(MANIFEST_URL, "utf8")) as Manifest;

function fail(message: string): never {
  throw new Error(`shadow equity-history repair: ${message}`);
}

function assertEqual(
  actual: unknown,
  expected: unknown,
  label: string,
): void {
  if (actual !== expected) {
    fail(`${label}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

function numberValue(value: unknown, label: string): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed)) fail(`${label} is not finite`);
  return parsed;
}

function assertMoney(actual: unknown, expected: number, label: string): void {
  const difference = Math.abs(numberValue(actual, label) - expected);
  if (difference > 0.000_001) {
    fail(`${label}: expected ${expected}, received ${String(actual)}`);
  }
}

function foldLedgerBookWithClampedSells(fills: LedgerBookFill[]): {
  positions: LedgerBookPosition[];
  clampedSellIds: string[];
} {
  const book = new Map<string, LedgerBookPosition>();
  const clampedSellIds: string[] = [];
  for (const fill of fills) {
    const quantity = Math.abs(fill.quantity);
    if (!quantity) continue;
    const current = book.get(fill.positionKey);
    if (current) {
      assertEqual(current.symbol, fill.symbol, `${fill.id} symbol identity`);
      assertEqual(current.ticker, fill.ticker, `${fill.id} ticker identity`);
      assertEqual(
        current.assetClass,
        fill.assetClass,
        `${fill.id} asset identity`,
      );
      assertEqual(
        current.multiplier,
        fill.multiplier,
        `${fill.id} multiplier identity`,
      );
    }

    if (fill.side === "buy") {
      const priorQuantity = current?.quantity ?? 0;
      const nextQuantity = priorQuantity + quantity;
      const averageCost =
        (priorQuantity * (current?.averageCost ?? fill.price) +
          quantity * fill.price) /
        nextQuantity;
      book.set(fill.positionKey, {
        positionKey: fill.positionKey,
        symbol: fill.symbol,
        ticker: fill.ticker,
        assetClass: fill.assetClass,
        quantity: nextQuantity,
        multiplier: fill.multiplier,
        averageCost,
        costBasis: averageCost * nextQuantity * fill.multiplier,
      });
      continue;
    }

    const currentQuantity = current?.quantity ?? 0;
    if (quantity > currentQuantity + 1e-9) {
      clampedSellIds.push(fill.id);
    }
    const nextQuantity = Math.max(0, currentQuantity - quantity);
    if (nextQuantity <= 1e-9) {
      book.delete(fill.positionKey);
      continue;
    }
    const remaining = current!;
    book.set(fill.positionKey, {
      ...remaining,
      quantity: nextQuantity,
      costBasis: remaining.averageCost * nextQuantity * remaining.multiplier,
    });
  }
  return {
    positions: [...book.values()].sort((left, right) =>
      left.positionKey.localeCompare(right.positionKey),
    ),
    clampedSellIds,
  };
}

function foldLedgerBook(fills: LedgerBookFill[]): LedgerBookPosition[] {
  return foldLedgerBookWithClampedSells(fills).positions;
}

function assertLedgerBookMatchesAnchor(
  anchor: Anchor,
  foldedBook: LedgerBookPosition[],
): void {
  const expected = anchor.positions
    .slice()
    .sort((left, right) => left.positionKey.localeCompare(right.positionKey));
  const actual = foldedBook
    .slice()
    .sort((left, right) => left.positionKey.localeCompare(right.positionKey));
  assertEqual(
    actual.length,
    expected.length,
    `${anchor.asOf} ledger book position count`,
  );
  expected.forEach((position, index) => {
    const folded = actual[index]!;
    const assetClass = position.positionKey.startsWith("option:")
      ? "option"
      : position.positionKey.startsWith("equity:")
        ? "equity"
        : fail(`${anchor.asOf} unsupported positionKey ${position.positionKey}`);
    assertEqual(
      folded.positionKey,
      position.positionKey,
      `${anchor.asOf} ledger book positionKey ${index}`,
    );
    assertEqual(
      folded.symbol,
      position.symbol,
      `${anchor.asOf} ${position.positionKey} symbol`,
    );
    assertEqual(
      folded.ticker,
      position.ticker,
      `${anchor.asOf} ${position.positionKey} ticker`,
    );
    assertEqual(
      folded.assetClass,
      assetClass,
      `${anchor.asOf} ${position.positionKey} asset class`,
    );
    assertMoney(
      folded.quantity,
      position.quantity,
      `${anchor.asOf} ${position.positionKey} quantity`,
    );
    assertEqual(
      folded.multiplier,
      position.multiplier,
      `${anchor.asOf} ${position.positionKey} multiplier`,
    );
    assertMoney(
      folded.averageCost,
      position.averageCost,
      `${anchor.asOf} ${position.positionKey} average cost`,
    );
    assertMoney(
      folded.costBasis,
      position.costBasis,
      `${anchor.asOf} ${position.positionKey} cost basis`,
    );
  });
}

function deepCanonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deepCanonical);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, deepCanonical(record[key])]),
  );
}

function deepCanonicalSha256(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(deepCanonical(value)))
    .digest("hex");
}

function validateClampedSellIds(ids: string[]): void {
  const actual = [...new Set(ids)].sort();
  const expected = [...EXPECTED_CLAMPED_SELL_IDS].sort();
  const hash = deepCanonicalSha256(actual);
  if (
    JSON.stringify(actual) !== JSON.stringify(expected) ||
    hash !== EXPECTED_CLAMPED_SELL_IDS_SHA256
  ) {
    fail(
      `clamped sell anomaly set: expected ${JSON.stringify(expected)} (${EXPECTED_CLAMPED_SELL_IDS_SHA256}), received ${JSON.stringify(actual)} (${hash})`,
    );
  }
}

function deterministicUuid(domain: string): string {
  const bytes = createHash("sha256")
    .update(REPAIR_ID)
    .update("\0")
    .update(domain)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function snapshotId(asOf: string): string {
  return deterministicUuid(`snapshot:${asOf}`);
}

function repairMarkId(asOf: string, positionKey: string): string {
  return deterministicUuid(`mark:${asOf}:${positionKey}`);
}

function mode(): Mode {
  const value =
    process.env.SHADOW_LEDGER_EQUITY_HISTORY_REPAIR_MODE?.trim() || "dry-run";
  if (value !== "dry-run" && value !== "apply") {
    fail(
      "SHADOW_LEDGER_EQUITY_HISTORY_REPAIR_MODE must be dry-run or apply",
    );
  }
  return value;
}

function economicsProjection(input: Manifest): Record<string, unknown> {
  return {
    schemaVersion: input.schemaVersion,
    accountId: input.accountId,
    ledgerCorrectionId: input.ledgerCorrectionId,
    valuationPolicy: input.valuationPolicy,
    anchors: input.anchors.map((anchor) => ({
      asOf: anchor.asOf,
      cash: anchor.cash,
      buyingPower: anchor.buyingPower,
      marketValue: anchor.marketValue,
      netLiquidation: anchor.netLiquidation,
      realizedPnl: anchor.realizedPnl,
      unrealizedPnl: anchor.unrealizedPnl,
      fees: anchor.fees,
      positions: anchor.positions
        .slice()
        .sort((left, right) =>
          left.positionKey.localeCompare(right.positionKey),
        ),
    })),
  };
}

function fullDocumentProjection(input: Manifest): Manifest {
  const projection = structuredClone(input);
  delete (
    projection.hashes as Partial<Manifest["hashes"]>
  ).fullDocumentCanonicalSha256;
  return projection;
}

function quoteRepairMarks(plan: ValidatedPlan): RepairMark[] {
  return plan.anchors.flatMap((anchor) =>
    anchor.positions
      .filter((position) => position.source !== "persisted_mark")
      .map((position) => ({
        id: position.repairMarkId!,
        positionId: position.positionId,
        mark: position.mark,
        marketValue: position.marketValue,
        unrealizedPnl: position.unrealizedPnl,
        asOf: position.quote!.asOf,
      })),
  );
}

function validateManifest(): ValidatedPlan {
  assertEqual(
    manifest.schemaVersion,
    "shadow-ledger-equity-history-repair-v1",
    "manifest schemaVersion",
  );
  assertEqual(manifest.accountId, ACCOUNT_ID, "manifest accountId");
  assertEqual(manifest.currency, CURRENCY, "manifest currency");
  assertEqual(manifest.source, SOURCE, "manifest source");
  assertEqual(
    manifest.ledgerCorrectionId,
    LEDGER_CORRECTION_ID,
    "manifest ledgerCorrectionId",
  );
  assertEqual(manifest.repairId, REPAIR_ID, "manifest repairId");
  assertEqual(
    manifest.anchors.length,
    EXPECTED_ANCHORS.length,
    "manifest anchor count",
  );

  const snapshotIds = new Set<string>();
  const markIds = new Set<string>();
  manifest.anchors.forEach((anchor, anchorIndex) => {
    const expected = EXPECTED_ANCHORS[anchorIndex]!;
    assertEqual(anchor.asOf, expected.asOf, `anchor ${anchorIndex} asOf`);
    assertEqual(
      anchor.snapshotId,
      snapshotId(anchor.asOf),
      `${anchor.asOf} snapshotId`,
    );
    if (snapshotIds.has(anchor.snapshotId)) fail("duplicate snapshotId");
    snapshotIds.add(anchor.snapshotId);
    assertMoney(anchor.cash, expected.cash, `${anchor.asOf} cash`);
    assertMoney(anchor.buyingPower, anchor.cash, `${anchor.asOf} buying power`);
    assertMoney(
      anchor.marketValue,
      expected.marketValue,
      `${anchor.asOf} market value`,
    );
    assertMoney(
      anchor.netLiquidation,
      expected.netLiquidation,
      `${anchor.asOf} net liquidation`,
    );
    assertMoney(
      anchor.realizedPnl,
      expected.realizedPnl,
      `${anchor.asOf} realized P&L`,
    );
    assertMoney(
      anchor.unrealizedPnl,
      expected.unrealizedPnl,
      `${anchor.asOf} unrealized P&L`,
    );
    assertMoney(anchor.fees, expected.fees, `${anchor.asOf} fees`);
    assertEqual(
      anchor.positions.length,
      expected.positionCount,
      `${anchor.asOf} position count`,
    );
    assertMoney(
      anchor.netLiquidation,
      anchor.cash + anchor.marketValue,
      `${anchor.asOf} cash + market value`,
    );

    const positionKeys = new Set<string>();
    let marketValue = 0;
    let unrealizedPnl = 0;
    for (const position of anchor.positions) {
      if (positionKeys.has(position.positionKey)) {
        fail(`${anchor.asOf} duplicate positionKey ${position.positionKey}`);
      }
      positionKeys.add(position.positionKey);
      if (position.quantity <= 0) fail(`${position.positionKey} quantity`);
      if (position.multiplier !== 1 && position.multiplier !== 100) {
        fail(`${position.positionKey} multiplier`);
      }
      assertMoney(
        position.costBasis,
        position.averageCost * position.quantity * position.multiplier,
        `${anchor.asOf} ${position.positionKey} cost basis`,
      );
      assertMoney(
        position.marketValue,
        position.mark * position.quantity * position.multiplier,
        `${anchor.asOf} ${position.positionKey} market value`,
      );
      assertMoney(
        position.unrealizedPnl,
        position.marketValue - position.costBasis,
        `${anchor.asOf} ${position.positionKey} unrealized P&L`,
      );
      marketValue += position.marketValue;
      unrealizedPnl += position.unrealizedPnl;

      if (position.source === "persisted_mark") {
        if (!position.persistedMark || position.quote || position.repairMarkId) {
          fail(`${anchor.asOf} ${position.positionKey} persisted provenance`);
        }
        if (new Date(position.persistedMark.asOf) > new Date(anchor.asOf)) {
          fail(`${anchor.asOf} ${position.positionKey} persisted mark is late`);
        }
      } else {
        if (!position.quote || position.persistedMark) {
          fail(`${anchor.asOf} ${position.positionKey} quote provenance`);
        }
        const expectedMarkId = repairMarkId(anchor.asOf, position.positionKey);
        assertEqual(
          position.repairMarkId,
          expectedMarkId,
          `${anchor.asOf} ${position.positionKey} repairMarkId`,
        );
        if (markIds.has(expectedMarkId)) fail(`duplicate repairMarkId`);
        markIds.add(expectedMarkId);
        assertMoney(
          position.mark,
          position.quote.bid,
          `${anchor.asOf} ${position.positionKey} bid mark`,
        );
        if (
          position.quote.bid <= 0 ||
          position.quote.ask < position.quote.bid ||
          position.quote.bidSize < position.quantity
        ) {
          fail(`${anchor.asOf} ${position.positionKey} invalid quote`);
        }
        const quoteAt = new Date(position.quote.asOf).getTime();
        const closeAt = new Date(anchor.asOf).getTime();
        if (quoteAt > closeAt || quoteAt < closeAt - 30 * 60 * 1_000) {
          fail(`${anchor.asOf} ${position.positionKey} quote outside window`);
        }
      }
    }
    assertMoney(marketValue, anchor.marketValue, `${anchor.asOf} MV sum`);
    assertMoney(
      unrealizedPnl,
      anchor.unrealizedPnl,
      `${anchor.asOf} UPL sum`,
    );
  });

  const economicsCanonicalSha256 = deepCanonicalSha256(
    economicsProjection(manifest),
  );
  assertEqual(
    economicsCanonicalSha256,
    EXPECTED_ECONOMICS_SHA256,
    "derived economics SHA-256",
  );
  assertEqual(
    manifest.hashes.economicsCanonicalSha256,
    economicsCanonicalSha256,
    "stored economics SHA-256",
  );
  const fullDocumentCanonicalSha256 = deepCanonicalSha256(
    fullDocumentProjection(manifest),
  );
  assertEqual(
    fullDocumentCanonicalSha256,
    EXPECTED_FULL_DOCUMENT_SHA256,
    "derived full-document SHA-256",
  );
  assertEqual(
    manifest.hashes.fullDocumentCanonicalSha256,
    fullDocumentCanonicalSha256,
    "stored full-document SHA-256",
  );
  return {
    manifest,
    anchors: manifest.anchors,
    economicsCanonicalSha256,
    fullDocumentCanonicalSha256,
  };
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.replace(/[$,%\s,]/g, ""))
        : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

type LedgerOrderClassificationRow = Pick<
  LedgerBookRow,
  "order_source" | "order_client_order_id" | "order_payload"
>;

function isDefaultLedgerBookRow(row: LedgerOrderClassificationRow): boolean {
  const payload = recordValue(row.order_payload);
  const metadata = recordValue(payload.metadata);
  const replay = recordValue(payload.replay);
  const backfill = recordValue(payload.backfill);
  const forwardTest = payload.forwardTest;
  if (
    forwardTest === true ||
    stringValue(forwardTest)?.toLowerCase() === "true" ||
    row.order_client_order_id?.startsWith("shadow-equity-forward-")
  ) {
    return false;
  }

  const sourceCandidates = [
    stringValue(payload.source),
    stringValue(payload.sourceType),
    stringValue(payload.runSource),
    stringValue(metadata.source),
    stringValue(metadata.sourceType),
    stringValue(metadata.runSource),
    stringValue(replay.source),
    stringValue(backfill.source),
  ];
  const position = recordValue(payload.position);
  const positionKey =
    stringValue(metadata.positionKey) ??
    stringValue(payload.positionKey) ??
    stringValue(position.positionKey);
  const effectiveSource = sourceCandidates.includes("signal_options_replay")
    ? "signal_options_replay"
    : sourceCandidates.includes("watchlist_backtest")
      ? "watchlist_backtest"
      : positionKey?.startsWith("signal_options_replay:")
        ? "signal_options_replay"
        : positionKey?.startsWith("watchlist_backtest:")
          ? "watchlist_backtest"
          : row.order_source === "watchlist_backtest"
            ? "watchlist_backtest"
            : row.order_source === "signal_options_replay"
              ? "signal_options_replay"
              : row.order_source === "automation"
                ? "automation"
                : "manual";
  return effectiveSource !== "watchlist_backtest";
}

function normalizeLedgerSymbol(value: string): string {
  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{1,5}[ -][A-Z]{1,2}$/.test(normalized)
    ? normalized.replace(/[ -]/, ".")
    : normalized;
}

function optionContractValue(value: unknown) {
  const contract = recordValue(value);
  const expirationDate = new Date(String(contract.expirationDate ?? ""));
  const right = String(contract.right ?? "").toLowerCase();
  const ticker = String(contract.ticker ?? "");
  const underlying = normalizeLedgerSymbol(
    String(contract.underlying ?? ticker),
  );
  const strike = optionalNumber(contract.strike);
  if (
    !ticker ||
    !underlying ||
    Number.isNaN(expirationDate.getTime()) ||
    strike === null ||
    (right !== "call" && right !== "put")
  ) {
    return null;
  }
  return {
    ticker,
    underlying,
    expirationDate,
    strike,
    right,
    multiplier: optionalNumber(contract.multiplier),
    sharesPerContract: optionalNumber(contract.sharesPerContract),
    providerContractId:
      typeof contract.providerContractId === "string" &&
      contract.providerContractId.trim()
        ? contract.providerContractId.trim()
        : null,
  };
}

function ledgerPositionKey(row: LedgerBookRow): string {
  const payload = recordValue(row.order_payload);
  const metadata = recordValue(payload.metadata);
  const position = recordValue(payload.position);
  const payloadKey =
    stringValue(metadata.positionKey) ??
    stringValue(payload.positionKey) ??
    stringValue(position.positionKey);
  if (payloadKey) return payloadKey;

  const contract = optionContractValue(row.order_option_contract);
  if (row.order_asset_class === "option" && contract) {
    return [
      "option",
      normalizeLedgerSymbol(contract.underlying || row.order_symbol),
      contract.expirationDate.toISOString().slice(0, 10),
      contract.strike,
      contract.right,
      contract.providerContractId || contract.ticker,
    ].join(":");
  }
  return `equity:${normalizeLedgerSymbol(row.order_symbol)}`;
}

function ledgerBookFill(row: LedgerBookRow): LedgerBookFill {
  if (row.fill_asset_class !== "equity" && row.fill_asset_class !== "option") {
    fail(`${row.id} unsupported fill asset class ${row.fill_asset_class}`);
  }
  if (row.fill_side !== "buy" && row.fill_side !== "sell") {
    fail(`${row.id} unsupported fill side ${row.fill_side}`);
  }
  const contract = optionContractValue(row.fill_option_contract);
  return {
    id: row.id,
    positionKey: ledgerPositionKey(row),
    symbol: normalizeLedgerSymbol(row.fill_symbol),
    ticker: row.fill_asset_class === "option" ? (contract?.ticker ?? null) : null,
    assetClass: row.fill_asset_class,
    side: row.fill_side,
    quantity: numberValue(row.fill_quantity, `${row.id} quantity`),
    price: numberValue(row.fill_price, `${row.id} price`),
    multiplier:
      row.fill_asset_class === "option"
        ? (contract?.multiplier ?? contract?.sharesPerContract ?? 100)
        : 1,
  };
}

const INCLUDED_LEDGER_BOOK_SQL = `
select f.id::text,
       f.occurred_at,
       f.symbol as fill_symbol,
       f.asset_class as fill_asset_class,
       f.side as fill_side,
       f.quantity::text as fill_quantity,
       f.price::text as fill_price,
       f.cash_delta::text as fill_cash_delta,
       f.realized_pnl::text as fill_realized_pnl,
       f.fees::text as fill_fees,
       f.option_contract as fill_option_contract,
       o.symbol as order_symbol,
       o.asset_class as order_asset_class,
       o.source as order_source,
       o.client_order_id as order_client_order_id,
       o.option_contract as order_option_contract,
       o.payload as order_payload
  from shadow_fills f
  join shadow_orders o
    on o.id = f.order_id
   and o.account_id = f.account_id
 where f.account_id = $1
   and f.occurred_at <= $2::timestamptz
 order by f.occurred_at, f.id`;

function iso(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) fail(`invalid database timestamp`);
  return date.toISOString();
}

async function validateLedgerAnchors(
  client: PoolClient,
  plan: ValidatedPlan,
  startingBalance: number,
): Promise<{
  anchorPositionCounts: Array<{ asOf: string; positions: number }>;
  clampedSellIds: string[];
  clampedSellIdsSha256: string;
}> {
  const lastAnchor = plan.anchors.at(-1)!;
  const book = await client.query<LedgerBookRow>(INCLUDED_LEDGER_BOOK_SQL, [
    ACCOUNT_ID,
    lastAnchor.asOf,
  ]);
  const timedFills = book.rows
    .filter(isDefaultLedgerBookRow)
    .map((row) => ({
      occurredAt: new Date(row.occurred_at).getTime(),
      fill: ledgerBookFill(row),
      cashDelta: numberValue(row.fill_cash_delta, `${row.id} cash delta`),
      realizedPnl: numberValue(
        row.fill_realized_pnl,
        `${row.id} realized P&L`,
      ),
      fees: numberValue(row.fill_fees, `${row.id} fees`),
    }));
  const anchorPositionCounts: Array<{ asOf: string; positions: number }> = [];
  let clampedSellIds: string[] = [];

  for (const anchor of plan.anchors) {
    const anchorAt = new Date(anchor.asOf).getTime();
    const fills = timedFills.filter((item) => item.occurredAt <= anchorAt);
    assertMoney(
      startingBalance +
        fills.reduce((sum, item) => sum + item.cashDelta, 0),
      anchor.cash,
      `${anchor.asOf} ledger cash`,
    );
    assertMoney(
      fills.reduce((sum, item) => sum + item.realizedPnl, 0),
      anchor.realizedPnl,
      `${anchor.asOf} ledger realized P&L`,
    );
    assertMoney(
      fills.reduce((sum, item) => sum + item.fees, 0),
      anchor.fees,
      `${anchor.asOf} ledger fees`,
    );

    const fold = foldLedgerBookWithClampedSells(
      fills.map((item) => item.fill),
    );
    assertLedgerBookMatchesAnchor(anchor, fold.positions);
    anchorPositionCounts.push({
      asOf: anchor.asOf,
      positions: fold.positions.length,
    });
    clampedSellIds = fold.clampedSellIds;
  }
  validateClampedSellIds(clampedSellIds);
  return {
    anchorPositionCounts,
    clampedSellIds: [...new Set(clampedSellIds)].sort(),
    clampedSellIdsSha256: deepCanonicalSha256([
      ...new Set(clampedSellIds),
    ].sort()),
  };
}

async function validateCorrectionAndAccount(
  client: PoolClient,
): Promise<number> {
  const correction = await client.query<{ event_type: string }>(
    `select event_type
       from execution_events
      where id = $1::uuid
      for key share`,
    [LEDGER_CORRECTION_ID],
  );
  assertEqual(correction.rowCount, 1, "ledger correction row count");
  assertEqual(
    correction.rows[0]!.event_type,
    "signal_options_ledger_correction",
    "ledger correction event type",
  );
  const account = await client.query<{ starting_balance: string }>(
    `select starting_balance::text
       from shadow_accounts
      where id = $1
      for update`,
    [ACCOUNT_ID],
  );
  assertEqual(account.rowCount, 1, "shadow account row count");
  return numberValue(
    account.rows[0]!.starting_balance,
    "shadow account starting balance",
  );
}

async function validatePositionIdentities(
  client: PoolClient,
  plan: ValidatedPlan,
): Promise<void> {
  const expected = new Map<string, PositionEvidence>();
  for (const position of plan.anchors.flatMap((anchor) => anchor.positions)) {
    const previous = expected.get(position.positionId);
    if (
      previous &&
      (previous.positionKey !== position.positionKey ||
        previous.symbol !== position.symbol)
    ) {
      fail(`positionId ${position.positionId} maps to conflicting identities`);
    }
    expected.set(position.positionId, position);
  }
  const result = await client.query<{
    id: string;
    account_id: string;
    position_key: string;
    symbol: string;
  }>(
    `select id::text, account_id, position_key, symbol
       from shadow_positions
      where id = any($1::uuid[])
      for key share`,
    [[...expected.keys()]],
  );
  assertEqual(result.rowCount, expected.size, "position identity row count");
  for (const row of result.rows) {
    const position = expected.get(row.id);
    if (!position) fail(`unexpected position ${row.id}`);
    assertEqual(row.account_id, ACCOUNT_ID, `${row.id} account`);
    assertEqual(row.position_key, position.positionKey, `${row.id} key`);
    assertEqual(row.symbol, position.symbol, `${row.id} symbol`);
  }
}

async function validatePersistedMarks(
  client: PoolClient,
  plan: ValidatedPlan,
): Promise<void> {
  const expected = new Map<
    string,
    { position: PositionEvidence; evidence: PersistedMarkEvidence }
  >();
  for (const position of plan.anchors.flatMap((anchor) => anchor.positions)) {
    if (position.persistedMark) {
      expected.set(position.persistedMark.id, {
        position,
        evidence: position.persistedMark,
      });
    }
  }
  const result = await client.query<{
    id: string;
    account_id: string;
    position_id: string;
    mark: string;
    market_value: string;
    unrealized_pnl: string;
    source: string;
    as_of: Date;
  }>(
    `select id::text, account_id, position_id::text, mark::text,
            market_value::text, unrealized_pnl::text, source, as_of
       from shadow_position_marks
      where id = any($1::uuid[])
      for key share`,
    [[...expected.keys()]],
  );
  assertEqual(result.rowCount, expected.size, "persisted mark row count");
  for (const row of result.rows) {
    const item = expected.get(row.id);
    if (!item) fail(`unexpected persisted mark ${row.id}`);
    assertEqual(row.account_id, ACCOUNT_ID, `${row.id} account`);
    assertEqual(
      row.position_id,
      item.position.positionId,
      `${row.id} position`,
    );
    assertMoney(row.mark, item.position.mark, `${row.id} mark`);
    assertMoney(
      row.market_value,
      item.position.marketValue,
      `${row.id} market value`,
    );
    assertMoney(
      row.unrealized_pnl,
      item.position.unrealizedPnl,
      `${row.id} unrealized P&L`,
    );
    assertEqual(row.source, item.evidence.source, `${row.id} source`);
    assertEqual(iso(row.as_of), item.evidence.asOf, `${row.id} asOf`);
  }
}

async function validateExistingRepairRows(
  client: PoolClient,
  plan: ValidatedPlan,
  requireAll: boolean,
): Promise<void> {
  const expectedMarks = new Map(
    quoteRepairMarks(plan).map((mark) => [mark.id, mark]),
  );
  const markRows = await client.query<{
    id: string;
    account_id: string;
    position_id: string;
    mark: string;
    market_value: string;
    unrealized_pnl: string;
    source: string;
    as_of: Date;
  }>(
    `select id::text, account_id, position_id::text, mark::text,
            market_value::text, unrealized_pnl::text, source, as_of
       from shadow_position_marks
      where id = any($1::uuid[])
         or (account_id = $2 and source = $3)
      for update`,
    [[...expectedMarks.keys()], ACCOUNT_ID, SOURCE],
  );
  for (const row of markRows.rows) {
    const expected = expectedMarks.get(row.id);
    if (!expected) fail(`conflicting ${SOURCE} mark ${row.id}`);
    assertEqual(row.account_id, ACCOUNT_ID, `${row.id} account`);
    assertEqual(row.position_id, expected.positionId, `${row.id} position`);
    assertMoney(row.mark, expected.mark, `${row.id} mark`);
    assertMoney(
      row.market_value,
      expected.marketValue,
      `${row.id} market value`,
    );
    assertMoney(
      row.unrealized_pnl,
      expected.unrealizedPnl,
      `${row.id} unrealized P&L`,
    );
    assertEqual(row.source, SOURCE, `${row.id} source`);
    assertEqual(iso(row.as_of), expected.asOf, `${row.id} asOf`);
  }
  if (requireAll) {
    assertEqual(markRows.rowCount, expectedMarks.size, "repair mark row count");
  }

  const expectedSnapshots = new Map(
    plan.anchors.map((anchor) => [anchor.snapshotId, anchor]),
  );
  const snapshotRows = await client.query<{
    id: string;
    account_id: string;
    currency: string;
    cash: string;
    buying_power: string;
    net_liquidation: string;
    realized_pnl: string;
    unrealized_pnl: string;
    fees: string;
    source: string;
    as_of: Date;
  }>(
    `select id::text, account_id, currency, cash::text, buying_power::text,
            net_liquidation::text, realized_pnl::text, unrealized_pnl::text,
            fees::text, source, as_of
       from shadow_balance_snapshots
      where id = any($1::uuid[])
         or (account_id = $2 and source = $3)
      for update`,
    [[...expectedSnapshots.keys()], ACCOUNT_ID, SOURCE],
  );
  for (const row of snapshotRows.rows) {
    const expected = expectedSnapshots.get(row.id);
    if (!expected) fail(`conflicting ${SOURCE} snapshot ${row.id}`);
    assertEqual(row.account_id, ACCOUNT_ID, `${row.id} account`);
    assertEqual(row.currency, CURRENCY, `${row.id} currency`);
    assertMoney(row.cash, expected.cash, `${row.id} cash`);
    assertMoney(
      row.buying_power,
      expected.buyingPower,
      `${row.id} buying power`,
    );
    assertMoney(
      row.net_liquidation,
      expected.netLiquidation,
      `${row.id} net liquidation`,
    );
    assertMoney(
      row.realized_pnl,
      expected.realizedPnl,
      `${row.id} realized P&L`,
    );
    assertMoney(
      row.unrealized_pnl,
      expected.unrealizedPnl,
      `${row.id} unrealized P&L`,
    );
    assertMoney(row.fees, expected.fees, `${row.id} fees`);
    assertEqual(row.source, SOURCE, `${row.id} source`);
    assertEqual(iso(row.as_of), expected.asOf, `${row.id} asOf`);
  }
  if (requireAll) {
    assertEqual(
      snapshotRows.rowCount,
      expectedSnapshots.size,
      "repair snapshot row count",
    );
  }
}

async function stateDigest(
  client: PoolClient,
  plan: ValidatedPlan,
): Promise<string> {
  const markIds = quoteRepairMarks(plan).map((mark) => mark.id);
  const snapshotIds = plan.anchors.map((anchor) => anchor.snapshotId);
  const [marks, snapshots] = await Promise.all([
    client.query(
      `select id::text, account_id, position_id::text, mark::text,
              market_value::text, unrealized_pnl::text, source, as_of
         from shadow_position_marks
        where id = any($1::uuid[])
        order by id`,
      [markIds],
    ),
    client.query(
      `select id::text, account_id, currency, cash::text, buying_power::text,
              net_liquidation::text, realized_pnl::text, unrealized_pnl::text,
              fees::text, source, as_of
         from shadow_balance_snapshots
        where id = any($1::uuid[])
        order by id`,
      [snapshotIds],
    ),
  ]);
  return deepCanonicalSha256({
    marks: marks.rows,
    snapshots: snapshots.rows,
  });
}

async function insertRepairRows(
  client: PoolClient,
  plan: ValidatedPlan,
): Promise<void> {
  const marks = quoteRepairMarks(plan).map((mark) => ({
    ...mark,
    accountId: ACCOUNT_ID,
    source: SOURCE,
  }));
  await client.query(
    `insert into shadow_position_marks
       (id, account_id, position_id, mark, market_value, unrealized_pnl,
        source, as_of)
     select row.id, row.account_id, row.position_id, row.mark,
            row.market_value, row.unrealized_pnl, row.source, row.as_of
       from jsonb_to_recordset($1::jsonb) as row(
         id uuid, account_id varchar, position_id uuid, mark numeric,
         market_value numeric, unrealized_pnl numeric, source varchar,
         as_of timestamptz
       )
     on conflict (id) do nothing`,
    [
      JSON.stringify(
        marks.map((mark) => ({
          id: mark.id,
          account_id: mark.accountId,
          position_id: mark.positionId,
          mark: mark.mark,
          market_value: mark.marketValue,
          unrealized_pnl: mark.unrealizedPnl,
          source: mark.source,
          as_of: mark.asOf,
        })),
      ),
    ],
  );
  await client.query(
    `insert into shadow_balance_snapshots
       (id, account_id, currency, cash, buying_power, net_liquidation,
        realized_pnl, unrealized_pnl, fees, source, as_of)
     select row.id, row.account_id, row.currency, row.cash, row.buying_power,
            row.net_liquidation, row.realized_pnl, row.unrealized_pnl,
            row.fees, row.source, row.as_of
       from jsonb_to_recordset($1::jsonb) as row(
         id uuid, account_id varchar, currency varchar, cash numeric,
         buying_power numeric, net_liquidation numeric, realized_pnl numeric,
         unrealized_pnl numeric, fees numeric, source varchar,
         as_of timestamptz
       )
     on conflict (id) do nothing`,
    [
      JSON.stringify(
        plan.anchors.map((anchor) => ({
          id: anchor.snapshotId,
          account_id: ACCOUNT_ID,
          currency: CURRENCY,
          cash: anchor.cash,
          buying_power: anchor.buyingPower,
          net_liquidation: anchor.netLiquidation,
          realized_pnl: anchor.realizedPnl,
          unrealized_pnl: anchor.unrealizedPnl,
          fees: anchor.fees,
          source: SOURCE,
          as_of: anchor.asOf,
        })),
      ),
    ],
  );
}

async function run(modeValue = mode()): Promise<Record<string, unknown>> {
  const plan = validateManifest();
  const { pool } = await import("@workspace/db");
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query("begin");
    transactionOpen = true;
    await client.query("set local lock_timeout = '5s'");
    await client.query("set local statement_timeout = '30s'");
    await client.query(
      "select pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`shadow-equity-history-repair:${REPAIR_ID}`],
    );
    const startingBalance = await validateCorrectionAndAccount(client);
    const ledgerValidation = await validateLedgerAnchors(
      client,
      plan,
      startingBalance,
    );
    await validatePositionIdentities(client, plan);
    await validatePersistedMarks(client, plan);
    await validateExistingRepairRows(client, plan, false);
    const beforeDigest = await stateDigest(client, plan);

    if (modeValue === "dry-run") {
      await client.query("savepoint project_repair");
      await insertRepairRows(client, plan);
      await validateExistingRepairRows(client, plan, true);
      const projectedDigest = await stateDigest(client, plan);
      await client.query("rollback to savepoint project_repair");
      const afterDigest = await stateDigest(client, plan);
      assertEqual(afterDigest, beforeDigest, "dry-run rollback restoration");
      await client.query("rollback");
      transactionOpen = false;
      return {
        mode: modeValue,
        applied: false,
        wouldInsertMarks: quoteRepairMarks(plan).length,
        wouldInsertSnapshots: plan.anchors.length,
        beforeDigest,
        projectedDigest,
        afterDigest,
        ledgerValidation,
        economicsCanonicalSha256: plan.economicsCanonicalSha256,
        fullDocumentCanonicalSha256: plan.fullDocumentCanonicalSha256,
      };
    }

    await insertRepairRows(client, plan);
    await validateExistingRepairRows(client, plan, true);
    const afterDigest = await stateDigest(client, plan);
    await client.query("commit");
    transactionOpen = false;
    return {
      mode: modeValue,
      applied: true,
      marks: quoteRepairMarks(plan).length,
      snapshots: plan.anchors.length,
      beforeDigest,
      afterDigest,
      ledgerValidation,
      economicsCanonicalSha256: plan.economicsCanonicalSha256,
      fullDocumentCanonicalSha256: plan.fullDocumentCanonicalSha256,
    };
  } catch (error) {
    if (transactionOpen) await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

export const __shadowLedgerEquityHistoryRepair20260716InternalsForTests = {
  REPAIR_ID,
  SOURCE,
  deepCanonicalSha256,
  deterministicUuid,
  economicsProjection,
  foldLedgerBook,
  foldLedgerBookWithClampedSells,
  isDefaultLedgerBookRow,
  ledgerBookFill,
  mode,
  repairMarkId,
  snapshotId,
  assertLedgerBookMatchesAnchor,
  validateManifest,
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  run()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
