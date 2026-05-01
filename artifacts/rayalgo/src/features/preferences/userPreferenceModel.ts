export const USER_PREFERENCES_UPDATED_EVENT = "rayalgo:user-preferences-updated";
export const USER_PREFERENCES_STORAGE_KEY = "rayalgo:state:v1";

export type UserPreferences = {
  appearance: {
    theme: "system" | "dark" | "light";
    density: "compact" | "comfortable";
    scale: "xs" | "s" | "m" | "l" | "xl";
    reducedMotion: "system" | "on" | "off";
    showTooltips: boolean;
    maskBalances: boolean;
  };
  time: {
    appTimeZoneMode: "app" | "local" | "exchange" | "utc" | "fixed";
    chartTimeZoneMode: "exchange" | "local" | "utc" | "fixed";
    fixedTimeZone: string;
    hourCycle: "auto" | "h12" | "h23";
    dateFormat: "locale" | "mdy" | "ymd" | "dmy";
    showSeconds: boolean;
    showTimeZoneBadge: boolean;
  };
  chart: {
    statusLineDetail: "full" | "compact" | "minimal";
    showOhlc: boolean;
    showVolume: boolean;
    showIndicatorValues: boolean;
    showTimeScale: boolean;
    showGrid: boolean;
    crosshairMode: "magnet" | "free";
    priceScaleMode: "linear" | "log" | "percent" | "indexed";
    futureExpansionBars: number;
    keepTimeZoom: boolean;
    extendedHours: boolean;
    sessionBreaks: boolean;
    rayAlgoDashboard: "auto" | "full" | "compact" | "hidden";
  };
  workspace: {
    defaultScreen: string;
    defaultSymbol: string;
    marketGridLayout: string;
    flowDensity: "compact" | "comfortable";
    flowRowsPerPage: number;
  };
  trading: {
    confirmOrders: boolean;
    showChartTrader: boolean;
    showExecutionMarkers: boolean;
    showPositionLines: boolean;
  };
  notifications: {
    audioEnabled: boolean;
    alertVolume: number;
    desktopNotifications: "ask" | "on" | "off";
    quietHoursEnabled: boolean;
    quietHoursStart: string;
    quietHoursEnd: string;
  };
  privacy: {
    hideAccountValues: boolean;
    persistSearchHistory: boolean;
    persistChartViewports: boolean;
    showDiagnosticsInSettings: boolean;
  };
};

export type UserPreferenceSnapshot = {
  profileKey: string;
  version: number;
  preferences: UserPreferences;
  source: "database" | "fallback" | "local";
  updatedAt: string;
};

type JsonRecord = Record<string, unknown>;

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  appearance: {
    theme: "dark",
    density: "compact",
    scale: "m",
    reducedMotion: "system",
    showTooltips: true,
    maskBalances: false,
  },
  time: {
    appTimeZoneMode: "app",
    chartTimeZoneMode: "exchange",
    fixedTimeZone: "America/New_York",
    hourCycle: "auto",
    dateFormat: "locale",
    showSeconds: false,
    showTimeZoneBadge: true,
  },
  chart: {
    statusLineDetail: "full",
    showOhlc: true,
    showVolume: true,
    showIndicatorValues: true,
    showTimeScale: true,
    showGrid: true,
    crosshairMode: "magnet",
    priceScaleMode: "linear",
    futureExpansionBars: 6,
    keepTimeZoom: true,
    extendedHours: true,
    sessionBreaks: false,
    rayAlgoDashboard: "auto",
  },
  workspace: {
    defaultScreen: "market",
    defaultSymbol: "SPY",
    marketGridLayout: "2x3",
    flowDensity: "compact",
    flowRowsPerPage: 40,
  },
  trading: {
    confirmOrders: true,
    showChartTrader: false,
    showExecutionMarkers: true,
    showPositionLines: true,
  },
  notifications: {
    audioEnabled: true,
    alertVolume: 70,
    desktopNotifications: "ask",
    quietHoursEnabled: false,
    quietHoursStart: "20:00",
    quietHoursEnd: "06:00",
  },
  privacy: {
    hideAccountValues: false,
    persistSearchHistory: true,
    persistChartViewports: true,
    showDiagnosticsInSettings: true,
  },
};

