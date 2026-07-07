import { useMemo, useState } from "react";
import {
  useGetAccountTaxEvents,
  useGetAccountTaxLots,
  useGetAccountTaxOverview,
  useGetAccountTaxReconciliation,
  useGetAccountWashWindows,
  useGetTaxReserve,
} from "@workspace/api-client-react";
import {
  CSS_COLOR,
  FONT_WEIGHTS,
  RADII,
  T,
  cssColorMix,
  dim,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import { Panel, Pill, formatAccountMoney } from "./accountUtils.jsx";

const TAX_TABS = ["Overview", "Wash Sales", "Lots", "Reserve", "Reconciliation"];

const asRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const asArray = (value) => (Array.isArray(value) ? value : []);

const numberOrZero = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const statusTone = (value) => {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "available" || normalized === "clear" || normalized === "verified") {
    return "green";
  }
  if (normalized === "blocked" || normalized === "failed_validation") {
    return "red";
  }
  return "amber";
};

const MiniStat = ({ label, value, tone = CSS_COLOR.text }) => (
  <div
    style={{
      minWidth: 0,
      border: `1px solid ${CSS_COLOR.border}`,
      background: CSS_COLOR.bg0,
      borderRadius: dim(RADII.xs),
      padding: sp("7px 8px"),
    }}
  >
    <div
      style={{
        color: CSS_COLOR.textMuted,
        fontFamily: T.sans,
        fontSize: textSize("caption"),
        fontWeight: FONT_WEIGHTS.regular,
      }}
    >
      {label}
    </div>
    <div
      style={{
        color: tone,
        fontFamily: T.data,
        fontSize: textSize("bodyStrong"),
        marginTop: sp(2),
        overflowWrap: "anywhere",
      }}
    >
      {value}
    </div>
  </div>
);

const TaxTabButton = ({ active, children, onClick }) => (
  <button
    type="button"
    aria-pressed={active}
    onClick={onClick}
    style={{
      border: "none",
      borderBottom: `2px solid ${active ? CSS_COLOR.cyan : "transparent"}`,
      background: active ? cssColorMix(CSS_COLOR.cyan, 7) : "transparent",
      color: active ? CSS_COLOR.text : CSS_COLOR.textSec,
      cursor: "pointer",
      fontFamily: T.sans,
      fontSize: textSize("caption"),
      fontWeight: active ? FONT_WEIGHTS.medium : FONT_WEIGHTS.regular,
      padding: sp("6px 8px"),
      whiteSpace: "nowrap",
    }}
  >
    {children}
  </button>
);

