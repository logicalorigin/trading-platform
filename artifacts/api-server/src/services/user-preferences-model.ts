import { HttpError } from "../lib/errors";

export const USER_PREFERENCES_PROFILE_KEY = "default";
export const USER_PREFERENCES_VERSION = 1;

type JsonRecord = Record<string, unknown>;

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

const enumValue = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
  key: string,
  strict: boolean,
): T => {
  if (typeof value === "string" && allowed.includes(value as T)) {
    return value as T;
  }
  if (value !== undefined && strict) {
    throw new HttpError(400, "Invalid user preference.", {
      code: "invalid_user_preference",
      detail: `${key} is not a supported value.`,
    });
  }
  return fallback;
};

const booleanValue = (
  value: unknown,
  fallback: boolean,
  key: string,
  strict: boolean,
): boolean => {
  if (typeof value === "boolean") {
    return value;
  }
  if (value !== undefined && strict) {
    throw new HttpError(400, "Invalid user preference.", {
      code: "invalid_user_preference",
      detail: `${key} must be true or false.`,
    });
  }
  return fallback;
};

const numberValue = (
  value: unknown,
  fallback: number,
  key: string,
  strict: boolean,
  min: number,
  max: number,
): number => {
  const numeric = Number(value);
  if (value !== undefined && Number.isFinite(numeric)) {
    return Math.min(max, Math.max(min, numeric));
  }
  if (value !== undefined && strict) {
    throw new HttpError(400, "Invalid user preference.", {
      code: "invalid_user_preference",
      detail: `${key} must be numeric.`,
    });
  }
  return fallback;
};

const stringValue = (
  value: unknown,
  fallback: string,
  key: string,
  strict: boolean,
  pattern?: RegExp,
): string => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!pattern || pattern.test(trimmed)) {
      return trimmed || fallback;
    }
  }
  if (value !== undefined && strict) {
    throw new HttpError(400, "Invalid user preference.", {
      code: "invalid_user_preference",
      detail: `${key} is not valid.`,
    });
  }
  return fallback;
};

const recordValue = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};

const validateTimeZone = (
  value: unknown,
  fallback: string,
  key: string,
  strict: boolean,
): string => {
  if (typeof value === "string" && value.trim()) {
    const candidate = value.trim();
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(
        new Date(),
      );
      return candidate;
    } catch {
      if (strict) {
        throw new HttpError(400, "Invalid user preference.", {
          code: "invalid_user_preference",
          detail: `${key} must be an IANA time zone.`,
        });
      }
    }
  } else if (value !== undefined && strict) {
    throw new HttpError(400, "Invalid user preference.", {
      code: "invalid_user_preference",
      detail: `${key} must be an IANA time zone.`,
    });
  }
  return fallback;
};

export function deepMergeRecords(
  base: JsonRecord,
  patch: JsonRecord,
): JsonRecord {
  const next: JsonRecord = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      continue;
    }
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
  }
  return next;
}

