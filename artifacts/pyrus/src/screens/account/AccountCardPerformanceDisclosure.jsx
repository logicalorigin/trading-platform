import { useMemo } from "react";
import {
  useGetAccountClosedTrades,
  useGetAccountOrders,
  useGetAccountPositions,
} from "@workspace/api-client-react";
import { getOpenPositionRows } from "../../features/account/accountPositionRows.js";
import {
  CSS_COLOR,
  FONT_WEIGHTS,
  RADII,
  T,
  cssColorMix,
  dim,
  fs,
  sp,
} from "../../lib/uiTokens.jsx";
import {
  formatAccountMoney,
  formatAccountPercent,
  formatAccountSignedMoney,
  formatNumber,
  maskAccountValue,
  toneForValue,
} from "./accountUtils.jsx";
import { normalizeAccountCurrency } from "./accountCurrency.js";
import { buildAccountAnalysisQueryParams } from "./tradingAnalysisFilters.js";
import { buildTradingAnalysisKpis } from "./tradingAnalysisModel.js";

export const ACCOUNT_CARD_PERIODS = Object.freeze([
  { id: "7D", label: "7 days", accountRange: "1W" },
  { id: "30D", label: "30 days", accountRange: "1M" },
  { id: "90D", label: "90 days", accountRange: "3M" },
]);

const periodDefinition = (periodId) =>
  ACCOUNT_CARD_PERIODS.find((period) => period.id === periodId) ||
  ACCOUNT_CARD_PERIODS[1];

export const accountCardPeriodParams = (periodId, nowMs = Date.now()) =>
  buildAccountAnalysisQueryParams({
    modeParams: { mode: "live" },
    range: periodDefinition(periodId).accountRange,
    nowMs,
  });

