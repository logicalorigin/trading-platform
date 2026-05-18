import {
  FONT_WEIGHTS,
  MISSING_VALUE,
  RADII,
  T,
  dim,
  fs,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import { Badge } from "../../components/platform/primitives.jsx";
import { SectionHeader } from "../../components/ui/SectionHeader.jsx";
import { formatRelativeTimeShort } from "../../lib/formatters";
import { joinMotionClasses, motionRowStyle, motionVars } from "../../lib/motion";
import {
  asRecord,
  compactButtonStyle,
  formatContractLabel,
  formatLiquidityFreshness,
  formatLiquidityReason,
  formatMoney,
  formatPct,
  formatPlainPrice,
  shadowLinkSummary,
  signalActionLabel,
  signalBarsSinceLabel,
  signalFilterStateLabel,
  signalFreshnessLabel,
  signalOptionsActionColor,
  signalOptionsActionLabel,
} from "./algoHelpers";

export const AlgoSignalsTab = ({
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
  algoIsPhone,
}) => (
  <>
    <div
      style={{
        display: "grid",
        gridTemplateColumns: algoDetailGridTemplate,
        gap: sp(10),
        minWidth: 0,
      }}
    >
      <div
        data-testid="algo-signal-action-panel"
        style={{
          border: "none",
          borderRadius: dim(RADII.md),
          background: T.bg1,
          padding: sp("9px 10px"),
          minWidth: 0,
        }}
      >
        <SectionHeader
          title={<>Signal -&gt; Action</>}
          subtitle="universe signal mapping and candidate queue"
          right={<Badge color={T.cyan}>SHADOW ONLY</Badge>}
        />

        {!visibleSignalRows.length ? (
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
            No RayReplica signal states are available for this deployment yet.
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gap: 0,
              minWidth: 0,
              borderTop: `1px solid ${T.border}`,
              marginTop: sp(4),
            }}
          >
            {visibleSignalRows.map((signal, index) => {
              const signalRecord = asRecord(signal);
              const linkedCandidate = signalOptionsCandidates.find(
                (candidate) =>
                  asRecord(candidate.signal).signalKey &&
                  asRecord(candidate.signal).signalKey === signalRecord.signalKey,
              );
              const tone =
                signalRecord.fresh === false
                  ? T.amber
                  : linkedCandidate
                    ? signalOptionsActionColor(
                        linkedCandidate.actionStatus || linkedCandidate.status,
                      )
                    : T.textDim;
              return (
                <div
                  key={
                    signalRecord.signalKey ||
                    `${signalRecord.symbol}:${signalRecord.timeframe}:${index}`
                  }
                  className="ra-row-enter"
                  style={{
                    ...motionRowStyle(index, 9, 60),
                    borderLeft: `3px solid ${tone}`,
                    borderBottom: `1px solid ${T.border}`,
                    background: `${tone}08`,
                    padding: sp("5px 9px"),
                    minWidth: 0,
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: algoIsPhone
                        ? "minmax(0, 1fr)"
                        : "minmax(90px, 0.7fr) minmax(110px, 0.85fr) minmax(110px, 0.85fr) minmax(130px, 1fr)",
                      gap: sp(5),
                      alignItems: "center",
                    }}
                  >
                    {[
                      [
                        "Signal",
                        `${signalRecord.symbol || MISSING_VALUE} ${signalRecord.direction || MISSING_VALUE}`,
                      ],
                      [
                        "Freshness",
                        `${signalFreshnessLabel(signalRecord)} · ${signalBarsSinceLabel(signalRecord)}`,
                      ],
                      [
                        "Action",
                        signalActionLabel(signalRecord, linkedCandidate?.action),
                      ],
                      [
                        "Outcome",
                        linkedCandidate
                          ? signalOptionsActionLabel(
                              linkedCandidate.actionStatus || linkedCandidate.status,
                            )
                          : "Awaiting scan",
                      ],
                    ].map(([label, value]) => (
                      <div key={label} style={{ minWidth: 0 }}>
                        <div
                          style={{
                            color: T.textMuted,
                            fontFamily: T.sans,
                            fontSize: textSize("caption"),
                            letterSpacing: "0.04em",
                          }}
                        >
                          {label.toUpperCase()}
                        </div>
                        <div
                          style={{
                            color: label === "Action" ? tone : T.text,
                            fontFamily: T.sans,
                            fontSize: textSize("caption"),
                            fontWeight: FONT_WEIGHTS.regular,
                            marginTop: sp(3),
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {value}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div
        style={{
          border: "none",
          borderRadius: dim(RADII.md),
          background: T.bg1,
          padding: sp("9px 10px"),
          minWidth: 0,
        }}
      >
        <SectionHeader title="Selected Action" />
        {selectedCandidate ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: algoIsPhone
                ? "minmax(0, 1fr)"
                : "repeat(2, minmax(0, 1fr))",
              columnGap: sp(8),
              marginTop: sp(4),
              borderTop: `1px solid ${T.border}`,
            }}
          >
            {[
              ["Signal", `${selectedCandidate.symbol} ${selectedCandidate.direction}`],
              [
                "Mapped to",
                signalActionLabel(selectedCandidate.signal, selectedCandidate.action),
              ],
              ["Contract", formatContractLabel(selectedCandidate.selectedContract)],
              [
                "Limit",
                formatMoney(asRecord(selectedCandidate.orderPlan).entryLimitPrice, 2),
              ],
              [
                "Spread",
                formatPct(asRecord(selectedCandidate.liquidity).spreadPctOfMid),
              ],
              ["Shadow", shadowLinkSummary(selectedCandidate.shadowLink)],
            ].map(([label, value]) => (
              <div
                key={label}
                style={{
                  display: "grid",
                  gridTemplateColumns: `${dim(76)}px minmax(0, 1fr)`,
                  gap: sp(5),
                  alignItems: "baseline",
                  padding: sp("4px 0"),
                  borderBottom: `1px solid ${T.border}`,
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
                  {String(label).toUpperCase()}
                </span>
                <span
                  style={{
                    color: T.text,
                    fontFamily: T.sans,
                    fontSize: textSize("caption"),
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {value}
                </span>
              </div>
            ))}
            <button
              type="button"
              onClick={() => handleOpenCandidateInTrade(selectedCandidate)}
              disabled={
                !onJumpToTradeCandidate ||
                !asRecord(selectedCandidate.selectedContract).strike
              }
              style={{
                ...compactButtonStyle({
                  fill: true,
                  disabled:
                    !onJumpToTradeCandidate ||
                    !asRecord(selectedCandidate.selectedContract).strike,
                }),
                gridColumn: "1 / -1",
                color: T.text,
                border: `1px solid ${T.accent}55`,
                background: `${T.accent}16`,
              }}
            >
              INSPECT CONTRACT
            </button>
          </div>
        ) : (
          <div
            style={{
              color: T.textDim,
              fontFamily: T.sans,
              fontSize: fs(10),
              lineHeight: 1.45,
            }}
          >
            Fresh RayReplica signals will appear here before scans resolve
            shadow option contracts.
          </div>
        )}
      </div>
    </div>

    <div
      style={{
        border: "none",
        borderRadius: dim(RADII.md),
        background: T.bg1,
        padding: sp("9px 10px"),
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: algoCandidateGridTemplate,
          gap: sp(8),
          minWidth: 0,
        }}
      >
        <div style={{ display: "grid", gap: sp(6), minWidth: 0 }}>
          {!displayedSignalOptionsCandidates.length ? (
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
              {selectedPipelineStageId === "all"
                ? "No potential actions yet. Fresh RayReplica universe signals will appear here before scans resolve shadow option contracts."
                : "No candidates match the selected pipeline stage."}
            </div>
          ) : (
            displayedSignalOptionsCandidates.slice(0, 6).map((candidate, index) => {
              const selected = selectedCandidate?.id === candidate.id;
              const tone = signalOptionsActionColor(
                candidate.actionStatus || candidate.status,
              );
              return (
                <button
                  key={candidate.id}
                  type="button"
                  className={joinMotionClasses(
                    "ra-row-enter",
                    "ra-interactive",
                    selected && "ra-focus-rail",
                  )}
                  onClick={() => setSelectedCandidateId(candidate.id)}
                  style={{
                    ...motionRowStyle(index, 10, 70),
                    ...motionVars({ accent: tone }),
                    textAlign: "left",
                    border: `1px solid ${selected ? tone : T.border}`,
                    borderRadius: dim(RADII.sm),
                    background: selected ? `${tone}24` : T.bg2,
                    padding: sp("8px 9px"),
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
                    <span
                      style={{
                        color: T.text,
                        fontFamily: T.sans,
                        fontSize: textSize("caption"),
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {candidate.symbol}{" "}
                      {signalActionLabel(candidate.signal, candidate.action)}
                    </span>
                    <Badge color={tone}>
                      {signalOptionsActionLabel(
                        candidate.actionStatus || candidate.status,
                      ).toUpperCase()}
                    </Badge>
                  </div>
                  <div
                    style={{
                      color: T.textDim,
                      fontFamily: T.sans,
                      fontSize: textSize("body"),
                      marginTop: sp(3),
                    }}
                  >
                    {candidate.timeframe} · {candidate.direction} ·{" "}
                    {candidate.optionRight?.toUpperCase() || "OPTION"} ·{" "}
                    {formatRelativeTimeShort(candidate.signalAt)}
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div
          style={{
            border: `1px solid ${T.border}`,
            borderRadius: dim(RADII.md),
            background: T.bg1,
            padding: sp("8px 9px"),
            minWidth: 0,
          }}
        >
          {selectedCandidate ? (
            <div style={{ display: "grid", gap: sp(6) }}>
              <div
                style={{
                  color: T.text,
                  fontFamily: T.sans,
                  fontSize: fs(12),
                  fontWeight: FONT_WEIGHTS.regular,
                }}
              >
                {selectedCandidate.symbol}{" "}
                {selectedCandidate.direction?.toUpperCase()} Signal
              </div>
              <div
                style={{
                  color: T.textDim,
                  fontFamily: T.sans,
                  fontSize: textSize("body"),
                  lineHeight: 1.35,
                }}
              >
                {selectedCandidate.timeframe} · signal{" "}
                {formatRelativeTimeShort(selectedCandidate.signalAt)} · spot{" "}
                {formatPlainPrice(selectedCandidate.signalPrice, 2)} ·{" "}
                {signalFreshnessLabel(selectedCandidate.signal)}
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: algoIsPhone
                    ? "minmax(0, 1fr)"
                    : "repeat(2, minmax(0, 1fr))",
                  gap: sp(6),
                }}
              >
                {[
                  ["Filter", signalFilterStateLabel(selectedCandidate.signal)],
                  ["Destination", "Shadow account"],
                  ["Bid / Ask", `${formatMoney(asRecord(selectedCandidate.liquidity).bid, 2)} / ${formatMoney(asRecord(selectedCandidate.liquidity).ask, 2)}`],
                  ["Mark / Last", `${formatMoney(asRecord(selectedCandidate.liquidity).mark, 2)} / ${formatMoney(asRecord(selectedCandidate.liquidity).last, 2)}`],
                  ["Mid / Spread", `${formatMoney(asRecord(selectedCandidate.liquidity).mid, 2)} / ${formatPct(asRecord(selectedCandidate.liquidity).spreadPctOfMid)}`],
                  ["Freshness", formatLiquidityFreshness(asRecord(selectedCandidate.liquidity).quoteFreshness)],
                  [
                    "Gate",
                    `${signalOptionsProfile.liquidityGate.requireBidAsk ? "Bid/ask required" : "Mark-only allowed"} · max ${formatPct(signalOptionsProfile.liquidityGate.maxSpreadPctOfMid, 0)}`,
                  ],
                  ["Premium", formatMoney(asRecord(selectedCandidate.orderPlan).premiumAtRisk)],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    style={{
                      border: "none",
                      borderRadius: dim(RADII.md),
                      background: T.bg1,
                      padding: sp("6px 7px"),
                      minWidth: 0,
                    }}
                  >
                    <div
                      style={{
                        color: T.textMuted,
                        fontFamily: T.sans,
                        fontSize: textSize("caption"),
                        letterSpacing: "0.04em",
                      }}
                    >
                      {String(label).toUpperCase()}
                    </div>
                    <div
                      style={{
                        color: T.text,
                        fontFamily: T.sans,
                        fontSize: textSize("caption"),
                        marginTop: sp(2),
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {value}
                    </div>
                  </div>
                ))}
              </div>
              {selectedCandidate.reason && (
                <div
                  style={{
                    color: T.amber,
                    fontFamily: T.sans,
                    fontSize: textSize("caption"),
                    lineHeight: 1.4,
                  }}
                >
                  {formatLiquidityReason(selectedCandidate.reason)}
                </div>
              )}
            </div>
          ) : (
            <div
              style={{
                color: T.textDim,
                fontFamily: T.sans,
                fontSize: fs(10),
                lineHeight: 1.45,
              }}
            >
              Select a candidate to inspect its contract, fill simulation,
              liquidity gate, Shadow ledger link, and signal mapping.
            </div>
          )}
        </div>
      </div>
    </div>
  </>
);

export default AlgoSignalsTab;
