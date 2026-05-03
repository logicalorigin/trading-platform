import { useEffect, useState } from "react";

const STORAGE_KEY = "rayalgo.footerMemoryPressure.v1";
const EVENT_NAME = "rayalgo:footer-memory-pressure-updated";

export const DEFAULT_MEMORY_PRESSURE_PREFERENCES = {
  animationEnabled: true,
  showCompactLabel: true,
  alertThreshold: "high",
};

const normalizePreferences = (input = {}) => ({
  animationEnabled:
    typeof input.animationEnabled === "boolean"
      ? input.animationEnabled
      : DEFAULT_MEMORY_PRESSURE_PREFERENCES.animationEnabled,
  showCompactLabel:
    typeof input.showCompactLabel === "boolean"
      ? input.showCompactLabel
      : DEFAULT_MEMORY_PRESSURE_PREFERENCES.showCompactLabel,
  alertThreshold:
    input.alertThreshold === "watch" ||
    input.alertThreshold === "high" ||
    input.alertThreshold === "critical"
      ? input.alertThreshold
      : DEFAULT_MEMORY_PRESSURE_PREFERENCES.alertThreshold,
});

export const readMemoryPressurePreferences = () => {
  if (typeof window === "undefined") {
    return { ...DEFAULT_MEMORY_PRESSURE_PREFERENCES };
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return normalizePreferences(raw ? JSON.parse(raw) : {});
  } catch {
    return { ...DEFAULT_MEMORY_PRESSURE_PREFERENCES };
  }
};

export const writeMemoryPressurePreferences = (input) => {
  const next = normalizePreferences(input);
  if (typeof window === "undefined") {
    return next;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: next }));
  } catch {}
  return next;
};

export const useMemoryPressurePreferences = () => {
  const [preferences, setPreferences] = useState(readMemoryPressurePreferences);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const handleSync = () => {
      setPreferences(readMemoryPressurePreferences());
    };

    window.addEventListener(EVENT_NAME, handleSync);
    window.addEventListener("storage", handleSync);
    return () => {
      window.removeEventListener(EVENT_NAME, handleSync);
      window.removeEventListener("storage", handleSync);
    };
  }, []);

  const updatePreferences = (patch) => {
    const next = writeMemoryPressurePreferences({
      ...preferences,
      ...(typeof patch === "function" ? patch(preferences) : patch),
    });
    setPreferences(next);
  };

  return { preferences, updatePreferences };
};
