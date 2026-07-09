import {
  CSS_COLOR,
  FONT_WEIGHTS,
  RADII,
  T,
  cssColorMix,
  dim,
  fs,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import { motionVars } from "../../lib/motion.jsx";
import { BrokerLogo } from "../../components/brand/brokerLogos";
import {
  formatAccountMoney,
  formatAccountPercent,
  formatAccountSignedMoney,
  maskAccountId,
  toneForValue,
} from "./accountUtils.jsx";

const ALL_TAB_ID = "all";
const SHADOW_TAB_ID = "shadow";

// `provider` keys the inline-SVG BrokerLogo mark; `tone` drives the active
// border/background accent; `label` is the human broker name.
const BROKER_BRANDS = {
  all: { label: "All accounts", provider: "all", tone: CSS_COLOR.accent },
  etrade: { label: "E*TRADE", provider: "etrade", tone: CSS_COLOR.purple },
  ibkr: { label: "IBKR", provider: "ibkr", tone: CSS_COLOR.red },
  robinhood: { label: "Robinhood", provider: "robinhood", tone: CSS_COLOR.green },
  schwab: { label: "Schwab", provider: "schwab", tone: CSS_COLOR.blue },
  snaptrade: { label: "SnapTrade", provider: "snaptrade", tone: CSS_COLOR.cyan },
  shadow: { label: "Shadow", provider: "shadow", tone: CSS_COLOR.pink },
  brokerage: { label: "Brokerage", provider: "brokerage", tone: CSS_COLOR.textMuted },
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
  return BROKER_BRANDS[provider] || BROKER_BRANDS.brokerage;
};

const ACCOUNT_SOURCE_PREFIX_PATTERN =
  /^(?:e\s*\*\s*trade|etrade|interactive brokers|ibkr|snaptrade|robinhood|charles schwab|schwab)\b[\s:./|-]*/i;
const ACCOUNT_TYPE_WORD_PATTERN = /(?:^|[\s:./|-]+)individual(?:[\s:./|-]+|$)/gi;

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
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

export const accountDayPnlValue = (account) =>
  [
    account?.dayPnl,
    account?.dailyPnl,
    account?.todayPnl,
    account?.pnlToday,
  ]
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

const AccountTab = ({
  id,
  active,
  brand,
  label,
  title,
  nav = null,
  dayPnl = null,
  dayPnlPercent = null,
  currency = "USD",
  maskValues = false,
  compact = false,
  accountIsPhone,
  onSelect,
  onIntent,
}) => {
  const tone = brand?.tone || CSS_COLOR.accent;
  const hasNav = finiteAccountValue(nav) !== null;
  const hasDayPnl = finiteAccountValue(dayPnl) !== null;
  const dayPnlTone = hasDayPnl ? toneForValue(dayPnl) : CSS_COLOR.textMuted;
  const dayPercentText =
    hasDayPnl && finiteAccountValue(dayPnlPercent) !== null
      ? ` (${formatAccountPercent(dayPnlPercent, 2, maskValues)})`
      : "";
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-label={title || label}
      data-testid={`account-tab-${id}`}
      title={title || label}
      onClick={() => onSelect?.(id)}
      onMouseEnter={() => onIntent?.(id)}
      onFocus={() => onIntent?.(id)}
      className="ra-interactive ra-touch-target"
      style={{
        ...motionVars({ accent: tone }),
        appearance: "none",
        border: `1px solid ${active ? cssColorMix(tone, 62) : CSS_COLOR.border}`,
        borderRadius: dim(RADII.xs),
        background: active ? cssColorMix(tone, 8) : CSS_COLOR.bg1,
        boxShadow: "none",
        display: "flex",
        alignItems: "center",
        gap: sp(accountIsPhone ? 6 : 8),
        flex: accountIsPhone
          ? "1 1 calc(50% - 4px)"
          : compact
            ? "0 0 168px"
            : "0 1 240px",
        minWidth: dim(accountIsPhone ? 150 : compact ? 152 : 180),
        maxWidth: accountIsPhone ? "none" : dim(compact ? 168 : 240),
        minHeight: dim(accountIsPhone ? 42 : 46),
        padding: sp(accountIsPhone ? "5px 8px" : "6px 9px"),
        color: active ? CSS_COLOR.text : CSS_COLOR.textSec,
        fontFamily: T.sans,
        fontSize: fs(accountIsPhone ? 10 : 12),
        fontWeight: active ? FONT_WEIGHTS.medium : FONT_WEIGHTS.regular,
        cursor: "pointer",
        textAlign: "left",
        transition:
          "background-color var(--ra-motion-standard) var(--ra-motion-ease), border-color var(--ra-motion-standard) var(--ra-motion-ease), color var(--ra-motion-standard) var(--ra-motion-ease)",
      }}
    >
      <BrokerLogo
        provider={brand?.provider || BROKER_BRANDS.brokerage.provider}
        size={dim(accountIsPhone ? 22 : 24)}
      />
      <span
        style={{
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          lineHeight: 1.15,
        }}
      >
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
        {hasNav || hasDayPnl ? (
          <span
            style={{
              alignItems: "center",
              display: "flex",
              gap: sp(accountIsPhone ? 5 : 8),
              fontSize: textSize("caption"),
              fontVariantNumeric: "tabular-nums",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {hasNav ? (
              <span style={{ color: CSS_COLOR.textMuted }}>
                NLV{" "}
                <span style={{ color: CSS_COLOR.textSec }}>
                  {formatAccountMoney(nav, currency, true, maskValues)}
                </span>
              </span>
            ) : null}
            {hasDayPnl ? (
              <span style={{ color: dayPnlTone }}>
                Day {formatAccountSignedMoney(dayPnl, currency, true, maskValues)}
                {dayPercentText}
              </span>
            ) : null}
          </span>
        ) : null}
      </span>
    </button>
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
  const totalNav = grouped.reduce(
    (sum, account) => sum + (finiteAccountValue(account?.netLiquidation) ?? 0),
    0,
  );
  const totalDayPnl = grouped.reduce(
    (sum, account) => sum + (accountDayPnlValue(account) ?? 0),
    0,
  );
  const hasTotalDayPnl = grouped.some(
    (account) => accountDayPnlValue(account) !== null,
  );
  const totalDayPnlBase = totalNav - totalDayPnl;
  const totalDayPnlPercent =
    hasTotalDayPnl && totalDayPnlBase
      ? (totalDayPnl / Math.abs(totalDayPnlBase)) * 100
      : null;
  const allCurrency = grouped[0]?.currency || "USD";

  return (
    <div
      role="tablist"
      data-testid={dataTestId}
      data-active-tab-id={activeTabId || ""}
      aria-label="Accounts"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "stretch",
        alignContent: "flex-start",
        gap: sp(accountIsPhone ? 4 : 5),
        width: "100%",
        overflowX: "visible",
        overflowY: "visible",
        background: CSS_COLOR.bg0,
        borderBottom: `1px solid ${CSS_COLOR.border}`,
        padding: sp(accountIsPhone ? "4px 0 6px" : "6px 0 8px"),
      }}
    >
      <AccountTab
        id={ALL_TAB_ID}
        active={activeTabId === ALL_TAB_ID}
        brand={BROKER_BRANDS.all}
        label="All"
        title="All accounts (aggregate)"
        nav={accounts.length ? totalNav : null}
        dayPnl={hasTotalDayPnl ? totalDayPnl : null}
        dayPnlPercent={totalDayPnlPercent}
        currency={allCurrency}
        maskValues={maskValues}
        compact
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
            active={activeTabId === account.id}
            brand={brand}
            label={label}
            title={`${label} ${maskedId}`}
            nav={account?.netLiquidation}
            dayPnl={accountDayPnlValue(account)}
            dayPnlPercent={accountDayPnlPercentValue(account)}
            currency={account?.currency || "USD"}
            maskValues={maskValues}
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
        label="Shadow"
        title="Shadow account (internal ledger)"
        compact
        accountIsPhone={accountIsPhone}
        onSelect={onSelectTab}
        onIntent={onTabIntent}
      />
    </div>
  );
};
