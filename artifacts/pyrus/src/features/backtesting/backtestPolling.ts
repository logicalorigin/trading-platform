import type { BacktestJobStatus } from "@workspace/api-client-react";

export function shouldPollBacktestRun(
  status: BacktestJobStatus | null | undefined,
): boolean {
  return status !== "completed" && status !== "failed" && status !== "canceled";
}
