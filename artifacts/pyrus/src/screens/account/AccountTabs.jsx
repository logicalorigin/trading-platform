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
import { formatAccountMoney, maskAccountId } from "./accountUtils.jsx";

const HIDE_SCROLLBAR_STYLE = {
  scrollbarWidth: "none",
  msOverflowStyle: "none",
};

const ALL_TAB_ID = "all";
const SHADOW_TAB_ID = "shadow";

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

// The visible tab label must never expose a raw full account number. When the
// synced displayName is (or embeds) the raw providerAccountId, fall back to the
// masked id; otherwise use the human display name. Captions/titles are built
// from the masked id only, so this is the sole place a name could leak.
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
  return displayName;
};

const AccountTab = ({
  id,
  active,
  tone,
  dotLabel,
  label,
  caption,
  title,
  nav,
  currency = "USD",
  maskValues = false,
  accountIsPhone,
  onSelect,
  onIntent,
}) => {
  // On phone, keep tabs to dot + label; reveal NAV/caption only when active.
  const showDetail = !accountIsPhone || active;
  const hasNav = nav != null && Number.isFinite(Number(nav));
  return (
    <div
      role="tab"
      tabIndex={0}
      aria-selected={active}
      data-testid={`account-tab-${id}`}
      title={title || label}
      onClick={() => onSelect?.(id)}
      onMouseEnter={() => onIntent?.(id)}
      onFocus={() => onIntent?.(id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect?.(id);
        }
      }}
      className="ra-interactive ra-touch-target"
      style={{
        ...motionVars({ accent: tone }),
        display: "inline-flex",
        alignItems: "center",
        gap: sp(accountIsPhone ? 4 : 6),
        flexShrink: 0,
        maxWidth: dim(accountIsPhone ? 180 : 260),
        padding: sp(accountIsPhone ? "5px 8px" : "6px 12px"),
        borderBottom: `2px solid ${active ? tone : "transparent"}`,
        background: active ? cssColorMix(tone, 6) : "transparent",
        color: active ? CSS_COLOR.text : CSS_COLOR.textSec,
        fontFamily: T.sans,
        fontSize: fs(accountIsPhone ? 11 : 13),
        fontWeight: active ? FONT_WEIGHTS.medium : FONT_WEIGHTS.regular,
        cursor: "pointer",
        whiteSpace: "nowrap",
        transition:
          "background-color var(--ra-motion-standard) var(--ra-motion-ease), color var(--ra-motion-standard) var(--ra-motion-ease)",
      }}
    >
      <span
        aria-label={dotLabel}
        style={{
          flexShrink: 0,
          width: dim(8),
          height: dim(8),
          borderRadius: dim(RADII.pill),
          background: tone,
        }}
      />
      <span
        style={{
          display: "inline-flex",
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
        {showDetail && caption ? (
          <span
            style={{
              color: CSS_COLOR.textMuted,
              fontSize: textSize("caption"),
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {caption}
          </span>
        ) : null}
      </span>
      {showDetail && hasNav ? (
        <span
          style={{
            flexShrink: 0,
            fontVariantNumeric: "tabular-nums",
            color: CSS_COLOR.textSec,
          }}
        >
          {formatAccountMoney(nav, currency, true, maskValues)}
        </span>
      ) : null}
    </div>
  );
};

// Full-width tab row for the Accounts page: a leading "All" cross-account
// aggregate, one tab per live broker account (grouped so same-provider accounts
// sit together), and a trailing "Shadow" tab. Mirrors AlgoDeploymentTabs.jsx:
// role=tablist flex row + horizontal scroll + status dot + active underline.
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
  // "All" NAV is a client-side sum of the listed accounts' net liquidation — a
  // provider-neutral display total independent of the server "combined"
  // aggregate that drives the panels below. Cross-currency accounts are summed
  // as-is (USD is the platform base today); revisit if multi-currency accounts
  // become common.
  const totalNav = grouped.reduce(
    (sum, account) => sum + (Number(account?.netLiquidation) || 0),
    0,
  );
  const allCurrency = grouped[0]?.currency || "USD";

  return (
    <div
      role="tablist"
      data-testid={dataTestId}
      data-active-tab-id={activeTabId || ""}
      aria-label="Accounts"
      style={{
        display: "flex",
        alignItems: "stretch",
        gap: sp(accountIsPhone ? 2 : 4),
        width: "100%",
        overflowX: "auto",
        background: CSS_COLOR.bg0,
        borderBottom: `1px solid ${CSS_COLOR.border}`,
        ...HIDE_SCROLLBAR_STYLE,
      }}
    >
      <AccountTab
        id={ALL_TAB_ID}
        active={activeTabId === ALL_TAB_ID}
        tone={CSS_COLOR.accent}
        dotLabel="all accounts"
        label="All"
        caption={accounts.length ? `${accounts.length} accounts` : null}
        title="All accounts (aggregate)"
        nav={accounts.length ? totalNav : null}
        currency={allCurrency}
        maskValues={maskValues}
        accountIsPhone={accountIsPhone}
        onSelect={onSelectTab}
        onIntent={onTabIntent}
      />
      {grouped.map((account) => {
        const maskedId = maskAccountId(account?.providerAccountId);
        const label = accountTabLabel(account);
        return (
          <AccountTab
            key={account.id}
            id={account.id}
            active={activeTabId === account.id}
            tone={CSS_COLOR.green}
            dotLabel="connected"
            label={label}
            caption={`${providerLabel(account)} · ${maskedId}`}
            title={`${label} — ${providerLabel(account)} ${maskedId}`}
            nav={account?.netLiquidation}
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
        tone={CSS_COLOR.pink}
        dotLabel="shadow"
        label="Shadow"
        caption="Internal"
        title="Shadow account (internal ledger)"
        nav={null}
        accountIsPhone={accountIsPhone}
        onSelect={onSelectTab}
        onIntent={onTabIntent}
      />
    </div>
  );
};