export default function TaxCenterPanel({
  accountId = "all",
  currency = "USD",
  maskValues = false,
  isPhone = false,
}) {
  const [activeTab, setActiveTab] = useState("Overview");
  const overviewQuery = useGetAccountTaxOverview(accountId, {
    query: { enabled: Boolean(accountId), staleTime: 30_000 },
  });
  const reserveQuery = useGetTaxReserve({
    query: { staleTime: 30_000 },
  });
  const eventsQuery = useGetAccountTaxEvents(accountId, {
    query: { enabled: Boolean(accountId) && activeTab === "Overview" },
  });
  const lotsQuery = useGetAccountTaxLots(accountId, {
    query: { enabled: Boolean(accountId) && activeTab === "Lots" },
  });
  const washQuery = useGetAccountWashWindows(accountId, {
    query: { enabled: Boolean(accountId) && activeTab === "Wash Sales" },
  });
  const reconciliationQuery = useGetAccountTaxReconciliation(accountId, {
    query: { enabled: Boolean(accountId) && activeTab === "Reconciliation" },
  });

  const overview = asRecord(overviewQuery.data);
  const estimates = asRecord(overview.estimates);
  const federal = asRecord(estimates.federal);
  const state = asRecord(estimates.state);
  const shadowEstimate = asRecord(estimates.shadow);
  const scope = asRecord(overview.scope);
  const reserve = asRecord(reserveQuery.data);
  const unknowns = asArray(overview.unknowns);
  const reserveWarnings = asArray(reserve.warnings);
  const isShadowTaxView =
    overview.accountScope === "shadow_simulation" ||
    scope.shadowIncluded === true ||
    shadowEstimate.status === "available";
  const shadowCurrency = shadowEstimate.currency || estimates.currency || currency;
  const shadowRealizedPnl = numberOrZero(shadowEstimate.realizedPnl);
  const shadowTaxableGain = numberOrZero(shadowEstimate.taxableGainEstimate);
  const shadowFederalEstimate = numberOrZero(shadowEstimate.federalEstimate);
  const shadowStateEstimate = numberOrZero(shadowEstimate.stateEstimate);
  const shadowTaxEstimate = shadowFederalEstimate + shadowStateEstimate;
  const shadowEventCount = numberOrZero(shadowEstimate.eventCount);

  const body = useMemo(() => {
    if (overviewQuery.isLoading) {
      return (
        <div style={{ color: CSS_COLOR.textSec, fontFamily: T.sans, fontSize: textSize("caption") }}>
          Loading tax view
        </div>
      );
    }
    if (overviewQuery.error) {
      return (
        <div role="alert" style={{ color: CSS_COLOR.red, fontFamily: T.sans, fontSize: textSize("caption") }}>
          Tax view unavailable.
        </div>
      );
    }

    if (activeTab === "Wash Sales") {
      const windows = asArray(washQuery.data?.washWindows);
      return windows.length ? (
        <div style={{ display: "grid", gap: sp(6) }}>
          {windows.map((row, index) => (
            <MiniStat key={row.id || index} label={row.symbol || "Window"} value={row.riskLevel || "risk"} />
          ))}
        </div>
      ) : (
        <MiniStat label="Wash windows" value="No computed windows yet" tone={CSS_COLOR.amber} />
      );
    }

    if (activeTab === "Lots") {
      const lots = asArray(lotsQuery.data?.lots);
      return lots.length ? (
        <div style={{ display: "grid", gap: sp(6) }}>
          {lots.map((row, index) => (
            <MiniStat key={row.id || index} label={row.symbol || "Lot"} value={row.status || "open"} />
          ))}
        </div>
      ) : (
        <MiniStat label="Tax lots" value="Not computed yet" tone={CSS_COLOR.amber} />
      );
    }

    if (activeTab === "Reserve") {
      return (
        <div style={{ display: "grid", gap: sp(8) }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isPhone ? "1fr" : "repeat(3, minmax(0, 1fr))",
              gap: sp(6),
            }}
          >
            <MiniStat
              label="Target"
              value={formatAccountMoney(reserve.targetAmount || 0, reserve.currency || currency, true, maskValues)}
            />
            <MiniStat
              label="Reserved"
              value={formatAccountMoney(reserve.reservedAmount || 0, reserve.currency || currency, true, maskValues)}
            />
            <MiniStat label="Mode" value={reserve.brokerBetaEnabled ? "Virtual + beta" : "Virtual"} />
          </div>
          {reserveWarnings.map((warning) => (
            <div key={warning} style={{ color: CSS_COLOR.textSec, fontFamily: T.sans, fontSize: textSize("caption") }}>
              {warning}
            </div>
          ))}
        </div>
      );
    }

    if (activeTab === "Reconciliation") {
      const issues = asArray(reconciliationQuery.data?.issues);
      return issues.length ? (
        <div style={{ display: "grid", gap: sp(6) }}>
          {issues.map((issue) => (
            <MiniStat key={issue.id} label={issue.issueType} value={issue.message} tone={CSS_COLOR.amber} />
          ))}
        </div>
      ) : (
        <MiniStat label="Reconciliation" value="No open issues" tone={CSS_COLOR.green} />
      );
    }

    return (
      <div style={{ display: "grid", gap: sp(8) }}>
        {isShadowTaxView ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isPhone ? "1fr" : "repeat(4, minmax(0, 1fr))",
              gap: sp(6),
            }}
          >
            <MiniStat
              label="Realized P/L"
              value={formatAccountMoney(shadowRealizedPnl, shadowCurrency, true, maskValues)}
              tone={shadowRealizedPnl < 0 ? CSS_COLOR.red : CSS_COLOR.green}
            />
            <MiniStat
              label="Taxable gain"
              value={formatAccountMoney(shadowTaxableGain, shadowCurrency, true, maskValues)}
            />
            <MiniStat
              label="Tax estimate"
              value={formatAccountMoney(shadowTaxEstimate, shadowCurrency, true, maskValues)}
            />
            <MiniStat label="Shadow events" value={`${shadowEventCount}`} />
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isPhone ? "1fr" : "repeat(4, minmax(0, 1fr))",
              gap: sp(6),
            }}
          >
            <MiniStat label="Federal" value={federal.status || "unavailable"} tone={CSS_COLOR.amber} />
            <MiniStat label="State" value={state.status || "unavailable"} tone={CSS_COLOR.amber} />
            <MiniStat
              label="Reserve target"
              value={formatAccountMoney(estimates.totalReserveTarget || 0, estimates.currency || currency, true, maskValues)}
            />
            <MiniStat label="Connected accounts" value={`${scope.includedAccounts ?? 0}/${scope.connectedAccounts ?? 0}`} />
          </div>
        )}
        <div style={{ display: "grid", gap: sp(4) }}>
          {unknowns.map((unknown) => (
            <div key={unknown} style={{ color: CSS_COLOR.textSec, fontFamily: T.sans, fontSize: textSize("caption") }}>
              {unknown}
            </div>
          ))}
          <div style={{ color: CSS_COLOR.textMuted, fontFamily: T.sans, fontSize: textSize("caption") }}>
            Events loaded: {asArray(eventsQuery.data?.events).length}
          </div>
        </div>
      </div>
    );
  }, [
    activeTab,
    currency,
    estimates,
    eventsQuery.data,
    federal.status,
    isPhone,
    isShadowTaxView,
    lotsQuery.data,
    maskValues,
    overviewQuery.error,
    overviewQuery.isLoading,
    reconciliationQuery.data,
    reserve,
    reserveWarnings,
    scope.connectedAccounts,
    scope.includedAccounts,
    shadowCurrency,
    shadowEventCount,
    shadowRealizedPnl,
    shadowTaxableGain,
    shadowTaxEstimate,
    state.status,
    unknowns,
    washQuery.data,
  ]);

  return (
    <Panel
      title="Tax Center"
      subtitle={isShadowTaxView ? "Shadow simulation tax view" : "Connected taxable accounts"}
      rightRail={
        <span style={{ display: "inline-flex", gap: sp(4), alignItems: "center" }}>
          <Pill tone={isShadowTaxView ? "amber" : statusTone(state.status)}>
            {isShadowTaxView ? "simulation" : state.status || "unavailable"}
          </Pill>
        </span>
      }
      minHeight={isPhone ? 360 : 260}
    >
      <div style={{ display: "grid", gap: sp(8), minWidth: 0 }}>
        <div className="ra-hide-scrollbar" style={{ display: "flex", overflowX: "auto", borderBottom: `1px solid ${CSS_COLOR.border}` }}>
          {TAX_TABS.map((tab) => (
            <TaxTabButton key={tab} active={activeTab === tab} onClick={() => setActiveTab(tab)}>
              {tab}
            </TaxTabButton>
          ))}
        </div>
        {body}
      </div>
    </Panel>
  );
}
