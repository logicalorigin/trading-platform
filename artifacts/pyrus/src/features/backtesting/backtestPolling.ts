import type { BacktestJobStatus } from "@workspace/api-client-react";

export function shouldPollBacktestRun(
  status: string | null | undefined,
): boolean {
  return status !== "completed" && status !== "failed" && status !== "canceled";
}

export function shouldPollBacktestCollection(
  items: readonly { status: BacktestJobStatus }[] | null | undefined,
): boolean {
  return items == null || items.some((item) => shouldPollBacktestRun(item.status));
}
