import { CircleAlert } from "lucide-react";
import { FailurePointTooltip } from "./FailurePointTooltip.jsx";
import { buildDataIssue, getPrimaryDataIssue } from "../../features/platform/dataIssueModel.js";
import { CSS_COLOR, RADII, dim } from "../../lib/uiTokens.jsx";

const summarizeIssues = (issues) => {
  const list = Array.isArray(issues) ? issues.filter(Boolean) : [];
  if (list.length <= 1) return list[0] || null;
  const primary = getPrimaryDataIssue(list);
  if (!primary) return null;
  return buildDataIssue({
    ...primary,
    title: `${primary.title} + ${list.length - 1} more`,
    metrics: [["Issues", String(list.length)], ...(primary.metrics || [])],
    topCauses: list.map((issue) => issue.title || issue.summary).filter(Boolean),
  });
};

// Dedicated marker for backend resilience events (backoffs / timeouts / fallbacks /
// loadsheds). Uses a literal exclamation glyph (CircleAlert) so it reads distinctly
// from the AlertTriangle used by generic failure icons. severity drives the tone:
// "warning" -> red (hard degradation served to the user), "attention" -> amber
// (transient / self-healing pressure). The reason/summary come from a DataIssue.
export const ResilienceMarker = ({
  issue,
  issues,
  severity = "warning",
  side = "top",
  align = "center",
  size = 12,
}) => {
  const base = issue || summarizeIssues(issues);
  if (!base) return null;
  const tone = severity === "attention" ? CSS_COLOR.amber : CSS_COLOR.red;
  const point = base.severity === severity ? base : { ...base, severity };
  return (
    <FailurePointTooltip point={point} side={side} align={align} compact>
      <span
        data-testid="resilience-marker"
        role="img"
        aria-label={`${base.title || "Backend issue"} details`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: dim(size + 6),
          height: dim(size + 6),
          borderRadius: dim(RADII.pill),
          color: tone,
          cursor: "help",
          flexShrink: 0,
        }}
      >
        <CircleAlert size={size} strokeWidth={2.1} aria-hidden="true" />
      </span>
    </FailurePointTooltip>
  );
};

export default ResilienceMarker;
