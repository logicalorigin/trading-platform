import { useCallback, useEffect, useState } from "react";
import {
  DATA_PROVIDER_BROKER,
  LEGACY_SETTINGS_KEY,
  loadCredentialsForBroker,
} from "../../lib/accountRegistry.js";
import { getDefaultCredentialStatus } from "../../lib/brokerClient.js";

const DATA_PROVIDER_KEYS = ["MASSIVE_API_KEY", "POLYGON_API_KEY", "UW_API_KEY"];

async function readStoredJson(key) {
  try {
    if (typeof window !== "undefined" && window.storage?.get) {
      const record = await window.storage.get(key);
      return record?.value ? JSON.parse(record.value) : {};
    }
    if (typeof localStorage !== "undefined") {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : {};
    }
  } catch {
    return {};
  }
  return {};
}

async function resolveResearchApiCreds() {
  const [legacyCreds, dataProviderCreds, credentialStatusByBroker] = await Promise.all([
    readStoredJson(LEGACY_SETTINGS_KEY),
    loadCredentialsForBroker(DATA_PROVIDER_BROKER).catch(() => ({})),
    getDefaultCredentialStatus().catch(() => ({})),
  ]);

  const merged = { ...(legacyCreds || {}) };
  for (const key of DATA_PROVIDER_KEYS) {
    delete merged[key];
  }

  return {
    creds: {
      ...merged,
      ...(dataProviderCreds || {}),
    },
    status: credentialStatusByBroker?.[DATA_PROVIDER_BROKER] || {},
  };
}

export function useResearchApiCreds({ isActive = true } = {}) {
  const [apiCreds, setApiCreds] = useState({});
  const [apiCredStatus, setApiCredStatus] = useState({});
  const [credsLoaded, setCredsLoaded] = useState(false);

  const reloadApiCreds = useCallback(async () => {
    const next = await resolveResearchApiCreds();
    setApiCreds(next.creds || {});
    setApiCredStatus(next.status || {});
    setCredsLoaded(true);
    return next;
  }, []);

  useEffect(() => {
    reloadApiCreds().catch(() => setCredsLoaded(true));
  }, [reloadApiCreds]);

  useEffect(() => {
    if (!isActive) {
      return;
    }
    reloadApiCreds().catch(() => setCredsLoaded(true));
  }, [isActive, reloadApiCreds]);

  return {
    apiCreds,
    apiCredStatus,
    credsLoaded,
    reloadApiCreds,
  };
}
