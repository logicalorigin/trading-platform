type JsonRecord = Record<string, unknown>;

export type DiagnosticsAccountProbeTarget = {
  accountId: string | null;
  provider: string | null;
  displayName: string | null;
  accountCount: number;
  snapTradeAccountCount: number;
  positionProbeProvider: "legacy" | "snaptrade" | "none";
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function accountIdentifier(account: JsonRecord): string | null {
  return textValue(account["providerAccountId"]) ?? textValue(account["id"]);
}

export function selectDiagnosticsAccountProbeTarget(
  accounts: unknown[],
): DiagnosticsAccountProbeTarget {
  const records = accounts.map(asRecord);
  const snapTradeAccounts = records.filter(
    (account) => textValue(account["provider"]) === "snaptrade",
  );
  const selected = snapTradeAccounts[0] ?? records[0] ?? {};
  const provider = textValue(selected["provider"]);
  const accountId = accountIdentifier(selected);

  return {
    accountId,
    provider,
    displayName: textValue(selected["displayName"]),
    accountCount: records.length,
    snapTradeAccountCount: snapTradeAccounts.length,
    positionProbeProvider: snapTradeAccounts.length
      ? "snaptrade"
      : accountId
        ? "legacy"
        : "none",
  };
}

export function diagnosticsPositionProbeForTarget(
  target: DiagnosticsAccountProbeTarget,
) {
  if (target.positionProbeProvider === "snaptrade") {
    return {
      ok: true,
      count: 0,
      provider: "snaptrade",
      accountId: target.accountId,
      accountCount: target.snapTradeAccountCount,
      source: "diagnostics-collector",
      skippedLegacyBridgeProbe: true,
      reason: "snaptrade_accounts_observed",
    };
  }

  return {
    ok: true,
    count: 0,
    provider: null,
    accountId: null,
    accountCount: target.accountCount,
    source: "diagnostics-collector",
    skippedLegacyBridgeProbe: true,
    reason: "no_accounts_observed",
  };
}
