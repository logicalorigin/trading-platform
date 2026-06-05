import { useIbkrOptionQuoteStream } from "../../features/platform/live-streams";

const isOpraOptionTicker = (value) =>
  /^O:/i.test(String(value ?? "").trim());

const normalizedProviderContractId = (value) => {
  const text = String(value || "").trim();
  return text && !isOpraOptionTicker(text) ? text : "";
};

const optionRightCode = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "call" || normalized === "c") return "C";
  if (normalized === "put" || normalized === "p") return "P";
  return "";
};

const optionExpirationKey = (value) => {
  const text = String(value || "").trim();
  const dateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dateOnly) return `${dateOnly[1]}${dateOnly[2]}${dateOnly[3]}`;
  if (/^\d{8}$/.test(text)) return text;
  return "";
};

export const structuredOptionProviderContractId = (contract) => {
  const underlying = String(contract?.underlying || "").trim().toUpperCase();
  const expiration = optionExpirationKey(contract?.expirationDate);
  const strike = Number(contract?.strike);
  const right = optionRightCode(contract?.right);
  if (!underlying || !expiration || !Number.isFinite(strike) || !right) {
    return "";
  }
  const multiplier = Number(contract?.multiplier ?? contract?.sharesPerContract ?? 100);
  const payload = {
    v: 1,
    u: underlying,
    e: expiration,
    s: strike,
    r: right,
    x: "SMART",
    tc: underlying,
    m: Number.isFinite(multiplier) && multiplier > 0 ? Math.trunc(multiplier) : 100,
  };
  return `twsopt:${btoa(JSON.stringify(payload))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")}`;
};

const optionProviderContractId = (contract) =>
  structuredOptionProviderContractId(contract) ||
  normalizedProviderContractId(contract?.providerContractId || contract?.conid);

const rowOptionProviderContractId = (row) =>
  optionProviderContractId(row?.optionContract) ||
  normalizedProviderContractId(row?.optionQuote?.providerContractId);

const rowOptionUnderlying = (row) => {
  const text = String(
    row?.optionContract?.underlying ||
      row?.underlyingMarket?.symbol ||
      row?.marketDataSymbol ||
      row?.symbol ||
      "",
  ).trim().toUpperCase();
  return text || null;
};

export const optionQuoteStreamGroupOwner = (
  owner = "account-position-option-quotes:ui",
  group = {},
) => {
  const baseOwner =
    String(owner || "").trim() || "account-position-option-quotes:ui";
  const scope = String(group?.underlying || "__unknown__")
    .trim()
    .toUpperCase();
  return `${baseOwner}:${scope || "__UNKNOWN__"}`;
};

export const buildPositionOptionQuoteGroups = (rows) => {
  const groups = new Map();
  rows.forEach((row) => {
    const providerContractId = rowOptionProviderContractId(row);
    if (!providerContractId) return;
    const underlying = rowOptionUnderlying(row);
    const key = underlying || "__unknown__";
    const group = groups.get(key) || {
      underlying,
      providerContractIds: new Set(),
    };
    group.providerContractIds.add(providerContractId);
    groups.set(key, group);
  });
  return Array.from(groups.values()).map((group) => ({
    underlying: group.underlying,
    providerContractIds: Array.from(group.providerContractIds),
  }));
};

const PositionOptionQuoteStreamGroup = ({
  underlying,
  providerContractIds,
  enabled,
  owner = "account-position-option-quotes:ui",
}) => {
  useIbkrOptionQuoteStream({
    underlying,
    providerContractIds,
    enabled: Boolean(enabled && providerContractIds.length),
    owner,
    intent: "account-monitor-live",
    requiresGreeks: false,
  });
  return null;
};

export const PositionOptionQuoteStreams = ({
  groups = [],
  enabled = true,
  owner = "account-position-option-quotes:ui",
}) => (
  <>
    {groups.map((group) => {
      const streamOwner = optionQuoteStreamGroupOwner(owner, group);
      return (
        <PositionOptionQuoteStreamGroup
          key={group.underlying || group.providerContractIds.join(",")}
          underlying={group.underlying}
          providerContractIds={group.providerContractIds}
          enabled={enabled}
          owner={streamOwner}
        />
      );
    })}
  </>
);
