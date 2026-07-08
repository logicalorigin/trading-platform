export function readEnvString(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  key: string,
): string {
  return env[key]?.trim() ?? "";
}

export function truthyEnv(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

export function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function readPositiveIntegerEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// Deliberately distinct from readPositiveIntegerEnv: Number() accepts forms
// parseInt reads differently ("1e3" -> 1000 vs 1, "12px" -> NaN vs 12), and
// blank/whitespace values fall back instead of parsing as 0.
export function readFlooredPositiveNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw?.trim()) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}
