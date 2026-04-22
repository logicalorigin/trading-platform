const DEFAULT_OPTIONS_WS_URL = process.env.MASSIVE_OPTIONS_WS_URL || "wss://socket.massive.com/options";
const DEFAULT_QUOTE_STALE_AFTER_MS = 15_000;
const DEFAULT_TRACKER_LEASE_TTL_MS = 120_000;
const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 30_000;

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numeric));
}

function normalizeOptionTicker(value) {
  const text = String(value || "").trim().toUpperCase();
  return /^O:[A-Z0-9]+$/.test(text) ? text : "";
}

function normalizeTimestampMs(value) {
  if (value == null || value === "") {
    return null;
  }
  if (typeof value === "string" && /[A-Z:-]/i.test(value)) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  if (numeric > 1e17) {
    return Math.round(numeric / 1e6);
  }
  if (numeric > 1e14) {
    return Math.round(numeric / 1e3);
  }
  if (numeric > 1e11) {
    return Math.round(numeric);
  }
  if (numeric > 1e9) {
    return Math.round(numeric * 1000);
  }
  return Math.round(numeric);
}

function toIsoOrNull(value) {
  const epochMs = normalizeTimestampMs(value);
  if (!Number.isFinite(epochMs)) {
    return null;
  }
  return new Date(epochMs).toISOString();
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return null;
}

