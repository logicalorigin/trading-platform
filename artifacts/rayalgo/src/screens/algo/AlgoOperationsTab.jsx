import {
  RADII,
  T,
  dim,
  fs,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import { SectionHeader } from "../../components/ui/SectionHeader.jsx";
import { AlgoPositionsTab } from "./AlgoPositionsTab";
import { OperationsAttentionStrip } from "./OperationsAttentionStrip";
import { OperationsKpiStrip } from "./OperationsKpiStrip";
import { OperationsSignalDrill } from "./OperationsSignalDrill";
import { OperationsSignalTable } from "./OperationsSignalTable";
import { OperationsTransitionsStrip } from "./OperationsTransitionsStrip";
import { PipelineStrip } from "./PipelineStrip.jsx";
import {
  asRecord,
  compactButtonStyle,
  formatMoney,
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

export const AlgoOperationsTab = ({
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
  displayedSignalOptionsCandidates,
  selectedCandidate,
  setSelectedCandidateId,
  selectedPipelineStageId,
  signalOptionsProfile,
  handleOpenCandidateInTrade,
  onJumpToTradeCandidate,
  algoDetailGridTemplate,
  algoCandidateGridTemplate,
  // Positions
  signalOptionsPositions,
  // Drill
  symbolIndex,
  events,
  userPreferences,
  // Layout
  algoIsPhone,
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
          <span
            style={{
              color: T.textDim,
              fontFamily: T.sans,
              fontSize: textSize("caption"),
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            {gatewayReady ? "gateway ready" : "gateway pending"}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: sp(8),
            color: T.textDim,
            fontFamily: T.sans,
            fontSize: textSize("body"),
          }}
        >
          <span>
            Realized{" "}
            <span style={{ color: realizedToday >= 0 ? T.green : T.red }}>
              {formatMoney(realizedToday, 2)}
            </span>
          </span>
          <span>
            Unrealized{" "}
            <span style={{ color: unrealized >= 0 ? T.green : T.red }}>
              {formatMoney(unrealized, 2)}
            </span>
          </span>
        </div>
      </div>

      <OperationsKpiStrip
        cockpitKpis={cockpitKpis}
        cockpitSignalFreshness={cockpitSignalFreshness}
        cockpitTradePath={cockpitTradePath}
        signalOptionsPerformanceSummary={signalOptionsPerformanceSummary}
        signalOptionsPositions={signalOptionsPositions}
        signalOptionsCandidates={signalOptionsCandidates}
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

      <AlgoPositionsTab
        signalOptionsPositions={signalOptionsPositions}
        algoIsPhone={algoIsPhone}
      />
    </div>
  );
};

export default AlgoOperationsTab;