export function normalizeUserPreferences(
  value: unknown,
  options: { strict?: boolean } = {},
): UserPreferences {
  const strict = options.strict === true;
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
      theme: enumValue(
        appearance.theme,
        ["system", "dark", "light"],
        DEFAULT_USER_PREFERENCES.appearance.theme,
        "appearance.theme",
        strict,
      ),
      density: enumValue(
        appearance.density,
        ["compact", "comfortable"],
        DEFAULT_USER_PREFERENCES.appearance.density,
        "appearance.density",
        strict,
      ),
      scale: enumValue(
        appearance.scale,
        ["xs", "s", "m", "l", "xl"],
        DEFAULT_USER_PREFERENCES.appearance.scale,
        "appearance.scale",
        strict,
      ),
      reducedMotion: enumValue(
        appearance.reducedMotion,
        ["system", "on", "off"],
        DEFAULT_USER_PREFERENCES.appearance.reducedMotion,
        "appearance.reducedMotion",
        strict,
      ),
      showTooltips: booleanValue(
        appearance.showTooltips,
        DEFAULT_USER_PREFERENCES.appearance.showTooltips,
        "appearance.showTooltips",
        strict,
      ),
      maskBalances: booleanValue(
        appearance.maskBalances,
        DEFAULT_USER_PREFERENCES.appearance.maskBalances,
        "appearance.maskBalances",
        strict,
      ),
    },
    time: {
      appTimeZoneMode: enumValue(
        time.appTimeZoneMode,
        ["app", "local", "exchange", "utc", "fixed"],
        DEFAULT_USER_PREFERENCES.time.appTimeZoneMode,
        "time.appTimeZoneMode",
        strict,
      ),
      chartTimeZoneMode: enumValue(
        time.chartTimeZoneMode,
        ["exchange", "local", "utc", "fixed"],
        DEFAULT_USER_PREFERENCES.time.chartTimeZoneMode,
        "time.chartTimeZoneMode",
        strict,
      ),
      fixedTimeZone: validateTimeZone(
        time.fixedTimeZone,
        DEFAULT_USER_PREFERENCES.time.fixedTimeZone,
        "time.fixedTimeZone",
        strict,
      ),
      hourCycle: enumValue(
        time.hourCycle,
        ["auto", "h12", "h23"],
        DEFAULT_USER_PREFERENCES.time.hourCycle,
        "time.hourCycle",
        strict,
      ),
      dateFormat: enumValue(
        time.dateFormat,
        ["locale", "mdy", "ymd", "dmy"],
        DEFAULT_USER_PREFERENCES.time.dateFormat,
        "time.dateFormat",
        strict,
      ),
      showSeconds: booleanValue(
        time.showSeconds,
        DEFAULT_USER_PREFERENCES.time.showSeconds,
        "time.showSeconds",
        strict,
      ),
      showTimeZoneBadge: booleanValue(
        time.showTimeZoneBadge,
        DEFAULT_USER_PREFERENCES.time.showTimeZoneBadge,
        "time.showTimeZoneBadge",
        strict,
      ),
    },
    chart: {
      statusLineDetail: enumValue(
        chart.statusLineDetail,
        ["full", "compact", "minimal"],
        DEFAULT_USER_PREFERENCES.chart.statusLineDetail,
        "chart.statusLineDetail",
        strict,
      ),
      showOhlc: booleanValue(
        chart.showOhlc,
        DEFAULT_USER_PREFERENCES.chart.showOhlc,
        "chart.showOhlc",
        strict,
      ),
      showVolume: booleanValue(
        chart.showVolume,
        DEFAULT_USER_PREFERENCES.chart.showVolume,
        "chart.showVolume",
        strict,
      ),
      showIndicatorValues: booleanValue(
        chart.showIndicatorValues,
        DEFAULT_USER_PREFERENCES.chart.showIndicatorValues,
        "chart.showIndicatorValues",
        strict,
      ),
      showTimeScale: booleanValue(
        chart.showTimeScale,
        DEFAULT_USER_PREFERENCES.chart.showTimeScale,
        "chart.showTimeScale",
        strict,
      ),
      showGrid: booleanValue(
        chart.showGrid,
        DEFAULT_USER_PREFERENCES.chart.showGrid,
        "chart.showGrid",
        strict,
      ),
      crosshairMode: enumValue(
        chart.crosshairMode,
        ["magnet", "free"],
        DEFAULT_USER_PREFERENCES.chart.crosshairMode,
        "chart.crosshairMode",
        strict,
      ),
      priceScaleMode: enumValue(
        chart.priceScaleMode,
        ["linear", "log", "percent", "indexed"],
        DEFAULT_USER_PREFERENCES.chart.priceScaleMode,
        "chart.priceScaleMode",
        strict,
      ),
      futureExpansionBars: numberValue(
        chart.futureExpansionBars,
        DEFAULT_USER_PREFERENCES.chart.futureExpansionBars,
        "chart.futureExpansionBars",
        strict,
        0,
        1000,
      ),
      keepTimeZoom: booleanValue(
        chart.keepTimeZoom,
        DEFAULT_USER_PREFERENCES.chart.keepTimeZoom,
        "chart.keepTimeZoom",
        strict,
      ),
      extendedHours: booleanValue(
        chart.extendedHours,
        DEFAULT_USER_PREFERENCES.chart.extendedHours,
        "chart.extendedHours",
        strict,
      ),
      sessionBreaks: booleanValue(
        chart.sessionBreaks,
        DEFAULT_USER_PREFERENCES.chart.sessionBreaks,
        "chart.sessionBreaks",
        strict,
      ),
      rayAlgoDashboard: enumValue(
        chart.rayAlgoDashboard,
        ["auto", "full", "compact", "hidden"],
        DEFAULT_USER_PREFERENCES.chart.rayAlgoDashboard,
        "chart.rayAlgoDashboard",
        strict,
      ),
    },
    workspace: {
      defaultScreen: stringValue(
        workspace.defaultScreen,
        DEFAULT_USER_PREFERENCES.workspace.defaultScreen,
        "workspace.defaultScreen",
        strict,
        /^[a-z-]+$/i,
      ),
      defaultSymbol: stringValue(
        workspace.defaultSymbol,
        DEFAULT_USER_PREFERENCES.workspace.defaultSymbol,
        "workspace.defaultSymbol",
        strict,
        /^[A-Z0-9.\-:]{1,32}$/i,
      ).toUpperCase(),
      marketGridLayout: stringValue(
        workspace.marketGridLayout,
        DEFAULT_USER_PREFERENCES.workspace.marketGridLayout,
        "workspace.marketGridLayout",
        strict,
        /^\d+x\d+$/,
      ),
      flowDensity: enumValue(
        workspace.flowDensity,
        ["compact", "comfortable"],
        DEFAULT_USER_PREFERENCES.workspace.flowDensity,
        "workspace.flowDensity",
        strict,
      ),
      flowRowsPerPage: numberValue(
        workspace.flowRowsPerPage,
        DEFAULT_USER_PREFERENCES.workspace.flowRowsPerPage,
        "workspace.flowRowsPerPage",
        strict,
        10,
        500,
      ),
    },
    trading: {
      confirmOrders: booleanValue(
        trading.confirmOrders,
        DEFAULT_USER_PREFERENCES.trading.confirmOrders,
        "trading.confirmOrders",
        strict,
      ),
      showChartTrader: booleanValue(
        trading.showChartTrader,
        DEFAULT_USER_PREFERENCES.trading.showChartTrader,
        "trading.showChartTrader",
        strict,
      ),
      showExecutionMarkers: booleanValue(
        trading.showExecutionMarkers,
        DEFAULT_USER_PREFERENCES.trading.showExecutionMarkers,
        "trading.showExecutionMarkers",
        strict,
      ),
      showPositionLines: booleanValue(
        trading.showPositionLines,
        DEFAULT_USER_PREFERENCES.trading.showPositionLines,
        "trading.showPositionLines",
        strict,
      ),
    },
    notifications: {
      audioEnabled: booleanValue(
        notifications.audioEnabled,
        DEFAULT_USER_PREFERENCES.notifications.audioEnabled,
        "notifications.audioEnabled",
        strict,
      ),
      alertVolume: numberValue(
        notifications.alertVolume,
        DEFAULT_USER_PREFERENCES.notifications.alertVolume,
        "notifications.alertVolume",
        strict,
        0,
        100,
      ),
      desktopNotifications: enumValue(
        notifications.desktopNotifications,
        ["ask", "on", "off"],
        DEFAULT_USER_PREFERENCES.notifications.desktopNotifications,
        "notifications.desktopNotifications",
        strict,
      ),
      quietHoursEnabled: booleanValue(
        notifications.quietHoursEnabled,
        DEFAULT_USER_PREFERENCES.notifications.quietHoursEnabled,
        "notifications.quietHoursEnabled",
        strict,
      ),
      quietHoursStart: stringValue(
        notifications.quietHoursStart,
        DEFAULT_USER_PREFERENCES.notifications.quietHoursStart,
        "notifications.quietHoursStart",
        strict,
        /^\d{2}:\d{2}$/,
      ),
      quietHoursEnd: stringValue(
        notifications.quietHoursEnd,
        DEFAULT_USER_PREFERENCES.notifications.quietHoursEnd,
        "notifications.quietHoursEnd",
        strict,
        /^\d{2}:\d{2}$/,
      ),
    },
    privacy: {
      hideAccountValues: booleanValue(
        privacy.hideAccountValues,
        DEFAULT_USER_PREFERENCES.privacy.hideAccountValues,
        "privacy.hideAccountValues",
        strict,
      ),
      persistSearchHistory: booleanValue(
        privacy.persistSearchHistory,
        DEFAULT_USER_PREFERENCES.privacy.persistSearchHistory,
        "privacy.persistSearchHistory",
        strict,
      ),
      persistChartViewports: booleanValue(
        privacy.persistChartViewports,
        DEFAULT_USER_PREFERENCES.privacy.persistChartViewports,
        "privacy.persistChartViewports",
        strict,
      ),
      showDiagnosticsInSettings: booleanValue(
        privacy.showDiagnosticsInSettings,
        DEFAULT_USER_PREFERENCES.privacy.showDiagnosticsInSettings,
        "privacy.showDiagnosticsInSettings",
        strict,
      ),
    },
  };
}
