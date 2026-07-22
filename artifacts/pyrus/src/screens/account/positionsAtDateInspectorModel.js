export const buildPositionsAtDateInspectorState = ({
  activeDate = null,
  pinnedDate = null,
  response = null,
  currentPositionsCount = null,
} = {}) => {
  if (!activeDate) {
    const count =
      currentPositionsCount == null ? null : Number(currentPositionsCount);
    return {
      mode: "live",
      title: "Positions Inspector",
      rightRail: count != null && Number.isFinite(count)
        ? `${count} current positions`
        : "Current positions unavailable",
      positions: [],
      positionsKnown: false,
      activity: [],
      activityKnown: false,
      unavailable: false,
    };
  }

  const mode = pinnedDate ? "pinned" : "hover";
  const responseDate = String(response?.date ?? "").slice(0, 10);
  if (responseDate !== activeDate) {
    return {
      mode,
      title: `Positions @ ${activeDate}`,
      rightRail: pinnedDate ? "Pinned date" : "Hover preview",
      positions: [],
      positionsKnown: false,
      activity: [],
      activityKnown: false,
      balance: null,
      unavailable: true,
      message: "No authoritative position snapshot exists for the selected date.",
    };
  }
  const positionsKnown = Array.isArray(response?.positions);
  const positions = positionsKnown ? response.positions : [];
  const activityKnown = Array.isArray(response?.activity);
  const activity = activityKnown ? response.activity : [];
  const balance = response?.totals?.balance || null;
  const unavailable =
    response?.status === "unavailable" &&
    !balance &&
    positions.length === 0 &&
    activity.length === 0;
  return {
    mode,
    title: `Positions @ ${activeDate}`,
    rightRail: pinnedDate ? "Pinned date" : "Hover preview",
    positions,
    positionsKnown,
    activity,
    activityKnown,
    balance,
    unavailable,
    message: response?.message || null,
  };
};
