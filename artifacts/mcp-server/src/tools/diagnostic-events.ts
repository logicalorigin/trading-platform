import { and, desc, eq, gte, lte } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { diagnosticEventsTable } from "@workspace/db/schema";
import { z } from "zod";
import { config } from "../config";
import { readFlightRecorder } from "../host/flight-recorder";
import { log } from "../log";
import { fail, fromHostError, ok, type ToolTextResult } from "./result";

const { Pool } = pg;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1_000;
const RAW_MAX_DEPTH = 4;
const RAW_MAX_OBJECT_KEYS = 40;
const RAW_MAX_ARRAY_ITEMS = 20;
const RAW_MAX_STRING_LENGTH = 2_000;
const diagnosticSchema = { diagnosticEventsTable };
const diagnosticDateInput = z
  .string()
  .trim()
  .max(64)
  .datetime({ offset: true })
  .refine((value) => Number.isFinite(new Date(value).getTime()));
const diagnosticEventsInputShape = {
  subsystem: z.string().trim().min(1).max(48).optional().describe("Filter to one diagnostics subsystem"),
  severity: z.enum(["info", "warning"]).optional(),
  from: diagnosticDateInput.optional().describe("ISO timestamp lower bound"),
  to: diagnosticDateInput.optional().describe("ISO timestamp upper bound"),
} satisfies z.ZodRawShape;
const diagnosticEventsInputSchema = z.object(diagnosticEventsInputShape);

type PressureLevel = "normal" | "watch" | "high";
type DiagnosticDatabase = NodePgDatabase<typeof diagnosticSchema>;
type DiagnosticEventRow = typeof diagnosticEventsTable.$inferSelect;

export interface DiagnosticEventsQueryInput {
  from: Date;
  to: Date;
  subsystem?: string;
  severity?: "info" | "warning";
  limit: number;
}

type ReadDiagnosticEvents = (
  input: DiagnosticEventsQueryInput,
) => Promise<DiagnosticEventRow[]>;
type ReadPressureLevel = () => Promise<PressureLevel>;

let database: DiagnosticDatabase | null = null;

function getDatabase(): DiagnosticDatabase {
  if (database) return database;

  const connectionString = process.env["DATABASE_URL"]?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured");
  }

  const pool = new Pool({
    connectionString,
    max: 1,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: config.apiTimeoutMs,
    query_timeout: config.apiTimeoutMs,
    statement_timeout: config.apiTimeoutMs,
    allowExitOnIdle: true,
    application_name: "pyrus-mcp-diagnostics",
  });
  pool.on("error", (error) => {
    log.warn("diagnostic events DB pool error", error.message);
  });
  database = drizzle(pool, { schema: diagnosticSchema });
  return database;
}

export function buildDiagnosticEventsQuery(
  target: DiagnosticDatabase,
  input: DiagnosticEventsQueryInput,
) {
  const clauses = [
    gte(diagnosticEventsTable.lastSeenAt, input.from),
    lte(diagnosticEventsTable.lastSeenAt, input.to),
  ];
  if (input.subsystem) {
    clauses.push(eq(diagnosticEventsTable.subsystem, input.subsystem));
  }
  if (input.severity) {
    clauses.push(eq(diagnosticEventsTable.severity, input.severity));
  }
  return target
    .select()
    .from(diagnosticEventsTable)
    .where(and(...clauses))
    .orderBy(desc(diagnosticEventsTable.lastSeenAt))
    .limit(input.limit);
}

async function readDiagnosticEvents(
  input: DiagnosticEventsQueryInput,
): Promise<DiagnosticEventRow[]> {
  return buildDiagnosticEventsQuery(getDatabase(), input);
}

function isPressureLevel(value: unknown): value is PressureLevel {
  return value === "normal" || value === "watch" || value === "high";
}

async function readPressureLevel(): Promise<PressureLevel> {
  const { apiCurrent } = await readFlightRecorder();
  if (!apiCurrent || typeof apiCurrent !== "object") return "normal";
  const apiPressure = (apiCurrent as Record<string, unknown>)["apiPressure"];
  if (!apiPressure || typeof apiPressure !== "object") return "normal";
  const level = (apiPressure as Record<string, unknown>)["resourceLevel"];
  return isPressureLevel(level) ? level : "normal";
}

