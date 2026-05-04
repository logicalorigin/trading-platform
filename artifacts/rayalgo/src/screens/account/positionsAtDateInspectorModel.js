export const buildPositionsAtDateInspectorState = ({
  activeDate = null,
  pinnedDate = null,
  response = null,
  currentPositionsCount = 0,
} = {}) => {
  if (!activeDate) {
    return {
      mode: "live",
      title: "Positions Inspector",
      rightRail: `${currentPositionsCount} current positions`,
      positions: [],
      activity: [],
      unavailable: false,
    };
  }

  const mode = pinnedDate ? "pinned" : "hover";
  const positions = Array.isArray(response?.positions) ? response.positions : [];
  const activity = Array.isArray(response?.activity) ? response.activity : [];
  const unavailable = response?.status === "unavailable";
  return {
    mode,
    title: `Positions @ ${activeDate}`,
    rightRail: pinnedDate ? "Pinned date" : "Hover preview",
    positions,
    activity,
    unavailable,
    message: response?.message || null,
  };
};
