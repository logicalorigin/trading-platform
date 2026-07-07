export type OrderReadSuppressionReason =
  | "orders_bridge_update_required"
  | "orders_timeout";

type OrderReadSuppression = {
  reason: OrderReadSuppressionReason;
  message: string;
  recordedAt: number;
  until: number;
};

let suppression: OrderReadSuppression | null = null;

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function orderReadSuppressionProbeAfterMs(): number {
  return readPositiveIntegerEnv(
    "ORDER_READ_SUPPRESSION_PROBE_MS",
    readPositiveIntegerEnv("IBKR_ORDER_READ_SUPPRESSION_PROBE_MS", 2_000),
  );
}

export function markOrderReadsSuppressed(input: {
  reason: OrderReadSuppressionReason;
  message: string;
  ttlMs: number;
}): void {
  const now = Date.now();
  const ttlMs = Math.max(1_000, Math.floor(input.ttlMs));
  const until = now + ttlMs;

  if (suppression && suppression.until >= until && suppression.reason === input.reason) {
    return;
  }

  suppression = {
    reason: input.reason,
    message: input.message,
    recordedAt: now,
    until,
  };
}

export function shouldProbeOrderReadSuppression(
  value: OrderReadSuppression | null,
  now = Date.now(),
): boolean {
  if (!value || value.reason !== "orders_timeout") return false;
  return now - value.recordedAt >= orderReadSuppressionProbeAfterMs();
}

export function clearOrderReadSuppression(
  reason?: OrderReadSuppressionReason,
): void {
  if (!suppression) return;
  if (reason && suppression.reason !== reason) return;
  suppression = null;
}

export function getOrderReadSuppression(now = Date.now()):
  | (OrderReadSuppression & { remainingMs: number })
  | null {
  if (!suppression) return null;
  const remainingMs = suppression.until - now;
  if (remainingMs <= 0) {
    suppression = null;
    return null;
  }
  return { ...suppression, remainingMs };
}

export function __resetOrderReadSuppressionForTests(): void {
  suppression = null;
}
