import fs from "node:fs/promises";
import path from "node:path";
import { normalizeOptionContractPayload } from "../services/optionContracts.js";
import { APP_DATA_ROOT, RUNTIME_STATE_PATH } from "../services/runtimePaths.js";
import { normalizeResearchHistoryStore } from "../../src/research/history/researchHistory.js";

const DATA_DIR = APP_DATA_ROOT;
const DATA_FILE = RUNTIME_STATE_PATH;

const DEFAULT_STATE = {
  dashboardLayouts: {},
  researchHistory: {
    runHistory: [],
    optimizerHistory: [],
    updatedAt: null,
  },
  researchBacktests: {
    jobs: [],
    results: [],
    updatedAt: null,
  },
  accounts: {},
  positionsByAccount: {},
  accountEquityHistoryByAccount: {},
  ordersById: {},
  optionContractsById: {},
  tradingViewAlerts: [],
  rayAlgoSignals: [],
  rayAlgoManualApprovals: [],
  rayAlgoExecutionPolicy: {
    enabled: true,
    liveAuto: false,
    liveManual: true,
    quantity: 1,
    autoAccountId: null,
    liveAccountId: null,
    maxSignalsPerSymbolPerDay: 3,
    cooldownBars: 1,
    tradingStart: "09:30",
    tradingEnd: "16:00",
    timezone: "America/New_York",
  },
  aiFusion: {
    config: {
      enabled: false,
      dryRun: false,
      provider: "openai",
      model: "gpt-5-mini",
      intervalSec: 60,
      timeoutMs: 4500,
      ttlSec: 180,
      maxHistory: 500,
      failureThreshold: 3,
      circuitOpenSec: 120,
      openaiFallbackToDryRun: false,
      runOnStart: false,
      lookbackMinutes: 240,
    },
    runtime: {
      status: "idle",
      inFlight: false,
      lastRunAt: null,
      lastSuccessAt: null,
      lastError: null,
      consecutiveFailures: 0,
      circuitOpenUntil: null,
      updatedAt: null,
    },
    context: null,
    history: [],
  },
  version: 5,
};

export class RuntimeStore {
  constructor() {
    this.state = structuredClone(DEFAULT_STATE);
    this.persistQueue = Promise.resolve();
  }

  async init() {
    await fs.mkdir(DATA_DIR, { recursive: true });
    try {
      const raw = await fs.readFile(DATA_FILE, "utf8");
      const parsed = JSON.parse(raw);
      this.state = {
        ...structuredClone(DEFAULT_STATE),
        ...parsed,
        dashboardLayouts:
          parsed.dashboardLayouts && typeof parsed.dashboardLayouts === "object"
            ? parsed.dashboardLayouts
            : {},
        researchHistory: normalizeResearchHistoryRecord(parsed.researchHistory),
        researchBacktests: normalizeResearchBacktestState(parsed.researchBacktests),
        accounts: parsed.accounts || {},
        positionsByAccount: parsed.positionsByAccount || {},
        accountEquityHistoryByAccount: parsed.accountEquityHistoryByAccount || {},
        ordersById: parsed.ordersById || {},
        optionContractsById: parsed.optionContractsById || {},
        tradingViewAlerts: Array.isArray(parsed.tradingViewAlerts)
          ? parsed.tradingViewAlerts
          : [],
        rayAlgoSignals: Array.isArray(parsed.rayAlgoSignals)
          ? parsed.rayAlgoSignals
          : [],
        rayAlgoManualApprovals: Array.isArray(parsed.rayAlgoManualApprovals)
          ? parsed.rayAlgoManualApprovals
          : [],
        rayAlgoExecutionPolicy: {
          ...structuredClone(DEFAULT_STATE).rayAlgoExecutionPolicy,
          ...(parsed.rayAlgoExecutionPolicy || {}),
        },
        aiFusion: {
          ...structuredClone(DEFAULT_STATE).aiFusion,
          ...(parsed.aiFusion || {}),
          config: {
            ...structuredClone(DEFAULT_STATE).aiFusion.config,
            ...(parsed.aiFusion?.config || {}),
          },
          runtime: {
            ...structuredClone(DEFAULT_STATE).aiFusion.runtime,
            ...(parsed.aiFusion?.runtime || {}),
          },
          context:
            parsed.aiFusion?.context
            && typeof parsed.aiFusion.context === "object"
            && !Array.isArray(parsed.aiFusion.context)
              ? parsed.aiFusion.context
              : null,
          history: Array.isArray(parsed.aiFusion?.history)
            ? parsed.aiFusion.history
            : [],
        },
      };
      const removedSeedRows = this.#removeSeedPositions();
      const normalizedModes = this.#normalizeAccountsToLiveMode();
      const normalizedHistoryRows = this.#normalizeAccountEquityHistoryState();
      if (removedSeedRows > 0 || normalizedModes > 0 || normalizedHistoryRows > 0) {
        await this.persist();
      }
    } catch (error) {
      if (error?.code === "ENOENT") {
        await this.persist();
        return;
      }
      if (error?.name === "SyntaxError") {
        await backupCorruptRuntimeState(error);
        this.state = structuredClone(DEFAULT_STATE);
        await this.persist();
        return;
      }
      throw error;
    }
  }

  async persist() {
    const writeOperation = async () => {
      const payload = JSON.stringify(this.state, null, 2);
      await fs.writeFile(DATA_FILE, payload, "utf8");
    };

    const nextWrite = this.persistQueue.then(writeOperation, writeOperation);
    this.persistQueue = nextWrite.catch(() => {});
    await nextWrite;
  }

  getDashboardLayout(dashboardId = "market-dashboard") {
    const normalizedId = normalizeDashboardId(dashboardId);
    const row = this.state.dashboardLayouts?.[normalizedId];
    if (!row || typeof row !== "object") {
      return null;
    }
    return normalizeDashboardLayoutRecord(row, {
      fallbackDashboardId: normalizedId,
    });
  }

  async upsertDashboardLayout(dashboardId = "market-dashboard", input = {}) {
    const normalizedId = normalizeDashboardId(dashboardId);
    const existing = this.getDashboardLayout(normalizedId);
    const next = normalizeDashboardLayoutRecord(
      {
        ...(existing || {}),
        ...(input && typeof input === "object" ? input : {}),
      },
      {
        fallbackDashboardId: normalizedId,
      },
    );
    this.state.dashboardLayouts = {
      ...(this.state.dashboardLayouts || {}),
      [normalizedId]: next,
    };
    await this.persist();
    return next;
  }

  getResearchHistory() {
    return normalizeResearchHistoryRecord(this.state.researchHistory);
  }

  async upsertResearchHistory(input = {}) {
    const next = normalizeResearchHistoryRecord({
      ...(this.state.researchHistory || {}),
      ...(input && typeof input === "object" ? input : {}),
      updatedAt: new Date().toISOString(),
    });
    this.state.researchHistory = next;
    await this.persist();
    return next;
  }

  getResearchBacktests() {
    return normalizeResearchBacktestState(this.state.researchBacktests);
  }

  async upsertResearchBacktests(input = {}) {
    const next = normalizeResearchBacktestState({
      ...(this.state.researchBacktests || {}),
      ...(input && typeof input === "object" ? input : {}),
      updatedAt: new Date().toISOString(),
    });
    this.state.researchBacktests = next;
    await this.persist();
    return next;
  }

