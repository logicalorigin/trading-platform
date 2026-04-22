import {
  buildFusionInputs,
  generateDryRunFusionContext,
  generateOpenAiFusionContext,
  normalizeFusionContext,
} from "./aiFusionProvider.js";

export function createAiFusionWorker({ store }) {
  let started = false;
  let timer = null;
  let nextRunAt = null;
  let inFlight = null;

  async function runOnce(reason = "timer", options = {}) {
    const force = Boolean(options.force);
    const config = store.getAiFusionConfig();

    if (!config.enabled && !force) {
      return {
        ok: false,
        skipped: "disabled",
      };
    }

    if (inFlight) {
      return {
        ok: false,
        skipped: "in_flight",
      };
    }

    const runtime = store.getAiFusionRuntime();
    const circuitUntilMs = Date.parse(runtime.circuitOpenUntil || "");
    if (!force && Number.isFinite(circuitUntilMs) && circuitUntilMs > Date.now()) {
      return {
        ok: false,
        skipped: "circuit_open",
        circuitOpenUntil: runtime.circuitOpenUntil,
      };
    }

    const runId = `aif-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const startedAtMs = Date.now();
    const startedAtIso = new Date(startedAtMs).toISOString();

    const task = (async () => {
      await store.patchAiFusionRuntime({
        status: "running",
        inFlight: true,
        lastRunAt: startedAtIso,
        lastError: null,
      });

      try {
        const lookbackMinutes = clampNumber(config.lookbackMinutes, 5, 24 * 60, 240);
        const inputs = buildFusionInputs(store, { lookbackMinutes });

        const timeoutMs = clampNumber(config.timeoutMs, 500, 30000, 4500);
        const providerResult = await withTimeout(
          runProvider({
            inputs,
            config,
          }),
          timeoutMs,
          `AI fusion timeout after ${timeoutMs}ms`,
        );

        const normalized = normalizeFusionContext(providerResult.context, {
          runId,
          source: providerResult.source,
          reason,
          providerMeta: providerResult.meta,
          ttlSec: config.ttlSec,
          ts: new Date().toISOString(),
        });
        normalized.inputs = {
          lookbackMinutes,
          signalCount: inputs.signalSummary?.sampleSize || 0,
          alertCount: inputs.alertSummary?.sampleSize || 0,
          accountCount: inputs.accountSummary?.sampleSize || 0,
        };

        await store.setAiFusionContext(normalized);

        const latencyMs = Date.now() - startedAtMs;
        await store.appendAiFusionHistory({
          runId,
          status: "success",
          source: providerResult.source,
          reason,
          model: providerResult.meta?.model,
          confidence: normalized.confidence,
          regime: normalized.regime,
          bias: normalized.bias,
          riskMultiplier: normalized.riskMultiplier,
          latencyMs,
          createdAt: new Date().toISOString(),
        });

        await store.patchAiFusionRuntime({
          status: "ok",
          inFlight: false,
          lastSuccessAt: new Date().toISOString(),
          consecutiveFailures: 0,
          circuitOpenUntil: null,
          lastError: null,
        });

        return {
          ok: true,
          runId,
          context: normalized,
          latencyMs,
          source: providerResult.source,
        };
      } catch (error) {
        const latestRuntime = store.getAiFusionRuntime();
        const failures = Math.max(0, Number(latestRuntime.consecutiveFailures || 0)) + 1;
        const threshold = clampNumber(config.failureThreshold, 1, 20, 3);
        const circuitSec = clampNumber(config.circuitOpenSec, 5, 3600, 120);
        const shouldOpenCircuit = failures >= threshold;
        const circuitOpenUntil = shouldOpenCircuit
          ? new Date(Date.now() + circuitSec * 1000).toISOString()
          : null;
        const message = error?.message || "AI fusion failed";

        await store.appendAiFusionHistory({
          runId,
          status: "error",
          source: chooseSourceForError(config),
          reason,
          model: config.model,
          error: message,
          latencyMs: Date.now() - startedAtMs,
          createdAt: new Date().toISOString(),
        });

        await store.patchAiFusionRuntime({
          status: "error",
          inFlight: false,
          lastError: message,
          consecutiveFailures: failures,
          circuitOpenUntil,
        });

        return {
          ok: false,
          runId,
          error: message,
          circuitOpenUntil,
        };
      }
    })();

    inFlight = task.finally(() => {
      inFlight = null;
    });

    return inFlight;
  }

  function scheduleNext(delayMs = null) {
    clearTimer();
    if (!started) {
      return;
    }

    const config = store.getAiFusionConfig();
    const intervalMs = Number.isFinite(delayMs)
      ? delayMs
      : Math.max(1000, clampNumber(config.intervalSec, 1, 3600, 60) * 1000);
    nextRunAt = new Date(Date.now() + intervalMs).toISOString();

    timer = setTimeout(async () => {
      try {
        await runOnce("timer", { force: false });
      } catch {
        // Swallow to keep scheduler alive.
      } finally {
        scheduleNext();
      }
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
    const config = store.getAiFusionConfig();
    if (toBoolean(config.runOnStart, false) && toBoolean(config.enabled, false)) {
      void runOnce("startup", { force: false });
    }
    scheduleNext();
  }

  function stop() {
    started = false;
    clearTimer();
  }

  function refreshSchedule() {
    if (started) {
      scheduleNext();
    }
  }

  function getStatus() {
    const context = store.getAiFusionContext();
    const nowMs = Date.now();
    const expiresMs = Date.parse(context?.expiresAt || "");
    const stale = !context || !Number.isFinite(expiresMs) || expiresMs <= nowMs;

    return {
      running: started,
      nextRunAt,
      config: store.getAiFusionConfig(),
      runtime: store.getAiFusionRuntime(),
      context,
      contextStale: stale,
    };
  }

  async function triggerNow(options = {}) {
    return runOnce(options.reason || "manual", {
      force: Boolean(options.force),
    });
  }

  return {
    start,
    stop,
    refreshSchedule,
    getStatus,
    triggerNow,
    runOnce,
  };
}

async function runProvider({ inputs, config }) {
  const provider = String(config.provider || "openai").toLowerCase();
  const dryRun = toBoolean(config.dryRun, false);

  if (!dryRun && provider === "openai") {
    try {
      const live = await generateOpenAiFusionContext({ inputs, config });
      return {
        context: live.context,
        source: "openai",
        meta: {
          provider: "openai",
          ...(live.meta || {}),
        },
      };
    } catch (error) {
      if (!toBoolean(config.openaiFallbackToDryRun, false)) {
        throw error;
      }
      const fallback = generateDryRunFusionContext({ inputs, config });
      return {
        context: fallback,
        source: "openai-fallback",
        meta: {
          provider: "dry-run",
          model: "heuristic",
          fallbackFrom: "openai",
          fallbackReason: error?.message || "openai_error",
        },
      };
    }
  }

  const local = generateDryRunFusionContext({ inputs, config });
  return {
    context: local,
    source: "dry-run",
    meta: {
      provider: "dry-run",
      model: "heuristic",
    },
  };
}

function chooseSourceForError(config) {
  const provider = String(config.provider || "openai").toLowerCase();
  const dryRun = toBoolean(config.dryRun, false);
  if (!dryRun && provider === "openai") {
    return "openai";
  }
  return "dry-run";
}

function toBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (["1", "true", "yes", "y", "on"].includes(text)) {
      return true;
    }
    if (["0", "false", "no", "n", "off"].includes(text)) {
      return false;
    }
  }
  return fallback;
}

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, num));
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timeoutId);
  });
}
