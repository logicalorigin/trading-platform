export type ChartTimeframeRole = "mini" | "primary" | "option";

export type ChartTimeframeDefinition = {
  value: string;
  label: string;
  stepMs: number;
  baseTimeframe: string;
  streamable: boolean;
  supports: Record<ChartTimeframeRole, boolean>;
  limits: Record<ChartTimeframeRole, { initial: number; target: number; max: number }>;
};

const minuteMs = 60_000;
const hourMs = 60 * minuteMs;
const dayMs = 24 * hourMs;

const defineLimits = (
  initial: number,
  target: number,
  max: number,
): { initial: number; target: number; max: number } => ({
  initial,
  target,
  max,
});

export const CHART_TIMEFRAME_DEFINITIONS: ChartTimeframeDefinition[] = [
  {
    value: "1s",
    label: "1s",
    stepMs: 1_000,
    baseTimeframe: "1s",
    streamable: false,
    supports: { mini: false, primary: false, option: false },
    limits: {
      mini: defineLimits(120, 240, 900),
      primary: defineLimits(180, 900, 7_200),
      option: defineLimits(0, 0, 0),
    },
  },
  {
    value: "5s",
    label: "5s",
    stepMs: 5_000,
    baseTimeframe: "5s",
    streamable: true,
    supports: { mini: true, primary: true, option: true },
    limits: {
      mini: defineLimits(180, 360, 1_800),
      primary: defineLimits(240, 900, 8_640),
      option: defineLimits(180, 600, 1_800),
    },
  },
  {
    value: "15s",
    label: "15s",
    stepMs: 15_000,
    baseTimeframe: "5s",
    streamable: true,
    supports: { mini: true, primary: true, option: true },
    limits: {
      mini: defineLimits(240, 600, 600),
      primary: defineLimits(300, 900, 2_880),
      option: defineLimits(180, 600, 600),
    },
  },
  {
    value: "30s",
    label: "30s",
    stepMs: 30_000,
    baseTimeframe: "5s",
    streamable: true,
    supports: { mini: true, primary: true, option: true },
    limits: {
      mini: defineLimits(240, 300, 300),
      primary: defineLimits(300, 900, 1_440),
      option: defineLimits(180, 300, 300),
    },
  },
  {
    value: "1m",
    label: "1m",
    stepMs: minuteMs,
    baseTimeframe: "1m",
    streamable: true,
    supports: { mini: true, primary: true, option: true },
    limits: {
      mini: defineLimits(900, 900, 1_800),
      primary: defineLimits(360, 1_800, 20_000),
      option: defineLimits(240, 720, 2_400),
    },
  },
  {
    value: "2m",
    label: "2m",
    stepMs: 2 * minuteMs,
    baseTimeframe: "1m",
    streamable: true,
    supports: { mini: true, primary: true, option: true },
    limits: {
      mini: defineLimits(720, 900, 1_800),
      primary: defineLimits(360, 1_800, 10_000),
      option: defineLimits(240, 720, 2_400),
    },
  },
  {
    value: "5m",
    label: "5m",
    stepMs: 5 * minuteMs,
    baseTimeframe: "5m",
    streamable: true,
    supports: { mini: true, primary: true, option: true },
    limits: {
      mini: defineLimits(900, 900, 1_800),
      primary: defineLimits(360, 1_800, 12_000),
      option: defineLimits(240, 720, 2_400),
    },
  },
  {
    value: "15m",
    label: "15m",
    stepMs: 15 * minuteMs,
    baseTimeframe: "15m",
    streamable: true,
    supports: { mini: true, primary: true, option: true },
    limits: {
      mini: defineLimits(900, 900, 1_800),
      primary: defineLimits(300, 1_500, 8_000),
      option: defineLimits(240, 720, 1_800),
    },
  },
  {
    value: "30m",
    label: "30m",
    stepMs: 30 * minuteMs,
    baseTimeframe: "15m",
    streamable: true,
    supports: { mini: true, primary: true, option: true },
    limits: {
      mini: defineLimits(720, 900, 1_800),
      primary: defineLimits(300, 1_500, 6_000),
      option: defineLimits(240, 720, 1_800),
    },
  },
  {
    value: "1h",
    label: "1h",
    stepMs: hourMs,
    baseTimeframe: "1h",
    streamable: true,
    supports: { mini: true, primary: true, option: true },
    limits: {
      mini: defineLimits(780, 780, 1_000),
      primary: defineLimits(240, 1_000, 4_000),
      option: defineLimits(240, 720, 1_200),
    },
  },
  {
    value: "4h",
    label: "4h",
    stepMs: 4 * hourMs,
    baseTimeframe: "1h",
    streamable: true,
    supports: { mini: true, primary: true, option: true },
    limits: {
      mini: defineLimits(480, 720, 1_000),
      primary: defineLimits(240, 1_000, 2_500),
      option: defineLimits(180, 480, 1_000),
    },
  },
  {
    value: "1d",
    label: "1d",
    stepMs: dayMs,
    baseTimeframe: "1d",
    streamable: true,
    supports: { mini: true, primary: true, option: true },
    limits: {
      mini: defineLimits(504, 504, 756),
      primary: defineLimits(252, 756, 2_500),
      option: defineLimits(126, 252, 756),
    },
  },
];

const definitionByValue = new Map(
  CHART_TIMEFRAME_DEFINITIONS.map((definition) => [
    definition.value,
    definition,
  ]),
);

export const normalizeChartTimeframe = (timeframe?: string | null): string => {
  if (timeframe === "1D") {
    return "1d";
  }
  return timeframe || "";
};

