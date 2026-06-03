import type { AssetClass } from "./client";
import { normalizeSymbol } from "./values";

export type IbkrMarketDataLineAssetClass = Extract<
  AssetClass,
  "equity" | "option"
>;

export type IbkrMarketDataLineState =
  | "desired"
  | "subscribing"
  | "live"
  | "releasing"
  | "released"
  | "failed"
  | "stale"
  | "unexpected";

export type IbkrMarketDataLineOwner = {
  owner: string;
  ownerClass: string | null;
  intent: string;
  pool: string | null;
  priority: number | null;
};

export type IbkrMarketDataLineContract = {
  symbol: string | null;
  providerContractId: string | null;
};

export type IbkrMarketDataDesiredLine = {
  lineKey: string;
  assetClass: IbkrMarketDataLineAssetClass;
  contract: IbkrMarketDataLineContract;
  intent: string;
  owners: IbkrMarketDataLineOwner[];
  priority: number | null;
  reason: string;
};

export type IbkrMarketDataDesiredGeneration = {
  schemaVersion: 1;
  generationId: string;
  source: "api-market-data-work-planner";
  generatedAt: string;
  desiredLines: IbkrMarketDataDesiredLine[];
  summary: {
    desiredLineCount: number;
    desiredEquityLineCount: number;
    desiredOptionLineCount: number;
    ownerCount: number;
  };
};

export type IbkrMarketDataGenerationLineStatus = {
  lineKey: string;
  assetClass: IbkrMarketDataLineAssetClass;
  state: IbkrMarketDataLineState;
  contract: IbkrMarketDataLineContract;
  owners: IbkrMarketDataLineOwner[];
  subscribedAt: string | null;
  lastTickAt: string | null;
  releaseRequestedAt: string | null;
  error: string | null;
};

export type IbkrMarketDataGenerationStatus = {
  schemaVersion: 1;
  mode: "observer" | "executor";
  source: "tws-bridge" | "ib-async-sidecar";
  generationId: string | null;
  appliedGenerationId: string | null;
  updatedAt: string;
  lines: IbkrMarketDataGenerationLineStatus[];
  summary: {
    liveLineCount: number;
    liveEquityLineCount: number;
    liveOptionLineCount: number;
    subscribingLineCount: number;
    releasingLineCount: number;
    failedLineCount: number;
    unexpectedLineCount: number;
  };
  throttle: {
    throttled: boolean;
    queueDepth: number | null;
    maxRequests: number | null;
    requestsIntervalSec: number | null;
    lastThrottleStartAt: string | null;
    lastThrottleEndAt: string | null;
  };
};

export function buildIbkrMarketDataLineKey(input: {
  assetClass: IbkrMarketDataLineAssetClass;
  symbol?: string | null;
  providerContractId?: string | null;
}): string | null {
  if (input.assetClass === "equity") {
    const symbol = normalizeSymbol(input.symbol ?? "");
    return symbol ? `equity:${symbol}` : null;
  }

  const providerContractId = input.providerContractId?.trim();
  return providerContractId ? `option:${providerContractId}` : null;
}

export function parseIbkrMarketDataLineKey(lineKey: string): {
  assetClass: IbkrMarketDataLineAssetClass;
  symbol: string | null;
  providerContractId: string | null;
} | null {
  if (lineKey.startsWith("equity:")) {
    const symbol = normalizeSymbol(lineKey.slice("equity:".length));
    return symbol
      ? { assetClass: "equity", symbol, providerContractId: null }
      : null;
  }

  if (lineKey.startsWith("option:")) {
    const providerContractId = lineKey.slice("option:".length).trim();
    return providerContractId
      ? { assetClass: "option", symbol: null, providerContractId }
      : null;
  }

  return null;
}
