import type {
  ChartExecution,
  ChartPositionOptionContract,
} from "../charting/chartPositionOverlays";

export type BrokerExecution = ChartExecution & {
  exchange?: string | null;
  netAmount?: number | string | null;
  contractDescription?: string | null;
  optionContract?: ChartPositionOptionContract | null;
};

export const listBrokerExecutionsRequest: (
  params?: Record<string, unknown>,
) => Promise<{ executions: BrokerExecution[] }>;
