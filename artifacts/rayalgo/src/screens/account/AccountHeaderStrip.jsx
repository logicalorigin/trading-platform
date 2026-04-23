import { useEffect, useMemo, useRef, useState } from "react";
import { T, dim, fs, sp } from "../../lib/uiTokens";
import {
  Pill,
  StatTile,
  formatMoney,
  formatPercent,
  formatSignedMoney,
  metricTitle,
  mutedLabelStyle,
} from "./accountUtils";

const isPaperAccount = (account) =>
  /du|paper/i.test(account?.id || "") || /paper/i.test(account?.accountType || "");

const metricValue = (metric, currency, kind = "money") => {
  if (!metric) return "----";
  if (kind === "percent") return formatPercent(metric.value);
  if (kind === "ratioPercent") {
    return metric.value == null ? "----" : formatPercent(Number(metric.value) * 100, 1);
  }
  if (kind === "signedMoney") return formatSignedMoney(metric.value, currency, true);
  return formatMoney(metric.value, metric.currency || currency, true);
};

const badgeTone = (type) => {
  if (/margin/i.test(type || "")) return "cyan";
  if (/ira/i.test(type || "")) return "purple";
  if (/cash/i.test(type || "")) return "accent";
  if (/paper/i.test(type || "")) return "amber";
  if (/combined/i.test(type || "")) return "purple";
  return "default";
};