function compactRawValue(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value.length > RAW_MAX_STRING_LENGTH
      ? `${value.slice(0, RAW_MAX_STRING_LENGTH)}...`
      : value;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (depth >= RAW_MAX_DEPTH) {
    return Array.isArray(value)
      ? { __truncated: "array-depth" }
      : { __truncated: "object-depth" };
  }
  if (Array.isArray(value)) {
    const items = value
      .slice(0, RAW_MAX_ARRAY_ITEMS)
      .map((item) => compactRawValue(item, depth + 1));
    return value.length > RAW_MAX_ARRAY_ITEMS
      ? [...items, { __truncated: value.length - RAW_MAX_ARRAY_ITEMS }]
      : items;
  }
  if (typeof value !== "object") return null;

  const entries = Object.entries(value as Record<string, unknown>);
  const compact: Record<string, unknown> = {};
  entries.slice(0, RAW_MAX_OBJECT_KEYS).forEach(([key, item]) => {
    compact[key] = compactRawValue(item, depth + 1);
  });
  if (entries.length > RAW_MAX_OBJECT_KEYS) {
    compact["__truncated"] = entries.length - RAW_MAX_OBJECT_KEYS;
  }
  return compact;
}

function compactRaw(raw: unknown, severity: string): Record<string, unknown> {
  if (severity === "info") return {};
  const compact = compactRawValue(raw);
  return compact && typeof compact === "object" && !Array.isArray(compact)
    ? (compact as Record<string, unknown>)
    : {};
}

function eventPayload(row: DiagnosticEventRow) {
  return {
    id: row.id,
    incidentKey: row.incidentKey,
    subsystem: row.subsystem,
    category: row.category,
    code: row.code,
    severity: row.severity,
    status: row.status,
    message: row.message,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    eventCount: row.eventCount,
    dimensions: row.dimensions,
    raw: compactRaw(row.raw, row.severity),
  };
}

export async function handleListDiagnosticEvents(
  args: Record<string, unknown>,
  readEvents: ReadDiagnosticEvents = readDiagnosticEvents,
  getPressureLevel: ReadPressureLevel = readPressureLevel,
): Promise<ToolTextResult> {
  const parsed = diagnosticEventsInputSchema.safeParse(args);
  if (!parsed.success) {
    return fail("list_diagnostic_events failed: invalid input.");
  }
  const to = parsed.data.to === undefined ? new Date() : new Date(parsed.data.to);
  const from = parsed.data.from === undefined
    ? new Date(to.getTime() - 60 * 60 * 1_000)
    : new Date(parsed.data.from);
  if (from.getTime() > to.getTime()) {
    return fail("list_diagnostic_events failed: invalid input.");
  }
  const pressureLevel = await getPressureLevel().catch(() => "normal" as const);
  const { subsystem, severity } = parsed.data;
  const input: DiagnosticEventsQueryInput = {
    from,
    to,
    ...(subsystem ? { subsystem } : {}),
    ...(severity ? { severity } : {}),
    limit: DEFAULT_LIMIT,
  };

  let rows: DiagnosticEventRow[];
  try {
    rows = await readEvents(input);
  } catch {
    return fail("list_diagnostic_events failed: DB unreachable.");
  }

  return ok({
    from: from.toISOString(),
    to: to.toISOString(),
    events: rows.map(eventPayload),
    limits: {
      requestedLimit: DEFAULT_LIMIT,
      appliedLimit: DEFAULT_LIMIT,
      maxLimit: MAX_LIMIT,
      absoluteMaxLimit: MAX_LIMIT,
      pressureLevel,
      pressureLimited: false,
    },
  });
}

async function runDiagnosticEventsTool(
  args: Record<string, unknown>,
  readEvents: ReadDiagnosticEvents = readDiagnosticEvents,
  getPressureLevel: ReadPressureLevel = readPressureLevel,
): Promise<ToolTextResult> {
  try {
    return await handleListDiagnosticEvents(args, readEvents, getPressureLevel);
  } catch (error) {
    return fromHostError("list_diagnostic_events", error);
  }
}

export const diagnosticEventsTool = {
  name: "list_diagnostic_events",
  description:
    "Diagnostic events/incidents (open and resolved). Filter by subsystem, severity (info|warning), and an ISO from/to time window.",
  inputShape: diagnosticEventsInputShape,
  run: runDiagnosticEventsTool,
} as const;