export const EXCHANGE_TIME_ZONE = "America/New_York";
export const APP_DEFAULT_TIME_ZONE = "America/Denver";

const recordValue = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};

const enumValue = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T => (typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback);

const booleanValue = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const numberValue = (
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback;
};

const stringValue = (
  value: unknown,
  fallback: string,
  pattern?: RegExp,
): string => {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed || (pattern && !pattern.test(trimmed))) return fallback;
  return trimmed;
};

const timeZoneValue = (value: unknown, fallback: string): string => {
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value.trim() }).format(new Date());
    return value.trim();
  } catch {
    return fallback;
  }
};

export const deepMergeRecords = (
  base: JsonRecord,
  patch: JsonRecord,
): JsonRecord => {
  const next: JsonRecord = { ...base };
  Object.entries(patch).forEach(([key, value]) => {
    if (value === undefined) return;
    const current = next[key];
    if (
      current &&
      typeof current === "object" &&
      !Array.isArray(current) &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      next[key] = deepMergeRecords(current as JsonRecord, value as JsonRecord);
    } else {
      next[key] = value;
    }
  });
  return next;
};

export function normalizeUserPreferences(value: unknown): UserPreferences {
  const input = recordValue(value);
  const appearance = recordValue(input.appearance);
  const time = recordValue(input.time);
  const chart = recordValue(input.chart);
  const workspace = recordValue(input.workspace);
  const trading = recordValue(input.trading);
  const notifications = recordValue(input.notifications);
  const privacy = recordValue(input.privacy);

  return {
    appearance: {
      theme: enumValue(appearance.theme, ["system", "dark", "light"], DEFAULT_USER_PREFERENCES.appearance.theme),
      density: enumValue(appearance.density, ["compact", "comfortable"], DEFAULT_USER_PREFERENCES.appearance.density),
      scale: enumValue(appearance.scale, ["xs", "s", "m", "l", "xl"], DEFAULT_USER_PREFERENCES.appearance.scale),
      reducedMotion: enumValue(appearance.reducedMotion, ["system", "on", "off"], DEFAULT_USER_PREFERENCES.appearance.reducedMotion),
      showTooltips: booleanValue(appearance.showTooltips, DEFAULT_USER_PREFERENCES.appearance.showTooltips),
      maskBalances: booleanValue(appearance.maskBalances, DEFAULT_USER_PREFERENCES.appearance.maskBalances),
    },
    time: {
      appTimeZoneMode: enumValue(time.appTimeZoneMode, ["app", "local", "exchange", "utc", "fixed"], DEFAULT_USER_PREFERENCES.time.appTimeZoneMode),
      chartTimeZoneMode: enumValue(time.chartTimeZoneMode, ["exchange", "local", "utc", "fixed"], DEFAULT_USER_PREFERENCES.time.chartTimeZoneMode),
      fixedTimeZone: timeZoneValue(time.fixedTimeZone, DEFAULT_USER_PREFERENCES.time.fixedTimeZone),
      hourCycle: enumValue(time.hourCycle, ["auto", "h12", "h23"], DEFAULT_USER_PREFERENCES.time.hourCycle),
      dateFormat: enumValue(time.dateFormat, ["locale", "mdy", "ymd", "dmy"], DEFAULT_USER_PREFERENCES.time.dateFormat),
      showSeconds: booleanValue(time.showSeconds, DEFAULT_USER_PREFERENCES.time.showSeconds),
      showTimeZoneBadge: booleanValue(time.showTimeZoneBadge, DEFAULT_USER_PREFERENCES.time.showTimeZoneBadge),
    },
    chart: {
      statusLineDetail: enumValue(chart.statusLineDetail, ["full", "compact", "minimal"], DEFAULT_USER_PREFERENCES.chart.statusLineDetail),
      showOhlc: booleanValue(chart.showOhlc, DEFAULT_USER_PREFERENCES.chart.showOhlc),
      showVolume: booleanValue(chart.showVolume, DEFAULT_USER_PREFERENCES.chart.showVolume),
      showIndicatorValues: booleanValue(chart.showIndicatorValues, DEFAULT_USER_PREFERENCES.chart.showIndicatorValues),
      showTimeScale: booleanValue(chart.showTimeScale, DEFAULT_USER_PREFERENCES.chart.showTimeScale),
      showGrid: booleanValue(chart.showGrid, DEFAULT_USER_PREFERENCES.chart.showGrid),
      crosshairMode: enumValue(chart.crosshairMode, ["magnet", "free"], DEFAULT_USER_PREFERENCES.chart.crosshairMode),
      priceScaleMode: enumValue(chart.priceScaleMode, ["linear", "log", "percent", "indexed"], DEFAULT_USER_PREFERENCES.chart.priceScaleMode),
      futureExpansionBars: numberValue(chart.futureExpansionBars, DEFAULT_USER_PREFERENCES.chart.futureExpansionBars, 0, 1000),
      keepTimeZoom: booleanValue(chart.keepTimeZoom, DEFAULT_USER_PREFERENCES.chart.keepTimeZoom),
      extendedHours: booleanValue(chart.extendedHours, DEFAULT_USER_PREFERENCES.chart.extendedHours),
      sessionBreaks: booleanValue(chart.sessionBreaks, DEFAULT_USER_PREFERENCES.chart.sessionBreaks),
      rayAlgoDashboard: enumValue(chart.rayAlgoDashboard, ["auto", "full", "compact", "hidden"], DEFAULT_USER_PREFERENCES.chart.rayAlgoDashboard),
    },
    workspace: {
      defaultScreen: stringValue(workspace.defaultScreen, DEFAULT_USER_PREFERENCES.workspace.defaultScreen, /^[a-z-]+$/i),
      defaultSymbol: stringValue(workspace.defaultSymbol, DEFAULT_USER_PREFERENCES.workspace.defaultSymbol, /^[A-Z0-9.\-:]{1,32}$/i).toUpperCase(),
      marketGridLayout: stringValue(workspace.marketGridLayout, DEFAULT_USER_PREFERENCES.workspace.marketGridLayout, /^\d+x\d+$/),
      flowDensity: enumValue(workspace.flowDensity, ["compact", "comfortable"], DEFAULT_USER_PREFERENCES.workspace.flowDensity),
      flowRowsPerPage: numberValue(workspace.flowRowsPerPage, DEFAULT_USER_PREFERENCES.workspace.flowRowsPerPage, 10, 500),
    },
    trading: {
      confirmOrders: booleanValue(trading.confirmOrders, DEFAULT_USER_PREFERENCES.trading.confirmOrders),
      showChartTrader: booleanValue(trading.showChartTrader, DEFAULT_USER_PREFERENCES.trading.showChartTrader),
      showExecutionMarkers: booleanValue(trading.showExecutionMarkers, DEFAULT_USER_PREFERENCES.trading.showExecutionMarkers),
      showPositionLines: booleanValue(trading.showPositionLines, DEFAULT_USER_PREFERENCES.trading.showPositionLines),
    },
    notifications: {
      audioEnabled: booleanValue(notifications.audioEnabled, DEFAULT_USER_PREFERENCES.notifications.audioEnabled),
      alertVolume: numberValue(notifications.alertVolume, DEFAULT_USER_PREFERENCES.notifications.alertVolume, 0, 100),
      desktopNotifications: enumValue(notifications.desktopNotifications, ["ask", "on", "off"], DEFAULT_USER_PREFERENCES.notifications.desktopNotifications),
      quietHoursEnabled: booleanValue(notifications.quietHoursEnabled, DEFAULT_USER_PREFERENCES.notifications.quietHoursEnabled),
      quietHoursStart: stringValue(notifications.quietHoursStart, DEFAULT_USER_PREFERENCES.notifications.quietHoursStart, /^\d{2}:\d{2}$/),
      quietHoursEnd: stringValue(notifications.quietHoursEnd, DEFAULT_USER_PREFERENCES.notifications.quietHoursEnd, /^\d{2}:\d{2}$/),
    },
    privacy: {
      hideAccountValues: booleanValue(privacy.hideAccountValues, DEFAULT_USER_PREFERENCES.privacy.hideAccountValues),
      persistSearchHistory: booleanValue(privacy.persistSearchHistory, DEFAULT_USER_PREFERENCES.privacy.persistSearchHistory),
      persistChartViewports: booleanValue(privacy.persistChartViewports, DEFAULT_USER_PREFERENCES.privacy.persistChartViewports),
      showDiagnosticsInSettings: booleanValue(privacy.showDiagnosticsInSettings, DEFAULT_USER_PREFERENCES.privacy.showDiagnosticsInSettings),
    },
  };
}