  listAccounts() {
    return Object.values(this.state.accounts).sort((a, b) =>
      a.accountId.localeCompare(b.accountId),
    );
  }

  getAccount(accountId) {
    return this.state.accounts[accountId] || null;
  }

  async upsertAccount(accountPatch) {
    const existing = this.state.accounts[accountPatch.accountId] || {};
    const merged = {
      accountId: accountPatch.accountId,
      broker: accountPatch.broker || existing.broker,
      label: accountPatch.label || existing.label || accountPatch.accountId,
      mode: "live",
      status: accountPatch.status || existing.status || "disconnected",
      credentials: {
        ...(existing.credentials || {}),
        ...(accountPatch.credentials || {}),
      },
      connectionMessage:
        accountPatch.connectionMessage ?? existing.connectionMessage ?? null,
      authState: accountPatch.authState ?? existing.authState ?? null,
      authMessage: accountPatch.authMessage ?? existing.authMessage ?? null,
      authCheckedAt: accountPatch.authCheckedAt ?? existing.authCheckedAt ?? null,
      buyingPower: Number(
        accountPatch.buyingPower ?? existing.buyingPower ?? 100000,
      ),
      cash: Number(
        accountPatch.cash ?? existing.cash ?? accountPatch.buyingPower ?? existing.buyingPower ?? 0,
      ),
      lastSync: accountPatch.lastSync || existing.lastSync || null,
      positionsSyncState: accountPatch.positionsSyncState ?? existing.positionsSyncState ?? "live",
      positionsSyncReason: accountPatch.positionsSyncReason ?? existing.positionsSyncReason ?? null,
      positionsSyncMessage: accountPatch.positionsSyncMessage ?? existing.positionsSyncMessage ?? null,
      positionsSyncCheckedAt: accountPatch.positionsSyncCheckedAt ?? existing.positionsSyncCheckedAt ?? null,
      positionsSyncFailureCount: Number(
        accountPatch.positionsSyncFailureCount ?? existing.positionsSyncFailureCount ?? 0,
      ),
      positionsSyncStaleSince: accountPatch.positionsSyncStaleSince ?? existing.positionsSyncStaleSince ?? null,
      positionsSyncLastSuccessAt: accountPatch.positionsSyncLastSuccessAt ?? existing.positionsSyncLastSuccessAt ?? null,
      updatedAt: new Date().toISOString(),
    };

    this.state.accounts[accountPatch.accountId] = merged;
    this.ensureAccountPositions(accountPatch.accountId, merged.broker);
    await this.persist();
    return merged;
  }

  async setAccountMode(accountId, mode) {
    const account = this.getAccount(accountId);
    if (!account) {
      return null;
    }
    account.mode = "live";
    account.updatedAt = new Date().toISOString();
    this.state.accounts[accountId] = account;
    await this.persist();
    return account;
  }

  ensureAccountPositions(accountId, broker) {
    if (this.state.positionsByAccount[accountId]) {
      return;
    }
    this.state.positionsByAccount[accountId] = [];
  }

  listPositions(accountId = "all") {
    if (accountId === "all") {
      return Object.values(this.state.positionsByAccount)
        .flat()
        .sort((a, b) => `${a.accountId}:${a.symbol}`.localeCompare(`${b.accountId}:${b.symbol}`));
    }

    return [...(this.state.positionsByAccount[accountId] || [])];
  }

  getPosition(accountId, positionId) {
    const rows = this.state.positionsByAccount[accountId] || [];
    return rows.find((position) => position.positionId === positionId) || null;
  }

  async setPositions(accountId, positions) {
    this.state.positionsByAccount[accountId] = positions.map((position) => ({
      ...position,
      accountId,
      updatedAt: new Date().toISOString(),
    }));
    await this.persist();
  }

  async upsertPosition(accountId, positionPatch) {
    const rows = this.state.positionsByAccount[accountId] || [];
    const index = rows.findIndex(
      (row) => row.positionId === positionPatch.positionId,
    );
    if (index === -1) {
      rows.push({ ...positionPatch, accountId, updatedAt: new Date().toISOString() });
    } else {
      rows[index] = {
        ...rows[index],
        ...positionPatch,
        accountId,
        updatedAt: new Date().toISOString(),
      };
    }
    this.state.positionsByAccount[accountId] = rows;
    await this.persist();
  }

  async removePosition(accountId, positionId) {
    const rows = this.state.positionsByAccount[accountId] || [];
    this.state.positionsByAccount[accountId] = rows.filter(
      (row) => row.positionId !== positionId,
    );
    await this.persist();
  }

