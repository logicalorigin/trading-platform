import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { logger } from "./logger";

export type BridgeLaneOverrideDocument = {
  version: 1;
  scheduler?: Record<string, Record<string, number>>;
  limits?: Record<string, number>;
  updatedAt?: string;
};

type OverrideSection = "scheduler" | "limits";

const overrideFile =
  process.env["IBKR_BRIDGE_LANE_OVERRIDE_FILE"]?.trim() ||
  join(homedir(), ".rayalgo", "ibkr-bridge-lane-overrides.json");

let loaded = false;
let document: BridgeLaneOverrideDocument = { version: 1 };

function safeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeNumberRecord(
  value: unknown,
): Record<string, Record<string, number>> | undefined {
  const outer = safeRecord(value);
  const normalized: Record<string, Record<string, number>> = {};

  Object.entries(outer).forEach(([key, rawInner]) => {
    const inner = safeRecord(rawInner);
    const normalizedInner: Record<string, number> = {};
    Object.entries(inner).forEach(([innerKey, rawValue]) => {
      const parsed = Number(rawValue);
      if (Number.isFinite(parsed)) {
        normalizedInner[innerKey] = Math.floor(parsed);
      }
    });
    if (Object.keys(normalizedInner).length > 0) {
      normalized[key] = normalizedInner;
    }
  });

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeFlatNumberRecord(
  value: unknown,
): Record<string, number> | undefined {
  const normalized: Record<string, number> = {};
  Object.entries(safeRecord(value)).forEach(([key, rawValue]) => {
    const parsed = Number(rawValue);
    if (Number.isFinite(parsed)) {
      normalized[key] = Math.floor(parsed);
    }
  });
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function loadDocument(): BridgeLaneOverrideDocument {
  if (loaded) {
    return document;
  }
  loaded = true;

  try {
    if (!existsSync(overrideFile)) {
      return document;
    }

    const raw = JSON.parse(readFileSync(overrideFile, "utf8")) as unknown;
    const record = safeRecord(raw);
    document = {
      version: 1,
      scheduler: normalizeNumberRecord(record.scheduler),
      limits: normalizeFlatNumberRecord(record.limits),
      updatedAt:
        typeof record.updatedAt === "string" ? record.updatedAt : undefined,
    };
  } catch (error) {
    logger.warn({ err: error, overrideFile }, "Failed to load bridge lane overrides");
  }

  return document;
}

function persistDocument(): void {
  try {
    mkdirSync(dirname(overrideFile), { recursive: true });
    writeFileSync(overrideFile, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  } catch (error) {
    logger.warn(
      { err: error, overrideFile },
      "Failed to persist bridge lane overrides",
    );
  }
}

export function getBridgeLaneOverrides(): BridgeLaneOverrideDocument {
  const current = loadDocument();
  return {
    version: 1,
    scheduler: current.scheduler ? { ...current.scheduler } : undefined,
    limits: current.limits ? { ...current.limits } : undefined,
    updatedAt: current.updatedAt,
  };
}

export function setBridgeLaneOverrideSection(
  section: OverrideSection,
  value: BridgeLaneOverrideDocument[OverrideSection],
): BridgeLaneOverrideDocument {
  const current = loadDocument();
  document = {
    ...current,
    [section]: value,
    updatedAt: new Date().toISOString(),
  };
  persistDocument();
  return getBridgeLaneOverrides();
}

