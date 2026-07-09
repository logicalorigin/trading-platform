import { and, desc, eq, gte, lte } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { diagnosticEventsTable } from "@workspace/db/schema";
import { z } from "zod";
import { config } from "../config";
import { readFlightRecorder } from "../host/flight-recorder";
import { log } from "../log";
import { fail, ok, type ToolTextResult } from "./result";

const { Pool } = pg;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1_000;
const PRESSURE_LIMITS = { normal: 1_000, watch: 300, high: 150 } as const;
const RAW_MAX_DEPTH = 4;
const RAW_MAX_OBJECT_KEYS = 40;
const RAW_MAX_ARRAY_ITEMS = 20;
const RAW_MAX_STRING_LENGTH = 2_000;
const diagnosticSchema = { diagnosticEventsTable };

type PressureLevel = keyof typeof PRESSURE_LIMITS;
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

function parseDate(value: unknown, fallback: Date): Date {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : fallback;
}

function stringFilter(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.trim() || undefined;
}

function severityFilter(value: unknown): "info" | "warning" | undefined {
  return value === "info" || value === "warning" ? value : undefined;
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
  const to = parseDate(args["to"], new Date());
  const from = parseDate(args["from"], new Date(to.getTime() - 60 * 60 * 1_000));
  const pressureLevel = await getPressureLevel().catch(() => "normal" as const);
  const pressureLimit = PRESSURE_LIMITS[pressureLevel];
  const appliedLimit = Math.min(DEFAULT_LIMIT, pressureLimit);
  const subsystem = stringFilter(args["subsystem"]);
  const severity = severityFilter(args["severity"]);
  const input: DiagnosticEventsQueryInput = {
    from,
    to,
    ...(subsystem ? { subsystem } : {}),
    ...(severity ? { severity } : {}),
    limit: appliedLimit,
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
      appliedLimit,
      maxLimit: Math.min(MAX_LIMIT, pressureLimit),
      absoluteMaxLimit: MAX_LIMIT,
      pressureLevel,
      pressureLimited: appliedLimit < DEFAULT_LIMIT,
    },
  });
}

export const diagnosticEventsTool = {
  name: "list_diagnostic_events",
  description:
    "Diagnostic events/incidents (open and resolved). Filter by subsystem, severity (info|warning), and an ISO from/to time window.",
  inputShape: {
    subsystem: z.string().optional().describe("Filter to one diagnostics subsystem"),
    severity: z.enum(["info", "warning"]).optional(),
    from: z.string().optional().describe("ISO timestamp lower bound"),
    to: z.string().optional().describe("ISO timestamp upper bound"),
  },
  run: handleListDiagnosticEvents,
} as const;