  async recordOrder(order) {
    const now = new Date().toISOString();
    const providedOrderId = toNonEmptyString(order?.orderId);
    const orderId = providedOrderId || `order-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const existing = this.state.ordersById[orderId] || null;
    const status = normalizeOrderStatus(order?.status || existing?.status || "submitted");
    const lifecycleState = deriveOrderLifecycleState(status);
    const previousEvents = Array.isArray(existing?.events) ? existing.events : [];
    const latestEvent = previousEvents[0] || null;
    const nextEvent = {
      at: now,
      status,
      message: toNonEmptyString(order?.statusMessage || order?.message),
      filledAt: toNonEmptyString(order?.filledAt),
    };
    const events = (
      !latestEvent
      || latestEvent.status !== nextEvent.status
      || latestEvent.filledAt !== nextEvent.filledAt
    )
      ? [nextEvent, ...previousEvents].slice(0, 100)
      : previousEvents;

    this.state.ordersById[orderId] = {
      ...(existing || {}),
      ...(order || {}),
      orderId,
      status,
      lifecycleState,
      createdAt: toNonEmptyString(existing?.createdAt || order?.createdAt) || now,
      updatedAt: now,
      events,
    };
    await this.persist();
    return this.state.ordersById[orderId];
  }

  getOrder(orderId) {
    return this.state.ordersById[orderId] || null;
  }

  listOrders(options = {}) {
    const rows = Object.values(this.state.ordersById || {});
    if (!rows.length) {
      return [];
    }

    const accountId = toNonEmptyString(options.accountId);
    const status = toNonEmptyString(options.status)?.toLowerCase() || null;
    const lifecycleState = toNonEmptyString(options.lifecycleState)?.toLowerCase() || null;
    const openOnly = parseBooleanLike(options.openOnly);
    const fromMs = parseMaybeDate(options.from);
    const toMs = parseMaybeDate(options.to);
    const limit = clampNumber(options.limit, 1, 2000, 250);

    return rows
      .filter((row) => {
        if (!row || typeof row !== "object") {
          return false;
        }
        if (accountId && String(row.accountId || "") !== accountId) {
          return false;
        }
        const rowStatus = normalizeOrderStatus(row.status);
        const rowLifecycle = String(
          row.lifecycleState || deriveOrderLifecycleState(rowStatus),
        ).toLowerCase();
        if (status && rowStatus !== status) {
          return false;
        }
        if (lifecycleState && rowLifecycle !== lifecycleState) {
          return false;
        }
        if (openOnly && rowLifecycle !== "open") {
          return false;
        }
        const ts = parseMaybeDate(row.updatedAt || row.createdAt || row.filledAt);
        if (Number.isFinite(fromMs) && (!Number.isFinite(ts) || ts < fromMs)) {
          return false;
        }
        if (Number.isFinite(toMs) && (!Number.isFinite(ts) || ts > toMs)) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        const aTs = parseMaybeDate(a.updatedAt || a.createdAt || a.filledAt);
        const bTs = parseMaybeDate(b.updatedAt || b.createdAt || b.filledAt);
        if (Number.isFinite(aTs) && Number.isFinite(bTs) && aTs !== bTs) {
          return bTs - aTs;
        }
        return String(b.orderId || "").localeCompare(String(a.orderId || ""));
      })
      .slice(0, limit);
  }

  getOptionContract(contractId) {
    const key = toNonEmptyString(contractId);
    if (!key) {
      return null;
    }
    return this.state.optionContractsById[key] || null;
  }

  listOptionContracts(options = {}) {
    const rows = Object.values(this.state.optionContractsById || {});
    if (!rows.length) {
      return [];
    }

    const symbol = toNonEmptyString(options.symbol)?.toUpperCase() || null;
    const expiry = toNonEmptyString(options.expiry) || null;
    const right = normalizeOptionRight(options.right);
    const broker = toNonEmptyString(options.broker)?.toLowerCase() || null;
    const accountId = toNonEmptyString(options.accountId) || null;
    const query = toNonEmptyString(options.query)?.toUpperCase() || null;
    const limit = clampNumber(options.limit, 1, 10000, 1000);

    return rows
      .filter((row) => {
        if (!row || typeof row !== "object") {
          return false;
        }
        if (symbol && String(row.symbol || "").toUpperCase() !== symbol) {
          return false;
        }
        if (expiry && String(row.expiry || "") !== expiry) {
          return false;
        }
        if (right && String(row.right || "").toLowerCase() !== right) {
          return false;
        }
        if (broker) {
          const brokerRow = row.brokers && typeof row.brokers === "object"
            ? row.brokers[broker]
            : null;
          if (!brokerRow) {
            return false;
          }
          if (accountId) {
            const ids = Array.isArray(brokerRow.accountIds)
              ? brokerRow.accountIds
              : [];
            if (!ids.includes(accountId)) {
              return false;
            }
          }
        }
        if (query) {
          const haystack = `${row.contractId || ""} ${row.symbol || ""} ${row.expiry || ""}`.toUpperCase();
          if (!haystack.includes(query)) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => {
        const expA = String(a.expiry || "");
        const expB = String(b.expiry || "");
        if (expA !== expB) {
          return expA.localeCompare(expB);
        }
        const strikeA = Number(a.strike);
        const strikeB = Number(b.strike);
        if (Number.isFinite(strikeA) && Number.isFinite(strikeB) && strikeA !== strikeB) {
          return strikeA - strikeB;
        }
        const rightA = String(a.right || "");
        const rightB = String(b.right || "");
        if (rightA !== rightB) {
          return rightA.localeCompare(rightB);
        }
        return String(a.contractId || "").localeCompare(String(b.contractId || ""));
      })
      .slice(0, limit);
  }

  async upsertOptionContract(contract, options = {}) {
    const rows = await this.upsertOptionContracts([contract], options);
    return rows[0] || null;
  }

  async upsertOptionContracts(contracts, options = {}) {
    const broker = toNonEmptyString(options.broker)?.toLowerCase() || null;
    const accountId = toNonEmptyString(options.accountId) || null;
    const source = toNonEmptyString(options.source) || null;
    const stale = options.stale == null ? null : Boolean(options.stale);
    const persist = options.persist !== false;
    const now = new Date().toISOString();
    const changedIds = new Set();
    const out = [];

    for (const input of Array.isArray(contracts) ? contracts : []) {
      const normalized = normalizeContractCatalogInput(input);
      if (!normalized) {
        continue;
      }
      const existing = this.state.optionContractsById[normalized.contractId] || null;
      const { row, changed } = mergeContractCatalogRow(existing, normalized, {
        broker,
        accountId,
        source,
        stale,
        now,
      });
      if (changed) {
        this.state.optionContractsById[normalized.contractId] = row;
        changedIds.add(normalized.contractId);
      }
      out.push(this.state.optionContractsById[normalized.contractId] || row);
    }

    if (changedIds.size > 0 && persist) {
      await this.persist();
    }
    return out;
  }

  listTradingViewAlerts(options = {}) {
    const limit = clampNumber(options.limit, 1, 500, 100);
    const since = options.since ? Date.parse(options.since) : null;
    const rows = Array.isArray(this.state.tradingViewAlerts)
      ? this.state.tradingViewAlerts
      : [];

    if (Number.isFinite(since)) {
      return rows
        .filter((row) => Date.parse(row.receivedAt || row.createdAt || "") > since)
        .slice(0, limit);
    }

    return rows.slice(0, limit);
  }

  async appendTradingViewAlert(alertPayload) {
    const now = new Date().toISOString();
    const row = {
      alertId:
        toNonEmptyString(alertPayload.alertId) ||
        `tv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      scriptName: toNonEmptyString(alertPayload.scriptName),
      strategy: toNonEmptyString(alertPayload.strategy),
      symbol: toNonEmptyString(alertPayload.symbol),
      timeframe: toNonEmptyString(alertPayload.timeframe),
      eventType: toNonEmptyString(alertPayload.eventType),
      signalClass: toNonEmptyString(alertPayload.signalClass),
      signalTs: toNonEmptyString(alertPayload.signalTs || alertPayload.ts),
      action: toNonEmptyString(alertPayload.action),
      direction: toNonEmptyString(alertPayload.direction || alertPayload.action),
      price: toNumberOrNull(alertPayload.price),
      conviction: toNumberOrNull(alertPayload.conviction),
      regime: toNonEmptyString(alertPayload.regime),
      components:
        alertPayload.components && typeof alertPayload.components === "object"
          ? alertPayload.components
          : {},
      meta:
        alertPayload.meta && typeof alertPayload.meta === "object"
          ? alertPayload.meta
          : {},
      message: toNonEmptyString(alertPayload.message),
      source: toNonEmptyString(alertPayload.source) || "tradingview-webhook",
      raw: alertPayload.raw ?? null,
      receivedAt: toNonEmptyString(alertPayload.receivedAt) || now,
      createdAt: now,
    };

