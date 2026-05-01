export function readPositiveIntegerEnv(
  name: string,
  fallback: number,
): number {
  const raw = process.env[name];
  if (!raw || !raw.trim()) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function limitValuesByBudget<T>(
  values: T[],
  max: number,
): { kept: T[]; dropped: T[] } {
  const normalizedMax = Math.max(0, Math.floor(max));

  if (normalizedMax === 0) {
    return { kept: values, dropped: [] };
  }

  if (values.length <= normalizedMax) {
    return { kept: values, dropped: [] };
  }

  return {
    kept: values.slice(0, normalizedMax),
    dropped: values.slice(normalizedMax),
  };
}
