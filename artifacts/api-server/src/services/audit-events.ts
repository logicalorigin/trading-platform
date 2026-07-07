import { db, auditEventsTable } from "@workspace/db";
import { logger } from "../lib/logger";

export type AuditEventType =
  | "auth.bootstrap"
  | "auth.login"
  | "auth.launch"
  | "broker.connect_start"
  | "broker.connect_complete"
  | "broker.connect_denied"
  | "broker.sync"
  | "broker.disconnect"
  | "broker.order_mutation_attempt"
  | "entitlement.changed"
  | "entitlement.denied";

export type AuditEventInput = {
  appUserId: string;
  eventType: AuditEventType | (string & {});
  subject?: AuditEventSubject;
  resource?: AuditEventSubject;
  payload?: unknown;
};

type AuditEventSubject = {
  type: string;
  id?: string | null;
};

type JsonRecord = Record<string, unknown>;

const MAX_STRING_LENGTH = 512;
const MAX_ARRAY_ITEMS = 20;
const MAX_OBJECT_KEYS = 30;
const MAX_DEPTH = 4;
const MAX_PAYLOAD_BYTES = 8_000;

function truncateString(value: string, maxLength = MAX_STRING_LENGTH): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...[truncated]`;
}

function normalizePayloadValue(value: unknown, depth: number): unknown {
  if (value === null) return null;
  if (typeof value === "string") return truncateString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (depth >= MAX_DEPTH) return "[truncated:max_depth]";
  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => normalizePayloadValue(item, depth + 1));
    if (value.length > MAX_ARRAY_ITEMS) {
      items.push(`[truncated:${value.length - MAX_ARRAY_ITEMS}_items]`);
    }
    return items;
  }
  if (value && typeof value === "object") {
    const output: JsonRecord = {};
    const entries = Object.entries(value as JsonRecord).slice(0, MAX_OBJECT_KEYS);
    for (const [key, entryValue] of entries) {
      output[truncateString(key, 96)] = normalizePayloadValue(
        entryValue,
        depth + 1,
      );
    }
    const totalKeys = Object.keys(value as JsonRecord).length;
    if (totalKeys > MAX_OBJECT_KEYS) {
      output.__truncatedKeys = totalKeys - MAX_OBJECT_KEYS;
    }
    return output;
  }
  if (value === undefined) return null;
  return String(value);
}

export function normalizeAuditPayload(payload: unknown): JsonRecord {
  const normalized = normalizePayloadValue(payload ?? {}, 0);
  const record =
    normalized && typeof normalized === "object" && !Array.isArray(normalized)
      ? (normalized as JsonRecord)
      : { value: normalized };
  const json = JSON.stringify(record);
  if (Buffer.byteLength(json, "utf8") <= MAX_PAYLOAD_BYTES) {
    return record;
  }
  return {
    truncated: true,
    originalBytes: Buffer.byteLength(json, "utf8"),
    note: "audit payload exceeded byte limit",
  };
}

function normalizeSubject(
  subject: AuditEventSubject | undefined,
): { type: string | null; id: string | null } {
  return {
    type: subject?.type ? truncateString(subject.type, 64) : null,
    id: subject?.id ? truncateString(subject.id, 512) : null,
  };
}

// Best-effort audit writer. Call sites intentionally use `void recordAuditEvent(...)`:
// persistence must never block or fail the user action being audited.
export async function recordAuditEvent(input: AuditEventInput): Promise<void> {
  const subject = normalizeSubject(input.subject);
  const resource = normalizeSubject(input.resource);
  try {
    await db.insert(auditEventsTable).values({
      appUserId: input.appUserId,
      eventType: truncateString(input.eventType, 96),
      subjectType: subject.type,
      subjectId: subject.id,
      resourceType: resource.type,
      resourceId: resource.id,
      payload: normalizeAuditPayload(input.payload),
    });
  } catch (error) {
    logger.warn(
      { err: error, appUserId: input.appUserId, eventType: input.eventType },
      "Audit event write failed",
    );
  }
}
