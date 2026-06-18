import { useCallback, useEffect, useState } from "react";
import {
  PYRUS_WORKSPACE_SETTINGS_EVENT,
  PYRUS_STORAGE_KEY,
} from "../../lib/workspaceStorage";

const STORAGE_KEY_FIELD = "accountSection";
const DEFAULT_SECTION = "real";

const normalizeAccountSection = (value) =>
  value === "shadow" ? "shadow" : DEFAULT_SECTION;

const readCurrentWorkspaceState = () => {
  if (typeof window === "undefined" || !window.localStorage) {
    return undefined;
  }
  const raw = window.localStorage.getItem(PYRUS_STORAGE_KEY);
  return raw ? JSON.parse(raw) : {};
};

const readAccountSectionFromStorage = () => {
  try {
    const parsed = readCurrentWorkspaceState();
    if (parsed === undefined) return DEFAULT_SECTION;
    const value = parsed[STORAGE_KEY_FIELD];
    return normalizeAccountSection(value);
  } catch {
    return DEFAULT_SECTION;
  }
};

export const readAccountSection = readAccountSectionFromStorage;

export const writeAccountSection = (value) => {
  try {
    const parsed = readCurrentWorkspaceState();
    if (parsed === undefined) return;
    const next = { ...parsed, [STORAGE_KEY_FIELD]: normalizeAccountSection(value) };
    window.localStorage.setItem(PYRUS_STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(PYRUS_WORKSPACE_SETTINGS_EVENT, { detail: next }));
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
    setSection(normalizeAccountSection(value));
  }, []);
  return [section, setSectionExternal];
};
