import { useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  CSS_COLOR,
  FONT_WEIGHTS,
  T,
  cssColorMix,
  dim,
  fs,
  sp,
} from "../../lib/uiTokens.jsx";
import {
  BrokerAccountCard,
  BrokerAccountIdentity,
} from "../../components/platform/BrokerAccountCardPresentation.jsx";
import { normalizeLegacyAlgoBrandText } from "../algo/algoBranding.js";
import {
  formatAccountMoney,
  formatAccountPercent,
  formatAccountSignedMoney,
  maskAccountId,
  toneForValue,
} from "./accountUtils.jsx";
import { AccountCardPerformanceDisclosure } from "./AccountCardPerformanceDisclosure.jsx";
import { normalizeAccountCurrency } from "./accountCurrency.js";

const ALL_TAB_ID = "all";
const SHADOW_TAB_ID = "shadow";
const MAX_VISIBLE_DEPLOYMENTS = 3;

// `provider` keys the local broker-logo asset; `tone` drives the active
// border/background accent; `label` is the human broker name.
const BROKER_BRANDS = {
  all: { label: "All accounts", provider: "all", tone: CSS_COLOR.accent },
  alpaca: { label: "Alpaca", provider: "alpaca", tone: CSS_COLOR.amber },
  etrade: { label: "E*TRADE", provider: "etrade", tone: CSS_COLOR.purple },
  ibkr: { label: "IBKR", provider: "ibkr", tone: CSS_COLOR.red },
  robinhood: {
    label: "Robinhood",
    provider: "robinhood",
    tone: CSS_COLOR.green,
  },
  schwab: { label: "Schwab", provider: "schwab", tone: CSS_COLOR.blue },
  snaptrade: {
    label: "SnapTrade",
    provider: "snaptrade",
    tone: CSS_COLOR.cyan,
  },
  webull: { label: "Webull", provider: "webull", tone: CSS_COLOR.blue },
  shadow: { label: "Shadow", provider: "shadow", tone: CSS_COLOR.pink },
  brokerage: {
    label: "Brokerage",
    provider: "brokerage",
    tone: CSS_COLOR.textMuted,
  },
};

// `provider` is the ONLY provider-identity field in the normalized account wire
// shape (GET /api/accounts): 'ibkr' for IBKR, 'snaptrade' for every
// SnapTrade-linked account (including E*TRADE — the specific brokerage name is
// intentionally NOT carried on the wire). Label strictly by that enum and never
// leak the raw value; an unknown/missing provider falls back to a neutral word.
const PROVIDER_LABELS = {
  ibkr: "IBKR",
  snaptrade: "SnapTrade",
  robinhood: "Robinhood",
  schwab: "Schwab",
};
export const providerLabel = (account) => {
  const provider =
    typeof account?.provider === "string"
      ? account.provider.trim().toLowerCase()
      : "";
  return PROVIDER_LABELS[provider] || "Brokerage";
};

export const brokerBrandForAccount = (account) => {
  const provider =
    typeof account?.provider === "string"
      ? account.provider.trim().toLowerCase()
      : "";
  const brokerText = [
    account?.brokerageName,
    account?.brokerage,
    account?.institutionName,
    account?.institution,
    account?.providerName,
    account?.displayName,
  ]
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();

  if (/\be\s*\*\s*trade\b|\betrade\b/.test(brokerText)) {
    return BROKER_BRANDS.etrade;
  }
  if (/\binteractive\s+brokers\b|\bibkr\b/.test(brokerText)) {
    return BROKER_BRANDS.ibkr;
  }
  if (/\balpaca\b/.test(brokerText)) {
    return BROKER_BRANDS.alpaca;
  }
  if (/\bwebull\b/.test(brokerText)) {
    return BROKER_BRANDS.webull;
  }
  return BROKER_BRANDS[provider] || BROKER_BRANDS.brokerage;
};

const ACCOUNT_SOURCE_PREFIX_PATTERN =
  /^(?:alpaca|e\s*\*\s*trade|etrade|interactive brokers|ibkr|snaptrade|robinhood|charles schwab|schwab|webull)\b[\s:./|-]*/i;
