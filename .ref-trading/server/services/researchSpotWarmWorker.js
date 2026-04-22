import {
  acquireResearchSpotWarmLease,
  isMassiveDbCacheConfigured,
} from "./massiveDbCache.js";
import { resolveMassiveApiKey } from "./massiveClient.js";
import { warmResearchSpotHistoryStep } from "./researchSpotHistory.js";

export function createResearchSpotWarmWorker() {
  let started = false;
  let timer = null;
  let nextRunAt = null;
  let inFlight = null;
  let lastResult = null;
  let symbolCursor = 0;
  let lease = null;

  function getConfig() {
    const enabledFallback = String(process.env.NODE_ENV || "").trim().toLowerCase() !== "production";
    return {
      enabled: toBoolean(process.env.RESEARCH_SPOT_WARM_ENABLED, enabledFallback),
      runOnStart: toBoolean(process.env.RESEARCH_SPOT_WARM_RUN_ON_START, enabledFallback),
      intervalSec: clampInt(process.env.RESEARCH_SPOT_WARM_INTERVAL_SEC, 30, 3600, 120),
      rateLimitBackoffSec: clampInt(process.env.RESEARCH_SPOT_WARM_RATE_LIMIT_BACKOFF_SEC, 60, 7200, 600),
      errorBackoffSec: clampInt(process.env.RESEARCH_SPOT_WARM_ERROR_BACKOFF_SEC, 30, 3600, 240),
      days: clampInt(process.env.RESEARCH_SPOT_WARM_DAYS, 30, 2000, 730),
      session: String(process.env.RESEARCH_SPOT_WARM_SESSION || "regular").trim().toLowerCase() || "regular",
      warmDaily: toBoolean(process.env.RESEARCH_SPOT_WARM_DAILY, true),
      symbols: parseSymbols(process.env.RESEARCH_SPOT_WARM_SYMBOLS || "SPY,QQQ"),
    };
  }

  async function runOnce(reason = "timer", options = {}) {
    try {
      const force = Boolean(options.force);
      const config = getConfig();
      if (!config.enabled && !force) {
        lastResult = { ok: false, skipped: "disabled", at: new Date().toISOString() };
        return lastResult;
      }
      if (!isMassiveDbCacheConfigured()) {
        lastResult = { ok: false, skipped: "db_unconfigured", at: new Date().toISOString() };
        return lastResult;
      }
      if (!config.symbols.length) {
        lastResult = { ok: false, skipped: "no_symbols", at: new Date().toISOString() };
        return lastResult;
      }
      const apiKey = resolveMassiveApiKey();
      if (!apiKey) {
        lastResult = { ok: false, skipped: "missing_api_key", at: new Date().toISOString() };
        return lastResult;
      }
      if (inFlight) {
        return {
          ok: false,
          skipped: "in_flight",
          at: new Date().toISOString(),
        };
      }
      const isLeader = await ensureLeaderLease();
      if (!isLeader) {
        lastResult = {
          ok: false,
          reason,
          at: new Date().toISOString(),
          skipped: "not_leader",
        };
        return lastResult;
      }
      const symbol = config.symbols[symbolCursor % config.symbols.length];
      const task = (async () => {
        try {
          const result = await warmResearchSpotHistoryStep({
            symbol,
            apiKey,
            days: config.days,
            session: config.session,
            warmDaily: config.warmDaily,
          });
          symbolCursor = (symbolCursor + 1) % config.symbols.length;
          lastResult = {
            ok: true,
            reason,
            symbol,
            at: new Date().toISOString(),
            result,
          };
          return lastResult;
        } catch (error) {
          lastResult = {
            ok: false,
            reason,
            symbol,
            at: new Date().toISOString(),
            error: error?.message || "Warm step failed",
          };
          return lastResult;
        }
      })();

      inFlight = task.finally(() => {
        inFlight = null;
      });
      return inFlight;
    } catch (error) {
      lastResult = {
        ok: false,
        reason,
        at: new Date().toISOString(),
        error: error?.message || "Warm worker failed",
      };
      console.warn("[research-spot-warm] run failed:", lastResult.error);
      return lastResult;
    }
  }

  function scheduleNext(delayMs = null) {
    clearTimer();
    if (!started) {
      return;
    }

    const config = getConfig();
    const intervalMs = Number.isFinite(delayMs)
      ? delayMs
      : config.intervalSec * 1000;
    nextRunAt = new Date(Date.now() + intervalMs).toISOString();
    timer = setTimeout(async () => {
      try {
        const result = await runOnce("timer");
        if (!result?.ok && isRateLimitError(result?.error)) {
          scheduleNext(config.rateLimitBackoffSec * 1000);
          return;
        }
        if (!result?.ok && !result?.skipped) {
          scheduleNext(config.errorBackoffSec * 1000);
          return;
        }
      } catch {
        scheduleNext(config.errorBackoffSec * 1000);
        return;
      }
      scheduleNext();
    }, intervalMs);
  }

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    nextRunAt = null;
  }

  function start() {
    if (started) {
      return;
    }
    started = true;
    const config = getConfig();
    if (config.enabled) {
      console.log(`[research-spot-warm] enabled for ${config.symbols.join(", ")} (${config.days}d ${config.session})`);
    }
    if (config.runOnStart && config.enabled) {
      void runOnce("startup").catch((error) => {
        const message = error?.message || "Warm worker startup failed";
        lastResult = {
          ok: false,
          reason: "startup",
          at: new Date().toISOString(),
          error: message,
        };
        console.warn("[research-spot-warm] startup failed:", message);
      });
    }
    scheduleNext();
  }

  function stop() {
    started = false;
    clearTimer();
    void releaseLeaderLease();
  }

  function getStatus() {
    return {
      running: started,
      nextRunAt,
      inFlight: Boolean(inFlight),
      leader: Boolean(lease),
      config: getConfig(),
      lastResult,
    };
  }

  return {
    start,
    stop,
    getStatus,
    runOnce,
  };

  async function ensureLeaderLease() {
    if (lease) {
      return true;
    }
    lease = await acquireResearchSpotWarmLease();
    return Boolean(lease);
  }

  async function releaseLeaderLease() {
    if (!lease) {
      return;
    }
    const activeLease = lease;
    lease = null;
    await activeLease.release();
  }
}

function parseSymbols(value) {
  return String(value || "")
    .split(",")
    .map((symbol) => String(symbol || "").trim().toUpperCase())
    .filter(Boolean);
}

function toBoolean(value, fallback = false) {
  if (value == null || value === "") {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function clampInt(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function isRateLimitError(message) {
  const normalized = String(message || "").trim().toLowerCase();
  return normalized.includes("requests per minute")
    || normalized.includes("rate limit")
    || normalized.includes("too many requests");
}
