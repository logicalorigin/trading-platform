import { useEffect, useMemo, useRef, useState } from "react";
import { T, dim, fs, sp } from "../../lib/uiTokens";
import { formatAppDateTime } from "../../lib/timeZone";
import {
  Pill,
  formatAccountMoney,
  formatAccountPercent,
  formatAccountSignedMoney,
  metricTitle,
} from "./accountUtils";
import { AppTooltip } from "@/components/ui/tooltip";


const isPaperAccount = (account) =>
  /du|paper/i.test(account?.id || "") || /paper/i.test(account?.accountType || "");

const isShadowAccount = (account) =>
  /shadow/i.test(account?.id || "") || /shadow/i.test(account?.accountType || "");

const metricValue = (metric, currency, kind = "money", maskValues = false) => {
  if (!metric) return "----";
  if (kind === "percent") return formatAccountPercent(metric.value, 2, maskValues);
  if (kind === "ratioPercent") {
    return metric.value == null
      ? "----"
      : formatAccountPercent(Number(metric.value) * 100, 1, maskValues);
  }
  if (kind === "signedMoney") {
    return formatAccountSignedMoney(metric.value, currency, true, maskValues);
  }
  return formatAccountMoney(metric.value, metric.currency || currency, true, maskValues);
};

const badgeTone = (type) => {
  if (/shadow/i.test(type || "")) return "pink";
  if (/margin/i.test(type || "")) return "cyan";
  if (/ira/i.test(type || "")) return "purple";
  if (/cash/i.test(type || "")) return "accent";
  if (/paper/i.test(type || "")) return "amber";
  if (/combined/i.test(type || "")) return "purple";
  return "default";
};

