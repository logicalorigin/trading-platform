import type {
  ChartExecution,
  ChartPositionOptionContract,
} from "../charting/chartPositionOverlays";

export type BrokerExecutionOptionContract = ChartPositionOptionContract & {
  ticker: string;
  underlying: string;
  expirationDate: string;
  strike: number;
  right: "call" | "put";
  multiplier: number;
  sharesPerContract: number;
};

export type BrokerExecution = ChartExecution & {
  id: string;
  accountId: string;
  symbol: string;
  assetClass: "equity" | "option";
  side: "buy" | "sell";
  quantity: number;
  price: number;
  executedAt: string;
  exchange: string | null;
  netAmount: number | null;
  orderDescription: string | null;
  contractDescription: string | null;
  providerContractId: string | null;
  optionContract?: BrokerExecutionOptionContract | null;
  orderRef: string | null;
};

export const normalizeBrokerExecutionsPayload: (
  value: unknown,
) => { executions: BrokerExecution[] };

export const listBrokerExecutionsRequest: (
  params?: Record<string, unknown>,
) => Promise<{ executions: BrokerExecution[] }>;
