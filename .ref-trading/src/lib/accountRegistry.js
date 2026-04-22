export const ACCOUNT_REGISTRY_KEY = "broker-accounts-v1";
export const LEGACY_SETTINGS_KEY = "spy-engine-settings";
export const DATA_PROVIDER_BROKER = "data";
export const DATA_PROVIDER_ACCOUNT_ID = "research-data";
const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

export const BROKER_FIELD_CONFIG = {
  etrade: [
    "ETRADE_PROD_KEY",
    "ETRADE_PROD_SECRET",
    "ETRADE_SB_KEY",
    "ETRADE_SB_SECRET",
    "ETRADE_ACCESS_TOKEN",
    "ETRADE_ACCESS_SECRET",
    "ETRADE_VERIFIER",
    "ETRADE_ACCOUNT_ID_KEY",
    "ETRADE_WEB_USERNAME",
    "ETRADE_WEB_PASSWORD",
    "ETRADE_TOTP_SECRET",
    "ETRADE_AUTH_CALLBACK_URL",
  ],
  webull: [
    "WEBULL_CLIENT_ID",
    "WEBULL_CLIENT_SECRET",
    "WEBULL_OAUTH_SCOPE",
    "WEBULL_OAUTH_REDIRECT_URI",
    "WEBULL_APP_KEY",
    "WEBULL_APP_SECRET",
    "WEBULL_TRADE_PIN",
    "WEBULL_EMAIL",
    "WEBULL_PASSWORD",
  ],
  ibkr: [
    "IBKR_BASE_URL",
    "IBKR_ACCOUNT_ID",
    "IBKR_USERNAME",
    "IBKR_PASSWORD",
    "IBKR_ALLOW_INSECURE_TLS",
  ],
  [DATA_PROVIDER_BROKER]: [
    "MASSIVE_API_KEY",
    "POLYGON_API_KEY",
    "UW_API_KEY",
  ],
};

const ACCOUNT_TEMPLATES = [
  {
    accountId: "etrade-main",
    broker: "etrade",
    label: "E*Trade Main",
    mode: "live",
    credentials: {},
  },
  {
    accountId: "webull-main",
    broker: "webull",
    label: "Webull Main",
    mode: "live",
    credentials: {},
  },
  {
    accountId: "ibkr-main",
    broker: "ibkr",
    label: "IBKR Main",
    mode: "live",
    credentials: {
      IBKR_BASE_URL: "http://127.0.0.1:5001",
      IBKR_ACCOUNT_ID: "",
      IBKR_ALLOW_INSECURE_TLS: "",
    },
  },
  {
    accountId: DATA_PROVIDER_ACCOUNT_ID,
    broker: DATA_PROVIDER_BROKER,
    label: "Research Data",
    mode: "live",
    credentials: {},
  },
];

export async function loadOrMigrateBrokerAccounts() {
  const envDefaultsByBroker = await loadCredentialDefaultsFromServer();
  const existing = await getJson(ACCOUNT_REGISTRY_KEY);
  if (Array.isArray(existing) && existing.length > 0) {
    const legacy = (await getJson(LEGACY_SETTINGS_KEY)) || {};
    const normalized = ensureTemplateAccounts(existing.map(normalizeAccount));
    const mergedWithLegacy = normalized.map((account) =>
      normalizeAccount({
        ...account,
        credentials: extractBrokerCredentials(
          account.broker,
          legacy,
          account.credentials || {},
        ),
      }),
    );
    const merged = applyCredentialDefaults(mergedWithLegacy, envDefaultsByBroker);
    if (didAccountsChange(normalized, merged)) {
      await saveBrokerAccounts(merged);
    }
    return merged;
  }

  const legacy = (await getJson(LEGACY_SETTINGS_KEY)) || {};
  const migrated = ACCOUNT_TEMPLATES.map((template) => ({
    ...template,
    credentials: extractBrokerCredentials(template.broker, legacy, template.credentials),
  }));
  const merged = applyCredentialDefaults(migrated, envDefaultsByBroker);

  await saveBrokerAccounts(merged);
  return merged;
}

export async function saveBrokerAccounts(accounts) {
  const normalized = accounts.map(normalizeAccount);
  await setJson(ACCOUNT_REGISTRY_KEY, normalized);
  await syncLegacySettings(normalized);
  return normalized;
}

export async function loadCredentialsForBroker(broker) {
  const normalizedBroker = canonicalBrokerId(broker);
  const keys = BROKER_FIELD_CONFIG[normalizedBroker] || [];
  if (!keys.length) {
    return {};
  }

  const accounts = await loadOrMigrateBrokerAccounts();
  const merged = {};
  for (const account of accounts) {
    if (canonicalBrokerId(account?.broker) !== normalizedBroker) {
      continue;
    }
    for (const key of keys) {
      const value = account?.credentials?.[key];
      if (hasStoredCredentialValue(value)) {
        merged[key] = String(value);
      }
    }
  }
  return merged;
}

export function isCredentialOnlyBroker(value) {
  return canonicalBrokerId(value) === DATA_PROVIDER_BROKER;
}

