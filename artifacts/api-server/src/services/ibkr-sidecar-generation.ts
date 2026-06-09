import { createHash } from "node:crypto";
import {
  buildIbkrMarketDataLineKey,
  parseIbkrMarketDataLineKey,
  type IbkrMarketDataDesiredGeneration,
  type IbkrMarketDataDesiredLine,
  type IbkrMarketDataLineAssetClass,
  type IbkrMarketDataLineOwner,
} from "@workspace/ibkr-contracts";
import { normalizeSymbol } from "../lib/values";
import type { MarketDataLease } from "./market-data-admission";

type AdmissionWithLeases = {
  leases: MarketDataLease[];
};

type MutableDesiredLine = Omit<
  IbkrMarketDataDesiredLine,
  "owners" | "intent"
> & {
  ownersByKey: Map<string, IbkrMarketDataLineOwner>;
  highestPriorityOwner: IbkrMarketDataLineOwner | null;
};

function assetClassFromLineId(lineId: string): IbkrMarketDataLineAssetClass | null {
  if (lineId.startsWith("equity:")) {
    return "equity";
  }
  if (lineId.startsWith("option:")) {
    return "option";
  }
  return null;
}

function isStructuredIbkrOptionProviderContractId(
  providerContractId: string | null,
): boolean {
  const raw = providerContractId?.trim() ?? "";
  if (!raw.startsWith("twsopt:")) {
    return false;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(raw.slice("twsopt:".length), "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    return (
      payload["v"] === 1 &&
      typeof payload["u"] === "string" &&
      /^\d{8}$/.test(String(payload["e"] ?? "")) &&
      typeof payload["s"] === "number" &&
      (payload["r"] === "C" || payload["r"] === "P")
    );
  } catch {
    return false;
  }
}

function isNumericIbkrOptionProviderContractId(
  providerContractId: string | null,
): boolean {
  const raw = providerContractId?.trim() ?? "";
  return /^[1-9]\d+$/.test(raw);
}

function isIbkrOptionProviderContractIdResolvable(
  providerContractId: string | null,
): boolean {
  return (
    isNumericIbkrOptionProviderContractId(providerContractId) ||
    isStructuredIbkrOptionProviderContractId(providerContractId)
  );
}

function ownerKey(owner: IbkrMarketDataLineOwner): string {
  return `${owner.owner}\u0000${owner.intent}\u0000${owner.pool ?? ""}`;
}

function compareOwners(
  left: IbkrMarketDataLineOwner,
  right: IbkrMarketDataLineOwner,
): number {
  return (
    (right.priority ?? -Infinity) - (left.priority ?? -Infinity) ||
    left.owner.localeCompare(right.owner) ||
    left.intent.localeCompare(right.intent)
  );
}

function createMutableDesiredLine(input: {
  lineKey: string;
  lease: MarketDataLease;
}): MutableDesiredLine | null {
  const assetClass = assetClassFromLineId(input.lineKey);
  if (!assetClass) {
    return null;
  }
  const normalizedKey = buildIbkrMarketDataLineKey({
    assetClass,
    symbol: input.lease.symbol,
    providerContractId: input.lease.providerContractId,
  });
  const parsed = parseIbkrMarketDataLineKey(normalizedKey ?? input.lineKey);
  if (!parsed || parsed.assetClass !== assetClass) {
    return null;
  }
  if (
    assetClass === "option" &&
    !isIbkrOptionProviderContractIdResolvable(parsed.providerContractId)
  ) {
    return null;
  }
  const symbol =
    assetClass === "equity"
      ? parsed.symbol
      : normalizeSymbol(input.lease.symbol ?? "") || null;
  const lineRole = input.lease.lineRoles[input.lineKey] ?? input.lease.role;
  const equityProviderContractId =
    assetClass === "equity" && lineRole !== "option-underlier-support"
      ? input.lease.providerContractId?.trim() || null
      : null;

  return {
    lineKey: normalizedKey ?? input.lineKey,
    assetClass,
    contract: {
      symbol,
      providerContractId:
        assetClass === "equity" ? equityProviderContractId : parsed.providerContractId,
    },
    priority: null,
    reason: "api-admission-live-lease",
    ownersByKey: new Map(),
    highestPriorityOwner: null,
  };
}

