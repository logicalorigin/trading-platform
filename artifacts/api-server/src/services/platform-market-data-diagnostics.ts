import { getBridgeQuoteStreamDiagnostics } from "./bridge-quote-stream";
import { getMarketDataAdmissionDiagnostics } from "./market-data-admission";
import { getStockAggregateStreamDiagnostics } from "./stock-aggregate-stream";

export function getRuntimeMarketDataDiagnostics(input: {
  bridgeQuoteDiagnostics?: ReturnType<typeof getBridgeQuoteStreamDiagnostics> | null;
} = {}) {
  return {
    bridgeQuote:
      input.bridgeQuoteDiagnostics ?? getBridgeQuoteStreamDiagnostics(),
    stockAggregates: getStockAggregateStreamDiagnostics(),
    marketDataAdmission: getMarketDataAdmissionDiagnostics(),
  };
}
