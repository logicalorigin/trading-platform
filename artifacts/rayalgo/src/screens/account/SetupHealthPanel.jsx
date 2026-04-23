import { T, dim, fs, sp } from "../../lib/uiTokens";
import {
  EmptyState,
  Panel,
  Pill,
  mutedLabelStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
} from "./accountUtils";

const StatusRow = ({ label, ok, detail }) => (
  <div
    title={detail || label}
    style={{
      display: "grid",
      gridTemplateColumns: "auto 1fr",
      gap: sp(8),
      alignItems: "start",
      padding: sp("6px 0"),
      borderBottom: `1px solid ${T.border}`,
    }}
  >
    <span
      style={{
        width: 8,
        height: 8,
        borderRadius: 999,
        background: ok ? T.green : T.amber,
        boxShadow: ok ? `0 0 8px ${T.green}` : "none",
        marginTop: sp(3),
      }}
    />
    <div style={{ minWidth: 0 }}>
      <div style={{ color: T.text, fontSize: fs(10), fontWeight: 800 }}>{label}</div>
      <div
        style={{
          marginTop: sp(3),
          color: T.textDim,
          fontSize: fs(9),
          fontFamily: T.mono,
          lineHeight: 1.4,
          whiteSpace: "normal",
        }}
      >
        {detail || (ok ? "Ready" : "Unavailable")}
      </div>
    </div>
  </div>
);

export const SetupHealthPanel = ({
  healthQuery,
  testMutation,
  brokerConfigured,
  brokerAuthenticated,
}) => {
  const health = healthQuery.data;
  const testResult = testMutation.data;
  const formatCoverage = (start, end, count, emptyLabel) => {
    if (!count || !start || !end) {
      return emptyLabel;
    }
    return `${new Date(start).toLocaleDateString()} -> ${new Date(end).toLocaleDateString()} · ${count.toLocaleString()} rows`;
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
      minHeight={320}
      action={
        <div style={{ display: "flex", gap: sp(6), flexWrap: "wrap", justifyContent: "flex-end" }}>
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
        <div style={{ display: "grid", gap: sp(10) }}>
          <div style={{ display: "grid", gap: sp(8) }}>
            <StatusRow
              label="Bridge connected"
              ok={Boolean(brokerConfigured && brokerAuthenticated)}
              detail={brokerAuthenticated ? "IBKR bridge session authenticated" : "Bridge unavailable or not authenticated"}
            />
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
                  ? `Last snapshot ${new Date(health.lastSnapshotAt).toLocaleString()} · coverage ${formatCoverage(health.snapshotCoverageStartAt, health.snapshotCoverageEndAt, health.snapshotPointCount, "none")}`
                  : "No balance snapshots recorded yet"
              }
            />
            <StatusRow
              label="Last Flex refresh"
              ok={Boolean(health.lastSuccessfulRefreshAt)}
              detail={
                health.lastSuccessfulRefreshAt
                  ? new Date(health.lastSuccessfulRefreshAt).toLocaleString()
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
          </div>

          {!health.schemaReady ? (
            <div
              style={{
                borderTop: `1px solid ${T.border}`,
                paddingTop: sp(8),
                display: "grid",
                gap: sp(5),
                color: T.textSec,
                fontSize: fs(10),
                lineHeight: 1.45,
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
                paddingTop: sp(8),
                display: "grid",
                gap: sp(6),
              }}
            >
              <div style={mutedLabelStyle}>Latest Flex Attempt</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: sp(6) }}>
                <Pill tone="default">
                  Attempt {health.lastAttemptAt ? new Date(health.lastAttemptAt).toLocaleString() : "----"}
                </Pill>
                <Pill tone={health.lastStatus === "ok" ? "green" : "amber"}>
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
