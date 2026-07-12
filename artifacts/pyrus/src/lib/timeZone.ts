import {
  formatPreferenceDateTime,
  formatPreferenceTimeZoneLabel,
  getCachedPreferenceDateTimeFormatter,
  readCachedUserPreferences,
  resolvePreferenceTimeZone,
  type UserPreferences,
} from "../features/preferences/userPreferenceModel";

type DateValue = Date | number | string | null | undefined;

const DEFAULT_FALLBACK = "----";

const toDate = (value: DateValue): Date | null => {
  if (value == null || value === "") {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const withAppTimeZone = (
  preferences: UserPreferences,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormatOptions => ({
  ...options,
  ...(preferences.time.hourCycle === "auto"
    ? {}
    : { hourCycle: preferences.time.hourCycle }),
  timeZone: resolvePreferenceTimeZone(preferences, "app"),
});

export const getAppTimeZoneLabel = (
  preferences: UserPreferences = readCachedUserPreferences(),
): string => formatPreferenceTimeZoneLabel(preferences, "app");

export const formatAppDateForPreferences = (
  value: DateValue,
  preferences: UserPreferences,
  options: Intl.DateTimeFormatOptions = {},
  fallback = DEFAULT_FALLBACK,
): string => {
  const date = toDate(value);
  if (!date) {
    return fallback;
  }
  if (Object.keys(options).length === 0) {
    return formatPreferenceDateTime(date, {
      preferences,
      context: "app",
      includeTime: false,
      fallback,
    });
  }

  return getCachedPreferenceDateTimeFormatter(
    withAppTimeZone(preferences, options),
  ).format(date);
};

export const formatAppTimeForPreferences = (
  value: DateValue,
  preferences: UserPreferences,
  options: Intl.DateTimeFormatOptions = {},
  fallback = DEFAULT_FALLBACK,
): string => {
  const date = toDate(value);
  if (!date) {
    return fallback;
  }
  if (Object.keys(options).length === 0) {
    return formatPreferenceDateTime(date, {
      preferences,
      context: "app",
      includeDate: false,
      fallback,
    });
  }

  return getCachedPreferenceDateTimeFormatter(
    withAppTimeZone(preferences, options),
  ).format(date);
};

export const formatAppDateTimeForPreferences = (
  value: DateValue,
  preferences: UserPreferences,
  options: Intl.DateTimeFormatOptions = {},
  fallback = DEFAULT_FALLBACK,
): string => {
  const date = toDate(value);
  if (!date) {
    return fallback;
  }
  if (Object.keys(options).length === 0) {
    return formatPreferenceDateTime(date, {
      preferences,
      context: "app",
      fallback,
    });
  }

  return getCachedPreferenceDateTimeFormatter(
    withAppTimeZone(preferences, options),
  ).format(date);
};

export const formatAppDate = (
  value: DateValue,
  options: Intl.DateTimeFormatOptions = {},
  fallback = DEFAULT_FALLBACK,
): string =>
  formatAppDateForPreferences(
    value,
    readCachedUserPreferences(),
    options,
    fallback,
  );

export const formatAppTime = (
  value: DateValue,
  options: Intl.DateTimeFormatOptions = {},
  fallback = DEFAULT_FALLBACK,
): string =>
  formatAppTimeForPreferences(
    value,
    readCachedUserPreferences(),
    options,
    fallback,
  );

export const formatAppDateTime = (
  value: DateValue,
  options: Intl.DateTimeFormatOptions = {},
  fallback = DEFAULT_FALLBACK,
): string =>
  formatAppDateTimeForPreferences(
    value,
    readCachedUserPreferences(),
    options,
    fallback,
  );
