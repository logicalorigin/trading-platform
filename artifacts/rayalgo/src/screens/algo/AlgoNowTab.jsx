import {
  FONT_WEIGHTS,
  RADII,
  T,
  dim,
  fs,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import { Badge } from "../../components/platform/primitives.jsx";
import { SectionHeader } from "../../components/ui/SectionHeader.jsx";
import { AttentionList } from "./AttentionList.jsx";
import { HeroKpi } from "./HeroKpi.jsx";
import { PipelineStrip } from "./PipelineStrip.jsx";
import {
  asRecord,
  compactButtonStyle,
  formatMoney,
  formatPct,
  signalActionLabel,
  signalFreshnessLabel,
} from "./algoHelpers";
import { buildAttentionStream } from "../algoCockpitDiagnosticsModel";

export const AlgoNowTab = ({
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
  cockpitSignalFreshness,
  cockpitKpis,
  signalOptionsPositions,
  signalOptionsCandidates,
  cockpitTradePath,
  signalOptionsPerformanceSummary,
  signalOptionsRuleAdherence,
  cockpitAttentionItems,
  gatewayReady,
  cockpitStageItems,
  selectedStage,
  setSelectedPipelineStageId,
  signalOptionsSignals,
  setPrimaryTab,
  algoIsPhone,
  algoIsNarrow,
}) => {
  if (!deployments.length) {
    return (
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
  }

  const freshSignals = Number(cockpitSignalFreshness.fresh ?? 0);
  const staleSignals = Number(cockpitSignalFreshness.notFresh ?? 0);
  const activePositions = Number(
    cockpitKpis.openPositions ?? signalOptionsPositions.length,
  );
  const candidatesCount = Number(
    cockpitKpis.candidates ?? signalOptionsCandidates.length,
  );
  const blockedCount = Number(cockpitTradePath.blockedCandidates ?? 0);
  const filledCount = Number(cockpitTradePath.shadowFilledCandidates ?? 0);
  const todayPnl = Number(cockpitKpis.todayPnl ?? 0);
  const realizedPnl = Number(cockpitKpis.dailyRealizedPnl ?? 0);
  const unrealizedPnl = Number(cockpitKpis.openUnrealizedPnl ?? 0);
  const winRate = signalOptionsPerformanceSummary.winRatePercent;
  const ruleFail = signalOptionsRuleAdherence.some(
    (rule) => asRecord(rule).status === "fail",
  );
  const ruleWarn = signalOptionsRuleAdherence.some(
    (rule) => asRecord(rule).status === "warning",
  );
  const ruleFailCount = signalOptionsRuleAdherence.filter(
    (rule) => asRecord(rule).status === "fail",
  ).length;
  const ruleWarnCount = signalOptionsRuleAdherence.filter(
    (rule) => asRecord(rule).status === "warning",
  ).length;

  const attentionStream = buildAttentionStream({
    attentionItems: cockpitAttentionItems,
    ruleAdherence: signalOptionsRuleAdherence,
    gatewayReady,
    gatewayBlocks: cockpitTradePath.gatewayBlocks,
  });
  const openCount = attentionStream.length;
  const criticalCount = attentionStream.filter(
    (item) => item.severity === "critical",
  ).length;
  const recentSignals = signalOptionsSignals.slice(0, 5);

  return (
    <>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: sp(8),
          minWidth: 0,
        }}
      >
        <HeroKpi
          pnlValue={todayPnl}
          pnlValueDisplay={formatMoney(todayPnl, 2)}
          pnlPercentDisplay={
            Number.isFinite(realizedPnl)
              ? `R ${formatMoney(realizedPnl, 0)} · U ${formatMoney(unrealizedPnl, 0)}`
              : "—"
          }
          wins={
            Number.isFinite(winRate)
              ? Math.round((filledCount * winRate) / 100)
              : 0
          }
          losses={
            Number.isFinite(winRate)
              ? Math.max(
                  0,
                  filledCount -
                    Math.round((filledCount * winRate) / 100),
                )
              : filledCount
          }
          activePositions={activePositions}
          unrealizedDisplay={formatMoney(unrealizedPnl, 0)}
          freshSignals={freshSignals}
          freshSignalsDetail={
            staleSignals > 0 ? `${staleSignals} stale` : null
          }
          rulesState={
            ruleFail ? "FAIL" : ruleWarn ? "REVIEW" : "OK"
          }
          rulesDetail={
            ruleFail
              ? `${ruleFailCount} failing`
              : ruleWarn
                ? `${ruleWarnCount} review`
                : "all green"
          }
          candidates={candidatesCount}
          candidatesDetail={
            blockedCount > 0 ? `${blockedCount} blocked` : null
          }
          todayFired={filledCount}
          todayFiredDetail={
            Number.isFinite(winRate)
              ? `${formatPct(winRate, 0)} win`
              : null
          }
          narrow={algoIsPhone || algoIsNarrow}
        />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: algoIsPhone
            ? "minmax(0, 1fr)"
            : "minmax(0, 1.6fr) minmax(0, 1fr)",
          gap: sp(8),
          minWidth: 0,
        }}
      >
        <div
          style={{
            border: "none",
            borderRadius: dim(RADII.md),
            background: T.bg1,
            padding: sp("9px 10px"),
            minWidth: 0,
          }}
        >
          <SectionHeader
            title="Pipeline"
            right={
              <span
                style={{
                  color: T.textMuted,
                  fontFamily: T.sans,
                  fontSize: textSize("caption"),
                  letterSpacing: "0.04em",
                }}
              >
                scan → signal → action → contract → gate → shadow → exit
              </span>
            }
          />
          <PipelineStrip
            stages={cockpitStageItems}
            selectedStageId={selectedStage?.id}
            onSelectStage={(id) => setSelectedPipelineStageId(id)}
            narrow={algoIsPhone}
          />
          <div
            style={{
              marginTop: sp(5),
              paddingTop: sp(5),
              borderTop: `1px solid ${T.border}`,
              display: "grid",
              gridTemplateColumns: `${dim(110)}px minmax(0, 1fr)`,
              columnGap: sp(6),
              rowGap: sp(1),
              alignItems: "baseline",
              minWidth: 0,
            }}
          >
            <span
              style={{
                color: T.textMuted,
                fontFamily: T.sans,
                fontSize: textSize("caption"),
                letterSpacing: "0.04em",
              }}
            >
              SELECTED STAGE
            </span>
            <span
              style={{
                color: T.text,
                fontFamily: T.sans,
                fontSize: fs(10),
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {selectedStage?.label || "No stage"}
            </span>
            <span />
            <span
              style={{
                color: T.textDim,
                fontFamily: T.sans,
                fontSize: textSize("body"),
                lineHeight: 1.35,
              }}
            >
              {selectedStage?.detail || "No timestamp"}
            </span>
          </div>
        </div>

        <div
          style={{
            border: "none",
            borderRadius: dim(RADII.md),
            background: T.bg1,
            padding: sp("9px 10px"),
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            gap: sp(6),
          }}
        >
          <SectionHeader
            title="Attention"
            spacing="none"
            right={
              <Badge
                color={
                  criticalCount > 0
                    ? T.red
                    : openCount > 0
                      ? T.amber
                      : T.green
                }
              >
                {openCount ? `${openCount} OPEN` : "CLEAR"}
              </Badge>
            }
          />
          <AttentionList items={attentionStream} />
        </div>
      </div>

      <div
        data-testid="algo-now-recent-signals"
        style={{
          border: "none",
          borderRadius: dim(RADII.md),
          background: T.bg1,
          padding: sp("9px 10px"),
          minWidth: 0,
        }}
      >
        <SectionHeader
          title="Recent signal mapping"
          right={
            <button
              type="button"
              onClick={() => setPrimaryTab("signals")}
              style={{
                padding: sp("3px 8px"),
                fontSize: textSize("caption"),
                fontFamily: T.sans,
                fontWeight: FONT_WEIGHTS.medium,
                color: T.accent,
                background: "transparent",
                border: "none",
                cursor: "pointer",
                letterSpacing: "0.02em",
              }}
            >
              see all in Signals →
            </button>
          }
        />
        {recentSignals.length ? (
          <div style={{ display: "grid", gap: sp(3), minWidth: 0 }}>
            {recentSignals.map((signal, index) => {
              const symbol = String(
                signal?.symbol || signal?.ticker || "—",
              ).toUpperCase();
              const direction =
                signal?.direction === "short" ||
                signal?.direction === "bearish"
                  ? "short"
                  : "long";
              const score =
                Number.isFinite(Number(signal?.score)) ||
                Number.isFinite(Number(signal?.confidence))
                  ? Number(signal?.score ?? signal?.confidence)
                  : null;
              const action = signalActionLabel(
                signal,
                signal?.action || signal?.mappedAction,
              );
              const freshness = signalFreshnessLabel(signal);
              const tone =
                freshness === "fresh"
                  ? T.green
                  : freshness === "stale"
                    ? T.amber
                    : T.textDim;
              return (
                <div
                  key={signal?.id || `${symbol}-${index}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: algoIsPhone
                      ? "minmax(0, 1fr) auto"
                      : "60px minmax(0, 1fr) minmax(0, 2fr) auto",
                    gap: sp(8),
                    alignItems: "center",
                    padding: sp("3px 0"),
                    borderBottom:
                      index < recentSignals.length - 1
                        ? `1px solid ${T.border}`
                        : "none",
                    minWidth: 0,
                  }}
                >
                  <span
                    style={{
                      color: T.textMuted,
                      fontFamily: T.sans,
                      fontSize: textSize("body"),
                    }}
                  >
                    {symbol}
                  </span>
                  {!algoIsPhone && (
                    <span
                      style={{
                        color: T.textSec,
                        fontFamily: T.sans,
                        fontSize: textSize("body"),
                        letterSpacing: "0.04em",
                      }}
                    >
                      {direction === "short" ? "▼ short" : "▲ long"}
                      {score != null ? ` ${score.toFixed(2)}` : ""}
                    </span>
                  )}
                  {!algoIsPhone && (
                    <span
                      style={{
                        color: T.text,
                        fontFamily: T.sans,
                        fontSize: textSize("body"),
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      → {action}
                    </span>
                  )}
                  <span
                    style={{
                      color: tone,
                      fontFamily: T.sans,
                      fontSize: textSize("body"),
                      letterSpacing: "0.04em",
                      textAlign: "right",
                    }}
                  >
                    {freshness}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div
            style={{
              color: T.textDim,
              fontFamily: T.sans,
              fontSize: textSize("caption"),
              padding: sp("8px 0"),
            }}
          >
            No signals yet — fresh universe signals will appear here as
            the algo evaluates.
          </div>
        )}
      </div>
    </>
  );
};

export default AlgoNowTab;
