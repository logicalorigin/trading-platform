import { FailurePointInlineIcon } from "./FailurePointTooltip.jsx";
import { buildDataIssue, getPrimaryDataIssue } from "../../features/platform/dataIssueModel.js";

const summarizeIssues = (issues) => {
  const list = Array.isArray(issues) ? issues.filter(Boolean) : [];
  if (list.length <= 1) return list[0] || null;
  const primary = getPrimaryDataIssue(list);
  if (!primary) return null;
  return buildDataIssue({
    ...primary,
    title: `${primary.title} + ${list.length - 1} more`,
    summary: primary.summary,
    metrics: [["Issues", String(list.length)], ...(primary.metrics || [])],
    topCauses: list.map((issue) => issue.title || issue.summary).filter(Boolean),
  });
};

export const DataIssueInlineIcon = ({
  issue,
  issues,
  side = "top",
  align = "center",
  size = 12,
}) => {
  const point = issue || summarizeIssues(issues);
  if (!point) return null;
  return (
    <FailurePointInlineIcon
      point={point}
      side={side}
      align={align}
      size={size}
    />
  );
};

export default DataIssueInlineIcon;