const HeaderMetric = ({ label, value, tone = T.text, title, strong = false }) => (
  <AppTooltip content={title}><div
    style={{
      display: "inline-flex",
      alignItems: "baseline",
      gap: sp(3),
      minHeight: dim(20),
      minWidth: 0,
      padding: sp("0 5px"),
      borderLeft: `1px solid ${T.border}`,
      whiteSpace: "nowrap",
      overflow: "hidden",
    }}
  >
    <span
      style={{
        color: T.textMuted,
        fontSize: fs(6),
        fontFamily: T.sans,
        fontWeight: 900,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        flexShrink: 0,
      }}
    >
      {label}
    </span>
    <span
      style={{
        color: tone,
        fontSize: fs(strong ? 10 : 9),
        fontFamily: T.mono,
        fontWeight: 900,
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {value}
    </span>
  </div></AppTooltip>
);

const AccountSwitcher = ({
  accountId,
  onAccountIdChange,
  accountOptions,
  currency,
  showCombined = true,
}) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const current =
    showCombined && accountId === "combined"
      ? {
          id: "combined",
          displayName: "All accounts",
          accountType: "combined",
          live: true,
        }
      : accountOptions.find((account) => account.id === accountId) || accountOptions[0];
  const combinedCount = accountOptions.filter((account) => !isPaperAccount(account)).length;
  const statusColor = isShadowAccount(current)
    ? T.pink
    : current?.live === false
      ? T.amber
      : T.green;
  const currentDetail =
    showCombined && accountId === "combined"
      ? `${combinedCount} real · ${currency}`
      : `${current?.id || "----"} · ${current?.accountType || "account"}`;

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!containerRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, []);

  return (
    <div ref={containerRef} style={{ position: "relative", minWidth: dim(154) }}>
      <button
        type="button"
        onClick={() => setOpen((currentState) => !currentState)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: sp(5),
          padding: sp("1px 0"),
          borderRadius: 0,
          border: "none",
          background: "transparent",
          cursor: "pointer",
          color: T.text,
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: 999,
            background: statusColor,
            boxShadow:
              current?.live === false && !isShadowAccount(current)
                ? "none"
                : `0 0 10px ${statusColor}`,
            flexShrink: 0,
          }}
        />
        <div
          style={{
            flex: 1,
            minWidth: 0,
            textAlign: "left",
            display: "flex",
            alignItems: "baseline",
            gap: sp(5),
          }}
        >
          <div
            style={{
              color: T.text,
              fontSize: fs(9),
              fontFamily: T.sans,
              fontWeight: 900,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {current?.displayName || current?.id || "All accounts"}
          </div>
          <span
            style={{
              color: T.textDim,
              fontSize: fs(7),
              fontFamily: T.mono,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {currentDetail}
          </span>
        </div>
        <span style={{ color: T.textDim, fontSize: fs(8) }}>{open ? "▴" : "▾"}</span>
      </button>
      {open ? (
        <div
          className="ra-popover-enter"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            right: 0,
            zIndex: 20,
            borderRadius: dim(6),
            border: `1px solid ${T.border}`,
            background: T.bg1,
            boxShadow:
              T.bg0 === "#f5f5f4"
                ? "0 18px 45px rgba(15,23,42,0.12)"
                : "0 18px 45px rgba(0,0,0,0.3)",
            overflow: "hidden",
          }}
        >
          {showCombined ? (
            <button
            type="button"
            className={accountId === "combined" ? "ra-focus-rail ra-interactive" : "ra-interactive"}
            onClick={() => {
              onAccountIdChange("combined");
              setOpen(false);
            }}
            style={{
              width: "100%",
              padding: sp("7px 9px"),
              border: "none",
              borderBottom: `1px solid ${T.border}`,
              background: accountId === "combined" ? T.accentDim : "transparent",
              textAlign: "left",
              cursor: "pointer",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: sp(8),
              }}
            >
              <div>
                <div
                  style={{
                    color: T.text,
                    fontSize: fs(10),
                    fontWeight: 900,
                  }}
                >
                  All accounts
                </div>
                <div
                  style={{
                    marginTop: sp(2),
                    color: T.textDim,
                    fontSize: fs(8),
                    fontFamily: T.mono,
                  }}
                >
                  {combinedCount} real accounts · base {currency}
                </div>
              </div>
              <Pill tone="purple">Combined</Pill>
            </div>
          </button>
          ) : null}
          {accountOptions.map((account) => (
            <button
              key={account.id}
              type="button"
              className={accountId === account.id ? "ra-focus-rail ra-interactive" : "ra-interactive"}
              onClick={() => {
                onAccountIdChange(account.id);
                setOpen(false);
              }}
              style={{
                width: "100%",
                padding: sp("7px 9px"),
                border: "none",
                borderBottom: `1px solid ${T.border}`,
                background: accountId === account.id ? `${T.accent}18` : "transparent",
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: sp(8) }}>
                <span
                  className={account.live === false ? undefined : "ra-status-pulse"}
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    background: isShadowAccount(account)
                      ? T.pink
                      : account.live === false
                        ? T.amber
                        : T.green,
                    flexShrink: 0,
                  }}
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      color: T.text,
                      fontSize: fs(9),
                      fontWeight: 900,
                    }}
                  >
                    {account.displayName || account.id}
                  </div>
                  <div
                    style={{
                      marginTop: sp(2),
                      color: T.textDim,
                      fontSize: fs(8),
                      fontFamily: T.mono,
                    }}
                  >
                    {account.id}
                  </div>
                </div>
                <Pill tone={badgeTone(account.accountType)}>{account.accountType || "Account"}</Pill>
              </div>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};

export const AccountHeaderStrip = ({
  accounts = [],
  accountId,
  onAccountIdChange,
  summary,
  brokerAuthenticated,
  showCombined = true,
  maskValues = false,
  sectionControl,
  linkChip = null,
}) => {
  const metrics = summary?.metrics || {};
  const currency = summary?.currency || accounts[0]?.currency || "USD";
  const pdt = summary?.badges?.pdt;
  const fx = summary?.fx;
  const pdtRemaining =
    pdt?.dayTradesRemainingThisWeek === Infinity
      ? null
      : pdt?.dayTradesRemainingThisWeek;
  const accountOptions = useMemo(() => {
    const merged = new Map();
    accounts.forEach((account) => {
      merged.set(account.id, {
        ...account,
        id: account.id,
        displayName: account.displayName || account.name || account.id,
        accountType: account.accountType,
        live: true,
      });
    });
    (summary?.accounts || []).forEach((account) => {
      merged.set(account.id, {
        ...merged.get(account.id),
        ...account,
      });
    });
    return Array.from(merged.values());
  }, [accounts, summary?.accounts]);
  const accountTypes = summary?.badges?.accountTypes || [];
  const showPdtBadge = Boolean(pdt?.isPatternDayTrader || pdtRemaining != null);

  return (
    <section
      style={{
        borderBottom: `1px solid ${T.border}`,
        padding: sp("0 0 2px"),
        display: "flex",
        alignItems: "center",
        gap: sp(4),
        flexWrap: "wrap",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: sp(3),
          flexWrap: "wrap",
          flex: "0 1 auto",
          minWidth: dim(285),
        }}
      >
        {sectionControl}
        {linkChip}
        <AccountSwitcher
          accountId={accountId}
          onAccountIdChange={onAccountIdChange}
          accountOptions={accountOptions}
          currency={currency}
          showCombined={showCombined}
        />
        <div style={{ display: "flex", flexWrap: "wrap", gap: sp(2) }}>
          {(accountTypes.length ? accountTypes : ["combined"]).map((badge) => (
            <Pill key={badge} tone={badgeTone(badge)}>
              {badge}
            </Pill>
          ))}
          <Pill tone={brokerAuthenticated ? "green" : "default"}>
            {brokerAuthenticated ? "Bridge live" : "Bridge off"}
          </Pill>
          {showPdtBadge ? (
            <Pill tone={pdt?.isPatternDayTrader ? "amber" : "default"} title="Pattern day trader status">
              PDT
              {pdt?.isPatternDayTrader ? " Yes" : ""}
              {pdtRemaining != null ? ` · ${pdtRemaining} left` : ""}
            </Pill>
          ) : null}
          <Pill
            tone={fx?.warning ? "amber" : "default"}
            title={[
              `Base ${fx?.baseCurrency || currency}`,
              fx?.timestamp ? `FX ${formatAppDateTime(fx.timestamp)}` : null,
              fx?.warning || null,
            ]
              .filter(Boolean)
              .join("\n")}
          >
            Base {fx?.baseCurrency || currency}
          </Pill>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "flex-end",
          gap: 0,
          alignItems: "flex-start",
          flex: "1 1 560px",
          minWidth: dim(280),
          marginLeft: "auto",
        }}
      >
        {[
          {
            label: "Net",
            value: metricValue(metrics.netLiquidation, currency, "money", maskValues),
            title: metricTitle(metrics.netLiquidation),
            strong: true,
          },
          {
            label: "Cash",
            value: metricValue(metrics.totalCash, currency, "money", maskValues),
            title: `${metricTitle(metrics.totalCash)}\nSettled: ${metricValue(metrics.settledCash, currency, "money", maskValues)}`,
          },
          {
            label: "BP",
            value: metricValue(metrics.buyingPower, currency, "money", maskValues),
            title: metricTitle(metrics.buyingPower),
          },
          {
            label: "Margin",
            value: metricValue(metrics.marginUsed, currency, "money", maskValues),
            title: `${metricTitle(metrics.marginUsed)}${
              metrics.maintenanceMargin
                ? `\nMaintenance: ${formatAccountMoney(metrics.maintenanceMargin.value, currency, true, maskValues)}`
                : ""
            }`,
          },
          {
            label: "Cushion",
            value: metricValue(metrics.maintenanceMarginCushionPercent, currency, "ratioPercent", maskValues),
            tone:
              metrics.maintenanceMarginCushionPercent?.value > 0.5
                ? T.green
                : metrics.maintenanceMarginCushionPercent?.value > 0.25
                  ? T.amber
                  : T.red,
            title: metricTitle(metrics.maintenanceMarginCushionPercent),
          },
          {
            label: "Day",
            value: metricValue(metrics.dayPnl, currency, "signedMoney", maskValues),
            tone: metrics.dayPnl?.value >= 0 ? T.green : T.red,
            title: `${metricTitle(metrics.dayPnl)}\n${metricTitle(metrics.dayPnlPercent)}${
              metrics.dayPnlPercent
                ? `\nPercent: ${formatAccountPercent(metrics.dayPnlPercent.value, 2, maskValues)}`
                : ""
            }`,
            strong: true,
          },
          {
            label: "Total",
            value: metricValue(metrics.totalPnl, currency, "signedMoney", maskValues),
            tone: metrics.totalPnl?.value >= 0 ? T.green : T.red,
            title: `${metricTitle(metrics.totalPnl)}\n${metricTitle(metrics.totalPnlPercent)}${
              metrics.totalPnlPercent
                ? `\nPercent: ${formatAccountPercent(metrics.totalPnlPercent.value, 2, maskValues)}`
                : ""
            }`,
            strong: true,
          },
        ].map((metric) => (
          <HeaderMetric
            key={metric.label}
            {...metric}
          />
        ))}
      </div>
    </section>
  );
};

export default AccountHeaderStrip;
