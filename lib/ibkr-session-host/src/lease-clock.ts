import { readFileSync } from "node:fs";

const DECIMAL_SECONDS_PATTERN = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,9}))?$/;
const MAX_SIGNED_NANOSECONDS = (1n << 63n) - 1n;

export function parseLinuxBoottimeNs(value: string): bigint {
  const fields = value.trim().split(/\s+/);
  if (fields.length !== 2) throw new Error("invalid Linux uptime clock");
  const match = DECIMAL_SECONDS_PATTERN.exec(fields[0]!);
  if (!match || !DECIMAL_SECONDS_PATTERN.test(fields[1]!)) {
    throw new Error("invalid Linux uptime clock");
  }
  const fraction = (match[2] ?? "").padEnd(9, "0");
  const nanoseconds = BigInt(match[1]!) * 1_000_000_000n + BigInt(fraction || 0);
  if (nanoseconds > MAX_SIGNED_NANOSECONDS) {
    throw new Error("Linux uptime clock overflow");
  }
  return nanoseconds;
}

export function readLinuxBoottimeNs(): bigint {
  return parseLinuxBoottimeNs(readFileSync("/proc/uptime", "utf8"));
}
