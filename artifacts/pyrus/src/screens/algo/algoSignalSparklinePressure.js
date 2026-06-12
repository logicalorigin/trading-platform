const PRESSURE_RANK = {
  normal: 0,
  watch: 1,
  high: 2,
};

const normalizePressureLevel = (value) =>
  value === "high" || value === "watch" ? value : "normal";

const maxPressureLevel = (...levels) =>
  levels
    .map(normalizePressureLevel)
    .reduce(
      (current, next) =>
        PRESSURE_RANK[next] > PRESSURE_RANK[current] ? next : current,
      "normal",
    );

const SPARKLINE_PAUSE_DRIVER_KINDS = new Set([
  "api-heap",
  "api-rss",
  "browser-memory",
]);

const highPausingDriverLevels = (drivers) =>
  (Array.isArray(drivers) ? drivers : [])
    .filter((driver) => SPARKLINE_PAUSE_DRIVER_KINDS.has(driver?.kind))
    .map((driver) => driver?.level);

export const resolveAlgoSignalSparklinePressureLevel = (snapshot = null) =>
  maxPressureLevel(
    snapshot?.level,
    ...highPausingDriverLevels(snapshot?.pressureDrivers),
    ...highPausingDriverLevels(snapshot?.dominantDrivers),
    ...highPausingDriverLevels(snapshot?.server?.pressureDrivers),
    ...highPausingDriverLevels(snapshot?.server?.dominantDrivers),
  );

export const shouldPauseAlgoSignalRowSparklines = (snapshot = null) =>
  false;
