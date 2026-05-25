import { useCallback, useEffect, useState } from "react";
import {
  PYRUS_WORKSPACE_SETTINGS_EVENT,
  PYRUS_STORAGE_KEY,
} from "../../lib/uiTokens.jsx";

const STORAGE_KEY_FIELD = "accountSection";
const DEFAULT_SECTION = "real";

const readAccountSectionFromStorage = () => {
  if (typeof window === "undefined" || !window.localStorage) {
    return DEFAULT_SECTION;
  }
  try {
    const raw = window.localStorage.getItem(PYRUS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const value = parsed[STORAGE_KEY_FIELD];
    return value === "shadow" ? "shadow" : "real";
  } catch {
    return DEFAULT_SECTION;
  }
};

export const readAccountSection = readAccountSectionFromStorage;

export const writeAccountSection = (value) => {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const raw = window.localStorage.getItem(PYRUS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const next = { ...parsed, [STORAGE_KEY_FIELD]: value === "shadow" ? "shadow" : "real" };
    window.localStorage.setItem(PYRUS_STORAGE_KEY, JSON.stringify(next));
    for (const eventName of [
      PYRUS_WORKSPACE_SETTINGS_EVENT,
    ]) {
      window.dispatchEvent(new CustomEvent(eventName, { detail: next }));
    }
  } catch {
    /* swallow quota errors */
  }
};

export const useAccountSection = () => {
  const [section, setSection] = useState(readAccountSectionFromStorage);
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const sync = () => setSection(readAccountSectionFromStorage());
    window.addEventListener(PYRUS_WORKSPACE_SETTINGS_EVENT, sync);
    return () => {
      window.removeEventListener(PYRUS_WORKSPACE_SETTINGS_EVENT, sync);
    };
  }, []);
  const setSectionExternal = useCallback((value) => {
    writeAccountSection(value);
    setSection(value === "shadow" ? "shadow" : "real");
  }, []);
  return [section, setSectionExternal];
};
