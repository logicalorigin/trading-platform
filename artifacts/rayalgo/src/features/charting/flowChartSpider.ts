import type { ChartEventBias, ChartEventSeverity } from "./chartEvents";
import type {
  FlowChartEventPlacement,
  FlowChartSourceBasis,
} from "./flowChartEvents";

export const SPIDER_MARKER_SIZE = 36;
export const SPIDER_BASE_RADIUS = 44;
export const SPIDER_RING_SPACING = 40;
export const SPIDER_ANGLE_OFFSET = -Math.PI / 2;

const severityRank: Record<ChartEventSeverity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  extreme: 3,
};

const sourceBasisOrder: Record<FlowChartSourceBasis, number> = {
  confirmed_trade: 0,
  snapshot_activity: 1,
  other: 2,
};

export type FlowEventCluster = {
  id: string;
  anchorX: number;
  anchorY: number;
  barIndex: number;
  members: FlowChartEventPlacement[];
  dominantSeverity: ChartEventSeverity;
  dominantBias: ChartEventBias;
  count: number;
  totalPremium: number;
  kind: "single" | "cluster";
};

export type SpiderChildPosition = {
  id: string;
  x: number;
  y: number;
  ring: number;
  angle: number;
};

export const spiderRingCapacity = (ringIndex: number): number =>
  ringIndex === 0 ? 7 : 7 + ringIndex * 5;

const readPremium = (placement: FlowChartEventPlacement): number => {
  const value = placement.event.metadata?.premium;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,\s,]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const fnv1aHash = (input: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

const buildClusterId = (members: FlowChartEventPlacement[]): string => {
  const sorted = members.map((member) => member.id).sort();
  return `flow-cluster:${fnv1aHash(sorted.join("|"))}`;
};

const pickDominant = (
  members: FlowChartEventPlacement[],
): { severity: ChartEventSeverity; bias: ChartEventBias } => {
  let best = members[0];
  let bestScore = severityRank[best.event.severity] * 1e12 + readPremium(best);
  for (let index = 1; index < members.length; index += 1) {
    const candidate = members[index];
    const score =
      severityRank[candidate.event.severity] * 1e12 + readPremium(candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return { severity: best.event.severity, bias: best.event.bias };
};

const sortMembers = (
  members: FlowChartEventPlacement[],
): FlowChartEventPlacement[] =>
  [...members].sort(
    (left, right) =>
      sourceBasisOrder[left.sourceBasis] - sourceBasisOrder[right.sourceBasis] ||
      left.eventTimeMs - right.eventTimeMs ||
      left.id.localeCompare(right.id),
  );

const median = (values: number[]): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
};

export type FlowEventClusterBuildOptions = {
  mergeThresholdPx?: number;
};

export const buildFlowEventClusters = (
  placements: FlowChartEventPlacement[],
  resolveAnchorXY: (
    placement: FlowChartEventPlacement,
  ) => { x: number; y: number } | null,
  options: FlowEventClusterBuildOptions = {},
): FlowEventCluster[] => {
  if (!placements.length) return [];
  const mergeThreshold = options.mergeThresholdPx ?? SPIDER_BASE_RADIUS;

  const byBarIndex = new Map<
    number,
    { members: FlowChartEventPlacement[]; anchors: { x: number; y: number }[] }
  >();
  placements.forEach((placement) => {
    const anchor = resolveAnchorXY(placement);
    if (!anchor) return;
    const existing = byBarIndex.get(placement.barIndex) || {
      members: [],
      anchors: [],
    };
    existing.members.push(placement);
    existing.anchors.push(anchor);
    byBarIndex.set(placement.barIndex, existing);
  });

  type WorkingCluster = {
    barIndices: number[];
    members: FlowChartEventPlacement[];
    anchors: { x: number; y: number }[];
    anchorX: number;
    anchorY: number;
  };

  const initial: WorkingCluster[] = Array.from(byBarIndex.entries())
    .map(([barIndex, group]) => ({
      barIndices: group.members.map(() => barIndex),
      members: group.members,
      anchors: group.anchors,
      anchorX: median(group.anchors.map((anchor) => anchor.x)),
      anchorY: median(group.anchors.map((anchor) => anchor.y)),
    }))
    .sort((left, right) => left.anchorX - right.anchorX);

  const merged: WorkingCluster[] = [];
  initial.forEach((cluster) => {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      Math.abs(cluster.anchorX - previous.anchorX) <= mergeThreshold &&
      Math.abs(cluster.anchorY - previous.anchorY) <= mergeThreshold
    ) {
      previous.members = [...previous.members, ...cluster.members];
      previous.anchors = [...previous.anchors, ...cluster.anchors];
      previous.barIndices = [...previous.barIndices, ...cluster.barIndices];
      previous.anchorX = median(previous.anchors.map((anchor) => anchor.x));
      previous.anchorY = median(previous.anchors.map((anchor) => anchor.y));
    } else {
      merged.push({ ...cluster });
    }
  });

  return merged.map((cluster) => {
    const members = sortMembers(cluster.members);
    const dominant = pickDominant(members);
    const totalPremium = members.reduce((sum, member) => sum + readPremium(member), 0);
    return {
      id: buildClusterId(members),
      anchorX: cluster.anchorX,
      anchorY: cluster.anchorY,
      barIndex: Math.round(median(cluster.barIndices)),
      members,
      dominantSeverity: dominant.severity,
      dominantBias: dominant.bias,
      count: members.length,
      totalPremium,
      kind: members.length === 1 ? "single" : "cluster",
    };
  });
};

export const computeSpiderChildPositions = (
  cluster: FlowEventCluster,
): SpiderChildPosition[] => {
  if (cluster.kind === "single") return [];
  const positions: SpiderChildPosition[] = [];
  let memberIndex = 0;
  let ring = 0;
  while (memberIndex < cluster.members.length) {
    const remaining = cluster.members.length - memberIndex;
    const capacity = spiderRingCapacity(ring);
    const slotsInRing = Math.min(capacity, remaining);
    const radius = SPIDER_BASE_RADIUS + ring * SPIDER_RING_SPACING;
    for (let slot = 0; slot < slotsInRing; slot += 1) {
      const angle = SPIDER_ANGLE_OFFSET + (2 * Math.PI * slot) / slotsInRing;
      positions.push({
        id: cluster.members[memberIndex].id,
        x: cluster.anchorX + radius * Math.cos(angle),
        y: cluster.anchorY + radius * Math.sin(angle),
        ring,
        angle,
      });
      memberIndex += 1;
    }
    ring += 1;
  }
  return positions;
};