export function upsertAccountInList(accounts, nextAccount) {
  const index = accounts.findIndex(
    (account) => account.accountId === nextAccount.accountId,
  );
  const normalized = normalizeAccount(nextAccount);
  if (index === -1) {
    return [...accounts, normalized];
  }

  const copy = [...accounts];
  copy[index] = {
    ...copy[index],
    ...normalized,
    credentials: {
      ...(copy[index].credentials || {}),
      ...(normalized.credentials || {}),
    },
  };
  return copy;
}

function normalizeAccount(account) {
  return {
    accountId: String(account.accountId || "").trim(),
    broker: canonicalBrokerId(account.broker),
    label: String(account.label || account.accountId || "").trim(),
    mode: "live",
    credentials: { ...(account.credentials || {}) },
  };
}

function extractBrokerCredentials(broker, legacySettings, defaults = {}) {
  const keys = BROKER_FIELD_CONFIG[canonicalBrokerId(broker)] || [];
  const credentials = { ...defaults };
  for (const key of keys) {
    if (hasStoredCredentialValue(legacySettings[key])) {
      credentials[key] = String(legacySettings[key]);
    }
  }
  return credentials;
}

function applyCredentialDefaults(accounts, defaultsByBroker) {
  if (!defaultsByBroker || typeof defaultsByBroker !== "object") {
    return accounts.map(normalizeAccount);
  }

  return accounts.map((account) => {
    const defaults = defaultsByBroker[canonicalBrokerId(account.broker)];
    if (!defaults || typeof defaults !== "object") {
      return normalizeAccount(account);
    }

    return normalizeAccount({
      ...account,
      credentials: {
        ...(account.credentials || {}),
        ...filterPersistableCredentialMap(defaults),
      },
    });
  });
}

async function loadCredentialDefaultsFromServer() {
  if (typeof fetch !== "function") {
    return {};
  }

  try {
    const response = await fetch(`${API_BASE}/api/accounts/default-credentials`, {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      return {};
    }
    const payload = await response.json();
    const byBroker = payload?.credentialsByBroker;
    return byBroker && typeof byBroker === "object" ? byBroker : {};
  } catch {
    return {};
  }
}

function didAccountsChange(before, after) {
  try {
    return JSON.stringify(before) !== JSON.stringify(after);
  } catch {
    return true;
  }
}

async function syncLegacySettings(accounts) {
  const legacy = (await getJson(LEGACY_SETTINGS_KEY)) || {};
  const managedKeys = new Set(Object.values(BROKER_FIELD_CONFIG).flat());
  for (const key of managedKeys) {
    delete legacy[key];
  }
  for (const account of accounts) {
    const keys = BROKER_FIELD_CONFIG[canonicalBrokerId(account.broker)] || [];
    for (const key of keys) {
      const value = account.credentials?.[key];
      if (hasStoredCredentialValue(value)) {
        legacy[key] = String(value);
      }
    }
  }
  await setJson(LEGACY_SETTINGS_KEY, legacy);
}

async function getJson(key) {
  const raw = await getStorageValue(key);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function setJson(key, value) {
  await setStorageValue(key, JSON.stringify(value));
}

async function getStorageValue(key) {
  if (typeof window !== "undefined" && window.storage?.get) {
    const record = await window.storage.get(key);
    return record?.value || null;
  }

  if (typeof localStorage !== "undefined") {
    return localStorage.getItem(key);
  }

  return null;
}

async function setStorageValue(key, value) {
  if (typeof window !== "undefined" && window.storage?.set) {
    await window.storage.set(key, value);
    return;
  }

  if (typeof localStorage !== "undefined") {
    localStorage.setItem(key, value);
  }
}

function ensureTemplateAccounts(accounts) {
  const existingIds = new Set((accounts || []).map((account) => account.accountId));
  const next = [...(accounts || [])];
  for (const template of ACCOUNT_TEMPLATES) {
    if (existingIds.has(template.accountId)) {
      continue;
    }
    next.push(normalizeAccount(template));
  }
  return next;
}

export function canonicalBrokerId(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) {
    return "";
  }
  const normalized = raw.replace(/[^a-z0-9]+/g, "");
  if (normalized.includes("etrade")) {
    return "etrade";
  }
  if (normalized.includes("webull")) {
    return "webull";
  }
  if (normalized.includes("ibkr") || normalized.includes("interactivebrokers")) {
    return "ibkr";
  }
  if (
    normalized === "data"
    || normalized.includes("marketdata")
    || normalized.includes("researchdata")
  ) {
    return DATA_PROVIDER_BROKER;
  }
  return raw;
}

function filterPersistableCredentialMap(credentials = {}) {
  if (!credentials || typeof credentials !== "object") {
    return {};
  }
  return Object.fromEntries(
    Object.entries(credentials).filter(([, value]) => hasStoredCredentialValue(value)),
  );
}

function hasStoredCredentialValue(value) {
  if (value == null) {
    return false;
  }
  const text = String(value).trim();
  if (!text) {
    return false;
  }
  if (isMaskedCredentialPlaceholder(text)) {
    return false;
  }
  return true;
}

function isMaskedCredentialPlaceholder(value) {
  const text = String(value || "").trim();
  if (!text) {
    return false;
  }
  if (/^(masked|redacted|hidden)$/i.test(text)) {
    return true;
  }
  return /^[*•xX#\-_.]{4,}$/.test(text);
}
