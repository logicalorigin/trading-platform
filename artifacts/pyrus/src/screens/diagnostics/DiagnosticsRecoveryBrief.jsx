import { Button } from "../../components/ui/Button.jsx";
import { StatusPill } from "../../components/platform/primitives.jsx";
import {
  CSS_COLOR,
  FONT_WEIGHTS,
  T,
  cssColorMix,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import { formatAppDateTime } from "../../lib/timeZone";

const stateMeta = (state) => {
  if (state === "failure") return { label: "ATTENTION", tone: CSS_COLOR.amber };
  if (state === "healthy") return { label: "READY", tone: CSS_COLOR.green };
  return { label: "WAITING", tone: CSS_COLOR.textDim };
};

export function DiagnosticsRecoveryBrief({
  model,
  isPhone = false,
  isNarrow = false,
  onOpenTab,
}) {
  const columns = isPhone ? 1 : isNarrow ? 2 : 4;
  const meta = stateMeta(model.state);
  const observed = model.observedAt
    ? formatAppDateTime(model.observedAt)
    : "Not observed yet";
  const blocks = [
    {
      id: "failure",
      label: "Current failure",
      value: model.currentFailure,
      detail: model.summary,
    },
    {
      id: "impact",
      label: "Impact",
      value: model.impact,
    },
    {
      id: "evidence",
      label: "Evidence",
      value: model.evidence,
      detail: `${model.subsystem || "collector"} · ${observed}`,
    },
    {
      id: "action",
      label: "Next safe action",
      value: model.nextAction,
      action: model.targetTab ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onOpenTab(model.targetTab)}
          style={{ alignSelf: "flex-start" }}
        >
          Review {model.targetTab}
        </Button>
      ) : null,
    },
  ];

  return (
    <section
      data-testid="diagnostics-recovery-brief"
      aria-labelledby="diagnostics-recovery-title"
      style={{
        borderTop: `1px solid ${CSS_COLOR.border}`,
        borderBottom: `1px solid ${CSS_COLOR.border}`,
        background: CSS_COLOR.bg1,
        marginBottom: sp(12),
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: sp(8),
          flexWrap: "wrap",
          padding: sp(isPhone ? "9px 10px" : "10px 14px"),
          borderBottom: `1px solid ${cssColorMix(CSS_COLOR.border, 60)}`,
          minWidth: 0,
        }}
      >
        <span
          id="diagnostics-recovery-title"
          style={{
            color: CSS_COLOR.text,
            fontFamily: T.sans,
            fontSize: textSize("label"),
            fontWeight: FONT_WEIGHTS.label,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          Recovery brief
        </span>
        <StatusPill color={meta.tone} variant="ghost" glow={false}>
          {meta.label}
        </StatusPill>
        <span
          style={{
            marginLeft: isPhone ? 0 : "auto",
            color: CSS_COLOR.textDim,
            fontFamily: T.data,
            fontSize: textSize("caption"),
          }}
        >
          Observed {observed}
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          minWidth: 0,
        }}
      >
        {blocks.map((block, index) => {
          const beginsRow = index % columns === 0;
          const laterRow = index >= columns;
          return (
            <div
              key={block.id}
              data-testid={`diagnostics-recovery-${block.id}`}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: sp(5),
                padding: sp(isPhone ? "10px" : "12px 14px"),
                borderLeft: !beginsRow
                  ? `1px solid ${cssColorMix(CSS_COLOR.border, 60)}`
                  : undefined,
                borderTop: laterRow
                  ? `1px solid ${cssColorMix(CSS_COLOR.border, 60)}`
                  : undefined,
                minWidth: 0,
              }}
            >
              <span
                style={{
                  color: CSS_COLOR.textDim,
                  fontFamily: T.sans,
                  fontSize: textSize("caption"),
                  fontWeight: FONT_WEIGHTS.label,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                }}
              >
                {block.label}
              </span>
              <span
                style={{
                  color: CSS_COLOR.text,
                  fontFamily: T.sans,
                  fontSize: textSize("paragraphMuted"),
                  fontWeight:
                    block.id === "failure"
                      ? FONT_WEIGHTS.medium
                      : FONT_WEIGHTS.regular,
                  lineHeight: 1.4,
                  overflowWrap: "anywhere",
                }}
              >
                {block.value}
              </span>
              {block.detail ? (
                <span
                  style={{
                    color: CSS_COLOR.textDim,
                    fontFamily: block.id === "evidence" ? T.data : T.sans,
                    fontSize: textSize("caption"),
                    lineHeight: 1.35,
                    overflowWrap: "anywhere",
                  }}
                >
                  {block.detail}
                </span>
              ) : null}
              {block.action}
            </div>
          );
        })}
      </div>
    </section>
  );
}
