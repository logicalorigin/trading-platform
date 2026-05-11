import { T, dim, fs, sp } from "../../lib/uiTokens";
import { formatAppDate, formatAppDateTime } from "../../lib/timeZone";
import {
  IbkrConnectionLane,
  getIbkrConnection,
} from "../../features/platform/IbkrConnectionStatus";
import {
  EmptyState,
  Panel,
  Pill,
  mutedLabelStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
} from "./accountUtils";
import { AppTooltip } from "@/components/ui/tooltip";


const StatusRow = ({ label, ok, detail }) => (
  <AppTooltip content={detail || label}><div
    style={{
      display: "grid",
      gridTemplateColumns: "auto 1fr",
      gap: sp(5),
      alignItems: "start",
      padding: sp("3px 0"),
      borderBottom: `1px solid ${T.border}`,
    }}
  >
    <span
      style={{
        width: 7,
        height: 7,
        borderRadius: 999,
        background: ok ? T.green : T.amber,
        boxShadow: ok ? `0 0 8px ${T.green}` : "none",
        marginTop: sp(3),
      }}
    />
    <div style={{ minWidth: 0 }}>
      <div style={{ color: T.text, fontSize: fs(8), fontWeight: 400 }}>{label}</div>
      <div
        style={{
          marginTop: sp(2),
          color: T.textDim,
          fontSize: fs(8),
          fontFamily: T.mono,
          lineHeight: 1.4,
          whiteSpace: "normal",
        }}
      >
        {detail || (ok ? "Ready" : "Unavailable")}
      </div>
    </div>
  </div></AppTooltip>
);

