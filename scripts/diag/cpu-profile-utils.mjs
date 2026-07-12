export function parseCpuProfilerArgs(argv) {
  const pid = Number(argv[0]);
  const durationMs = Number(argv[1] ?? 15_000);
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error("pid must be a positive safe integer");
  }
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
    throw new Error("durationMs must be a positive safe integer");
  }
  return { pid, durationMs, outPath: argv[2] ?? null };
}

export function readInspectorProcessId(evaluation) {
  const pid = evaluation?.result?.value;
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

export function summarizeCpuProfile(profile) {
  const samples = profile?.samples;
  const timeDeltas = profile?.timeDeltas;
  if (
    !Array.isArray(samples) ||
    !Array.isArray(timeDeltas) ||
    samples.length !== timeDeltas.length
  ) {
    throw new Error("CPU profile requires aligned samples and timeDeltas");
  }

  const nodesById = new Map((profile.nodes ?? []).map((node) => [node.id, node]));
  const durationByFrame = new Map();
  let totalDurationUs = 0;
  let idleDurationUs = 0;

  for (let index = 0; index < samples.length; index += 1) {
    const durationUs = Number(timeDeltas[index]);
    if (!Number.isFinite(durationUs) || durationUs < 0) {
      throw new Error(`CPU profile has invalid timeDelta at index ${index}`);
    }
    const node = nodesById.get(samples[index]);
    const functionName = node?.callFrame?.functionName || "(anonymous)";
    totalDurationUs += durationUs;
    if (functionName === "(idle)" || functionName === "(program)") {
      idleDurationUs += durationUs;
      continue;
    }
    const frame = formatCallFrame(node?.callFrame);
    durationByFrame.set(frame, (durationByFrame.get(frame) ?? 0) + durationUs);
  }

  const busyDurationUs = totalDurationUs - idleDurationUs;
  const rows = [...durationByFrame.entries()]
    .map(([frame, durationUs]) => ({
      frame,
      durationUs,
      percent: busyDurationUs > 0 ? (durationUs / busyDurationUs) * 100 : 0,
    }))
    .sort((left, right) => right.durationUs - left.durationUs);

  return {
    totalSamples: samples.length,
    totalDurationUs,
    idleDurationUs,
    busyDurationUs,
    busyPercent:
      totalDurationUs > 0 ? (busyDurationUs / totalDurationUs) * 100 : 0,
    rows,
  };
}

export function parseCpuProfileSummaryOutput(stdout) {
  const header = stdout.match(
    /total samples=(\d+) idle=(\d+) busy=(\d+) \(busy%=([\d.]+)\)/,
  );
  const rows = [];
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.match(/^\s*([\d.]+)%\s+(\d+)\s+(.+)$/);
    if (!match) continue;
    rows.push({
      percent: Number(match[1]),
      durationUs: Number(match[2]),
      frame: match[3].trim(),
    });
  }
  const gcPercent = rows
    .filter((row) => /garbage collector/i.test(row.frame))
    .reduce((sum, row) => sum + row.percent, 0);
  return {
    totalSamples: header ? Number(header[1]) : null,
    idleDurationUs: header ? Number(header[2]) : null,
    busyDurationUs: header ? Number(header[3]) : null,
    busyPercent: header ? Number(header[4]) : null,
    gcPercent,
    rows,
  };
}

function formatCallFrame(callFrame) {
  const functionName = callFrame?.functionName || "(anonymous)";
  const file = String(callFrame?.url ?? "").split("/").at(-1) ?? "";
  const line = Number(callFrame?.lineNumber ?? -1) + 1;
  return `${functionName} ${file}:${Math.max(0, line)}`;
}
