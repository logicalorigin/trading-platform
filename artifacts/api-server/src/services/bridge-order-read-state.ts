export type BridgeOrderReadSuppressionReason =
  | "orders_bridge_update_required"
  | "orders_timeout";

type BridgeOrderReadSuppression = {
  reason: BridgeOrderReadSuppressionReason;
  message: string;
  recordedAt: number;
  until: number;
};

let suppression: BridgeOrderReadSuppression | null = null;

export function markBridgeOrderReadsSuppressed(input: {
  reason: BridgeOrderReadSuppressionReason;
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

export function clearBridgeOrderReadSuppression(
  reason?: BridgeOrderReadSuppressionReason,
): void {
  if (!suppression) {
    return;
  }
  if (reason && suppression.reason !== reason) {
    return;
  }
  suppression = null;
}

export function getBridgeOrderReadSuppression(now = Date.now()):
  | (BridgeOrderReadSuppression & { remainingMs: number })
  | null {
  if (!suppression) {
    return null;
  }

  const remainingMs = suppression.until - now;
  if (remainingMs <= 0) {
    suppression = null;
    return null;
  }

  return {
    ...suppression,
    remainingMs,
  };
}

export function __resetBridgeOrderReadSuppressionForTests(): void {
  suppression = null;
}