const ACCOUNT_TYPE_WORD_PATTERN =
  /(?:^|[\s:./|-]+)individual(?:[\s:./|-]+|$)/gi;

const cleanAccountDisplayName = (value) => {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "";
  const cleaned = raw
    .replace(ACCOUNT_SOURCE_PREFIX_PATTERN, "")
    .replace(ACCOUNT_TYPE_WORD_PATTERN, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || raw;
};

// The visible tab label must never expose a raw full account number. When the
// synced displayName is (or embeds) the raw providerAccountId, fall back to the
// masked id; otherwise use the cleaned human display name.
export const accountTabLabel = (account) => {
  const maskedId = maskAccountId(account?.providerAccountId);
  const displayName =
    typeof account?.displayName === "string" ? account.displayName.trim() : "";
  if (!displayName) return maskedId;
  const rawId =
    typeof account?.providerAccountId === "string"
      ? account.providerAccountId.trim()
      : "";
  if (rawId && displayName.includes(rawId)) {
    return maskedId;
  }
  return cleanAccountDisplayName(displayName);
};

const finiteAccountValue = (value) => {
  if (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "")
  ) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

export const accountDayPnlValue = (account) =>
  [account?.dayPnl, account?.dailyPnl, account?.todayPnl, account?.pnlToday]
    .map(finiteAccountValue)
    .find((value) => value !== null) ?? null;

export const accountDayPnlPercentValue = (account) =>
  [
    account?.dayPnlPercent,
    account?.dailyPnlPercent,
    account?.todayPnlPercent,
    account?.pnlTodayPercent,
  ]
    .map(finiteAccountValue)
    .find((value) => value !== null) ?? null;

export const accountAggregateMetrics = (accounts = []) => {
  const rows = Array.isArray(accounts) ? accounts : [];
  const currencies = rows.map((account) =>
    normalizeAccountCurrency(account?.currency),
  );
  const sameCurrency =
    rows.length > 0 &&
    currencies.every((currency) => currency != null) &&
    new Set(currencies).size === 1;
  const navValues = rows.map((account) =>
    finiteAccountValue(account?.netLiquidation),
  );
  const dayPnlValues = rows.map(accountDayPnlValue);
  const completeNav =
    sameCurrency && navValues.every((value) => value !== null);
  const completeDayPnl =
    sameCurrency && dayPnlValues.every((value) => value !== null);
  const nav = completeNav
    ? navValues.reduce((sum, value) => sum + value, 0)
    : null;
  const dayPnl = completeDayPnl
    ? dayPnlValues.reduce((sum, value) => sum + value, 0)
    : null;
  const dayPnlBase = nav !== null && dayPnl !== null ? nav - dayPnl : null;

  return {
    currency: rows.length === 0 ? "USD" : sameCurrency ? currencies[0] : null,
    nav,
    dayPnl,
    dayPnlPercent: dayPnlBase ? (dayPnl / Math.abs(dayPnlBase)) * 100 : null,
  };
};

export const accountSummaryMetrics = (summary) => {
  const currency = normalizeAccountCurrency(summary?.currency);
  return {
    currency,
    nav: currency
      ? finiteAccountValue(summary?.metrics?.netLiquidation?.value)
      : null,
    dayPnl: currency
      ? finiteAccountValue(summary?.metrics?.dayPnl?.value)
      : null,
    dayPnlPercent: currency
      ? finiteAccountValue(summary?.metrics?.dayPnlPercent?.value)
      : null,
  };
};

export const linkedDeploymentsForAccount = (deployments = [], account = {}) => {
  const accountId = String(account?.accountId || "").trim();
  const providerAccountId = String(account?.providerAccountId || "").trim();
  const accountType =
    account?.accountType === "broker" || account?.accountType === "shadow"
      ? account.accountType
      : null;
  if (!accountId && !providerAccountId) return [];

  return (Array.isArray(deployments) ? deployments : []).flatMap(
    (deployment) => {
      const targets = Array.isArray(deployment?.targets)
        ? deployment.targets
        : [];
      const linkedTarget = targets.find(
        (target) =>
          target?.lifecycle !== "detached" &&
          (!accountType || target?.accountType === accountType) &&
          ((accountId && String(target?.accountId || "") === accountId) ||
            (providerAccountId &&
              String(target?.providerAccountId || "") === providerAccountId)),
      );
      if (linkedTarget) return [{ ...deployment, linkedTarget }];
      if (targets.length || !providerAccountId) return [];

      return String(deployment?.providerAccountId || "").trim() ===
        providerAccountId
        ? [{ ...deployment, linkedTarget: null }]
        : [];
    },
  );
};

export const deploymentAccountStatusLabel = (deployment) => {
  if (deployment?.archivedAt) return "Archived";
  if (deployment?.isDraft) return "Draft";
  if (deployment?.linkedTarget?.lifecycle === "draining") return "Draining";
  if (deployment?.linkedTarget?.lifecycle === "manual_takeover") {
    return "Manual takeover";
  }
  return deployment?.enabled === true ? "Running" : "Paused";
};

const deploymentAllowanceLabel = (setting, legacyPercent) => {
  const unit = setting?.unit === "percent" ? "percent" : setting?.unit;
  const value = Number(setting?.value);
  if (Number.isFinite(value) && value > 0) {
    return unit === "percent"
      ? `${Number(value.toFixed(2))}%`
      : unit === "usd"
        ? formatAccountMoney(value, "USD")
        : null;
  }
  const percent = Number(legacyPercent);
  return Number.isFinite(percent) && percent > 0
    ? `${Number(percent.toFixed(2))}%`
    : null;
};

export const deploymentAccountSummary = (deployment) => {
  const name = normalizeLegacyAlgoBrandText(deployment?.name || "Deployment");
  const allowance = deploymentAllowanceLabel(
    deployment?.linkedTarget?.allowance,
    deployment?.linkedTarget?.allocationPercent,
  );
  const totalAllowance = deploymentAllowanceLabel(
    deployment?.linkedTarget?.totalAlgoAllowance,
    deployment?.linkedTarget?.hardCeilingPercent,
  );
  return [
    name,
    deploymentAccountStatusLabel(deployment),
    allowance ? `${allowance} allowance` : null,
    totalAllowance ? `${totalAllowance} shared total` : null,
  ]
    .filter(Boolean)
    .join(" · ");
};

const AccountTab = ({
  id,
  account = null,
  active,
  brand,
  eyebrow,
  label,
  detail,
  title,
  nav = null,
  dayPnl = null,
  dayPnlPercent = null,
  currency = "USD",
  maskValues = false,
  showMetrics = false,
  deployments = [],
  deploymentInventoryState = "idle",
  accountIsPhone,
  onSelect,
  onIntent,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [period, setPeriod] = useState("30D");
  const expandable = Boolean(account);
  const tone = brand?.tone || CSS_COLOR.accent;
  const provider = brand?.provider || BROKER_BRANDS.brokerage.provider;
  const hasNav = finiteAccountValue(nav) !== null;
  const hasDayPnl = finiteAccountValue(dayPnl) !== null;
  const hasMetrics = showMetrics || hasNav || hasDayPnl;
  const dayPnlTone = hasDayPnl ? toneForValue(dayPnl) : CSS_COLOR.textMuted;
  const dayPercentText =
    hasDayPnl && finiteAccountValue(dayPnlPercent) !== null
      ? ` · ${formatAccountPercent(dayPnlPercent, 2, maskValues)}`
      : "";
  const deploymentNames = deployments
    .map(deploymentAccountSummary)
    .filter(Boolean);
  const visibleDeploymentNames = deploymentNames.slice(
    0,
    MAX_VISIBLE_DEPLOYMENTS,
  );
  const deploymentOverflow = Math.max(
    0,
    deploymentNames.length - visibleDeploymentNames.length,
  );
  const deploymentSummary =
    deploymentInventoryState === "loading"
      ? "Loading"
      : deploymentInventoryState === "unavailable"
        ? "Unavailable"
        : deploymentNames.length
          ? `${visibleDeploymentNames.join(" · ")}${deploymentOverflow ? ` · +${deploymentOverflow}` : ""}`
          : "None linked";
  const showDeployments =
    id !== ALL_TAB_ID && deploymentInventoryState !== "idle";
  const cardTitle = title || label;
  const accessibleLabel = showDeployments
    ? `${cardTitle}. Linked deployments: ${deploymentSummary}`
    : cardTitle;
  const panelId = `account-tab-${id}-details`;
  return (
    <BrokerAccountCard
      role="presentation"
      data-testid={`account-card-${id}`}
      selected={active}
      tone={tone}
      style={{
        gridColumn: expanded && !accountIsPhone ? "span 2" : undefined,
      }}
    >
      <button
        data-testid={`account-tab-${id}`}
        type="button"
        aria-pressed={active}
        aria-label={accessibleLabel}
        title={accessibleLabel}
        onClick={() => onSelect?.(id)}
        onMouseEnter={() => onIntent?.(id)}
        onFocus={() => onIntent?.(id)}
        className="ra-interactive ra-touch-target"
        style={{
          appearance: "none",
          background: "transparent",
          border: 0,
          color: active ? CSS_COLOR.text : CSS_COLOR.textSec,
          columnGap: sp(accountIsPhone ? 6 : 7),
          cursor: "pointer",
          display: "grid",
          fontFamily: T.sans,
          gridTemplateColumns: expandable
            ? `${dim(accountIsPhone ? 28 : 32)}px minmax(0, 1fr)`
            : `${dim(accountIsPhone ? 28 : 32)}px minmax(0, 1fr) fit-content(${dim(accountIsPhone ? 96 : 108)}px)`,
          minHeight: dim(44),
          minWidth: 0,
          padding: sp(
            expandable
              ? accountIsPhone
                ? "5px 92px 5px 6px"
                : "5px 94px 5px 7px"
              : accountIsPhone
                ? "5px 6px"
                : "5px 7px",
          ),
          position: "relative",
          rowGap: sp(accountIsPhone ? 3 : 4),
          textAlign: "left",
          width: "100%",
        }}
      >
        <BrokerAccountIdentity
          dataTestId={`account-tab-${id}-identity-lines`}
          detail={!expandable ? detail : null}
          eyebrow={eyebrow || brand?.label || BROKER_BRANDS.brokerage.label}
          isPhone={accountIsPhone}
          label={label}
          provider={provider}
          selected={active}
          tone={tone}
        />
        {!expandable && hasMetrics ? (
          <span
            data-testid={`account-tab-${id}-metrics`}
            style={{
              alignContent: "start",
              alignItems: "end",
              alignSelf: "start",
              display: "grid",
              gap: sp(1),
              gridColumn: "3",
              gridRow: "1",
              justifyItems: "end",
              minWidth: 0,
              overflow: "hidden",
              textAlign: "right",
            }}
          >
            {showMetrics || hasNav ? (
              <span
                style={{
                  alignItems: "baseline",
                  display: "flex",
                  gap: sp(accountIsPhone ? 2 : 3),
                  justifyContent: "flex-end",
                  maxWidth: "100%",
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    color: CSS_COLOR.textMuted,
                    flex: "0 0 auto",
                    fontSize: fs(8),
                    letterSpacing: "0.06em",
                    lineHeight: 1.1,
                    textTransform: "uppercase",
                  }}
                >
                  NLV
                </span>
                <span
                  style={{
                    color: CSS_COLOR.textSec,
                    fontSize: fs(accountIsPhone ? 9 : 10),
                    fontVariantNumeric: "tabular-nums",
                    fontWeight: FONT_WEIGHTS.medium,
                    lineHeight: 1.2,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {formatAccountMoney(nav, currency, false, maskValues)}
                </span>
              </span>
            ) : null}
            {showMetrics || hasDayPnl ? (
              <span
                style={{
                  alignItems: "baseline",
                  display: "flex",
                  gap: sp(accountIsPhone ? 2 : 3),
                  justifyContent: "flex-end",
                  maxWidth: "100%",
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    color: CSS_COLOR.textMuted,
                    flex: "0 0 auto",
                    fontSize: fs(8),
                    letterSpacing: "0.06em",
                    lineHeight: 1.1,
                    textTransform: "uppercase",
                  }}
                >
                  Day
                </span>
                <span
                  style={{
                    color: dayPnlTone,
                    fontSize: fs(accountIsPhone ? 9 : 10),
                    fontVariantNumeric: "tabular-nums",
                    fontWeight: FONT_WEIGHTS.medium,
                    lineHeight: 1.2,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {formatAccountSignedMoney(dayPnl, currency, true, maskValues)}
                  {dayPercentText}
                </span>
              </span>
            ) : null}
          </span>
        ) : null}
        {showDeployments ? (
          <span
            aria-hidden="true"
            data-testid={`account-tab-${id}-deployments`}
            style={{
              alignItems: "baseline",
              borderTop: `1px solid ${cssColorMix(CSS_COLOR.border, 58)}`,
              display: "grid",
              gap: sp(3),
              gridColumn: "1 / -1",
              gridRow: "2",
              gridTemplateColumns: "auto minmax(0, 1fr)",
              minWidth: 0,
              paddingTop: sp(3),
            }}
          >
            <span
              style={{
                color: CSS_COLOR.textMuted,
                fontSize: fs(8),
                letterSpacing: "0.06em",
                lineHeight: 1.1,
                textTransform: "uppercase",
              }}
            >
              Deployments
            </span>
            <span
              style={{
                color:
                  deploymentInventoryState === "unavailable"
                    ? CSS_COLOR.amber
                    : CSS_COLOR.textSec,
                fontSize: fs(accountIsPhone ? 9 : 10),
                fontWeight: FONT_WEIGHTS.medium,
                lineHeight: 1.2,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {deploymentSummary}
            </span>
          </span>
        ) : null}
      </button>
      {expandable ? (
        <button
          data-testid={`account-tab-${id}-expand`}
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          aria-label={`${expanded ? "Hide" : "Show"} ${label} trading details`}
          title={`${expanded ? "Hide" : "Show"} trading details`}
          onClick={() => setExpanded((current) => !current)}
          onMouseEnter={() => onIntent?.(id)}
          onFocus={() => onIntent?.(id)}
          className="ra-interactive ra-touch-target"
          style={{
            alignItems: "center",
            appearance: "none",
            background: expanded ? cssColorMix(tone, 11) : "transparent",
            border: 0,
            borderLeft: `1px solid ${cssColorMix(CSS_COLOR.border, 62)}`,
            color: expanded ? tone : CSS_COLOR.textMuted,
            cursor: "pointer",
            display: "flex",
            fontFamily: T.sans,
            fontSize: fs(9),
            fontWeight: FONT_WEIGHTS.label,
            gap: sp(2),
            justifyContent: "center",
            minHeight: dim(44),
            minWidth: dim(44),
            padding: sp("0 7px"),
            position: "absolute",
            right: 0,
            top: 0,
          }}
        >
          <span>{expanded ? "Hide" : "Details"}</span>
          <ChevronDown
            aria-hidden="true"
            size={dim(13)}
            style={{
              transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
              transition:
                "transform var(--ra-motion-fast) var(--ra-motion-ease)",
            }}
          />
        </button>
      ) : null}
      {expandable && expanded ? (
        <AccountCardPerformanceDisclosure
          account={account}
          detail={detail}
          label={label}
          maskValues={maskValues}
          panelId={panelId}
          period={period}
          onPeriodChange={setPeriod}
          dayPnl={dayPnl}
          dayPnlPercent={dayPnlPercent}
          deploymentSummary={deploymentSummary}
          deploymentInventoryState={deploymentInventoryState}
        />
      ) : null}
    </BrokerAccountCard>
  );
};

// Full-width tab row for the Accounts page: a leading "All" cross-account
// aggregate, one tab per live broker account (grouped so same-provider accounts
// sit together), and a trailing "Shadow" tab.
// Props:
//   accounts      BrokerAccount[] (id, provider, displayName, netLiquidation, …)
//   activeTabId   "all" | <account.id> | "shadow"
//   onSelectTab   (tabId) => void
//   onTabIntent   optional (tabId) => void, fired on hover/focus to prewarm data
export const AccountTabs = ({
  accounts = [],
  shadowSummary = null,
  deployments = [],
  deploymentInventoryState = "idle",
  activeTabId = ALL_TAB_ID,
  onSelectTab,
  onTabIntent,
  accountIsPhone = false,
  maskValues = false,
  dataTestId = "account-tabs",
}) => {
  // Group by provider so a user's IBKR and E*TRADE accounts cluster together.
  const grouped = [...accounts].sort((a, b) =>
    String(a?.provider || "").localeCompare(String(b?.provider || "")),
  );
  const aggregate = accountAggregateMetrics(grouped);
  const shadow = accountSummaryMetrics(shadowSummary);

  return (
    <div
      role="group"
      data-testid={dataTestId}
      data-active-tab-id={activeTabId || ""}
      aria-label="Accounts"
      style={{
        background: "transparent",
        alignItems: "start",
        display: "grid",
        gap: sp(accountIsPhone ? 5 : 6),
        gridTemplateColumns: accountIsPhone
          ? "minmax(0, 1fr)"
          : "repeat(auto-fill, minmax(196px, 220px))",
        justifyContent: accountIsPhone ? "stretch" : "start",
        overflowX: "visible",
        overflowY: "visible",
        padding: sp(accountIsPhone ? "3px 0 6px" : "4px 0 8px"),
        width: "100%",
      }}
    >
      <AccountTab
        id={ALL_TAB_ID}
        active={activeTabId === ALL_TAB_ID}
        brand={BROKER_BRANDS.all}
        eyebrow="Portfolio"
        label="All accounts"
        detail={`${accounts.length} ${accounts.length === 1 ? "account" : "accounts"}`}
        title="All accounts (aggregate)"
        nav={aggregate.nav}
        dayPnl={aggregate.dayPnl}
        dayPnlPercent={aggregate.dayPnlPercent}
        currency={aggregate.currency}
        maskValues={maskValues}
        accountIsPhone={accountIsPhone}
        onSelect={onSelectTab}
        onIntent={onTabIntent}
      />
      {grouped.map((account) => {
        const maskedId = maskAccountId(account?.providerAccountId);
        const label = accountTabLabel(account);
        const brand = brokerBrandForAccount(account);
        return (
          <AccountTab
            key={account.id}
            id={account.id}
            account={account}
            active={activeTabId === account.id}
            brand={brand}
            eyebrow={brand.label}
            label={label}
            detail={maskedId}
            title={`${label} ${maskedId}`}
            nav={account?.netLiquidation}
            dayPnl={accountDayPnlValue(account)}
            dayPnlPercent={accountDayPnlPercentValue(account)}
            currency={account?.currency || "USD"}
            maskValues={maskValues}
            deployments={linkedDeploymentsForAccount(deployments, {
              accountType: "broker",
              accountId: account?.id,
              providerAccountId: account?.providerAccountId,
            })}
            deploymentInventoryState={deploymentInventoryState}
            accountIsPhone={accountIsPhone}
            onSelect={onSelectTab}
            onIntent={onTabIntent}
          />
        );
      })}
      <AccountTab
        id={SHADOW_TAB_ID}
        active={activeTabId === SHADOW_TAB_ID}
        brand={BROKER_BRANDS.shadow}
        eyebrow="PYRUS"
        label="Shadow"
        detail="Internal ledger"
        title="Shadow account (internal ledger)"
        nav={shadow.nav}
        dayPnl={shadow.dayPnl}
        dayPnlPercent={shadow.dayPnlPercent}
        currency={shadow.currency}
        maskValues={maskValues}
        showMetrics
        deployments={linkedDeploymentsForAccount(deployments, {
          accountType: "shadow",
          accountId: shadowSummary?.accountId || SHADOW_TAB_ID,
          providerAccountId: shadowSummary?.accountId || SHADOW_TAB_ID,
        })}
        deploymentInventoryState={deploymentInventoryState}
        accountIsPhone={accountIsPhone}
        onSelect={onSelectTab}
        onIntent={onTabIntent}
      />
    </div>
  );
};