    const existing = Array.isArray(this.state.tradingViewAlerts)
      ? this.state.tradingViewAlerts
      : [];
    this.state.tradingViewAlerts = [row, ...existing].slice(0, 500);
    await this.persist();
    return row;
  }

  listRayAlgoSignals(options = {}) {
    const limit = clampNumber(options.limit, 1, 5000, 500);
    const source = toNonEmptyString(options.source)?.toLowerCase() || "all";
    const symbol = toNonEmptyString(options.symbol)?.toUpperCase() || null;
    const timeframe = toNonEmptyString(options.timeframe) || null;
    const fromMs = parseMaybeDate(options.from);
    const toMs = parseMaybeDate(options.to);
    const rows = Array.isArray(this.state.rayAlgoSignals)
      ? this.state.rayAlgoSignals
      : [];

    return rows
      .filter((row) => {
        if (source !== "all" && String(row.source || "").toLowerCase() !== source) {
          return false;
        }
        if (symbol && String(row.symbol || "").toUpperCase() !== symbol) {
          return false;
        }
        if (timeframe && String(row.timeframe || "") !== timeframe) {
          return false;
        }
        const ts = parseMaybeDate(row.ts || row.barTime || row.receivedAt || row.createdAt);
        if (Number.isFinite(fromMs) && (!Number.isFinite(ts) || ts < fromMs)) {
          return false;
        }
        if (Number.isFinite(toMs) && (!Number.isFinite(ts) || ts > toMs)) {
          return false;
        }
        return true;
      })
      .slice(0, limit);
  }

  async appendRayAlgoSignal(signalPayload) {
    const now = new Date().toISOString();
    const row = {
      signalId:
        toNonEmptyString(signalPayload.signalId) ||
        `ray-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      source: toNonEmptyString(signalPayload.source) || "local",
      strategy: toNonEmptyString(signalPayload.strategy) || "rayalgo",
      symbol: toNonEmptyString(signalPayload.symbol)?.toUpperCase() || "AMEX:SPY",
      timeframe: toNonEmptyString(signalPayload.timeframe) || "5",
      eventType: toNonEmptyString(signalPayload.eventType) || "signal",
      signalClass: toNonEmptyString(signalPayload.signalClass),
      ts: toNonEmptyString(signalPayload.ts) || now,
      barTime: toNonEmptyString(signalPayload.barTime) || toNonEmptyString(signalPayload.ts) || now,
      direction: toNonEmptyString(signalPayload.direction) || null,
      price: toNumberOrNull(signalPayload.price),
      conviction: toNumberOrNull(signalPayload.conviction),
      regime: toNonEmptyString(signalPayload.regime) || "unknown",
      components:
        signalPayload.components && typeof signalPayload.components === "object"
          ? signalPayload.components
          : {},
      meta:
        signalPayload.meta && typeof signalPayload.meta === "object"
          ? signalPayload.meta
          : {},
      createdAt: now,
    };

    const existing = Array.isArray(this.state.rayAlgoSignals)
      ? this.state.rayAlgoSignals
      : [];
    const duplicate = existing.find((item) => item.signalId === row.signalId);
    if (duplicate) {
      return { signal: duplicate, inserted: false };
    }

    this.state.rayAlgoSignals = [row, ...existing].slice(0, 5000);
    await this.persist();
    return { signal: row, inserted: true };
  }

  getRayAlgoExecutionPolicy() {
    const merged = {
      ...structuredClone(DEFAULT_STATE).rayAlgoExecutionPolicy,
      ...(this.state.rayAlgoExecutionPolicy || {}),
    };
    return {
      ...merged,
      liveAuto: normalizeBoolean(
        Object.prototype.hasOwnProperty.call(merged, "liveAuto")
          ? merged.liveAuto
          : merged.paperAuto,
      ),
      liveManual: normalizeBoolean(merged.liveManual),
      quantity: Math.max(1, Math.round(Number(merged.quantity ?? merged.paperQuantity) || 1)),
      autoAccountId: normalizeNullableId(
        Object.prototype.hasOwnProperty.call(merged, "autoAccountId")
          ? merged.autoAccountId
          : merged.paperAccountId,
      ),
      liveAccountId: normalizeNullableId(merged.liveAccountId),
      maxSignalsPerSymbolPerDay: Math.max(
        1,
        Math.round(Number(merged.maxSignalsPerSymbolPerDay || 1)),
      ),
      cooldownBars: Math.max(0, Math.round(Number(merged.cooldownBars || 0))),
      tradingStart: String(merged.tradingStart || "09:30"),
      tradingEnd: String(merged.tradingEnd || "16:00"),
      timezone: String(merged.timezone || "America/New_York"),
    };
  }

  async upsertRayAlgoExecutionPolicy(policyPatch) {
    const merged = {
      ...this.getRayAlgoExecutionPolicy(),
      ...(policyPatch && typeof policyPatch === "object" ? policyPatch : {}),
    };
    this.state.rayAlgoExecutionPolicy = {
      enabled: normalizeBoolean(merged.enabled),
      liveAuto: normalizeBoolean(merged.liveAuto),
      liveManual: normalizeBoolean(merged.liveManual),
      quantity: Math.max(1, Math.round(Number(merged.quantity || 1))),
      autoAccountId: normalizeNullableId(merged.autoAccountId),
      liveAccountId: normalizeNullableId(merged.liveAccountId),
      maxSignalsPerSymbolPerDay: Math.max(
        1,
        Math.round(Number(merged.maxSignalsPerSymbolPerDay || 1)),
      ),
      cooldownBars: Math.max(0, Math.round(Number(merged.cooldownBars || 0))),
      tradingStart: String(merged.tradingStart || "09:30"),
      tradingEnd: String(merged.tradingEnd || "16:00"),
      timezone: String(merged.timezone || "America/New_York"),
      updatedAt: new Date().toISOString(),
    };
    await this.persist();
    return this.state.rayAlgoExecutionPolicy;
  }

  getAiFusionConfig() {
    return {
      ...structuredClone(DEFAULT_STATE).aiFusion.config,
      ...(this.state.aiFusion?.config || {}),
    };
  }

  getAiFusionRuntime() {
    return {
      ...structuredClone(DEFAULT_STATE).aiFusion.runtime,
      ...(this.state.aiFusion?.runtime || {}),
    };
  }

  getAiFusionContext() {
    const row = this.state.aiFusion?.context;
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      return null;
    }
    return { ...row };
  }

  listAiFusionHistory(options = {}) {
    const limit = clampNumber(options.limit, 1, 5000, 200);
    const rows = Array.isArray(this.state.aiFusion?.history)
      ? this.state.aiFusion.history
      : [];
    return rows.slice(0, limit);
  }

  async upsertAiFusionConfig(configPatch) {
    const nextConfig = {
      ...this.getAiFusionConfig(),
      ...(configPatch && typeof configPatch === "object" ? configPatch : {}),
      updatedAt: new Date().toISOString(),
    };
    this.state.aiFusion = {
      ...structuredClone(DEFAULT_STATE).aiFusion,
      ...(this.state.aiFusion || {}),
      config: nextConfig,
      runtime: this.getAiFusionRuntime(),
      context: this.getAiFusionContext(),
      history: Array.isArray(this.state.aiFusion?.history)
        ? this.state.aiFusion.history
        : [],
    };
    await this.persist();
    return nextConfig;
  }

  async patchAiFusionRuntime(runtimePatch) {
    const nextRuntime = {
      ...this.getAiFusionRuntime(),
      ...(runtimePatch && typeof runtimePatch === "object" ? runtimePatch : {}),
      updatedAt: new Date().toISOString(),
    };
    this.state.aiFusion = {
      ...structuredClone(DEFAULT_STATE).aiFusion,
      ...(this.state.aiFusion || {}),
      config: this.getAiFusionConfig(),
      runtime: nextRuntime,
      context: this.getAiFusionContext(),
      history: Array.isArray(this.state.aiFusion?.history)
        ? this.state.aiFusion.history
        : [],
    };
    await this.persist();
    return nextRuntime;
  }

  async setAiFusionContext(contextPatch) {
    const nextContext =
      contextPatch
      && typeof contextPatch === "object"
      && !Array.isArray(contextPatch)
        ? {
            ...contextPatch,
            updatedAt: new Date().toISOString(),
          }
        : null;
    this.state.aiFusion = {
      ...structuredClone(DEFAULT_STATE).aiFusion,
      ...(this.state.aiFusion || {}),
      config: this.getAiFusionConfig(),
      runtime: this.getAiFusionRuntime(),
      context: nextContext,
      history: Array.isArray(this.state.aiFusion?.history)
        ? this.state.aiFusion.history
        : [],
    };
    await this.persist();
    return nextContext;
  }

  async appendAiFusionHistory(historyPatch) {
    const maxHistory = clampNumber(this.getAiFusionConfig().maxHistory, 10, 5000, 500);
    const row = {
      runId:
        toNonEmptyString(historyPatch?.runId)
        || `aif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      status: toNonEmptyString(historyPatch?.status) || "unknown",
      source: toNonEmptyString(historyPatch?.source) || "unknown",
      reason: toNonEmptyString(historyPatch?.reason) || null,
      model: toNonEmptyString(historyPatch?.model) || null,
      confidence: toNumberOrNull(historyPatch?.confidence),
      regime: toNonEmptyString(historyPatch?.regime) || null,
      bias: toNonEmptyString(historyPatch?.bias) || null,
      riskMultiplier: toNumberOrNull(historyPatch?.riskMultiplier),
      error: toNonEmptyString(historyPatch?.error),
      latencyMs: toNumberOrNull(historyPatch?.latencyMs),
      createdAt: toNonEmptyString(historyPatch?.createdAt) || new Date().toISOString(),
    };
    const rows = Array.isArray(this.state.aiFusion?.history)
      ? this.state.aiFusion.history
      : [];
    this.state.aiFusion = {
      ...structuredClone(DEFAULT_STATE).aiFusion,
      ...(this.state.aiFusion || {}),
      config: this.getAiFusionConfig(),
      runtime: this.getAiFusionRuntime(),
      context: this.getAiFusionContext(),
      history: [row, ...rows].slice(0, maxHistory),
    };
    await this.persist();
    return row;
  }

  listRayAlgoManualApprovals(options = {}) {
    const limit = clampNumber(options.limit, 1, 1000, 100);
    const status = toNonEmptyString(options.status)?.toLowerCase() || "all";
    const rows = Array.isArray(this.state.rayAlgoManualApprovals)
      ? this.state.rayAlgoManualApprovals
      : [];

    return rows
      .filter((row) => status === "all" || String(row.status || "").toLowerCase() === status)
      .slice(0, limit);
  }

  getRayAlgoManualApproval(approvalId) {
    const rows = Array.isArray(this.state.rayAlgoManualApprovals)
      ? this.state.rayAlgoManualApprovals
      : [];
    return rows.find((row) => row.approvalId === approvalId) || null;
  }

  async appendRayAlgoManualApproval(approvalPayload) {
    const now = new Date().toISOString();
    const row = {
      approvalId:
        toNonEmptyString(approvalPayload.approvalId) ||
        `raya-approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      signalId: toNonEmptyString(approvalPayload.signalId),
      symbol: toNonEmptyString(approvalPayload.symbol)?.toUpperCase() || "AMEX:SPY",
      direction: toNonEmptyString(approvalPayload.direction),
      status: toNonEmptyString(approvalPayload.status) || "pending",
      orderDraft: approvalPayload.orderDraft || null,
      executionResult: approvalPayload.executionResult || null,
      reason: toNonEmptyString(approvalPayload.reason),
      createdAt: now,
      updatedAt: now,
    };

    const rows = Array.isArray(this.state.rayAlgoManualApprovals)
      ? this.state.rayAlgoManualApprovals
      : [];
    this.state.rayAlgoManualApprovals = [row, ...rows].slice(0, 2000);
    await this.persist();
    return row;
  }

  async updateRayAlgoManualApproval(approvalId, patch) {
    const rows = Array.isArray(this.state.rayAlgoManualApprovals)
      ? this.state.rayAlgoManualApprovals
      : [];
    const index = rows.findIndex((row) => row.approvalId === approvalId);
    if (index < 0) {
      return null;
    }
    rows[index] = {
      ...rows[index],
      ...(patch && typeof patch === "object" ? patch : {}),
      updatedAt: new Date().toISOString(),
    };
    this.state.rayAlgoManualApprovals = rows;
    await this.persist();
    return rows[index];
  }

  buildCachedAccountSummary(accountId) {
    const account = this.getAccount(accountId);
    if (!account) {
      return null;
    }
    const latest = this.getLatestAccountEquityPoint(accountId);
    const positions = this.listPositions(accountId);
    const marketValue = positions.reduce(
      (total, row) => total + Number(row.marketValue || 0),
      0,
    );
    const unrealizedPnl = positions.reduce(
      (total, row) => total + Number(row.unrealizedPnl || 0),
      0,
    );
    const latestEquity = toNumberOrNull(latest?.equity);
    const latestBuyingPower = toNumberOrNull(latest?.buyingPower);
    const latestCash = toNumberOrNull(latest?.cash);
    const latestSettledCash = toNumberOrNull(latest?.settledCash);
    const latestUnsettledCash = toNumberOrNull(latest?.unsettledCash);
    const latestCashAvailableToTrade = toNumberOrNull(latest?.cashAvailableToTrade);
    const latestCashAvailableToWithdraw = toNumberOrNull(latest?.cashAvailableToWithdraw);
    const latestMarginAvailable = toNumberOrNull(latest?.marginAvailable);
    const latestMarketValue = toNumberOrNull(latest?.marketValue);
    const latestUnrealizedPnl = toNumberOrNull(latest?.unrealizedPnl);

    const hasLatestSummary = [
      latestEquity,
      latestBuyingPower,
      latestCash,
      latestSettledCash,
      latestUnsettledCash,
      latestCashAvailableToTrade,
      latestCashAvailableToWithdraw,
      latestMarginAvailable,
      latestMarketValue,
      latestUnrealizedPnl,
    ].some(Number.isFinite);
    if (!hasLatestSummary && positions.length === 0) {
      return null;
    }

    return {
      accountId,
      marketValue: Number.isFinite(latestMarketValue)
        ? round2(latestMarketValue)
        : (positions.length > 0 ? round2(marketValue) : null),
      unrealizedPnl: Number.isFinite(latestUnrealizedPnl)
        ? round2(latestUnrealizedPnl)
        : (positions.length > 0 ? round2(unrealizedPnl) : null),
      equity: Number.isFinite(latestEquity) ? round2(latestEquity) : null,
      buyingPower: Number.isFinite(latestBuyingPower) ? round2(latestBuyingPower) : null,
      cash: Number.isFinite(latestCash) ? round2(latestCash) : null,
      settledCash: Number.isFinite(latestSettledCash) ? round2(latestSettledCash) : null,
      unsettledCash: Number.isFinite(latestUnsettledCash) ? round2(latestUnsettledCash) : null,
      cashAvailableToTrade: Number.isFinite(latestCashAvailableToTrade)
        ? round2(latestCashAvailableToTrade)
        : null,
      cashAvailableToWithdraw: Number.isFinite(latestCashAvailableToWithdraw)
        ? round2(latestCashAvailableToWithdraw)
        : null,
      marginAvailable: Number.isFinite(latestMarginAvailable) ? round2(latestMarginAvailable) : null,
      positions: positions.length,
      source: `${account.broker}-cached-summary`,
      stale: true,
      lastSync: latest?.ts || latest?.lastSync || account.lastSync || null,
    };
  }

  listAccountEquityHistory(accountId, options = {}) {
    const rows = Array.isArray(this.state.accountEquityHistoryByAccount?.[accountId])
      ? this.state.accountEquityHistoryByAccount[accountId]
      : [];
    if (!rows.length) {
      return [];
    }

    const fromMs = parseMaybeDate(options.from);
    const toMs = parseMaybeDate(options.to);
    const limit = clampNumber(options.limit, 1, 50000, 5000);

    const filtered = rows.filter((row) => {
      const ts = Number(row.epochMs);
      if (!Number.isFinite(ts)) {
        return false;
      }
      if (Number.isFinite(fromMs) && ts < fromMs) {
        return false;
      }
      if (Number.isFinite(toMs) && ts > toMs) {
        return false;
      }
      return true;
    });
    if (!filtered.length) {
      return [];
    }

    if (filtered.length > limit) {
      return filtered.slice(filtered.length - limit);
    }
    return filtered;
  }

  getLatestAccountEquityPoint(accountId) {
    const rows = Array.isArray(this.state.accountEquityHistoryByAccount?.[accountId])
      ? this.state.accountEquityHistoryByAccount[accountId]
      : [];
    if (!rows.length) {
      return null;
    }
    return rows[rows.length - 1] || null;
  }

  async appendAccountEquitySnapshot(accountId, snapshot, options = {}) {
    if (!accountId || !snapshot || typeof snapshot !== "object") {
      return null;
    }
    const point = this.#normalizeEquityPoint({
      ...snapshot,
      source: options.source || snapshot.source || "unknown-summary",
      stale: options.stale ?? snapshot.stale,
      ts:
        options.ts
        || snapshot.ts
        || snapshot.lastSync
        || snapshot.updatedAt
        || new Date().toISOString(),
    });
    if (!point) {
      return null;
    }

    const rows = Array.isArray(this.state.accountEquityHistoryByAccount?.[accountId])
      ? [...this.state.accountEquityHistoryByAccount[accountId]]
      : [];
    const last = rows[rows.length - 1] || null;
    if (
      last
      && Number(last.epochMs) === Number(point.epochMs)
      && Number(last.equity) === Number(point.equity)
    ) {
      return last;
    }
    rows.push(point);
    rows.sort((a, b) => Number(a.epochMs) - Number(b.epochMs));
    this.state.accountEquityHistoryByAccount[accountId] = rows.slice(-50000);
    await this.persist();
    return point;
  }

  async mergeAccountEquityHistory(accountId, points, options = {}) {
    if (!accountId) {
      return [];
    }
    const incoming = Array.isArray(points) ? points : [];
    if (!incoming.length) {
      return this.listAccountEquityHistory(accountId, {
        from: options.from,
        to: options.to,
        limit: options.limit,
      });
    }

    const existing = Array.isArray(this.state.accountEquityHistoryByAccount?.[accountId])
      ? this.state.accountEquityHistoryByAccount[accountId]
      : [];
    const byTs = new Map();
    for (const row of existing) {
      const normalized = this.#normalizeEquityPoint(row);
      if (!normalized) {
        continue;
      }
      byTs.set(Number(normalized.epochMs), normalized);
    }
    for (const row of incoming) {
      const normalized = this.#normalizeEquityPoint(row);
      if (!normalized) {
        continue;
      }
      byTs.set(Number(normalized.epochMs), normalized);
    }

    const merged = [...byTs.values()]
      .sort((a, b) => Number(a.epochMs) - Number(b.epochMs))
      .slice(-50000);
    this.state.accountEquityHistoryByAccount[accountId] = merged;
    await this.persist();

    return this.listAccountEquityHistory(accountId, {
      from: options.from,
      to: options.to,
      limit: options.limit,
    });
  }

  #normalizeAccountEquityHistoryState() {
    const next = {};
    let changed = 0;

    for (const [accountId, rows] of Object.entries(this.state.accountEquityHistoryByAccount || {})) {
      const byEpochMs = new Map();
      const safeRows = Array.isArray(rows) ? rows : [];
      for (const row of safeRows) {
        const normalized = this.#normalizeEquityPoint(row);
        if (!normalized) {
          changed += 1;
          continue;
        }
        const originalSource = toNonEmptyString(row?.source) || "unknown-history";
        if (
          normalized.source !== originalSource
          || normalized.stale !== Boolean(row?.stale)
          || Number(normalized.epochMs) !== Number(row?.epochMs)
        ) {
          changed += 1;
        }
        byEpochMs.set(Number(normalized.epochMs), normalized);
      }
      next[accountId] = [...byEpochMs.values()].sort((a, b) => Number(a.epochMs) - Number(b.epochMs));
      if (next[accountId].length !== safeRows.length) {
        changed += Math.abs(safeRows.length - next[accountId].length);
      }
    }

    if (changed > 0) {
      this.state.accountEquityHistoryByAccount = next;
    }
    return changed;
  }

  #normalizeEquityPoint(row) {
    if (!row || typeof row !== "object") {
      return null;
    }
    const epochMs = parseMaybeDate(
      row.epochMs
      ?? row.ts
      ?? row.timestamp
      ?? row.time
      ?? row.lastSync
      ?? row.updatedAt,
    );
    const equity = Number(
      row.equity
      ?? row.netLiquidation
      ?? row.net_liquidation
      ?? row.totalAsset
      ?? row.total_assets
      ?? NaN,
    );
    if (!Number.isFinite(epochMs) || !Number.isFinite(equity)) {
      return null;
    }

    const buyingPower = Number(row.buyingPower ?? row.buying_power);
    const cash = Number(row.cash ?? row.cash_balance ?? row.cashBalance);
    const settledCash = Number(row.settledCash ?? row.settled_cash ?? row.settled);
    const unsettledCash = Number(row.unsettledCash ?? row.unsettled_cash ?? row.unsettled);
    const cashAvailableToTrade = Number(
      row.cashAvailableToTrade
      ?? row.cash_available_to_trade
      ?? row.availableToTrade,
    );
    const cashAvailableToWithdraw = Number(
      row.cashAvailableToWithdraw
      ?? row.cash_available_to_withdraw
      ?? row.availableToWithdraw,
    );
    const marginAvailable = Number(
      row.marginAvailable
      ?? row.margin_available,
    );
    const marketValue = Number(row.marketValue ?? row.market_value);
    const unrealizedPnl = Number(
      row.unrealizedPnl
      ?? row.unrealized_pnl
      ?? row.total_unrealized_profit_loss,
    );
    const positions = Number(row.positions);
    const sourceNormalization = normalizeLegacyAccountHistorySource(toNonEmptyString(row.source));

    return {
      ts: new Date(epochMs).toISOString(),
      epochMs: Math.round(epochMs),
      equity: round2(equity),
      buyingPower: Number.isFinite(buyingPower) ? round2(buyingPower) : null,
      cash: Number.isFinite(cash) ? round2(cash) : null,
      settledCash: Number.isFinite(settledCash) ? round2(settledCash) : null,
      unsettledCash: Number.isFinite(unsettledCash) ? round2(unsettledCash) : null,
      cashAvailableToTrade: Number.isFinite(cashAvailableToTrade) ? round2(cashAvailableToTrade) : null,
      cashAvailableToWithdraw: Number.isFinite(cashAvailableToWithdraw) ? round2(cashAvailableToWithdraw) : null,
      marginAvailable: Number.isFinite(marginAvailable) ? round2(marginAvailable) : null,
      marketValue: Number.isFinite(marketValue) ? round2(marketValue) : null,
      unrealizedPnl: Number.isFinite(unrealizedPnl) ? round2(unrealizedPnl) : null,
      positions: Number.isFinite(positions) ? Math.max(0, Math.round(positions)) : null,
      source: sourceNormalization.source,
      stale: sourceNormalization.forceStale ? true : Boolean(row.stale),
    };
  }

  #removeSeedPositions() {
    let removed = 0;
    const next = {};

    for (const [accountId, rows] of Object.entries(this.state.positionsByAccount || {})) {
      const safeRows = Array.isArray(rows) ? rows : [];
      const filtered = safeRows.filter((row) => {
        const positionId = String(row?.positionId || "");
        const isSeed = positionId.includes("-seed-") || positionId.startsWith("seed-");
        if (isSeed) {
          removed += 1;
          return false;
        }
        return true;
      });
      next[accountId] = filtered;
    }

    if (removed > 0) {
      this.state.positionsByAccount = next;
    }
    return removed;
  }

  #normalizeAccountsToLiveMode() {
    let updated = 0;
    const entries = Object.entries(this.state.accounts || {});
    for (const [accountId, account] of entries) {
      if (!account || typeof account !== "object") {
        continue;
      }
      if (String(account.mode || "").toLowerCase() === "live") {
        continue;
      }
      this.state.accounts[accountId] = {
        ...account,
        mode: "live",
        updatedAt: new Date().toISOString(),
      };
      updated += 1;
    }
    return updated;
  }
}

async function backupCorruptRuntimeState(error) {
  const backupPath = path.join(
    DATA_DIR,
    `runtime-state.corrupt-${Date.now()}.json`,
  );
  await fs.rename(DATA_FILE, backupPath);
  console.warn(
    `Recovered corrupt runtime state snapshot. Moved ${DATA_FILE} to ${backupPath}.`,
    error,
  );
}

function normalizeDashboardId(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) {
    return "market-dashboard";
  }
  return text.replace(/[^a-z0-9_-]+/g, "-").slice(0, 80) || "market-dashboard";
}

function normalizeLegacyAccountHistorySource(source) {
  const normalized = String(source || "").trim().toLowerCase();
  if (!normalized) {
    return {
      source: "unknown-history",
      forceStale: true,
    };
  }
  if (normalized === "ibkr-summary") {
    return { source: "ibkr-cached-summary", forceStale: true };
  }
  if (normalized === "etrade-summary") {
    return { source: "etrade-cached-summary", forceStale: true };
  }
  if (normalized === "webull-cached") {
    return { source: "webull-cached-summary", forceStale: true };
  }
  if (normalized === "account-summary" || normalized === "unknown-summary") {
    return { source: "unknown-history", forceStale: true };
  }
  if (normalized.endsWith("-fallback-summary")) {
    const broker = normalized.split("-")[0] || "";
    return {
      source: broker ? `${broker}-cached-summary` : "unknown-history",
      forceStale: true,
    };
  }
  return {
    source: normalized,
    forceStale: false,
  };
}

function normalizeDashboardLayoutRecord(input, options = {}) {
  const fallbackDashboardId = normalizeDashboardId(options.fallbackDashboardId);
  const payload = input && typeof input === "object" ? input : {};
  const dashboardId = normalizeDashboardId(payload.dashboardId || fallbackDashboardId);
  const version = clampNumber(payload.version, 1, 1000, 1);
  const layouts = normalizeDashboardLayoutsPayload(payload.layouts);
  const enabledWidgetIds = normalizeUniqueStringList(payload.enabledWidgetIds);
  const hiddenWidgetIds = normalizeUniqueStringList(payload.hiddenWidgetIds).filter(
    (widgetId) => !enabledWidgetIds.includes(widgetId),
  );
  const updatedAtInput = toNonEmptyString(payload.updatedAt) || toNonEmptyString(payload.savedAt);
  const updatedAtMs = parseMaybeDate(updatedAtInput);
  const updatedAt = Number.isFinite(updatedAtMs)
    ? new Date(updatedAtMs).toISOString()
    : new Date().toISOString();

  return {
    dashboardId,
    version,
    updatedAt,
    layouts,
    enabledWidgetIds,
    hiddenWidgetIds,
  };
}

function normalizeDashboardLayoutsPayload(layouts) {
  if (!layouts || typeof layouts !== "object") {
    return {};
  }
  const out = {};
  for (const [breakpoint, rows] of Object.entries(layouts)) {
    const normalizedRows = normalizeDashboardLayoutRows(rows);
    if (normalizedRows.length) {
      out[String(breakpoint)] = normalizedRows;
    }
  }
  return out;
}

function normalizeDashboardLayoutRows(rows) {
  const out = [];
  const seenIds = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const itemId = toNonEmptyString(row.i);
    if (!itemId || seenIds.has(itemId)) {
      continue;
    }
    seenIds.add(itemId);
    out.push({
      i: itemId,
      x: clampNumber(row.x, 0, 200, 0),
      y: clampNumber(row.y, 0, 10000, 0),
      w: clampNumber(row.w, 1, 24, 1),
      h: clampNumber(row.h, 1, 100, 1),
      minW: clampNumber(row.minW, 1, 24, 1),
      minH: clampNumber(row.minH, 1, 100, 1),
    });
  }
  return out;
}

function normalizeUniqueStringList(value) {
  const out = [];
  const seen = new Set();
  for (const row of Array.isArray(value) ? value : []) {
    const text = toNonEmptyString(row);
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    out.push(text);
  }
  return out;
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function toNonEmptyString(value) {
  if (value == null) {
    return null;
  }
  const text = String(value).trim();
  return text ? text : null;
}

function toNumberOrNull(value) {
  if (value == null || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

function parseMaybeDate(value) {
  if (value == null || value === "") {
    return NaN;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric > 100000000000 ? numeric : numeric * 1000;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function parseBooleanLike(value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value > 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return false;
    }
    if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "y") {
      return true;
    }
    if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "n") {
      return false;
    }
  }
  return false;
}

function normalizeOrderStatus(value) {
  const normalized = String(value || "submitted").trim().toLowerCase();
  if (!normalized) {
    return "submitted";
  }
  if (normalized === "new" || normalized === "working" || normalized === "accepted") {
    return "submitted";
  }
  if (normalized === "partial" || normalized === "partially_filled" || normalized === "partially-filled") {
    return "partial_fill";
  }
  if (normalized === "cancelled" || normalized === "canceled") {
    return "cancelled";
  }
  if (normalized === "filled" || normalized === "rejected" || normalized === "submitted" || normalized === "expired") {
    return normalized;
  }
  return normalized;
}

function deriveOrderLifecycleState(status) {
  const normalized = normalizeOrderStatus(status);
  if (normalized === "submitted" || normalized === "partial_fill") {
    return "open";
  }
  return "closed";
}

function normalizeContractCatalogInput(input) {
  if (!input || typeof input !== "object") {
    return null;
  }
  const option = normalizeOptionContractPayload(input);
  if (!option) {
    return null;
  }
  return {
    contractId: option.contractId,
    symbol: option.symbol,
    expiry: option.expiry,
    strike: round2(option.strike),
    right: option.right,
    nativeContractRefs: collectNativeContractRefs(input, option.contractId),
  };
}

function mergeContractCatalogRow(existing, incoming, context = {}) {
  const now = toNonEmptyString(context.now) || new Date().toISOString();
  const broker = toNonEmptyString(context.broker)?.toLowerCase() || null;
  const accountId = toNonEmptyString(context.accountId) || null;
  const source = toNonEmptyString(context.source);
  const stale = context.stale == null ? null : Boolean(context.stale);
  const current = existing && typeof existing === "object" ? existing : null;
  const next = current
    ? { ...current }
    : {
      contractId: incoming.contractId,
      symbol: incoming.symbol,
      expiry: incoming.expiry,
      strike: incoming.strike,
      right: incoming.right,
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
      brokers: {},
    };

  let changed = false;
  if (next.symbol !== incoming.symbol) {
    next.symbol = incoming.symbol;
    changed = true;
  }
  if (next.expiry !== incoming.expiry) {
    next.expiry = incoming.expiry;
    changed = true;
  }
  if (Number(next.strike) !== Number(incoming.strike)) {
    next.strike = incoming.strike;
    changed = true;
  }
  if (next.right !== incoming.right) {
    next.right = incoming.right;
    changed = true;
  }

  const shouldTouchLastSeen = shouldUpdateLastSeen(next.lastSeenAt, now, 30 * 60 * 1000);
  if (shouldTouchLastSeen) {
    next.lastSeenAt = now;
    changed = true;
  }

  if (broker) {
    const brokers = next.brokers && typeof next.brokers === "object"
      ? { ...next.brokers }
      : {};
    const existingBroker = brokers[broker] && typeof brokers[broker] === "object"
      ? brokers[broker]
      : {};
    const nextBroker = {
      broker,
      source: source || toNonEmptyString(existingBroker.source) || null,
      stale: stale == null ? (existingBroker.stale == null ? null : Boolean(existingBroker.stale)) : stale,
      lastSeenAt: shouldUpdateLastSeen(existingBroker.lastSeenAt, now, 30 * 60 * 1000)
        ? now
        : (toNonEmptyString(existingBroker.lastSeenAt) || now),
      accountIds: dedupeStrings([
        ...(Array.isArray(existingBroker.accountIds) ? existingBroker.accountIds : []),
        accountId,
      ]),
      nativeContractRefs: dedupeStrings([
        ...(Array.isArray(existingBroker.nativeContractRefs) ? existingBroker.nativeContractRefs : []),
        ...(Array.isArray(incoming.nativeContractRefs) ? incoming.nativeContractRefs : []),
      ]),
    };
    if (JSON.stringify(existingBroker) !== JSON.stringify(nextBroker)) {
      brokers[broker] = nextBroker;
      next.brokers = brokers;
      changed = true;
    }
  }

  if (changed) {
    next.updatedAt = now;
  }

  return {
    row: next,
    changed,
  };
}

function collectNativeContractRefs(input, canonicalContractId) {
  const refs = [];
  const maybeAdd = (value) => {
    const text = toNonEmptyString(value);
    if (!text || text === canonicalContractId) {
      return;
    }
    refs.push(text);
  };

  maybeAdd(input.nativeContractId);
  maybeAdd(input.native_contract_id);
  maybeAdd(input.conid);
  maybeAdd(input.conId);
  maybeAdd(input.optionId);
  maybeAdd(input.option_id);
  maybeAdd(input.instrumentId);
  maybeAdd(input.instrument_id);
  maybeAdd(input.osiKey);
  maybeAdd(input.osi_key);
  maybeAdd(input.localSymbol);
  maybeAdd(input.local_symbol);
  maybeAdd(input.contractCode);
  maybeAdd(input.contract_code);

  if (input.optionContract && typeof input.optionContract === "object") {
    maybeAdd(input.optionContract.nativeContractId);
    maybeAdd(input.optionContract.conid);
    maybeAdd(input.optionContract.conId);
    maybeAdd(input.optionContract.osiKey);
    maybeAdd(input.optionContract.localSymbol);
  }

  return dedupeStrings(refs);
}

function normalizeOptionRight(value) {
  const text = toNonEmptyString(value)?.toLowerCase() || null;
  if (!text) {
    return null;
  }
  if (text.startsWith("c")) {
    return "call";
  }
  if (text.startsWith("p")) {
    return "put";
  }
  return null;
}

function dedupeStrings(values) {
  const out = [];
  for (const value of Array.isArray(values) ? values : []) {
    const text = toNonEmptyString(value);
    if (!text || out.includes(text)) {
      continue;
    }
    out.push(text);
  }
  return out;
}

function shouldUpdateLastSeen(existingTs, nextTs, minDeltaMs = 0) {
  const existingMs = parseMaybeDate(existingTs);
  const nextMs = parseMaybeDate(nextTs);
  if (!Number.isFinite(existingMs) || !Number.isFinite(nextMs)) {
    return true;
  }
  return Math.abs(nextMs - existingMs) >= Math.max(0, Number(minDeltaMs) || 0);
}

function normalizeBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value > 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "y") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "n") {
      return false;
    }
  }
  return false;
}

function normalizeResearchHistoryRecord(value = {}) {
  const normalizedHistory = normalizeResearchHistoryStore(value);
  const updatedAt = toNonEmptyString(value?.updatedAt) || null;
  return {
    ...normalizedHistory,
    updatedAt,
  };
}

function normalizeResearchBacktestState(value = {}) {
  const jobs = Array.isArray(value?.jobs)
    ? value.jobs
        .filter((row) => row && typeof row === "object")
        .map((row) => ({ ...row }))
        .sort((left, right) => {
          const rightTs = Date.parse(right?.updatedAt || right?.createdAt || 0) || 0;
          const leftTs = Date.parse(left?.updatedAt || left?.createdAt || 0) || 0;
          return rightTs - leftTs;
        })
        .slice(0, 48)
    : [];
  const results = Array.isArray(value?.results)
    ? value.results
        .filter((row) => row && typeof row === "object")
        .map((row) => ({ ...row }))
        .sort((left, right) => {
          const rightTs = Date.parse(right?.completedAt || right?.createdAt || 0) || 0;
          const leftTs = Date.parse(left?.completedAt || left?.createdAt || 0) || 0;
          return rightTs - leftTs;
        })
        .slice(0, 48)
    : [];
  return {
    jobs,
    results,
    updatedAt: toNonEmptyString(value?.updatedAt) || null,
  };
}

function normalizeNullableId(value) {
  if (value == null) {
    return null;
  }
  const text = String(value).trim();
  return text || null;
}