export const SetupHealthPanel = ({
  session,
  healthQuery,
  testMutation,
  brokerConfigured,
  brokerAuthenticated,
}) => {
  const health = healthQuery.data;
  const testResult = testMutation.data;
  const twsConnection = getIbkrConnection(session, "tws");
  const formatCoverage = (start, end, count, emptyLabel) => {
    if (!count || !start || !end) {
      return emptyLabel;
    }
    return `${formatAppDate(start)} -> ${formatAppDate(end)} · ${count.toLocaleString()} rows`;
  };
  const schemaMissingDetail = health?.missingTables?.length
    ? `Missing tables: ${health.missingTables.join(", ")}`
    : health?.schemaError || "Account/Flex schema readiness check failed.";

  return (
    <Panel
      title="Setup & Health"
      subtitle="Bridge connectivity, Flex status, schema readiness, and snapshot recording"
      rightRail={health?.flexConfigured ? "Flex configured" : "Flex setup required"}
      loading={healthQuery.isLoading}
      error={healthQuery.error}
      onRetry={healthQuery.refetch}
      minHeight={160}
      action={
        <div style={{ display: "flex", gap: sp(3), flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={() => healthQuery.refetch()}
            style={secondaryButtonStyle}
          >
            Refresh
          </button>
          <button
            type="button"
            disabled={!health?.flexConfigured || !health?.schemaReady || testMutation.isPending}
            onClick={() => testMutation.mutate()}
            style={{
              ...primaryButtonStyle,
              opacity:
                !health?.flexConfigured || !health?.schemaReady || testMutation.isPending
                  ? 0.55
                  : 1,
              cursor:
                !health?.flexConfigured || !health?.schemaReady || testMutation.isPending
                  ? "not-allowed"
                  : "pointer",
            }}
          >
            {testMutation.isPending ? "Importing..." : "Pull Flex History"}
          </button>
        </div>
      }
    >
      {!health ? (
        <EmptyState title="Health unavailable" body="Server-side account health will appear once the Account API responds." />
      ) : (
        <div style={{ display: "grid", gap: sp(5) }}>
          <div style={{ display: "grid", gap: sp(4) }}>
            <StatusRow
              label="Bridge connected"
              ok={Boolean(brokerConfigured && brokerAuthenticated)}
              detail={brokerAuthenticated ? "IBKR bridge session authenticated" : "Bridge unavailable or not authenticated"}
            />
            <div
              style={{
                display: "grid",
                gap: sp(4),
                padding: sp("3px 0 5px"),
                borderBottom: `1px solid ${T.border}`,
              }}
            >
              <div style={mutedLabelStyle}>IBKR Connection Lanes</div>
              <IbkrConnectionLane label="IB Gateway" connection={twsConnection} />
            </div>
            <StatusRow
              label="Flex configured"
              ok={Boolean(health.flexConfigured)}
              detail={
                health.flexConfigured
                  ? "IBKR_FLEX_TOKEN and IBKR_FLEX_QUERY_ID are present"
                  : "Missing IBKR_FLEX_TOKEN and/or IBKR_FLEX_QUERY_ID (comma-separated query IDs supported)"
              }
            />
            <StatusRow
              label="Schema ready"
              ok={Boolean(health.schemaReady)}
              detail={health.schemaReady ? "Account persistence tables are present" : schemaMissingDetail}
            />
            <StatusRow
              label="Snapshots recording"
              ok={Boolean(health.snapshotsRecording)}
              detail={
                health.lastSnapshotAt
                  ? `Last snapshot ${formatAppDateTime(health.lastSnapshotAt)} · coverage ${formatCoverage(health.snapshotCoverageStartAt, health.snapshotCoverageEndAt, health.snapshotPointCount, "none")}`
                  : "No balance snapshots recorded yet"
              }
            />
            <StatusRow
              label="Last Flex refresh"
              ok={Boolean(health.lastSuccessfulRefreshAt)}
              detail={
                health.lastSuccessfulRefreshAt
                  ? formatAppDateTime(health.lastSuccessfulRefreshAt)
                  : health.lastError || "No successful Flex refresh yet"
              }
            />
            <StatusRow
              label="Flex NAV coverage"
              ok={Boolean(health.flexNavRowCount)}
              detail={formatCoverage(
                health.flexNavCoverageStartDate,
                health.flexNavCoverageEndDate,
                health.flexNavRowCount,
                "No Flex NAV rows imported yet",
              )}
            />
            <StatusRow
              label="Flex trade coverage"
              ok={Boolean(health.flexTradeRowCount)}
              detail={formatCoverage(
                health.flexTradeCoverageStartAt,
                health.flexTradeCoverageEndAt,
                health.flexTradeRowCount,
                "No Flex trade rows imported yet",
              )}
            />
            <StatusRow
              label="Flex cash coverage"
              ok={Boolean(health.flexCashRowCount)}
              detail={formatCoverage(
                health.flexCashCoverageStartAt,
                health.flexCashCoverageEndAt,
                health.flexCashRowCount,
                "No Flex cash rows imported yet",
              )}
            />
            <StatusRow
              label="Flex dividend coverage"
              ok={Boolean(health.flexDividendRowCount)}
              detail={formatCoverage(
                health.flexDividendCoverageStartAt,
                health.flexDividendCoverageEndAt,
                health.flexDividendRowCount,
                "No Flex dividend rows imported yet",
              )}
            />
            <StatusRow
              label="Flex position coverage"
              ok={Boolean(health.flexOpenPositionRowCount)}
              detail={formatCoverage(
                health.flexOpenPositionCoverageStartAt,
                health.flexOpenPositionCoverageEndAt,
                health.flexOpenPositionRowCount,
                "No Flex open-position rows imported yet",
              )}
            />
          </div>

          {!health.schemaReady ? (
            <div
              style={{
                borderTop: `1px solid ${T.border}`,
                paddingTop: sp(5),
                display: "grid",
                gap: sp(3),
                color: T.textSec,
                fontSize: fs(10),
                lineHeight: 1.35,
              }}
            >
              <div style={{ ...mutedLabelStyle, color: T.amber }}>Schema Action</div>
              <div>Run <code>pnpm --filter @workspace/db run push</code> to create the missing tables.</div>
            </div>
          ) : null}

          {!health.flexConfigured ? (
            <EmptyState
              title="Flex setup required for deep history"
              body="1. In IBKR Account Management create one or more Activity Flex Queries with NAV, Cash Report, Trades, Open Positions, Deposits & Withdrawals, and Change in NAV. 2. Use daily breakout and the broadest history window IBKR allows per query. 3. Set IBKR_FLEX_TOKEN. 4. Set IBKR_FLEX_QUERY_ID to one query ID or a comma-separated list. 5. Use Pull Flex History to import the history into this platform."
            />
          ) : (
            <div
              style={{
                borderTop: `1px solid ${T.border}`,
                paddingTop: sp(5),
                display: "grid",
                gap: sp(5),
              }}
            >
              <div style={mutedLabelStyle}>Latest Flex Attempt</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: sp(4) }}>
                <Pill tone="default">
                  Attempt {formatAppDateTime(health.lastAttemptAt)}
                </Pill>
                <Pill tone={health.lastStatus === "completed" ? "green" : "amber"}>
                  Status {health.lastStatus || "----"}
                </Pill>
                {health.lastError ? <Pill tone="red">{health.lastError}</Pill> : null}
                {testResult ? (
                  <Pill tone="green">
                    {testResult.message} · {testResult.referenceCode}
                  </Pill>
                ) : null}
              </div>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
};

export default SetupHealthPanel;
