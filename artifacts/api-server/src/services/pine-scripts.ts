import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { desc, eq } from "drizzle-orm";
import { db, pineScriptsTable, type PineScript } from "@workspace/db";
import { HttpError } from "../lib/errors";
import { logger } from "../lib/logger";
import {
  createTransientPostgresBackoff,
  isTransientPostgresError,
} from "../lib/transient-db-error";

type CreatePineScriptInput = {
  scriptKey?: string | null;
  name: string;
  description?: string | null;
  sourceCode: string;
  status?: "draft" | "ready" | "error" | "archived";
  defaultPaneType?: "price" | "lower";
  chartAccessEnabled?: boolean;
  notes?: string | null;
  lastError?: string | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
};

type UpdatePineScriptInput = {
  name?: string;
  description?: string | null;
  sourceCode?: string;
  status?: "draft" | "ready" | "error" | "archived";
  defaultPaneType?: "price" | "lower";
  chartAccessEnabled?: boolean;
  notes?: string | null;
  lastError?: string | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
};

type PineScriptFileRecord = Omit<PineScript, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};

type BundledPineSeed = CreatePineScriptInput & {
  scriptKey: string;
};

type StorageMode = "db" | "fallback";

const RAY_REPLICA_PINE_SCRIPT_KEY = "rayalgo-replica-smc-pro-v3";
const pineScriptsDbBackoff = createTransientPostgresBackoff();

function resolveApiServerDataRoot(): string {
  const candidates = [
    path.resolve(process.cwd(), "data"),
    path.resolve(process.cwd(), "artifacts", "api-server", "data"),
  ];

  const existingRoot = candidates.find((candidate) => existsSync(candidate));
  return existingRoot ?? candidates[0];
}

const API_SERVER_DATA_ROOT = resolveApiServerDataRoot();
const PINE_SCRIPT_FALLBACK_PATH = path.resolve(
  API_SERVER_DATA_ROOT,
  "pine-scripts.json",
);
const RAY_REPLICA_PINE_SOURCE_PATH = path.resolve(
  API_SERVER_DATA_ROOT,
  "pine-seeds",
  "rayalgo-replica-smc-pro-v3.pine",
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingRelationError(error: unknown): boolean {
  if (!isRecord(error)) {
    return false;
  }

  if (error.code === "42P01") {
    return true;
  }

  const cause = error.cause;
  return isRecord(cause) && cause.code === "42P01";
}

function shouldUseFallbackStorage(error: unknown): boolean {
  return isMissingRelationError(error) || isTransientPostgresError(error);
}

function markPineScriptsDbUnavailable(error: unknown): void {
  pineScriptsDbBackoff.markFailure({
    error,
    logger,
    message: "Pine script database unavailable; serving file fallback",
    nowMs: Date.now(),
  });
}

function isPineScriptsDbBackoffActive(): boolean {
  return pineScriptsDbBackoff.isActive(Date.now());
}

function normalizeNullableText(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeTags(tags: string[] | undefined): string[] {
  if (!Array.isArray(tags)) {
    return [];
  }

  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
}

function normalizeMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return isRecord(metadata) ? metadata : {};
}

function normalizeScriptKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 128);
}

function ensurePineScriptName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new HttpError(400, "Pine script name is required.", {
      code: "pine_script_name_required",
    });
  }

  return trimmed;
}

function ensurePineSourceCode(sourceCode: string): string {
  const trimmed = sourceCode.trim();
  if (!trimmed) {
    throw new HttpError(400, "Pine source is required.", {
      code: "pine_script_source_required",
    });
  }

  return sourceCode;
}

function pineScriptToResponse(script: PineScript) {
  return {
    id: script.id,
    scriptKey: script.scriptKey,
    name: script.name,
    description: script.description ?? null,
    sourceCode: script.sourceCode,
    status: script.status,
    defaultPaneType: script.defaultPaneType,
    chartAccessEnabled: script.chartAccessEnabled,
    notes: script.notes ?? null,
    lastError: script.lastError ?? null,
    tags: script.tags ?? [],
    metadata: script.metadata ?? {},
    createdAt: script.createdAt,
    updatedAt: script.updatedAt,
  };
}