function parseSocketJson(rawMessage) {
  const payload = rawMessage?.data ?? rawMessage;
  if (payload == null) {
    return [];
  }
  const text = typeof payload === "string"
    ? payload
    : (Buffer.isBuffer(payload) ? payload.toString("utf8") : String(payload));
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function normalizeQuoteEvent(message, receivedAtMs) {
  const optionTicker = normalizeOptionTicker(message?.sym || message?.symbol || message?.ticker);
  const bid = firstFiniteNumber(message?.bp, message?.bidPrice, message?.bid);
  const ask = firstFiniteNumber(message?.ap, message?.askPrice, message?.ask);
  if (!optionTicker || !Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0 || ask < bid) {
    return null;
  }
  const timestampMs = normalizeTimestampMs(message?.t || message?.timestamp || message?.sip_timestamp) || receivedAtMs;
  const midpoint = (bid + ask) / 2;
  return {
    optionTicker,
    bid,
    ask,
    bidSize: firstFiniteNumber(message?.bs, message?.bidSize, message?.bid_size),
    askSize: firstFiniteNumber(message?.as, message?.askSize, message?.ask_size),
    spread: ask - bid,
    midpoint,
    condition: message?.c ?? message?.conditions ?? null,
    quoteTimestampMs: timestampMs,
    quoteTimestamp: toIsoOrNull(timestampMs),
    receivedAtMs,
    receivedAt: toIsoOrNull(receivedAtMs),
  };
}

function normalizeTradeEvent(message, receivedAtMs) {
  const optionTicker = normalizeOptionTicker(message?.sym || message?.symbol || message?.ticker);
  const price = firstFiniteNumber(message?.p, message?.price);
  if (!optionTicker || !Number.isFinite(price) || price <= 0) {
    return null;
  }
  const timestampMs = normalizeTimestampMs(message?.t || message?.timestamp || message?.sip_timestamp) || receivedAtMs;
  return {
    optionTicker,
    price,
    size: firstFiniteNumber(message?.s, message?.size),
    exchange: message?.x ?? message?.exchange ?? null,
    condition: message?.c ?? message?.conditions ?? null,
    tradeTimestampMs: timestampMs,
    tradeTimestamp: toIsoOrNull(timestampMs),
    receivedAtMs,
    receivedAt: toIsoOrNull(receivedAtMs),
  };
}

function createTrackerRecord(request, nowIso, nowMs) {
  return {
    trackingId: String(request.trackingId || "").trim(),
    optionTicker: normalizeOptionTicker(request.optionTicker),
    label: String(request.label || "").trim() || null,
    sourceType: String(request.sourceType || "").trim() || null,
    sourceId: String(request.sourceId || "").trim() || null,
    openedAtMs: normalizeTimestampMs(request.openedAt) || nowMs,
    openedAt: toIsoOrNull(request.openedAt) || nowIso,
    entrySignalTsMs: normalizeTimestampMs(request.entrySignalTs),
    entrySignalTs: toIsoOrNull(request.entrySignalTs),
    exitSignalTsMs: normalizeTimestampMs(request.exitSignalTs),
    exitSignalTs: toIsoOrNull(request.exitSignalTs),
    entryFillPrice: null,
    entryFillAtMs: null,
    entryFillAt: null,
    exitFillPrice: null,
    exitFillAtMs: null,
    exitFillAt: null,
    createdAt: nowIso,
    updatedAt: nowIso,
    lastEventAt: null,
    lastLeaseAtMs: nowMs,
    lastLeaseAt: nowIso,
  };
}

async function resolveWebSocketCtor() {
  if (typeof WebSocket === "function") {
    return WebSocket;
  }
  const wsModule = await import("ws");
  return wsModule?.WebSocket || wsModule?.default;
}

function attachSocketListener(socket, eventName, handler) {
  if (typeof socket?.on === "function") {
    socket.on(eventName, (...args) => {
      if (eventName === "message") {
        handler(args[0]);
        return;
      }
      if (eventName === "close") {
        handler({ code: args[0], reason: args[1] });
        return;
      }
      handler(args[0]);
    });
    return;
  }
  if (typeof socket?.addEventListener === "function") {
    socket.addEventListener(eventName, handler);
    return;
  }
  socket[`on${eventName}`] = handler;
}

export function createMassiveOptionsTracker(options = {}) {
  const websocketUrl = String(options.websocketUrl || DEFAULT_OPTIONS_WS_URL).trim() || DEFAULT_OPTIONS_WS_URL;
  const quoteStaleAfterMs = clampNumber(
    options.quoteStaleAfterMs,
    1_000,
    600_000,
    DEFAULT_QUOTE_STALE_AFTER_MS,
  );
  const trackerLeaseTtlMs = clampNumber(
    options.trackerLeaseTtlMs ?? process.env.MASSIVE_TRACKER_LEASE_TTL_MS,
    1_000,
    3_600_000,
    DEFAULT_TRACKER_LEASE_TTL_MS,
  );
  const trackerLeaseSweepMs = clampNumber(
    options.trackerLeaseSweepMs ?? process.env.MASSIVE_TRACKER_LEASE_SWEEP_MS,
    250,
    trackerLeaseTtlMs,
    Math.min(5_000, trackerLeaseTtlMs),
  );
  const contractsByTicker = new Map();
  const trackersById = new Map();
  const activeSubscriptions = new Set();
  let socket = null;
  let connectPromise = null;
  let reconnectTimer = null;
  const connection = {
    status: "idle",
    authenticated: false,
    connectedAt: null,
    lastMessageAt: null,
    lastError: null,
    reconnectAttempt: 0,
    apiKey: "",
  };

  function nowMs() {
    return Date.now();
  }

  function ensureContractState(optionTicker) {
    const normalizedTicker = normalizeOptionTicker(optionTicker);
    if (!normalizedTicker) {
      return null;
    }
    let state = contractsByTicker.get(normalizedTicker);
    if (!state) {
      state = {
        optionTicker: normalizedTicker,
        trackers: new Set(),
        latestQuote: null,
        latestTrade: null,
        updatedAt: null,
      };
      contractsByTicker.set(normalizedTicker, state);
    }
    return state;
  }

  function getDesiredTickers() {
    return Array.from(contractsByTicker.values())
      .filter((contract) => contract.trackers.size > 0)
      .map((contract) => contract.optionTicker)
      .sort();
  }

  function getQuoteStatusForContract(contract) {
    if (!connection.apiKey) {
      return "api_key_missing";
    }
    if (!contract?.latestQuote) {
      return connection.status === "error" ? "unavailable" : "pending_quote";
    }
    const ageMs = Math.max(0, nowMs() - Number(contract.latestQuote.quoteTimestampMs || contract.latestQuote.receivedAtMs || 0));
    return ageMs > quoteStaleAfterMs ? "stale" : "live";
  }

  function buildContractSnapshot(contract) {
    if (!contract) {
      return null;
    }
    const quoteStatus = getQuoteStatusForContract(contract);
    return {
      optionTicker: contract.optionTicker,
      trackingCount: contract.trackers.size,
      quoteStatus,
      bid: contract.latestQuote?.bid ?? null,
      ask: contract.latestQuote?.ask ?? null,
      midpoint: contract.latestQuote?.midpoint ?? null,
      spread: contract.latestQuote?.spread ?? null,
      bidSize: contract.latestQuote?.bidSize ?? null,
      askSize: contract.latestQuote?.askSize ?? null,
      lastQuoteAt: contract.latestQuote?.quoteTimestamp || null,
      lastTradePrice: contract.latestTrade?.price ?? null,
      lastTradeAt: contract.latestTrade?.tradeTimestamp || null,
      updatedAt: contract.updatedAt || null,
    };
  }

  function buildTrackerSnapshot(tracker) {
    if (!tracker) {
      return null;
    }
    const contract = contractsByTicker.get(tracker.optionTicker) || null;
    const contractSnapshot = buildContractSnapshot(contract);
    const quoteStatus = contractSnapshot?.quoteStatus
      || (!connection.apiKey ? "api_key_missing" : "pending_quote");
    const lifecycleState = tracker.exitFillPrice != null
      ? "closed"
      : (tracker.entryFillPrice != null ? "open" : (tracker.entrySignalTs ? "pending_entry_fill" : "tracking"));
    return {
      trackingId: tracker.trackingId,
      optionTicker: tracker.optionTicker,
      label: tracker.label,
      sourceType: tracker.sourceType,
      sourceId: tracker.sourceId,
      lifecycleState,
      quoteStatus,
      openedAt: tracker.openedAt,
      entrySignalTs: tracker.entrySignalTs,
      entryFillPrice: tracker.entryFillPrice,
      entryFillAt: tracker.entryFillAt,
      exitSignalTs: tracker.exitSignalTs,
      exitFillPrice: tracker.exitFillPrice,
      exitFillAt: tracker.exitFillAt,
      markPrice: contractSnapshot?.midpoint ?? null,
      bid: contractSnapshot?.bid ?? null,
      ask: contractSnapshot?.ask ?? null,
      midpoint: contractSnapshot?.midpoint ?? null,
      spread: contractSnapshot?.spread ?? null,
      bidSize: contractSnapshot?.bidSize ?? null,
      askSize: contractSnapshot?.askSize ?? null,
      lastQuoteAt: contractSnapshot?.lastQuoteAt ?? null,
      lastTradePrice: contractSnapshot?.lastTradePrice ?? null,
      lastTradeAt: contractSnapshot?.lastTradeAt ?? null,
      updatedAt: tracker.updatedAt,
      service: {
        connectionStatus: connection.status,
        authenticated: connection.authenticated,
        lastError: connection.lastError,
      },
    };
  }

  function getServiceStatus() {
    pruneExpiredTrackers();
    return {
      websocketUrl,
      connectionStatus: connection.status,
      authenticated: connection.authenticated,
      trackerLeaseTtlMs,
      trackedContracts: getDesiredTickers().length,
      trackedSources: trackersById.size,
      lastError: connection.lastError,
      connectedAt: connection.connectedAt,
      lastMessageAt: connection.lastMessageAt,
    };
  }

  function touchTrackerLease(tracker, leaseAtMs = nowMs()) {
    if (!tracker) {
      return;
    }
    tracker.lastLeaseAtMs = leaseAtMs;
    tracker.lastLeaseAt = toIsoOrNull(leaseAtMs) || new Date(leaseAtMs).toISOString();
  }

  function markTrackerUpdated(tracker, updatedAtMs) {
    tracker.updatedAt = toIsoOrNull(updatedAtMs) || new Date(updatedAtMs).toISOString();
    tracker.lastEventAt = tracker.updatedAt;
  }

  function removeTracker(trackingId) {
    const tracker = trackersById.get(trackingId);
    if (!tracker) {
      return null;
    }
    trackersById.delete(trackingId);
    const contract = contractsByTicker.get(tracker.optionTicker);
    contract?.trackers?.delete(trackingId);
    if (contract && contract.trackers.size === 0) {
      contractsByTicker.delete(tracker.optionTicker);
      activeSubscriptions.delete(tracker.optionTicker);
    }
    return tracker;
  }

  function pruneExpiredTrackers(referenceNowMs = nowMs()) {
    const expiryCutoffMs = referenceNowMs - trackerLeaseTtlMs;
    let removedAny = false;
    for (const [trackingId, tracker] of Array.from(trackersById.entries())) {
      if (Number(tracker?.lastLeaseAtMs || 0) > expiryCutoffMs) {
        continue;
      }
      if (removeTracker(trackingId)) {
        removedAny = true;
      }
    }
    if (removedAny) {
      syncSubscriptions();
    }
    return removedAny;
  }

  function applyQuoteToTrackers(optionTicker, quote) {
    const contract = contractsByTicker.get(optionTicker);
    if (!contract) {
      return;
    }
    for (const trackingId of contract.trackers) {
      const tracker = trackersById.get(trackingId);
      if (!tracker) {
        continue;
      }
      const quoteTimestampMs = Number(quote.quoteTimestampMs || quote.receivedAtMs || nowMs());
      if (
        tracker.entryFillPrice == null
        && Number.isFinite(tracker.entrySignalTsMs)
        && quoteTimestampMs >= tracker.entrySignalTsMs
      ) {
        tracker.entryFillPrice = quote.midpoint;
        tracker.entryFillAtMs = quoteTimestampMs;
        tracker.entryFillAt = quote.quoteTimestamp || quote.receivedAt || null;
      }
      if (
        tracker.exitFillPrice == null
        && Number.isFinite(tracker.exitSignalTsMs)
        && quoteTimestampMs >= tracker.exitSignalTsMs
      ) {
        tracker.exitFillPrice = quote.midpoint;
        tracker.exitFillAtMs = quoteTimestampMs;
        tracker.exitFillAt = quote.quoteTimestamp || quote.receivedAt || null;
      }
      markTrackerUpdated(tracker, quoteTimestampMs);
    }
  }

  function handleQuoteMessage(message) {
    const receivedAtMs = nowMs();
    const quote = normalizeQuoteEvent(message, receivedAtMs);
    if (!quote) {
      return;
    }
    const contract = ensureContractState(quote.optionTicker);
    if (!contract) {
      return;
    }
    contract.latestQuote = quote;
    contract.updatedAt = quote.receivedAt;
    connection.lastMessageAt = quote.receivedAt;
    applyQuoteToTrackers(contract.optionTicker, quote);
  }

  function handleTradeMessage(message) {
    const receivedAtMs = nowMs();
    const trade = normalizeTradeEvent(message, receivedAtMs);
    if (!trade) {
      return;
    }
    const contract = ensureContractState(trade.optionTicker);
    if (!contract) {
      return;
    }
    contract.latestTrade = trade;
    contract.updatedAt = trade.receivedAt;
    connection.lastMessageAt = trade.receivedAt;
    for (const trackingId of contract.trackers) {
      const tracker = trackersById.get(trackingId);
      if (tracker) {
        markTrackerUpdated(tracker, trade.tradeTimestampMs || receivedAtMs);
      }
    }
  }

  function sendSocketMessage(payload) {
    if (!socket || Number(socket.readyState) !== 1) {
      return false;
    }
    socket.send(JSON.stringify(payload));
    return true;
  }

  function sendAuthMessage() {
    if (!connection.apiKey) {
      return false;
    }
    return sendSocketMessage({
      action: "auth",
      params: connection.apiKey,
    });
  }

  function scheduleReconnect() {
    if (reconnectTimer || !connection.apiKey || !getDesiredTickers().length) {
      return;
    }
    const attempt = connection.reconnectAttempt + 1;
    connection.reconnectAttempt = attempt;
    connection.status = "reconnecting";
    const delayMs = Math.min(
      RECONNECT_MAX_DELAY_MS,
      RECONNECT_BASE_DELAY_MS * (2 ** Math.max(attempt - 1, 0)),
    );
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      ensureConnected({ apiKey: connection.apiKey }).catch((error) => {
        connection.status = "error";
        connection.lastError = error?.message || "Failed to reconnect Massive options websocket";
        scheduleReconnect();
      });
    }, delayMs);
  }

  function clearSocketState() {
    connection.authenticated = false;
    activeSubscriptions.clear();
    socket = null;
    connectPromise = null;
  }

  function closeSocket(reason = "idle") {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (socket && Number(socket.readyState) <= 1) {
      try {
        socket.close(1000, reason);
      } catch {
        // no-op
      }
    }
    clearSocketState();
    connection.status = getDesiredTickers().length ? "disconnected" : "idle";
  }

  function syncSubscriptions() {
    if (!connection.authenticated || !socket || Number(socket.readyState) !== 1) {
      return;
    }
    const desiredTickers = new Set(getDesiredTickers());
    const subscribeParams = [];
    const unsubscribeParams = [];

    for (const optionTicker of desiredTickers) {
      if (!activeSubscriptions.has(optionTicker)) {
        subscribeParams.push(`Q.${optionTicker}`, `T.${optionTicker}`);
      }
    }
    for (const optionTicker of activeSubscriptions) {
      if (!desiredTickers.has(optionTicker)) {
        unsubscribeParams.push(`Q.${optionTicker}`, `T.${optionTicker}`);
      }
    }

    if (subscribeParams.length) {
      sendSocketMessage({
        action: "subscribe",
        params: subscribeParams.join(","),
      });
      for (const optionTicker of desiredTickers) {
        activeSubscriptions.add(optionTicker);
      }
    }

    if (unsubscribeParams.length) {
      sendSocketMessage({
        action: "unsubscribe",
        params: unsubscribeParams.join(","),
      });
      for (const optionTicker of Array.from(activeSubscriptions)) {
        if (!desiredTickers.has(optionTicker)) {
          activeSubscriptions.delete(optionTicker);
        }
      }
    }

    if (!desiredTickers.size) {
      closeSocket("no-tracked-contracts");
    }
  }

  function handleStatusMessage(message) {
    const statusText = String(
      message?.status
      || message?.message
      || message?.msg
      || message?.text
      || "",
    ).toLowerCase();
    if (!statusText) {
      return;
    }
    connection.lastMessageAt = new Date().toISOString();
    if (statusText.includes("connected")) {
      connection.status = "connected";
      sendAuthMessage();
      return;
    }
    if (statusText.includes("auth") && (statusText.includes("success") || statusText.includes("ok"))) {
      connection.authenticated = true;
      connection.status = "connected";
      connection.connectedAt = new Date().toISOString();
      connection.lastError = null;
      connection.reconnectAttempt = 0;
      syncSubscriptions();
      return;
    }
    if (statusText.includes("auth") && (statusText.includes("fail") || statusText.includes("error"))) {
      connection.status = "error";
      connection.lastError = message?.message || message?.msg || "Massive websocket authentication failed";
    }
  }

  async function ensureConnected({ apiKey } = {}) {
    const desiredTickers = getDesiredTickers();
    const nextApiKey = String(apiKey || connection.apiKey || "").trim();
    if (!desiredTickers.length) {
      closeSocket("no-tracked-contracts");
      return false;
    }
    if (!nextApiKey) {
      connection.status = "error";
      connection.lastError = "Massive API key is required for live options tracking";
      return false;
    }
    connection.apiKey = nextApiKey;
    if (socket && Number(socket.readyState) <= 1) {
      if (connection.authenticated) {
        syncSubscriptions();
      }
      return true;
    }
    if (connectPromise) {
      return connectPromise;
    }

    const WebSocketCtor = await resolveWebSocketCtor();
    connection.status = "connecting";
    connection.lastError = null;
    connectPromise = new Promise((resolve) => {
      let settled = false;
      const connectTimeout = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        connection.status = "error";
        connection.lastError = "Massive websocket connect timed out";
        try {
          socket?.close?.(1000, "connect-timeout");
        } catch {
          // no-op
        }
        resolve(false);
      }, 5000);
      const finish = (value) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(connectTimeout);
        resolve(value);
      };

      const nextSocket = new WebSocketCtor(websocketUrl);
      socket = nextSocket;

      attachSocketListener(nextSocket, "open", () => {
        connection.status = "connected";
        sendAuthMessage();
        finish(true);
      });
      attachSocketListener(nextSocket, "message", (rawMessage) => {
        const messages = parseSocketJson(rawMessage);
        for (const message of messages) {
          const eventType = String(message?.ev || message?.event || "").trim().toUpperCase();
          if (eventType === "STATUS") {
            handleStatusMessage(message);
            continue;
          }
          if (eventType === "Q") {
            handleQuoteMessage(message);
            continue;
          }
          if (eventType === "T") {
            handleTradeMessage(message);
          }
        }
      });
      attachSocketListener(nextSocket, "error", (error) => {
        connection.status = "error";
        connection.lastError = error?.message || "Massive websocket error";
        finish(false);
      });
      attachSocketListener(nextSocket, "close", () => {
        finish(false);
        clearSocketState();
        if (getDesiredTickers().length) {
          scheduleReconnect();
        } else {
          connection.status = "idle";
        }
      });
    }).finally(() => {
      connectPromise = null;
    });
    return connectPromise;
  }

  async function trackContract(request = {}, options = {}) {
    pruneExpiredTrackers();
    const normalizedTicker = normalizeOptionTicker(request.optionTicker);
    const trackingId = String(request.trackingId || "").trim();
    if (!trackingId || !normalizedTicker) {
      throw new Error("trackingId and optionTicker are required");
    }

    const timestampMs = nowMs();
    const timestampIso = new Date(timestampMs).toISOString();
    const existing = trackersById.get(trackingId) || null;
    if (existing && existing.optionTicker !== normalizedTicker) {
      const previousContract = contractsByTicker.get(existing.optionTicker);
      previousContract?.trackers?.delete(trackingId);
      if (previousContract && previousContract.trackers.size === 0) {
        contractsByTicker.delete(existing.optionTicker);
        activeSubscriptions.delete(existing.optionTicker);
      }
    }

    const tracker = existing
      ? {
          ...existing,
          optionTicker: normalizedTicker,
          label: String(request.label || existing.label || "").trim() || null,
          sourceType: String(request.sourceType || existing.sourceType || "").trim() || null,
          sourceId: String(request.sourceId || existing.sourceId || "").trim() || null,
          openedAtMs: normalizeTimestampMs(request.openedAt) || existing.openedAtMs,
          openedAt: toIsoOrNull(request.openedAt) || existing.openedAt,
          entrySignalTsMs: normalizeTimestampMs(request.entrySignalTs) ?? existing.entrySignalTsMs,
          entrySignalTs: toIsoOrNull(request.entrySignalTs) ?? existing.entrySignalTs,
          exitSignalTsMs: normalizeTimestampMs(request.exitSignalTs) ?? existing.exitSignalTsMs,
          exitSignalTs: toIsoOrNull(request.exitSignalTs) ?? existing.exitSignalTs,
          updatedAt: timestampIso,
        }
      : createTrackerRecord({
          ...request,
          trackingId,
          optionTicker: normalizedTicker,
        }, timestampIso, timestampMs);

    touchTrackerLease(tracker, timestampMs);
    trackersById.set(trackingId, tracker);
    const contract = ensureContractState(normalizedTicker);
    contract?.trackers?.add(trackingId);
    await ensureConnected({
      apiKey: String(options.apiKey || connection.apiKey || "").trim(),
    });
    if (connection.authenticated) {
      syncSubscriptions();
    }
    return buildTrackerSnapshot(tracker);
  }

  async function untrackContract({ trackingId } = {}) {
    pruneExpiredTrackers();
    const normalizedTrackingId = String(trackingId || "").trim();
    if (!normalizedTrackingId) {
      throw new Error("trackingId is required");
    }
    const tracker = removeTracker(normalizedTrackingId);
    if (!tracker) {
      return {
        removed: false,
        trackingId: normalizedTrackingId,
      };
    }
    syncSubscriptions();
    return {
      removed: true,
      trackingId: normalizedTrackingId,
      optionTicker: tracker.optionTicker,
    };
  }

  function getTrackingSnapshots({ trackingIds = [], optionTickers = [] } = {}) {
    pruneExpiredTrackers();
    const normalizedTrackingIds = (Array.isArray(trackingIds) ? trackingIds : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    if (normalizedTrackingIds.length) {
      const leaseAtMs = nowMs();
      return normalizedTrackingIds
        .map((trackingId) => {
          const tracker = trackersById.get(trackingId);
          touchTrackerLease(tracker, leaseAtMs);
          return buildTrackerSnapshot(tracker);
        })
        .filter(Boolean);
    }

    const normalizedTickers = (Array.isArray(optionTickers) ? optionTickers : [])
      .map(normalizeOptionTicker)
      .filter(Boolean);
    if (normalizedTickers.length) {
      return normalizedTickers
        .map((optionTicker) => buildContractSnapshot(contractsByTicker.get(optionTicker)))
        .filter(Boolean);
    }

    return Array.from(trackersById.values())
      .map((tracker) => buildTrackerSnapshot(tracker))
      .filter(Boolean);
  }

  const leaseSweepTimer = setInterval(() => {
    pruneExpiredTrackers();
  }, trackerLeaseSweepMs);
  leaseSweepTimer.unref?.();

  return {
    ensureConnected,
    trackContract,
    untrackContract,
    getTrackingSnapshots,
    getServiceStatus,
  };
}
