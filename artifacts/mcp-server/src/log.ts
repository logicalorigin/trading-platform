type Level = "info" | "warn" | "error";

function emit(level: Level, message: string, detail?: unknown): void {
  let line = `[pyrus-mcp] ${new Date().toISOString()} ${level} ${message}`;
  if (detail !== undefined) {
    let extra: string;
    try {
      extra = typeof detail === "string" ? detail : JSON.stringify(detail);
    } catch {
      extra = String(detail);
    }
    line += ` ${extra}`;
  }
  // Important: stdout is the MCP JSON-RPC wire. All diagnostics go to stderr.
  process.stderr.write(`${line}\n`);
}

export const log = {
  info: (message: string, detail?: unknown): void => emit("info", message, detail),
  warn: (message: string, detail?: unknown): void => emit("warn", message, detail),
  error: (message: string, detail?: unknown): void => emit("error", message, detail),
};

export function reportStartupReady(
  httpToolCount: number,
  hostToolCount: number,
): void {
  log.info(
    `ready (stdio) — ${httpToolCount} http + 1 db + ${hostToolCount} host tools`,
  );
}

export function reportStartupFailure(_error: unknown): void {
  log.error("fatal MCP startup failure");
}