function deserializeFileRecord(record: PineScriptFileRecord): PineScript {
  return {
    ...record,
    description: record.description ?? null,
    notes: record.notes ?? null,
    lastError: record.lastError ?? null,
    tags: record.tags ?? [],
    metadata: record.metadata ?? {},
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  };
}

function sortScriptsDescending(scripts: PineScript[]): PineScript[] {
  return [...scripts].sort(
    (left, right) =>
      right.updatedAt.getTime() - left.updatedAt.getTime() ||
      right.createdAt.getTime() - left.createdAt.getTime(),
  );
}

async function readFallbackScripts(): Promise<PineScript[]> {
  try {
    const raw = await readFile(PINE_SCRIPT_FALLBACK_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((value): value is PineScriptFileRecord => isRecord(value))
      .map((record) => deserializeFileRecord(record as PineScriptFileRecord))
      .sort(
        (left, right) =>
          right.updatedAt.getTime() - left.updatedAt.getTime() ||
          right.createdAt.getTime() - left.createdAt.getTime(),
      );
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function writeFallbackScripts(scripts: PineScript[]): Promise<void> {
  await mkdir(path.dirname(PINE_SCRIPT_FALLBACK_PATH), { recursive: true });
  const serializable = scripts.map<PineScriptFileRecord>((script) => ({
    ...script,
    createdAt: script.createdAt.toISOString(),
    updatedAt: script.updatedAt.toISOString(),
  }));
  await writeFile(
    PINE_SCRIPT_FALLBACK_PATH,
    `${JSON.stringify(serializable, null, 2)}\n`,
    "utf8",
  );
}

async function readScriptsFromStorage(): Promise<{
  scripts: PineScript[];
  mode: StorageMode;
}> {
  if (isPineScriptsDbBackoffActive()) {
    return {
      scripts: await readFallbackScripts(),
      mode: "fallback",
    };
  }

  try {
    const scripts = await db
      .select()
      .from(pineScriptsTable)
      .orderBy(
        desc(pineScriptsTable.updatedAt),
        desc(pineScriptsTable.createdAt),
      );
    return {
      scripts,
      mode: "db",
    };
  } catch (error) {
    if (shouldUseFallbackStorage(error)) {
      if (isTransientPostgresError(error)) {
        markPineScriptsDbUnavailable(error);
      }
      return {
        scripts: await readFallbackScripts(),
        mode: "fallback",
      };
    }

    throw error;
  }
}

async function listScriptsFromStorage(): Promise<PineScript[]> {
  return (await readScriptsFromStorage()).scripts;
}

async function loadBundledPineSeeds(): Promise<BundledPineSeed[]> {
  try {
    const rayReplicaSource = await readFile(
      RAY_REPLICA_PINE_SOURCE_PATH,
      "utf8",
    );

    return [
      {
        scriptKey: RAY_REPLICA_PINE_SCRIPT_KEY,
        name: "RayAlgo Replica (SMC Pro v3)",
        description:
          "Shared price-pane Pine script seed for the RayReplica-style market-structure overlay.",
        sourceCode: rayReplicaSource,
        status: "ready",
        defaultPaneType: "price",
        chartAccessEnabled: true,
        notes:
          "Bundled from the first shared Pine handoff. The JS runtime adapter renders basis bands, regime windows, key levels, structure markers, order blocks, and candle colors.",
        tags: [
          "rayalgo",
          "replica",
          "smc",
          "structure",
          "order-blocks",
          "price-pane",
        ],
        metadata: {
          seed: true,
          runtimeAdapterKey: RAY_REPLICA_PINE_SCRIPT_KEY,
        },
      },
    ];
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function ensureBundledPineScriptsStored(): Promise<PineScript[]> {
  const bundledSeeds = await loadBundledPineSeeds();
  if (!bundledSeeds.length) {
    return listScriptsFromStorage();
  }

  const { scripts, mode } = await readScriptsFromStorage();
  const missingSeeds = bundledSeeds.filter(
    (seed) => !scripts.some((script) => script.scriptKey === seed.scriptKey),
  );

  if (!missingSeeds.length) {
    return scripts;
  }

  if (mode === "db") {
    try {
      await db.insert(pineScriptsTable).values(
        missingSeeds.map((seed) => ({
          scriptKey: seed.scriptKey,
          name: ensurePineScriptName(seed.name),
          description: normalizeNullableText(seed.description),
          sourceCode: ensurePineSourceCode(seed.sourceCode),
          status: seed.status ?? "draft",
          defaultPaneType: seed.defaultPaneType ?? "price",
          chartAccessEnabled: seed.chartAccessEnabled ?? false,
          notes: normalizeNullableText(seed.notes),
          lastError: normalizeNullableText(seed.lastError),
          tags: normalizeTags(seed.tags),
          metadata: normalizeMetadata(seed.metadata),
        })),
      );
    } catch (error) {
      if (shouldUseFallbackStorage(error)) {
        if (isTransientPostgresError(error)) {
          markPineScriptsDbUnavailable(error);
        }
        const now = new Date();
        const nextScripts = sortScriptsDescending([
          ...scripts,
          ...missingSeeds.map<PineScript>((seed) => ({
            id: randomUUID(),
            scriptKey: seed.scriptKey,
            name: ensurePineScriptName(seed.name),
            description: normalizeNullableText(seed.description),
            sourceCode: ensurePineSourceCode(seed.sourceCode),
            status: seed.status ?? "draft",
            defaultPaneType: seed.defaultPaneType ?? "price",
            chartAccessEnabled: seed.chartAccessEnabled ?? false,
            notes: normalizeNullableText(seed.notes),
            lastError: normalizeNullableText(seed.lastError),
            tags: normalizeTags(seed.tags),
            metadata: normalizeMetadata(seed.metadata),
            createdAt: now,
            updatedAt: now,
          })),
        ]);
        await writeFallbackScripts(nextScripts);
        return nextScripts;
      }
      if (!(isRecord(error) && error.code === "23505")) {
        throw error;
      }
    }

    return listScriptsFromStorage();
  }

  const now = new Date();
  const nextScripts = sortScriptsDescending([
    ...scripts,
    ...missingSeeds.map<PineScript>((seed) => ({
      id: randomUUID(),
      scriptKey: seed.scriptKey,
      name: ensurePineScriptName(seed.name),
      description: normalizeNullableText(seed.description),
      sourceCode: ensurePineSourceCode(seed.sourceCode),
      status: seed.status ?? "draft",
      defaultPaneType: seed.defaultPaneType ?? "price",
      chartAccessEnabled: seed.chartAccessEnabled ?? false,
      notes: normalizeNullableText(seed.notes),
      lastError: normalizeNullableText(seed.lastError),
      tags: normalizeTags(seed.tags),
      metadata: normalizeMetadata(seed.metadata),
      createdAt: now,
      updatedAt: now,
    })),
  ]);
  await writeFallbackScripts(nextScripts);
  return nextScripts;
}

async function findScriptOrThrow(scriptId: string): Promise<PineScript> {
  const scripts = await listScriptsFromStorage();
  const script = scripts.find((entry) => entry.id === scriptId) ?? null;

  if (!script) {
    throw new HttpError(404, "Pine script not found.", {
      code: "pine_script_not_found",
    });
  }

  return script;
}

function deriveUniqueScriptKey(
  requestedKey: string | null | undefined,
  name: string,
  scripts: PineScript[],
): string {
  const normalizedRequested = normalizeScriptKey(requestedKey ?? "");
  const baseKey =
    normalizedRequested || normalizeScriptKey(name) || "pine-script";
  const occupiedKeys = new Set(scripts.map((script) => script.scriptKey));

  if (!occupiedKeys.has(baseKey)) {
    return baseKey;
  }

  if (normalizedRequested) {
    throw new HttpError(409, "Pine script key already exists.", {
      code: "pine_script_key_conflict",
    });
  }

  let suffix = 2;
  let candidate = `${baseKey}-${suffix}`;
  while (occupiedKeys.has(candidate)) {
    suffix += 1;
    candidate = `${baseKey}-${suffix}`;
  }

  return candidate;
}

export async function listPineScripts() {
  const scripts = await ensureBundledPineScriptsStored();
  return {
    scripts: scripts.map((script) => pineScriptToResponse(script)),
  };
}

export async function createPineScript(input: CreatePineScriptInput) {
  const scripts = await ensureBundledPineScriptsStored();
  const name = ensurePineScriptName(input.name);
  const sourceCode = ensurePineSourceCode(input.sourceCode);
  const scriptKey = deriveUniqueScriptKey(input.scriptKey, name, scripts);
  const nextRecord = {
    scriptKey,
    name,
    description: normalizeNullableText(input.description),
    sourceCode,
    status: input.status ?? "draft",
    defaultPaneType: input.defaultPaneType ?? "price",
    chartAccessEnabled: input.chartAccessEnabled ?? false,
    notes: normalizeNullableText(input.notes),
    lastError: normalizeNullableText(input.lastError),
    tags: normalizeTags(input.tags),
    metadata: normalizeMetadata(input.metadata),
  } as const;

  try {
    const [created] = await db
      .insert(pineScriptsTable)
      .values(nextRecord)
      .returning();
    return pineScriptToResponse(created);
  } catch (error) {
    if (!shouldUseFallbackStorage(error)) {
      throw error;
    }
    if (isTransientPostgresError(error)) {
      markPineScriptsDbUnavailable(error);
    }
  }

  const now = new Date();
  const created: PineScript = {
    id: randomUUID(),
    ...nextRecord,
    createdAt: now,
    updatedAt: now,
  };
  await writeFallbackScripts([created, ...scripts]);
  return pineScriptToResponse(created);
}

export async function updatePineScript(
  scriptId: string,
  input: UpdatePineScriptInput,
) {
  await ensureBundledPineScriptsStored();
  const existing = await findScriptOrThrow(scriptId);
  const nextName =
    typeof input.name === "string"
      ? ensurePineScriptName(input.name)
      : existing.name;
  const nextSource =
    typeof input.sourceCode === "string"
      ? ensurePineSourceCode(input.sourceCode)
      : existing.sourceCode;
  const nextRecord = {
    name: nextName,
    description:
      input.description === undefined
        ? existing.description
        : normalizeNullableText(input.description),
    sourceCode: nextSource,
    status: input.status ?? existing.status,
    defaultPaneType: input.defaultPaneType ?? existing.defaultPaneType,
    chartAccessEnabled: input.chartAccessEnabled ?? existing.chartAccessEnabled,
    notes:
      input.notes === undefined
        ? existing.notes
        : normalizeNullableText(input.notes),
    lastError:
      input.lastError === undefined
        ? existing.lastError
        : normalizeNullableText(input.lastError),
    tags: input.tags ? normalizeTags(input.tags) : existing.tags,
    metadata:
      input.metadata === undefined
        ? existing.metadata
        : normalizeMetadata(input.metadata),
    updatedAt: new Date(),
  } as const;

  try {
    const [updated] = await db
      .update(pineScriptsTable)
      .set(nextRecord)
      .where(eq(pineScriptsTable.id, scriptId))
      .returning();

    if (!updated) {
      throw new HttpError(404, "Pine script not found.", {
        code: "pine_script_not_found",
      });
    }

    return pineScriptToResponse(updated);
  } catch (error) {
    if (!shouldUseFallbackStorage(error)) {
      throw error;
    }
    if (isTransientPostgresError(error)) {
      markPineScriptsDbUnavailable(error);
    }
  }

  const scripts = await listScriptsFromStorage();
  const nextScripts = scripts.map((script) =>
    script.id === scriptId
      ? {
          ...script,
          ...nextRecord,
        }
      : script,
  );
  await writeFallbackScripts(nextScripts);
  const updated = nextScripts.find((script) => script.id === scriptId) ?? null;

  if (!updated) {
    throw new HttpError(404, "Pine script not found.", {
      code: "pine_script_not_found",
    });
  }

  return pineScriptToResponse(updated);
}
