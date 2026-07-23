import { randomUUID } from "node:crypto";
import {
  closeSync,
  fstatSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import path from "node:path";

const SAFE_REPLIT_ENV = [
  "REPLIT_CLUSTER",
  "REPLIT_CONTAINER",
  "REPLIT_PID1_VERSION",
  "REPLIT_SESSION",
  "REPL_IN_MICROVM",
];
const REPLIT_RUNTIME_FILES = {
  envLatest: "/run/replit/env/latest.json",
  envLast: "/run/replit/env/last.json",
  pid1Flags: "/run/replit/pid1/flags.json",
  toolchain: "/run/replit/toolchain.json",
};
const RECORDER_CONTINUITY_MS = 90_000;
const CLOCK_SKEW_MS = 30_000;

export function resolveFlightRecorderDir(repoRoot, env = process.env) {
  return env.PYRUS_FLIGHT_RECORDER_DIR
    ? path.resolve(env.PYRUS_FLIGHT_RECORDER_DIR)
    : path.join(repoRoot, ".pyrus-runtime", "flight-recorder");
}

export function readContainerBoot() {
  const match = readFileSync("/proc/stat", "utf8").match(/^btime\s+(\d+)$/mu);
  if (!match) throw new Error("kernel boot time is unavailable");
  const btime = Number(match[1]);
  return {
    btime,
    bootedAt: new Date(btime * 1_000).toISOString(),
    bootId: `btime:${btime}`,
  };
}

function fsyncDirectory(dirPath) {
  const descriptor = openSync(dirPath, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function quarantineMarker(filePath, observedAt) {
  const quarantine = path.join(
    path.dirname(filePath),
    `${path.basename(filePath, ".json")}.corrupt.${observedAt.replaceAll(/[^0-9A-Za-z]/gu, "_")}.${randomUUID()}.json`,
  );
  try {
    renameSync(filePath, quarantine);
    fsyncDirectory(path.dirname(filePath));
    return quarantine;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function inspectMarker(value, observedMs, expectedBtime = null) {
  const btime = value?.boot?.btime;
  const bootedAtMs = Date.parse(value?.boot?.bootedAt ?? "");
  const updatedAtMs = Date.parse(value?.updatedAt ?? "");
  const coverageStartedAtMs = Date.parse(value?.coverageStartedAt ?? "");
  const baseValid =
    [1, 2].includes(value?.schemaVersion) &&
    Number.isSafeInteger(btime) &&
    btime > 0 &&
    (expectedBtime === null || btime === expectedBtime) &&
    value.boot.bootId === `btime:${btime}` &&
    Number.isFinite(bootedAtMs) &&
    Math.abs(bootedAtMs - btime * 1_000) < 1_000 &&
    Number.isFinite(updatedAtMs) &&
    bootedAtMs <= observedMs + CLOCK_SKEW_MS &&
    updatedAtMs <= observedMs + CLOCK_SKEW_MS;
  if (!baseValid) return { valid: false };
  if (!Number.isFinite(coverageStartedAtMs)) {
    return value.schemaVersion === 1
      ? { valid: true, legacyCoverageGap: true }
      : { valid: false };
  }
  return {
    valid: coverageStartedAtMs <= updatedAtMs + CLOCK_SKEW_MS,
    legacyCoverageGap: false,
  };
}

function readMarker(filePath, observed, expectedBtime = null) {
  const observedAt = observed.toISOString();
  try {
    const value = JSON.parse(readFileSync(filePath, "utf8"));
    const inspection = inspectMarker(value, observed.getTime(), expectedBtime);
    return inspection.valid
      ? {
          value,
          coverageGap: inspection.legacyCoverageGap
            ? "legacy-marker-without-coverage"
            : null,
        }
      : {
          value: null,
          quarantine: quarantineMarker(filePath, observedAt),
        };
  } catch (error) {
    if (error?.code === "ENOENT") return { value: null };
    if (error instanceof SyntaxError) {
      return {
        value: null,
        quarantine: quarantineMarker(filePath, observedAt),
      };
    }
    throw error;
  }
}

function fileSnapshot(filePath) {
  try {
    const { mtimeMs, size } = statSync(filePath);
    return {
      exists: true,
      size,
      mtimeIso: new Date(mtimeMs).toISOString(),
    };
  } catch {
    return { exists: false };
  }
}

function replitSnapshot(env) {
  return {
    env: Object.fromEntries(
      SAFE_REPLIT_ENV.flatMap((name) =>
        Object.hasOwn(env, name) ? [[name, env[name] ?? null]] : [],
      ),
    ),
    runtimeFiles: Object.fromEntries(
      Object.entries(REPLIT_RUNTIME_FILES).map(([name, filePath]) => [
        name,
        fileSnapshot(filePath),
      ]),
    ),
  };
}

function durableAtomicJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  let descriptor;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, filePath);
    fsyncDirectory(path.dirname(filePath));
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
  }
}

function appendDurableJsonLine(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const descriptor = openSync(filePath, "a+", 0o600);
  try {
    const { size } = fstatSync(descriptor);
    const lastByte = Buffer.allocUnsafe(1);
    const needsSeparator =
      size > 0 && readSync(descriptor, lastByte, 0, 1, size - 1) === 1
        ? lastByte[0] !== 0x0a
        : false;
    const payload = Buffer.from(
      `${needsSeparator ? "\n" : ""}${JSON.stringify(value)}\n`,
    );
    let written = 0;
    while (written < payload.length) {
      const chunkSize = writeSync(
        descriptor,
        payload,
        written,
        payload.length - written,
      );
      if (chunkSize <= 0) {
        throw new Error(
          `short write while appending ${path.basename(filePath)}`,
        );
      }
      written += chunkSize;
    }
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  fsyncDirectory(path.dirname(filePath));
}

function bootMarkersDir(recorderDir) {
  return path.join(recorderDir, "boot-markers");
}

function bootMarkerPath(recorderDir, btime) {
  return path.join(bootMarkersDir(recorderDir), `btime-${btime}.json`);
}

function recordedBootTimes(recorderDir) {
  try {
    return readdirSync(bootMarkersDir(recorderDir))
      .flatMap((name) => {
        const match = /^btime-(\d+)\.json$/u.exec(name);
        const btime = match ? Number(match[1]) : Number.NaN;
        return Number.isSafeInteger(btime) && btime > 0 ? [btime] : [];
      })
      .sort((left, right) => left - right);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function newestValidBootMarker(recorderDir, observed) {
  const quarantines = [];
  for (const btime of recordedBootTimes(recorderDir).toReversed()) {
    const source = bootMarkerPath(recorderDir, btime);
    const markerRead = readMarker(source, observed, btime);
    if (markerRead.quarantine) quarantines.push(markerRead.quarantine);
    if (markerRead.value) {
      return { ...markerRead, btime, quarantines, source };
    }
  }
  return { btime: null, quarantines, source: null, value: null };
}

function coverageGapIncident({ observedAt, reason, source }) {
  return {
    schemaVersion: 1,
    incidentId: `recorder-coverage-gap:${reason}:${randomUUID()}`,
    observedAt,
    boundaryAt: observedAt,
    classification: "recorder-coverage-gap",
    confidence: "high",
    severity: "warning",
    message:
      "The supervisor recorder could not prove continuous prior coverage; evidence before this time is incomplete.",
    hostTrigger: "unknown",
    evidence: [reason, `source:${path.basename(source)}`],
  };
}

function incidentAlreadyRecorded(filePath, incidentId) {
  try {
    return readFileSync(filePath, "utf8")
      .split("\n")
      .some((line) => {
        try {
          return JSON.parse(line).incidentId === incidentId;
        } catch {
          return false;
        }
      });
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function managedChildExitClassification(name) {
  if (name === "API") return "api-child-exit";
  if (name === "PYRUS web") return "web-child-exit";
  return "managed-child-exit";
}

export function createBootBoundaryRecorder({
  recorderDir,
  env = process.env,
  now = () => new Date(),
  readBoot = readContainerBoot,
}) {
  const currentPath = path.join(recorderDir, "current.json");
  const incidentsPath = path.join(recorderDir, "incidents.jsonl");

  return {
    recordChildExit({ name, pid, code = null, signal = null, error = null }) {
      const observedAt = now().toISOString();
      const currentBoot = readBoot();
      const classification = managedChildExitClassification(name);
      const childPid = Number.isSafeInteger(pid) && pid > 0 ? pid : null;
      const errorMessage =
        error instanceof Error
          ? error.message
          : typeof error === "string" && error.trim()
            ? error.trim()
            : null;
      const incidentId = [
        classification,
        currentBoot.bootId,
        process.pid,
        childPid ?? String(name || "unknown"),
      ]
        .join(":")
        .replace(/[^a-zA-Z0-9:._-]/gu, "_")
        .slice(0, 160);
      const incident = {
        schemaVersion: 1,
        incidentId,
        observedAt,
        boundaryAt: observedAt,
        classification,
        confidence: "high",
        severity: "warning",
        message: `${name || "Managed child"} exited unexpectedly; the initiating reason is not available to the supervisor.`,
        hostTrigger: "unknown",
        currentBoot,
        supervisor: { pid: process.pid, ppid: process.ppid },
        child: {
          name: String(name || "unknown"),
          pid: childPid,
          code: Number.isInteger(code) ? code : null,
          signal:
            typeof signal === "string" && signal.trim()
              ? signal.trim()
              : null,
          error: errorMessage,
        },
        evidence: [
          `child-name:${String(name || "unknown")}`,
          `child-pid:${childPid ?? "unknown"}`,
          `exit-code:${Number.isInteger(code) ? code : "null"}`,
          `exit-signal:${
            typeof signal === "string" && signal.trim()
              ? signal.trim()
              : "null"
          }`,
          ...(errorMessage ? [`error:${errorMessage}`] : []),
        ],
      };
      if (!incidentAlreadyRecorded(incidentsPath, incidentId)) {
        appendDurableJsonLine(incidentsPath, incident);
      }
      return incident;
    },
    record({ children = [] } = {}) {
      const observed = now();
      const observedAt = observed.toISOString();
      const currentBoot = readBoot();
      const ownMarkerPath = bootMarkerPath(recorderDir, currentBoot.btime);
      const newestMarker = newestValidBootMarker(recorderDir, observed);
      let source = newestMarker.source ?? currentPath;
      let markerRead = newestMarker.value
        ? newestMarker
        : readMarker(currentPath, observed);
      const quarantines = [...newestMarker.quarantines];
      if (markerRead.quarantine) {
        quarantines.push(markerRead.quarantine);
      }
      const previous = markerRead.value;

      let coverageGap = null;
      for (const quarantine of quarantines) {
        const gap = coverageGapIncident({
          observedAt,
          reason: "invalid-supervisor-marker-quarantined",
          source: quarantine,
        });
        appendDurableJsonLine(incidentsPath, gap);
        coverageGap ??= gap;
      }
      if (markerRead.coverageGap) {
        coverageGap = coverageGapIncident({
          observedAt,
          reason: markerRead.coverageGap,
          source,
        });
        appendDurableJsonLine(incidentsPath, coverageGap);
      }
      if (previous?.boot?.btime > currentBoot.btime) {
        return {
          incident: null,
          coverageGap,
          recoveredCorruptMarker: quarantines.length > 0,
          superseded: true,
        };
      }

      let incident = null;
      if (
        previous?.boot?.bootId &&
        previous.boot.bootId !== currentBoot.bootId
      ) {
        const incidentId = `container-replaced:${previous.boot.bootId}:${currentBoot.bootId}`;
        incident = {
          schemaVersion: 1,
          incidentId,
          observedAt,
          boundaryAt: currentBoot.bootedAt,
          classification: "container-replaced",
          confidence: "high",
          severity: "warning",
          message:
            "Replit guest boot identity changed; the host trigger is unavailable inside the guest.",
          hostTrigger: "unknown",
          previousUpdatedAt: previous.updatedAt ?? null,
          previousBoot: previous.boot,
          currentBoot,
          evidence: [
            `previous-boot:${previous.boot.bootId}`,
            `current-boot:${currentBoot.bootId}`,
          ],
        };
        if (!incidentAlreadyRecorded(incidentsPath, incidentId)) {
          appendDurableJsonLine(incidentsPath, incident);
        }
      }

      const previousUpdatedAtMs = Date.parse(previous?.updatedAt ?? "");
      const priorCoverageAtMs = Date.parse(previous?.coverageStartedAt ?? "");
      const continuous =
        !coverageGap &&
        Number.isFinite(previousUpdatedAtMs) &&
        Number.isFinite(priorCoverageAtMs) &&
        observed.getTime() - previousUpdatedAtMs >= -CLOCK_SKEW_MS &&
        observed.getTime() - previousUpdatedAtMs <= RECORDER_CONTINUITY_MS;
      const marker = {
        schemaVersion: 2,
        coverageStartedAt: continuous ? previous.coverageStartedAt : observedAt,
        updatedAt: observedAt,
        boot: currentBoot,
        supervisor: { pid: process.pid, ppid: process.ppid },
        children,
        replit: replitSnapshot(env),
      };
      durableAtomicJson(ownMarkerPath, marker);

      const newestAfterWrite = recordedBootTimes(recorderDir).at(-1);
      if (newestAfterWrite === currentBoot.btime) {
        durableAtomicJson(currentPath, marker);
      }
      return {
        incident,
        coverageGap,
        recoveredCorruptMarker: quarantines.length > 0,
      };
    },
  };
}