const finiteValue = (value) => {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

export const buildAccountCardActivityMetrics = ({
  positions = [],
  orders = [],
} = {}) => {
  const openPositions = getOpenPositionRows(
    Array.isArray(positions) ? positions : [],
  );
  const exposures = openPositions.map((position) =>
    finiteValue(position?.marketValue),
  );
  const completeExposure = exposures.every((value) => value !== null);

  return {
    openPositions: openPositions.length,
    workingOrders: Array.isArray(orders) ? orders.length : 0,
    grossExposure: completeExposure
      ? exposures.reduce((sum, value) => sum + Math.abs(value), 0)
      : null,
  };
};

const initialQueryWait = (query) =>
  Boolean(
    !query?.data &&
      (query?.isLoading ||
        query?.isFetching ||
        (query?.isPending && query?.fetchStatus !== "idle")),
  );

const MetricCell = ({ label, value, tone = CSS_COLOR.textSec }) => (
  <div
    style={{
      display: "grid",
      gap: sp(2),
      minWidth: 0,
      padding: sp("6px 7px"),
    }}
  >
    <span
      style={{
        color: CSS_COLOR.textMuted,
        fontFamily: T.sans,
        fontSize: fs(8),
        letterSpacing: "0.06em",
        lineHeight: 1.1,
        textTransform: "uppercase",
      }}
    >
      {label}
    </span>
    <span
      style={{
        color: tone,
        fontFamily: T.data,
        fontSize: fs(11),
        fontVariantNumeric: "tabular-nums",
        fontWeight: FONT_WEIGHTS.medium,
        lineHeight: 1.2,
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {value}
    </span>
  </div>
);

const MetricsGrid = ({ children }) => (
  <div
    style={{
      background: CSS_COLOR.bg0,
      border: `1px solid ${cssColorMix(CSS_COLOR.border, 55)}`,
      borderRadius: dim(RADII.xs),
      display: "grid",
      gridTemplateColumns: `repeat(auto-fit, minmax(${dim(92)}px, 1fr))`,
      minWidth: 0,
      overflow: "hidden",
    }}
  >
    {children}
  </div>
);

const maskedNumber = (value, digits, maskValues) =>
  maskAccountValue(formatNumber(value, digits), maskValues);

export const accountCardQueryData = (query) =>
  query?.isError ? null : (query?.data ?? null);

export const resolveAccountCardCurrency = (...values) => {
  const currencies = new Set();
  for (const value of values) {
    if (value == null || String(value).trim() === "") continue;
    const currency = normalizeAccountCurrency(value);
    if (!currency) return null;
    currencies.add(currency);
  }
  return currencies.size === 1 ? currencies.values().next().value : null;
};

const todayPnlText = ({ dayPnl, dayPnlPercent, currency, maskValues }) => {
  if (maskValues) return maskAccountValue("", true);
  const money = formatAccountSignedMoney(dayPnl, currency, false, false);
  const percent =
    finiteValue(dayPnlPercent) === null
      ? ""
      : ` · ${formatAccountPercent(dayPnlPercent, 2, false)}`;
  return `${money}${percent}`;
};

export const AccountCardPerformanceDisclosure = ({
  account,
  detail = "",
  label,
  maskValues = false,
  panelId,
  period = "30D",
  onPeriodChange,
  dayPnl = null,
  dayPnlPercent = null,
  deploymentSummary = "",
  deploymentInventoryState = "idle",
}) => {
  // ponytail: bounds stay fixed for this mounted disclosure; add a midnight
  // timer only if overnight Account sessions need an in-place date rollover.
  const tradeParams = useMemo(() => accountCardPeriodParams(period), [period]);
  const queryOptions = {
    query: {
      staleTime: 30_000,
      refetchInterval: false,
      retry: false,
    },
  };
  const tradesQuery = useGetAccountClosedTrades(
    account?.id || "",
    tradeParams,
    queryOptions,
  );
  const positionsQuery = useGetAccountPositions(
    account?.id || "",
    { mode: "live", liveQuotes: false },
    queryOptions,
  );
  const ordersQuery = useGetAccountOrders(
    account?.id || "",
    { mode: "live", tab: "working" },
    queryOptions,
  );

  const tradesData = accountCardQueryData(tradesQuery);
  const positionsData = accountCardQueryData(positionsQuery);
  const ordersData = accountCardQueryData(ordersQuery);
  const tradesReady = Array.isArray(tradesData?.trades);
  const positionsReady = Array.isArray(positionsData?.positions);
  const ordersReady = Array.isArray(ordersData?.orders);
  const currency = resolveAccountCardCurrency(
    account?.currency,
    tradesData?.currency,
    positionsData?.currency,
  );
  const performance = useMemo(
    () =>
      tradesReady
        ? buildTradingAnalysisKpis({
            trades: tradesData.trades,
            currency,
          }).metrics
        : null,
    [currency, tradesData, tradesReady],
  );
  const activity = useMemo(
    () =>
      buildAccountCardActivityMetrics({
        positions: positionsData?.positions,
        orders: ordersData?.orders,
      }),
    [ordersData?.orders, positionsData?.positions],
  );
  const waiting =
    initialQueryWait(tradesQuery) ||
    initialQueryWait(positionsQuery) ||
    initialQueryWait(ordersQuery);
  const unavailable =
    tradesQuery.isError || positionsQuery.isError || ordersQuery.isError;
  const selectedPeriod = periodDefinition(period);

  return (
    <section
      id={panelId}
      role="region"
      aria-label={`${label} trading details`}
      data-testid={`account-tab-${account.id}-disclosure`}
      style={{
        borderTop: `1px solid ${cssColorMix(CSS_COLOR.border, 62)}`,
        display: "grid",
        gap: sp(7),
        minWidth: 0,
        padding: sp(7),
      }}
    >
      <div
        style={{
          alignItems: "center",
          display: "flex",
          flexWrap: "wrap",
          gap: sp(6),
          justifyContent: "space-between",
          minWidth: 0,
        }}
      >
        <div style={{ display: "grid", gap: sp(1), minWidth: 0 }}>
          <span
            style={{
              color: CSS_COLOR.textSec,
              fontFamily: T.sans,
              fontSize: fs(10),
              fontWeight: FONT_WEIGHTS.semibold,
            }}
          >
            Account performance
          </span>
          <span
            style={{
              color: CSS_COLOR.textMuted,
              fontFamily: T.sans,
              fontSize: fs(9),
            }}
          >
            {detail}
          </span>
        </div>
        <div
          role="group"
          aria-label={`${label} performance period`}
          style={{ display: "flex", gap: sp(2) }}
        >
          {ACCOUNT_CARD_PERIODS.map((option) => {
            const selected = option.id === selectedPeriod.id;
            return (
              <button
                key={option.id}
                type="button"
                aria-label={option.label}
                aria-pressed={selected}
                onClick={() => onPeriodChange?.(option.id)}
                className="ra-interactive ra-touch-target"
                style={{
                  appearance: "none",
                  background: selected
                    ? cssColorMix(CSS_COLOR.accent, 12)
                    : "transparent",
                  border: `1px solid ${
                    selected
                      ? cssColorMix(CSS_COLOR.accent, 58)
                      : CSS_COLOR.border
                  }`,
                  borderRadius: dim(RADII.xs),
                  color: selected ? CSS_COLOR.accent : CSS_COLOR.textMuted,
                  cursor: "pointer",
                  fontFamily: T.sans,
                  fontSize: fs(9),
                  fontWeight: FONT_WEIGHTS.semibold,
                  minHeight: dim(44),
                  minWidth: dim(44),
                  padding: sp("0 6px"),
                }}
              >
                {option.id}
              </button>
            );
          })}
        </div>
      </div>

      {waiting ? (
        <div
          role="status"
          aria-busy="true"
          style={{
            color: CSS_COLOR.textMuted,
            fontFamily: T.sans,
            fontSize: fs(9),
          }}
        >
          Loading account performance…
        </div>
      ) : null}
      {unavailable ? (
        <div
          role="status"
          style={{
            color: CSS_COLOR.amber,
            fontFamily: T.sans,
            fontSize: fs(9),
          }}
        >
          Some account details are temporarily unavailable.
        </div>
      ) : null}
      {tradesReady && tradesQuery.data.trades.length === 0 ? (
        <div
          role="status"
          style={{
            color: CSS_COLOR.textMuted,
            fontFamily: T.sans,
            fontSize: fs(9),
          }}
        >
          No closed trades in this period.
        </div>
      ) : null}

      <MetricsGrid>
        <MetricCell
          label="Net liquidation"
          value={formatAccountMoney(
            account?.netLiquidation,
            currency,
            false,
            maskValues,
          )}
        />
        <MetricCell
          label="Today P&L"
          value={todayPnlText({
            dayPnl,
            dayPnlPercent,
            currency,
            maskValues,
          })}
          tone={toneForValue(dayPnl)}
        />
      </MetricsGrid>

      <div style={{ display: "grid", gap: sp(3) }}>
        <span
          style={{
            color: CSS_COLOR.textMuted,
            fontFamily: T.sans,
            fontSize: fs(8),
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          {selectedPeriod.id} performance
        </span>
        <MetricsGrid>
          <MetricCell
            label="Period P&L"
            value={formatAccountSignedMoney(
              performance?.netPnl,
              currency,
              false,
              maskValues,
            )}
            tone={toneForValue(performance?.netPnl)}
          />
          <MetricCell
            label="Win rate"
            value={formatAccountPercent(
              performance?.winRatePercent,
              1,
              maskValues,
            )}
          />
          <MetricCell
            label="Trades"
            value={maskedNumber(performance?.trades, 0, maskValues)}
          />
          <MetricCell
            label="Profit factor"
            value={maskedNumber(performance?.profitFactor, 2, maskValues)}
          />
          <MetricCell
            label="Average win"
            value={formatAccountSignedMoney(
              performance?.averageWin,
              currency,
              true,
              maskValues,
            )}
            tone={toneForValue(performance?.averageWin)}
          />
          <MetricCell
            label="Average loss"
            value={formatAccountSignedMoney(
              performance?.averageLoss,
              currency,
              true,
              maskValues,
            )}
            tone={toneForValue(performance?.averageLoss)}
          />
          <MetricCell
            label="Max drawdown"
            value={formatAccountMoney(
              performance?.maxDrawdown,
              currency,
              true,
              maskValues,
            )}
            tone={CSS_COLOR.amber}
          />
        </MetricsGrid>
      </div>

      <div style={{ display: "grid", gap: sp(3) }}>
        <span
          style={{
            color: CSS_COLOR.textMuted,
            fontFamily: T.sans,
            fontSize: fs(8),
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          Current activity
        </span>
        <MetricsGrid>
          <MetricCell
            label="Open positions"
            value={maskedNumber(
              positionsReady ? activity.openPositions : null,
              0,
              maskValues,
            )}
          />
          <MetricCell
            label="Working orders"
            value={maskedNumber(
              ordersReady ? activity.workingOrders : null,
              0,
              maskValues,
            )}
          />
          <MetricCell
            label="Gross exposure"
            value={formatAccountMoney(
              positionsReady ? activity.grossExposure : null,
              currency,
              false,
              maskValues,
            )}
          />
        </MetricsGrid>
      </div>

      {deploymentInventoryState !== "idle" ? (
        <div
          style={{
            color:
              deploymentInventoryState === "unavailable"
                ? CSS_COLOR.amber
                : CSS_COLOR.textMuted,
            display: "grid",
            fontFamily: T.sans,
            fontSize: fs(9),
            gap: sp(2),
            gridTemplateColumns: "auto minmax(0, 1fr)",
            minWidth: 0,
          }}
        >
          <span style={{ fontWeight: FONT_WEIGHTS.semibold }}>
            Linked deployments
          </span>
          <span
            style={{
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {deploymentSummary}
          </span>
        </div>
      ) : null}
    </section>
  );
};