const readWorkspaceState = (): JsonRecord => {
  try {
    const raw = window.localStorage.getItem(USER_PREFERENCES_STORAGE_KEY);
    return raw ? recordValue(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
};

export const readCachedUserPreferences = (): UserPreferences => {
  if (typeof window === "undefined") {
    return DEFAULT_USER_PREFERENCES;
  }
  const state = readWorkspaceState();
  return normalizeUserPreferences(
    deepMergeRecords(
      {
        appearance: {
          theme: typeof state.theme === "string" ? state.theme : undefined,
          scale: typeof state.scale === "string" ? state.scale : undefined,
        },
        workspace: {
          defaultScreen: state.screen,
          defaultSymbol: state.sym,
          marketGridLayout: state.marketGridLayout,
          flowDensity: state.flowDensity,
          flowRowsPerPage: state.flowRowsPerPage,
        },
      },
      recordValue(state.userPreferences),
    ),
  );
};

export const writeCachedUserPreferences = (
  preferences: UserPreferences,
): void => {
  if (typeof window === "undefined") return;
  try {
    const current = readWorkspaceState();
    const next = {
      ...current,
      userPreferences: preferences,
      theme:
        preferences.appearance.theme === "system"
          ? current.theme
          : preferences.appearance.theme,
      scale: preferences.appearance.scale,
      screen: preferences.workspace.defaultScreen,
      sym: preferences.workspace.defaultSymbol,
      marketGridLayout: preferences.workspace.marketGridLayout,
      flowDensity: preferences.workspace.flowDensity,
      flowRowsPerPage: preferences.workspace.flowRowsPerPage,
    };
    window.localStorage.setItem(USER_PREFERENCES_STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(
      new CustomEvent(USER_PREFERENCES_UPDATED_EVENT, {
        detail: preferences,
      }),
    );
    window.dispatchEvent(
      new CustomEvent("rayalgo:workspace-settings-updated", {
        detail: next,
      }),
    );
  } catch {}
};

export const buildLocalPreferenceSnapshot = (): UserPreferenceSnapshot => ({
  profileKey: "default",
  version: 1,
  preferences: readCachedUserPreferences(),
  source: "local",
  updatedAt: new Date(0).toISOString(),
});

export const normalizePreferenceSnapshot = (
  value: unknown,
): UserPreferenceSnapshot => {
  const record = recordValue(value);
  return {
    profileKey:
      typeof record.profileKey === "string" && record.profileKey
        ? record.profileKey
        : "default",
    version: Number.isFinite(Number(record.version)) ? Number(record.version) : 1,
    preferences: normalizeUserPreferences(record.preferences),
    source:
      record.source === "database" || record.source === "fallback"
        ? record.source
        : "local",
    updatedAt:
      typeof record.updatedAt === "string" && record.updatedAt
        ? record.updatedAt
        : new Date(0).toISOString(),
  };
};

export const getBrowserTimeZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || APP_DEFAULT_TIME_ZONE;
  } catch {
    return APP_DEFAULT_TIME_ZONE;
  }
};

export const resolvePreferenceTimeZone = (
  preferences: UserPreferences = readCachedUserPreferences(),
  context: "app" | "chart" = "app",
): string => {
  const resolvedPreferences = normalizeUserPreferences(preferences);
  const mode =
    context === "chart"
      ? resolvedPreferences.time.chartTimeZoneMode
      : resolvedPreferences.time.appTimeZoneMode;
  if (mode === "local") return getBrowserTimeZone();
  if (mode === "utc") return "UTC";
  if (mode === "fixed") {
    return timeZoneValue(resolvedPreferences.time.fixedTimeZone, EXCHANGE_TIME_ZONE);
  }
  if (mode === "exchange") return EXCHANGE_TIME_ZONE;
  return APP_DEFAULT_TIME_ZONE;
};

const dateOptions = (
  format: UserPreferences["time"]["dateFormat"],
): Pick<Intl.DateTimeFormatOptions, "year" | "month" | "day"> => {
  if (format === "ymd") return { year: "numeric", month: "2-digit", day: "2-digit" };
  if (format === "dmy") return { day: "2-digit", month: "2-digit", year: "numeric" };
  if (format === "mdy") return { month: "2-digit", day: "2-digit", year: "numeric" };
  return { year: "numeric", month: "numeric", day: "numeric" };
};

export const formatPreferenceDateTime = (
  value: Date | number | string | null | undefined,
  options: {
    preferences?: UserPreferences;
    context?: "app" | "chart";
    includeDate?: boolean;
    includeTime?: boolean;
    fallback?: string;
    monthStyle?: "numeric" | "short" | "2-digit";
    dayStyle?: "numeric" | "2-digit";
    weekdayStyle?: "short" | "long" | "narrow";
  } = {},
): string => {
  const fallback = options.fallback ?? "----";
  if (value == null || value === "") return fallback;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  const preferences = normalizeUserPreferences(
    options.preferences ?? readCachedUserPreferences(),
  );
  const includeDate = options.includeDate !== false;
  const includeTime = options.includeTime !== false;
  const hourCycle =
    preferences.time.hourCycle === "auto" ? undefined : preferences.time.hourCycle;
  const formatOptions: Intl.DateTimeFormatOptions = {
    ...(includeDate ? dateOptions(preferences.time.dateFormat) : {}),
    ...(includeTime
      ? {
          hour: "2-digit",
          minute: "2-digit",
          ...(preferences.time.showSeconds ? { second: "2-digit" } : {}),
        }
      : {}),
    ...(hourCycle ? { hourCycle } : {}),
    timeZone: resolvePreferenceTimeZone(preferences, options.context ?? "app"),
  };
  if (options.monthStyle) {
    formatOptions.month = options.monthStyle;
  }
  if (options.dayStyle) {
    formatOptions.day = options.dayStyle;
  }
  if (options.weekdayStyle) {
    formatOptions.weekday = options.weekdayStyle;
  }
  return new Intl.DateTimeFormat("en-US", formatOptions).format(date);
};

export const formatPreferenceTimeZoneLabel = (
  preferences: UserPreferences = readCachedUserPreferences(),
  context: "app" | "chart" = "app",
): string => {
  const zone = resolvePreferenceTimeZone(preferences, context);
  if (zone === "UTC") return "UTC";
  if (zone === EXCHANGE_TIME_ZONE) return "ET";
  if (zone === APP_DEFAULT_TIME_ZONE) return "MT";
  return zone.split("/").pop()?.replace(/_/g, " ") || zone;
};
