import { readFileSync } from "node:fs";
import { constants as osConstants } from "node:os";

import { parseProcStat } from "./replit-process-authority.mjs";

const FORWARDED_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"];

function signalExitCode(signal) {
  const signalNumber = osConstants.signals[signal];
  return Number.isSafeInteger(signalNumber) && signalNumber > 0
    ? 128 + signalNumber
    : 1;
}

export function readProcessGroupIdentity(
  pid,
  { readFile = readFileSync } = {},
) {
  if (
    !Number.isSafeInteger(pid) ||
    pid <= 0 ||
    typeof readFile !== "function"
  ) {
    return null;
  }
  try {
    const stat = parseProcStat(readFile(`/proc/${pid}/stat`, "utf8"));
    return stat ? { pid, startTimeTicks: stat.startTimeTicks } : null;
  } catch {
    return null;
  }
}

function childIdentityMatches(expected, current) {
  return (
    Number.isSafeInteger(expected?.pid) &&
    expected.pid === current?.pid &&
    typeof expected.startTimeTicks === "string" &&
    expected.startTimeTicks === current.startTimeTicks
  );
}

export function normalizeProcessErrorCode(error) {
  const code = String(error?.code ?? "ERROR");
  return /^[A-Z0-9_]{1,64}$/u.test(code) ? code : "ERROR";
}

export function createProcessGroupShutdownController({
  graceMs,
  onSignalError = () => {},
  signalSource = process,
  readIdentity = readProcessGroupIdentity,
  kill = process.kill,
  platform = process.platform,
} = {}) {
  // ponytail: these runners deploy on Linux; add a native process-identity
  // adapter before supporting another host platform.
  if (platform !== "linux") {
    throw new Error("Process-group shutdown requires Linux /proc support");
  }
  if (
    !Number.isSafeInteger(graceMs) ||
    graceMs <= 0 ||
    graceMs > 60_000 ||
    typeof onSignalError !== "function" ||
    typeof signalSource?.on !== "function" ||
    typeof signalSource?.removeListener !== "function" ||
    typeof readIdentity !== "function" ||
    typeof kill !== "function"
  ) {
    throw new Error("Process-group shutdown dependencies are invalid");
  }

  let child = null;
  let childIdentity = null;
  let requestedSignal = null;
  let forceRequested = false;
  let escalationTimer = null;
  let forceSent = false;
  let finalOutcome = null;
  const handlers = new Map();

  const signalChildGroup = (signal, allowMissingLeader = false) => {
    if (!Number.isSafeInteger(child?.pid) || child.pid <= 0) return false;
    const currentIdentity = readIdentity(child.pid);
    if (
      (currentIdentity &&
        !childIdentityMatches(childIdentity, currentIdentity)) ||
      (!currentIdentity && !allowMissingLeader)
    ) {
      return false;
    }
    try {
      kill(-child.pid, signal);
      return true;
    } catch (error) {
      if (error?.code !== "ESRCH") onSignalError(signal, error);
      return false;
    }
  };
  const forceShutdown = (allowMissingLeader = false) => {
    if (!child) return;
    forceSent = signalChildGroup("SIGKILL", allowMissingLeader) || forceSent;
  };
  const armShutdown = () => {
    if (!child || !requestedSignal || escalationTimer) return;
    signalChildGroup(requestedSignal);
    escalationTimer = setTimeout(() => forceShutdown(false), graceMs);
  };
  const requestShutdown = (signal) => {
    if (requestedSignal) {
      forceRequested = true;
      forceShutdown(false);
      return;
    }
    requestedSignal = signal;
    armShutdown();
  };
  const cleanup = () => {
    if (escalationTimer) clearTimeout(escalationTimer);
    for (const [signal, handler] of handlers) {
      signalSource.removeListener(signal, handler);
    }
  };

  for (const signal of FORWARDED_SIGNALS) {
    const handler = () => requestShutdown(signal);
    handlers.set(signal, handler);
    signalSource.on(signal, handler);
  }

  return {
    attach(spawnedChild) {
      const identity = readIdentity(spawnedChild.pid);
      if (!identity) return false;
      child = spawnedChild;
      childIdentity = identity;
      armShutdown();
      if (forceRequested) forceShutdown(false);
      return true;
    },
    finish(code, childSignal, errorCode) {
      if (requestedSignal) {
        // ponytail: Node has no process-group fd. After the observed leader exit,
        // a missing leader is the platform ceiling for draining surviving group
        // descendants without trusting a potentially reused live leader PID.
        forceShutdown(true);
      }
      const wrapperSignal = requestedSignal;
      const finalSignal = wrapperSignal ?? childSignal;
      const outcome = {
        code: code ?? (finalSignal ? signalExitCode(finalSignal) : 1),
        signal: finalSignal,
        wrapperSignal,
        childSignal,
        escalated:
          forceSent || Boolean(requestedSignal && childSignal === "SIGKILL"),
        errorCode,
      };
      if (escalationTimer) clearTimeout(escalationTimer);
      escalationTimer = null;
      return outcome;
    },
    complete(outcome) {
      if (finalOutcome) return finalOutcome;
      if (requestedSignal && !forceSent) forceShutdown(true);
      const wrapperSignal = requestedSignal;
      const finalSignal = wrapperSignal ?? outcome.signal;
      finalOutcome = {
        ...outcome,
        code: outcome.code ?? (finalSignal ? signalExitCode(finalSignal) : 1),
        signal: finalSignal,
        wrapperSignal,
        escalated: forceSent || Boolean(outcome.escalated),
      };
      child = null;
      childIdentity = null;
      cleanup();
      return finalOutcome;
    },
  };
}

export function waitForProcessGroupChild(child, shutdown) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };
    child.once("error", (error) => {
      if (settled) return;
      finish(shutdown.finish(127, null, normalizeProcessErrorCode(error)));
    });
    child.once("exit", (code, signal) => {
      if (settled) return;
      finish(shutdown.finish(code, signal, null));
    });
    if (!Number.isSafeInteger(child.pid) || child.pid <= 0) return;
    const failAttachment = (errorCode) => {
      try {
        child.kill("SIGKILL");
      } catch {
        // A queued exit/error event still owns the authoritative outcome.
      }
      finish(shutdown.finish(127, null, errorCode));
    };
    try {
      if (shutdown.attach(child)) return;
    } catch (error) {
      failAttachment(normalizeProcessErrorCode(error));
      return;
    }
    setImmediate(() => {
      if (settled) return;
      try {
        if (shutdown.attach(child)) return;
      } catch (error) {
        failAttachment(normalizeProcessErrorCode(error));
        return;
      }
      failAttachment("PROCESS_IDENTITY_UNAVAILABLE");
    });
  });
}