export const getChartTimeframeDefinition = (
  timeframe?: string | null,
): ChartTimeframeDefinition | null =>
  definitionByValue.get(normalizeChartTimeframe(timeframe)) || null;

export const getChartTimeframeOptions = (
  role: ChartTimeframeRole = "primary",
): Array<{ value: string; label: string }> =>
  CHART_TIMEFRAME_DEFINITIONS.filter((definition) => definition.supports[role]).map(
    ({ value, label }) => ({ value, label }),
  );

export const getChartTimeframeValues = (
  role: ChartTimeframeRole = "primary",
): string[] => getChartTimeframeOptions(role).map((option) => option.value);

export const DEFAULT_CHART_TIMEFRAME_FAVORITES: Record<
  ChartTimeframeRole,
  string[]
> = {
  mini: ["5s", "1m", "5m", "15m", "1h", "1d"],
  primary: ["5s", "1m", "5m", "15m", "1h", "1d"],
  option: ["5s", "1m", "5m", "15m", "1h", "1d"],
};

export const isChartTimeframeSupported = (
  timeframe: string | null | undefined,
  role: ChartTimeframeRole = "primary",
): boolean => Boolean(getChartTimeframeDefinition(timeframe)?.supports[role]);

export const sanitizeChartTimeframeFavorites = (
  value: unknown,
  role: ChartTimeframeRole = "primary",
): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const favorites: string[] = [];
  value.forEach((entry) => {
    if (typeof entry !== "string") {
      return;
    }

    const normalized = normalizeChartTimeframe(entry);
    if (
      favorites.includes(normalized) ||
      !isChartTimeframeSupported(normalized, role)
    ) {
      return;
    }

    favorites.push(normalized);
  });

  return favorites;
};

export const resolveChartTimeframeFavorites = (
  value: unknown,
  role: ChartTimeframeRole = "primary",
): string[] => {
  const sanitized = sanitizeChartTimeframeFavorites(value, role);
  if (sanitized.length) {
    return sanitized;
  }

  return sanitizeChartTimeframeFavorites(
    DEFAULT_CHART_TIMEFRAME_FAVORITES[role],
    role,
  );
};

export const toggleChartTimeframeFavorite = (
  favorites: unknown,
  timeframe: string,
  role: ChartTimeframeRole = "primary",
): string[] => {
  const current = resolveChartTimeframeFavorites(favorites, role);
  const normalized = normalizeChartTimeframe(timeframe);
  if (!isChartTimeframeSupported(normalized, role)) {
    return current;
  }

  if (current.includes(normalized)) {
    if (current.length <= 1) {
      return current;
    }
    return current.filter((value) => value !== normalized);
  }

  const supportedValues = getChartTimeframeValues(role);
  return [...current, normalized].sort(
    (left, right) =>
      supportedValues.indexOf(left) - supportedValues.indexOf(right),
  );
};

export const isStreamableChartTimeframe = (
  timeframe: string | null | undefined,
): boolean => Boolean(getChartTimeframeDefinition(timeframe)?.streamable);

export const getChartTimeframeStepMs = (
  timeframe: string | null | undefined,
): number => getChartTimeframeDefinition(timeframe)?.stepMs || 0;

export const getChartBrokerRecentWindowMinutes = (
  timeframe: string | null | undefined,
  limit: number | null | undefined,
): number | undefined => {
  const stepMs = getChartTimeframeStepMs(timeframe);
  const barCount =
    typeof limit === "number" && Number.isFinite(limit)
      ? Math.max(1, Math.ceil(limit))
      : 0;
  if (!stepMs || !barCount) {
    return undefined;
  }

  // The API defaults to a 60-minute broker live edge when delayed historical
  // synthesis is configured. Chart callers need a broker window that matches
  // the requested interval horizon so a successful response cannot hydrate only
  // the latest candle and leave the rest to delayed history.
  return Math.max(1, Math.ceil((stepMs * (barCount + 2)) / minuteMs));
};

export const getChartBaseTimeframe = (
  timeframe: string | null | undefined,
): string => getChartTimeframeDefinition(timeframe)?.baseTimeframe || normalizeChartTimeframe(timeframe);

export const getChartBarLimit = (
  timeframe: string,
  role: ChartTimeframeRole = "primary",
): number => {
  const definition = getChartTimeframeDefinition(timeframe);
  return definition?.limits[role]?.target || definitionByValue.get("15m")?.limits.primary.target || 1_500;
};

export const getInitialChartBarLimit = (
  timeframe: string,
  role: ChartTimeframeRole = "primary",
): number => {
  const targetLimit = getChartBarLimit(timeframe, role);
  const initialLimit = getChartTimeframeDefinition(timeframe)?.limits[role]?.initial;
  return Math.min(targetLimit, initialLimit || targetLimit);
};

export const getMaxChartBarLimit = (
  timeframe: string,
  role: ChartTimeframeRole = "primary",
): number => {
  const targetLimit = getChartBarLimit(timeframe, role);
  const maxLimit = getChartTimeframeDefinition(timeframe)?.limits[role]?.max;
  return Math.max(targetLimit, maxLimit || targetLimit);
};

export const resolveAdjacentChartTimeframes = (
  timeframe: string,
  role: ChartTimeframeRole = "primary",
): string[] => {
  const options = getChartTimeframeValues(role);
  const index = options.indexOf(normalizeChartTimeframe(timeframe));
  if (index < 0) {
    return [];
  }

  return [options[index - 1], options[index + 1]].filter(
    (value): value is string => Boolean(value),
  );
};