function addOwner(line: MutableDesiredLine, lease: MarketDataLease): void {
  const lineRole = lease.lineRoles[line.lineKey] ?? lease.role;
  const providerContractId = lease.providerContractId?.trim() || null;
  if (
    line.assetClass === "equity" &&
    providerContractId &&
    lineRole !== "option-underlier-support" &&
    !line.contract.providerContractId
  ) {
    line.contract.providerContractId = providerContractId;
  }
  const owner: IbkrMarketDataLineOwner = {
    owner: lease.owner,
    ownerClass: lease.ownerClass,
    intent: lease.intent,
    pool: lease.pool,
    priority: lease.priority,
  };
  line.ownersByKey.set(ownerKey(owner), owner);
  line.priority =
    line.priority === null ? lease.priority : Math.max(line.priority, lease.priority);
  if (!line.highestPriorityOwner || compareOwners(owner, line.highestPriorityOwner) < 0) {
    line.highestPriorityOwner = owner;
  }
}

function finalizeDesiredLine(line: MutableDesiredLine): IbkrMarketDataDesiredLine {
  const owners = Array.from(line.ownersByKey.values()).sort((left, right) =>
    left.owner.localeCompare(right.owner) ||
    left.intent.localeCompare(right.intent),
  );
  return {
    lineKey: line.lineKey,
    assetClass: line.assetClass,
    contract: line.contract,
    intent: line.highestPriorityOwner?.intent ?? "unknown",
    owners,
    priority: line.priority,
    reason: line.reason,
  };
}

function hashGeneration(lines: IbkrMarketDataDesiredLine[]): string {
  const hash = createHash("sha256");
  hash.update(
    JSON.stringify(
      lines.map((line) => ({
        lineKey: line.lineKey,
        owners: line.owners.map((owner) => [
          owner.owner,
          owner.intent,
          owner.pool,
          owner.priority,
        ]),
      })),
    ),
  );
  return `api-admission:${hash.digest("hex").slice(0, 16)}`;
}

function compareDesiredLinesByPriority(
  left: IbkrMarketDataDesiredLine,
  right: IbkrMarketDataDesiredLine,
): number {
  return (
    (right.priority ?? -Infinity) - (left.priority ?? -Infinity) ||
    left.lineKey.localeCompare(right.lineKey)
  );
}

export function buildIbkrSidecarDesiredGeneration(input: {
  admission: AdmissionWithLeases;
  generatedAt?: string;
  plannerGeneration?: string | null;
}): IbkrMarketDataDesiredGeneration {
  const linesByKey = new Map<string, MutableDesiredLine>();

  input.admission.leases.forEach((lease) => {
    lease.lineIds.forEach((lineId) => {
      const createdLine = createMutableDesiredLine({ lineKey: lineId, lease });
      if (!createdLine) {
        return;
      }
      const mutableLine = linesByKey.get(createdLine.lineKey) ?? createdLine;
      addOwner(mutableLine, lease);
      linesByKey.set(mutableLine.lineKey, mutableLine);
    });
  });

  const desiredLines = Array.from(linesByKey.values())
    .map(finalizeDesiredLine)
    .sort(compareDesiredLinesByPriority);
  const ownerCount = new Set(
    desiredLines.flatMap((line) => line.owners.map((owner) => owner.owner)),
  ).size;

  return {
    schemaVersion: 1,
    generationId: input.plannerGeneration ?? hashGeneration(desiredLines),
    source: "api-market-data-work-planner",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    desiredLines,
    summary: {
      desiredLineCount: desiredLines.length,
      desiredEquityLineCount: desiredLines.filter(
        (line) => line.assetClass === "equity",
      ).length,
      desiredOptionLineCount: desiredLines.filter(
        (line) => line.assetClass === "option",
      ).length,
      ownerCount,
    },
  };
}