const AccountSwitcher = ({
  accountId,
  onAccountIdChange,
  accountOptions,
  currency,
}) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const current =
    accountId === "combined"
      ? {
          id: "combined",
          displayName: "All accounts",
          accountType: "combined",
          live: true,
        }
      : accountOptions.find((account) => account.id === accountId) || accountOptions[0];
  const combinedCount = accountOptions.filter((account) => !isPaperAccount(account)).length;

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
    <div ref={containerRef} style={{ position: "relative", minWidth: dim(220) }}>
      <button
        type="button"
        onClick={() => setOpen((currentState) => !currentState)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: sp(8),
          padding: sp("2px 0"),
          borderRadius: 0,
          border: "none",
          background: "transparent",
          cursor: "pointer",
          color: T.text,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: current?.live === false ? T.amber : T.green,
            boxShadow:
              current?.live === false ? "none" : `0 0 10px ${T.green}`,
            flexShrink: 0,
          }}
        />
        <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
          <div
            style={{
              color: T.text,
              fontSize: fs(11),
              fontFamily: T.sans,
              fontWeight: 900,
            }}
          >
            {current?.displayName || current?.id || "All accounts"}
          </div>
          <div
            style={{
              marginTop: sp(1),
              color: T.textDim,
              fontSize: fs(8),
              fontFamily: T.mono,
            }}
          >
            {accountId === "combined"
              ? `${combinedCount} real accounts aggregated`
              : `${current?.id || "----"} · ${current?.accountType || "account"}`}
          </div>
        </div>
        <span style={{ color: T.textDim, fontSize: fs(9) }}>{open ? "▴" : "▾"}</span>
      </button>
      {open ? (
        <div
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
          <button
            type="button"
            onClick={() => {
              onAccountIdChange("combined");
              setOpen(false);
            }}
            style={{
              width: "100%",
              padding: sp("9px 12px"),
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
                    fontSize: fs(11),
                    fontWeight: 900,
                  }}
                >
                  All accounts
                </div>
                <div
                  style={{
                    marginTop: sp(2),
                    color: T.textDim,
                    fontSize: fs(9),
                    fontFamily: T.mono,
                  }}
                >
                  {combinedCount} real accounts · base {currency}
                </div>
              </div>
              <Pill tone="purple">Combined</Pill>
            </div>
          </button>
          {accountOptions.map((account) => (
            <button
              key={account.id}
              type="button"
              onClick={() => {
                onAccountIdChange(account.id);
                setOpen(false);
              }}
              style={{
                width: "100%",
                padding: sp("9px 12px"),
                border: "none",
                borderBottom: `1px solid ${T.border}`,
                background: accountId === account.id ? `${T.accent}18` : "transparent",
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: sp(8) }}>
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    background: account.live === false ? T.amber : T.green,
                    flexShrink: 0,
                  }}
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      color: T.text,
                      fontSize: fs(10),
                      fontWeight: 900,
                    }}
                  >
                    {account.displayName || account.id}
                  </div>
                  <div
                    style={{
                      marginTop: sp(2),
                      color: T.textDim,
                      fontSize: fs(9),
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
        padding: sp("2px 0 6px"),
        display: "flex",
        alignItems: "flex-start",
        gap: sp(10),
        flexWrap: "wrap",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: sp(4),
          flexWrap: "wrap",
          flex: "0 1 auto",
          minWidth: dim(240),
        }}
      >
        <AccountSwitcher
          accountId={accountId}
          onAccountIdChange={onAccountIdChange}
          accountOptions={accountOptions}
          currency={currency}
        />
        <div style={{ display: "flex", flexWrap: "wrap", gap: sp(3) }}>
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
        </div>
        <div
          style={{
            color: T.textDim,
            fontSize: fs(8),
            fontFamily: T.mono,
            lineHeight: 1.3,
            whiteSpace: "nowrap",
            paddingLeft: sp(8),
            borderLeft: `1px solid ${T.border}`,
          }}
        >
          Base {fx?.baseCurrency || currency}
          {fx?.timestamp ? ` · FX ${new Date(fx.timestamp).toLocaleString()}` : ""}
          {fx?.warning ? ` · ${fx.warning}` : ""}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "flex-end",
          gap: 0,
          alignItems: "flex-start",
          flex: "1 1 760px",
          minWidth: dim(420),
          marginLeft: "auto",
        }}
      >
        {[
          {
            label: "Net Liq",
            value: metricValue(metrics.netLiquidation, currency),
            title: metricTitle(metrics.netLiquidation),
          },
          {
            label: "Cash",
            value: metricValue(metrics.totalCash, currency),
            subvalue: metricValue(metrics.settledCash, currency),
            title: metricTitle(metrics.totalCash),
          },
          {
            label: "Buying Power",
            value: metricValue(metrics.buyingPower, currency),
            title: metricTitle(metrics.buyingPower),
          },
          {
            label: "Margin Used",
            value: metricValue(metrics.marginUsed, currency),
            subvalue: metrics.maintenanceMargin
              ? `Maint ${formatMoney(metrics.maintenanceMargin.value, currency, true)}`
              : null,
            title: metricTitle(metrics.marginUsed),
          },
          {
            label: "Maint Cushion",
            value: metricValue(metrics.maintenanceMarginCushionPercent, currency, "ratioPercent"),
            tone:
              metrics.maintenanceMarginCushionPercent?.value > 0.5
                ? "green"
                : metrics.maintenanceMarginCushionPercent?.value > 0.25
                  ? "amber"
                  : "red",
            title: metricTitle(metrics.maintenanceMarginCushionPercent),
          },
          {
            label: "Day P&L",
            value: metricValue(metrics.dayPnl, currency, "signedMoney"),
            subvalue: metrics.dayPnlPercent ? formatPercent(metrics.dayPnlPercent.value) : null,
            tone: metrics.dayPnl?.value >= 0 ? "green" : "red",
            title: `${metricTitle(metrics.dayPnl)}\n${metricTitle(metrics.dayPnlPercent)}`,
            emphasis: true,
          },
          {
            label: "Total P&L",
            value: metricValue(metrics.totalPnl, currency, "signedMoney"),
            subvalue: metrics.totalPnlPercent ? formatPercent(metrics.totalPnlPercent.value) : null,
            tone: metrics.totalPnl?.value >= 0 ? "green" : "red",
            title: `${metricTitle(metrics.totalPnl)}\n${metricTitle(metrics.totalPnlPercent)}`,
            emphasis: true,
          },
        ].map((metric, index) => (
          <StatTile
            key={metric.label}
            {...metric}
            align="right"
            compact
            flat
            style={{
              minWidth: metric.emphasis ? dim(108) : "fit-content",
              borderLeft: index === 0 ? `1px solid ${T.border}` : `1px solid ${T.border}`,
              paddingLeft: sp(8),
              paddingRight: metric.emphasis ? sp(10) : sp(8),
              paddingTop: metric.emphasis ? sp(2) : sp(1),
              paddingBottom: metric.emphasis ? sp(2) : sp(1),
            }}
          />
        ))}
      </div>
    </section>
  );
};

export default AccountHeaderStrip;
