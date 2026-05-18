import { FONT_WEIGHTS, T, dim, fs, sp } from "../../lib/uiTokens.jsx";
import {
  formatAccountMoney,
  formatAccountPercent,
  metricTitle,
} from "./accountUtils";
import { AppTooltip } from "@/components/ui/tooltip";

const metricValue = (metric, currency, kind = "money", maskValues = false) => {
  if (!metric) return "—";
  if (kind === "percent") return formatAccountPercent(metric.value, 2, maskValues);
  return formatAccountMoney(metric.value, metric.currency || currency, true, maskValues);
};

const HeaderMetric = ({ label, value, tone = T.text, title, strong = false }) => (
  <AppTooltip content={title}>
    <div
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: sp(4),
        minHeight: dim(20),
        minWidth: 0,
        padding: sp("0 6px"),
        whiteSpace: "nowrap",
        overflow: "hidden",
      }}
    >
      <span
        style={{
          color: T.textMuted,
          fontSize: fs(6),
          fontFamily: T.sans,
          fontWeight: FONT_WEIGHTS.medium,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <span
        style={{
          color: tone,
          fontSize: fs(strong ? 11 : 9),
          fontFamily: T.sans,
          fontWeight: strong ? FONT_WEIGHTS.medium : FONT_WEIGHTS.regular,
          fontVariantNumeric: "tabular-nums",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {value}
      </span>
    </div>
  </AppTooltip>
);

const StatusDot = ({ tone, title }) => (
  <AppTooltip content={title}>
    <span
      role="status"
      aria-label={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: sp("0 6px"),
        height: dim(20),
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: tone,
        }}
      />
    </span>
  </AppTooltip>
);

const formatFreshnessAge = (timestamp) => {
  if (!Number.isFinite(timestamp)) return "waiting";
  const ageMs = Math.max(0, Date.now() - timestamp);
  if (ageMs < 1_000) return "now";
  if (ageMs < 60_000) return `${Math.round(ageMs / 1_000)}s`;
  return `${Math.round(ageMs / 60_000)}m`;
};

const resolveStatus = (brokerAuthenticated, accountFreshness) => {
  const fresh = Boolean(accountFreshness?.accountFresh);
  const lastEventAt = Number(accountFreshness?.accountLastEventAt);
  const lastEventValid = Number.isFinite(lastEventAt);
  if (brokerAuthenticated === false) {
    return { tone: T.red, title: "Bridge offline" };
  }
  if (fresh) {
    return { tone: T.green, title: "Bridge live · account fresh" };
  }
  if (lastEventValid) {
    return {
      tone: T.amber,
      title: `Account stream stale · last event ${formatFreshnessAge(lastEventAt)}`,
    };
  }
  return { tone: T.textMuted, title: "Account stream waiting for first event" };
};

export const AccountHeaderStrip = ({
  summary,
  maskValues = false,
  brokerAuthenticated = true,
  accountFreshness = null,
}) => {
  const metrics = summary?.metrics || {};
  const currency = summary?.currency || "USD";
  const status = resolveStatus(brokerAuthenticated, accountFreshness);

  return (
    <section
      className="ra-hide-scrollbar"
      style={{
        borderBottom: `1px solid ${T.border}`,
        padding: sp("0 0 2px"),
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: 0,
        flexWrap: "nowrap",
        overflowX: "auto",
        minWidth: 0,
      }}
    >
      <StatusDot tone={status.tone} title={status.title} />
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
          value: metricValue(metrics.maintenanceMarginCushionPercent, currency, "percent", maskValues),
          tone:
            metrics.maintenanceMarginCushionPercent?.value > 50
              ? T.green
              : metrics.maintenanceMarginCushionPercent?.value > 25
                ? T.amber
                : T.red,
          title: metricTitle(metrics.maintenanceMarginCushionPercent),
        },
      ].map((metric) => (
        <HeaderMetric key={metric.label} {...metric} />
      ))}
    </section>
  );
};

export default AccountHeaderStrip;
