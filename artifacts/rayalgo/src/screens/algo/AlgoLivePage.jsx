import {
  RADII,
  T,
  dim,
  fs,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import { SectionHeader } from "../../components/ui/SectionHeader.jsx";
import { OperationsAttentionStrip } from "./OperationsAttentionStrip";
import { OperationsKpiStrip } from "./OperationsKpiStrip";
import { OperationsPositionsTable } from "./OperationsPositionsTable";
import { OperationsSignalDrill } from "./OperationsSignalDrill";
import { OperationsSignalTable } from "./OperationsSignalTable";
import { OperationsStatusOrb } from "./OperationsStatusOrb";
import { OperationsTransitionsStrip } from "./OperationsTransitionsStrip";
import { PipelineStrip } from "./PipelineStrip.jsx";
import {
  STRATEGY_SIGNAL_TIMEFRAMES,
  asRecord,
  compactButtonStyle,
  formatMoney,
  numberFrom,
} from "./algoHelpers";
import { buildAttentionStream } from "../algoCockpitDiagnosticsModel";

const EmptyOperationsState = ({
  candidateDrafts,
  selectedDraft,
  setSelectedDraftId,
  deploymentName,
  setDeploymentName,
  symbolUniverseInput,
  setSymbolUniverseInput,
  handleCreateDeployment,
  createDeploymentMutation,
}) => (
  <div
    style={{
      border: `1px solid ${T.border}`,
      borderRadius: dim(RADII.md),
      background: T.bg1,
      padding: sp("12px 14px"),
      minWidth: 0,
    }}
  >
    <SectionHeader title="Setup Shadow Deployment" />
    {candidateDrafts.length ? (
      <div style={{ display: "grid", gap: sp(7) }}>
        <select
          value={selectedDraft?.id || ""}
          onChange={(event) => setSelectedDraftId(event.target.value)}
          style={{
            width: "100%",
            background: T.bg1,
            border: "none",
            borderRadius: dim(RADII.md),
            padding: sp("8px 10px"),
            color: T.text,
            fontSize: fs(10),
            fontFamily: T.sans,
            outline: "none",
          }}
        >
          {candidateDrafts.map((draft) => (
            <option key={draft.id} value={draft.id}>
              {draft.name} · {draft.mode} · {draft.symbolUniverse.length} syms
            </option>
          ))}
        </select>
        <input
          value={deploymentName}
          onChange={(event) => setDeploymentName(event.target.value)}
          placeholder="Deployment name"
          style={{
            width: "100%",
            background: T.bg1,
            border: "none",
            borderRadius: dim(RADII.md),
            padding: sp("8px 10px"),
            color: T.text,
            fontSize: fs(10),
            fontFamily: T.sans,
            outline: "none",
          }}
        />
        <input
          value={symbolUniverseInput}
          onChange={(event) => setSymbolUniverseInput(event.target.value)}
          placeholder="SPY, QQQ, NVDA"
          style={{
            width: "100%",
            background: T.bg1,
            border: "none",
            borderRadius: dim(RADII.md),
            padding: sp("8px 10px"),
            color: T.text,
            fontSize: fs(10),
            fontFamily: T.sans,
            outline: "none",
          }}
        />
        <button
          type="button"
          onClick={handleCreateDeployment}
          disabled={createDeploymentMutation.isPending}
          style={{
            ...compactButtonStyle({
              fill: true,
              disabled: createDeploymentMutation.isPending,
            }),
            border: "none",
            background: T.accent,
            color: T.onAccent,
          }}
        >
          {createDeploymentMutation.isPending
            ? "CREATING..."
            : "CREATE SHADOW DEPLOYMENT"}
        </button>
      </div>
    ) : (
      <div
        style={{
          border: `1px dashed ${T.border}`,
          borderRadius: dim(RADII.sm),
          color: T.textDim,
          fontFamily: T.sans,
          fontSize: fs(10),
          lineHeight: 1.45,
          padding: sp("14px 10px"),
        }}
      >
        No promoted draft strategies are available yet. Promote a completed
        backtest run first, then return here to create a Shadow signal deployment.
      </div>
    )}
  </div>
);

export const AlgoLivePage = ({
  // Empty state
  deployments,
  candidateDrafts,
  selectedDraft,
  setSelectedDraftId,
  deploymentName,
  setDeploymentName,
  symbolUniverseInput,
  setSymbolUniverseInput,
  handleCreateDeployment,
  createDeploymentMutation,
  // KPI strip
  cockpitKpis,
  cockpitSignalFreshness,
  cockpitTradePath,
  signalOptionsPerformanceSummary,
  // Pipeline
  cockpitStageItems,
  selectedStage,
  setSelectedPipelineStageId,
  // Attention
  cockpitAttentionItems,
  signalOptionsRuleAdherence,
  gatewayReady,
  // Transitions
  transitions,
  // Signals
  visibleSignalRows,
  signalOptionsCandidates,
  signalOptionsProfile,
  // Positions
  signalOptionsPositions,
  // Drill
  symbolIndex,
  events,
  userPreferences,
  // Signal monitor (promoted header controls)
  signalMonitorProfile,
  strategySettingsDraft,
  setStrategySettingsDraft,
  handleSaveStrategySettings,
  updateStrategySettingsMutation,
  // Smart summary
  activitySummary,
  // Pause / Scan-now (existing mutations + handlers)
  focusedDeployment,
  handleToggleDeployment,
  handleRunShadowScan,
  enableDeploymentMutation,
  pauseDeploymentMutation,
  runShadowScanMutation,
  // Layout
  algoIsPhone,
  algoIsNarrow,
  // Slots
  auditPanel,
  rightRail,
}) => {
  if (!deployments.length) {
    return (
      <EmptyOperationsState
        candidateDrafts={candidateDrafts}
        selectedDraft={selectedDraft}
        setSelectedDraftId={setSelectedDraftId}
        deploymentName={deploymentName}
        setDeploymentName={setDeploymentName}
        symbolUniverseInput={symbolUniverseInput}
        setSymbolUniverseInput={setSymbolUniverseInput}
        handleCreateDeployment={handleCreateDeployment}
        createDeploymentMutation={createDeploymentMutation}
      />
    );
  }

  const attentionStream = buildAttentionStream({
    attentionItems: cockpitAttentionItems,
    ruleAdherence: signalOptionsRuleAdherence,
    gatewayReady,
    gatewayBlocks: cockpitTradePath.gatewayBlocks,
  });
  const realizedToday = Number(cockpitKpis?.dailyRealizedPnl ?? 0);
  const unrealized = Number(cockpitKpis?.openUnrealizedPnl ?? 0);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: sp(6),
        minWidth: 0,
      }}
    >
      <div
        data-testid="algo-operations-header"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: sp(8),
          padding: sp("6px 10px"),
          background: T.bg0,
          borderBottom: `1px solid ${T.border}`,
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: sp(8),
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              color: T.text,
              fontFamily: T.sans,
              fontSize: fs(13),
              fontWeight: 600,
              letterSpacing: "0.01em",
            }}
          >
            RayReplica Shadow
          </span>
          <OperationsStatusOrb
            gatewayReady={gatewayReady}
            scanOn={Boolean(focusedDeployment?.enabled)}
            deploymentEnabled={focusedDeployment?.enabled}
            attentionItems={attentionStream}
          />
        </div>
        <div
          data-testid="algo-operations-header-monitor"
          style={{
            display: "flex",
            alignItems: "center",
            gap: sp(6),
            flexWrap: "wrap",
          }}
        >
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: sp(2),
              color: T.textDim,
              fontFamily: T.sans,
              fontSize: textSize("caption"),
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            tf
            <select
              value={strategySettingsDraft?.signalTimeframe || "5m"}
              onChange={(event) =>
                setStrategySettingsDraft?.((current) => ({
                  ...current,
                  signalTimeframe: event.target.value,
                }))
              }
              disabled={updateStrategySettingsMutation?.isPending}
              style={{
                background: T.bg1,
                color: T.text,
                border: `1px solid ${T.border}`,
                borderRadius: dim(RADII.xs),
                padding: sp("1px 4px"),
                fontFamily: T.sans,
                fontSize: textSize("caption"),
              }}
            >
              {STRATEGY_SIGNAL_TIMEFRAMES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: sp(2),
              color: T.textDim,
              fontFamily: T.sans,
              fontSize: textSize("caption"),
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            h=
            <input
              type="number"
              min={2}
              max={50}
              step={1}
              value={strategySettingsDraft?.timeHorizon ?? 8}
              onChange={(event) =>
                setStrategySettingsDraft?.((current) => ({
                  ...current,
                  timeHorizon: numberFrom(event.target.value, 8),
                }))
              }
              disabled={updateStrategySettingsMutation?.isPending}
              style={{
                width: dim(48),
                background: T.bg1,
                color: T.text,
                border: `1px solid ${T.border}`,
                borderRadius: dim(RADII.xs),
                padding: sp("1px 4px"),
                fontFamily: T.sans,
                fontSize: textSize("caption"),
                textAlign: "center",
              }}
            />
          </label>
          {signalMonitorProfile?.watchlistId ? (
            <span
              style={{
                color: T.textMuted,
                fontFamily: T.sans,
                fontSize: textSize("caption"),
                letterSpacing: "0.04em",
                textTransform: "uppercase",
              }}
            >
              wl {signalMonitorProfile.watchlistId}
            </span>
          ) : null}
          <button
            type="button"
            onClick={handleSaveStrategySettings}
            disabled={
              !handleSaveStrategySettings ||
              updateStrategySettingsMutation?.isPending
            }
            style={{
              ...compactButtonStyle({
                disabled:
                  !handleSaveStrategySettings ||
                  updateStrategySettingsMutation?.isPending,
              }),
              border: "none",
              background: T.accent,
              color: T.onAccent,
            }}
          >
            {updateStrategySettingsMutation?.isPending ? "SAVING…" : "APPLY"}
          </button>
          {focusedDeployment ? (
            <button
              type="button"
              onClick={() =>
                handleToggleDeployment?.(focusedDeployment)
              }
              disabled={
                enableDeploymentMutation?.isPending ||
                pauseDeploymentMutation?.isPending
              }
              style={{
                ...compactButtonStyle({
                  disabled:
                    enableDeploymentMutation?.isPending ||
                    pauseDeploymentMutation?.isPending,
                }),
                border: `1px solid ${
                  focusedDeployment.enabled ? T.amber : T.green
                }`,
                background: "transparent",
                color: focusedDeployment.enabled ? T.amber : T.green,
              }}
            >
              {focusedDeployment.enabled ? "⏸ PAUSE" : "▶ RESUME"}
            </button>
          ) : null}
          {focusedDeployment ? (
            <button
              type="button"
              onClick={handleRunShadowScan}
              disabled={runShadowScanMutation?.isPending}
              style={{
                ...compactButtonStyle({
                  disabled: runShadowScanMutation?.isPending,
                }),
                border: `1px solid ${T.accent}`,
                background: "transparent",
                color: T.accent,
              }}
            >
              {runShadowScanMutation?.isPending ? "⟳ SCANNING…" : "⟳ SCAN NOW"}
            </button>
          ) : null}
          <span
            style={{
              color: T.textDim,
              fontFamily: T.sans,
              fontSize: textSize("caption"),
              marginLeft: sp(4),
            }}
          >
            Realized{" "}
            <span style={{ color: realizedToday >= 0 ? T.green : T.red }}>
              {formatMoney(realizedToday, 2)}
            </span>
            {" · "}
            Unrealized{" "}
            <span style={{ color: unrealized >= 0 ? T.green : T.red }}>
              {formatMoney(unrealized, 2)}
            </span>
          </span>
        </div>
      </div>

      {activitySummary?.segments?.length ? (
        <div
          data-testid="algo-activity-summary"
          style={{
            display: "flex",
            alignItems: "baseline",
            flexWrap: "wrap",
            gap: sp(5),
            padding: sp("5px 10px"),
            background: T.bg1,
            border: `1px solid ${T.border}`,
            borderRadius: dim(RADII.md),
            color: T.textSec,
            fontFamily: T.sans,
            fontSize: textSize("body"),
            minWidth: 0,
          }}
        >
          {activitySummary.segments.map((segment, index) => (
            <span
              key={`${segment.kind}-${index}`}
              style={{
                color:
                  segment.tone === "green"
                    ? T.green
                    : segment.tone === "amber"
                      ? T.amber
                      : segment.tone === "red"
                        ? T.red
                        : segment.tone === "cyan"
                          ? T.cyan
                          : segment.tone === "muted"
                            ? T.textMuted
                            : T.textDim,
                fontFamily: segment.kind === "prefix" ? T.mono : T.sans,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                letterSpacing:
                  segment.kind === "prefix" ? "0.04em" : "0.01em",
                textTransform:
                  segment.kind === "prefix" ? "uppercase" : "none",
              }}
            >
              {segment.text}
            </span>
          ))}
        </div>
      ) : null}

      <OperationsKpiStrip
        cockpitKpis={cockpitKpis}
        cockpitSignalFreshness={cockpitSignalFreshness}
        cockpitTradePath={cockpitTradePath}
        signalOptionsPerformanceSummary={signalOptionsPerformanceSummary}
        signalOptionsPositions={signalOptionsPositions}
        signalOptionsCandidates={signalOptionsCandidates}
        deploymentId={focusedDeployment?.id || null}
        algoIsPhone={algoIsPhone}
      />

      <div
        data-testid="algo-operations-pipeline-strip"
        style={{
          background: T.bg1,
          border: `1px solid ${T.border}`,
          borderRadius: dim(RADII.md),
          padding: sp("6px 10px"),
          minWidth: 0,
        }}
      >
        <PipelineStrip
          stages={cockpitStageItems}
          selectedStageId={selectedStage?.id}
          onSelectStage={(id) => setSelectedPipelineStageId(id)}
          narrow={algoIsPhone}
        />
      </div>

      <OperationsAttentionStrip items={attentionStream} maxInline={3} />

      <OperationsTransitionsStrip transitions={transitions || []} maxInline={5} />

      <div
        data-testid="algo-live-grid"
        style={{
          display: "grid",
          gridTemplateColumns:
            algoIsPhone || algoIsNarrow
              ? "minmax(0, 1fr)"
              : "minmax(0, 1fr) 380px",
          gap: sp(8),
          alignItems: "start",
          minWidth: 0,
        }}
      >
        <div
          data-testid="algo-live-main-column"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: sp(6),
            minWidth: 0,
          }}
        >
          <OperationsSignalTable
            signals={visibleSignalRows}
            candidates={signalOptionsCandidates}
            algoIsPhone={algoIsPhone}
            renderDrill={({ signal, candidate }) => {
              const symbol = String(signal?.symbol || "").toUpperCase();
              const indexed = symbolIndex?.[symbol] || {};
              return (
                <OperationsSignalDrill
                  signal={signal}
                  candidate={candidate || indexed.candidate}
                  position={indexed.position}
                  events={events || []}
                  userPreferences={userPreferences}
                  signalOptionsProfile={signalOptionsProfile}
                />
              );
            }}
          />

          <OperationsPositionsTable
            positions={signalOptionsPositions}
            symbolIndex={symbolIndex}
            signalOptionsProfile={signalOptionsProfile}
            algoIsPhone={algoIsPhone}
          />

          {auditPanel}
        </div>

        <div
          data-testid="algo-live-right-column"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: sp(6),
            minWidth: 0,
          }}
        >
          {rightRail}
        </div>
      </div>
    </div>
  );
};

export default AlgoLivePage;
