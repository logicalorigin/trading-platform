import { T, dim, fs, sp } from "../../RayAlgoPlatform";
import {
  EmptyState,
  Panel,
  denseButtonStyle,
  mutedLabelStyle,
} from "./accountUtils";

const StatusPill = ({ label, ok, detail }) => (
  <div
    title={detail || label}
    style={{
      display: "flex",
      flexDirection: "column",
      gap: 4,
      padding: sp(10),
      border: `1px solid ${ok ? T.green : T.border}`,
      background: ok ? "rgba(34,197,94,0.1)" : "rgba(15,23,42,0.45)",
      minHeight: dim(58),
    }}
  >
    <div style={mutedLabelStyle}>{label}</div>
    <div style={{ color: ok ? T.green : T.textMuted, fontWeight: 900 }}>
      {ok ? "Yes" : "No"}
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

  return (
    <Panel
      title="Setup / Health"
      subtitle="Bridge connectivity, Flex status, and snapshot recording"
      loading={healthQuery.isLoading}
      error={healthQuery.error}
      minHeight={260}
      action={
        <button
          type="button"
          disabled={!health?.flexConfigured || testMutation.isPending}
          onClick={() => testMutation.mutate()}
          style={denseButtonStyle(false)}
        >
          {testMutation.isPending ? "Testing..." : "Test Flex token"}
        </button>
      }
    >
      {!health ? (
        <EmptyState title="Health unavailable" body="Server-side account health will appear once the Account API responds." />
      ) : (
        <div style={{ display: "grid", gap: sp(12) }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: sp(8) }}>
            <StatusPill
              label="Bridge connected"
              ok={Boolean(brokerConfigured && brokerAuthenticated)}
              detail="IBKR bridge session status"
            />
            <StatusPill
              label="Flex configured"
              ok={Boolean(health.flexConfigured)}
              detail="Requires IBKR_FLEX_TOKEN and IBKR_FLEX_QUERY_ID"
            />
            <StatusPill
              label="Snapshots recording"
              ok={Boolean(health.snapshotsRecording)}
              detail={health.lastSnapshotAt ? `Last snapshot ${new Date(health.lastSnapshotAt).toLocaleString()}` : "No balance snapshots recorded yet"}
            />
            <StatusPill
              label="Last Flex refresh ok"
              ok={Boolean(health.lastSuccessfulRefreshAt)}
              detail={
                health.lastSuccessfulRefreshAt
                  ? new Date(health.lastSuccessfulRefreshAt).toLocaleString()
                  : health.lastError || "No successful Flex refresh yet"
              }
            />
          </div>
          {!health.flexConfigured ? (
            <EmptyState
              title="Flex setup required"
              body="1. In IBKR Account Management create a Flex Query with NAV, Cash Report, Trades, Open Positions, Deposits & Withdrawals, and Change in NAV. 2. Set IBKR_FLEX_TOKEN. 3. Set IBKR_FLEX_QUERY_ID. 4. Use Test Flex token to validate the import path."
            />
          ) : (
            <div
              style={{
                border: `1px solid ${T.border}`,
                padding: sp(12),
                background: "rgba(15,23,42,0.45)",
                display: "grid",
                gap: sp(6),
                color: T.textSec,
                fontSize: fs(11),
                fontFamily: T.sans,
              }}
            >
              <div>
                Last attempt:{" "}
                {health.lastAttemptAt
                  ? new Date(health.lastAttemptAt).toLocaleString()
                  : "----"}
              </div>
              <div>Last status: {health.lastStatus || "----"}</div>
              <div>Last error: {health.lastError || "none"}</div>
              {testResult ? (
                <div style={{ color: T.green }}>
                  Test result: {testResult.message} · ref {testResult.referenceCode}
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
};

export default SetupHealthPanel;
