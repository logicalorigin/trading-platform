import { useCallback, useEffect, useState } from "react";
import {
  PYRUS_WORKSPACE_SETTINGS_EVENT,
  PYRUS_STORAGE_KEY,
} from "../../lib/workspaceStorage";

const STORAGE_KEY_FIELD = "accountTab";
// The multi-account tab strip replaces the old real/shadow SegmentedControl,
// which persisted its selection under `accountSection`. Preserve a saved shadow
// selection when migrating an existing user to the tab model.
const LEGACY_SECTION_FIELD = "accountSection";
const DEFAULT_TAB = "all";

// Tab id domain: "all" (cross-account aggregate) | <account.id> | "shadow". A
// blank/absent value defaults to "all". Account ids are opaque strings validated
// against the live account list by the consumer, not here, so any non-empty
// string is retained as-is.
const normalizeAccountTab = (value) =>
  typeof value === "string" && value.trim() ? value : DEFAULT_TAB;

const readCurrentWorkspaceState = () => {
  if (typeof window === "undefined" || !window.localStorage) {
    return undefined;
  }
  const raw = window.localStorage.getItem(PYRUS_STORAGE_KEY);
  return raw ? JSON.parse(raw) : {};
};

const readAccountTabFromStorage = () => {
  try {
    const parsed = readCurrentWorkspaceState();
    if (parsed === undefined) return DEFAULT_TAB;
    const value = parsed[STORAGE_KEY_FIELD];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
    if (parsed[LEGACY_SECTION_FIELD] === "shadow") {
      return "shadow";
    }
    return DEFAULT_TAB;
  } catch {
    return DEFAULT_TAB;
  }
};

export const readAccountTab = readAccountTabFromStorage;

export const writeAccountTab = (value) => {
  try {
    const parsed = readCurrentWorkspaceState();
    if (parsed === undefined) return;
    const normalized = normalizeAccountTab(value);
    // Mirror the shadow/real intent onto the legacy `accountSection` field so
    // out-of-page consumers that still read it (e.g. chart position overlays)
    // continue to reflect the active tab's shadow-vs-live mode.
    const next = {
      ...parsed,
      [STORAGE_KEY_FIELD]: normalized,
      [LEGACY_SECTION_FIELD]: normalized === "shadow" ? "shadow" : "real",
    };
    window.localStorage.setItem(PYRUS_STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(PYRUS_WORKSPACE_SETTINGS_EVENT, { detail: next }));
  } catch {
    /* swallow quota errors */
  }
};

export const useAccountTab = () => {
  const [tab, setTab] = useState(readAccountTabFromStorage);
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const sync = () => setTab(readAccountTabFromStorage());
    window.addEventListener(PYRUS_WORKSPACE_SETTINGS_EVENT, sync);
    return () => {
      window.removeEventListener(PYRUS_WORKSPACE_SETTINGS_EVENT, sync);
    };
  }, []);
  const setTabExternal = useCallback((value) => {
    writeAccountTab(value);
    setTab(normalizeAccountTab(value));
  }, []);
  return [tab, setTabExternal];
};
