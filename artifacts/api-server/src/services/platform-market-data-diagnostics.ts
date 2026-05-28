import { getBridgeOptionQuoteStreamDiagnostics } from "./bridge-option-quote-stream";
import { getBridgeQuoteStreamDiagnostics } from "./bridge-quote-stream";
import { getMassiveStockQuoteStreamDiagnostics } from "./massive-stock-quote-stream";
import { getMarketDataAdmissionDiagnostics } from "./market-data-admission";
import { getStockAggregateStreamDiagnostics } from "./stock-aggregate-stream";

export function getRuntimeMarketDataDiagnostics(input: {
  bridgeQuoteDiagnostics?: ReturnType<typeof getBridgeQuoteStreamDiagnostics> | null;
} = {}) {
  return {
    bridgeQuote:
      input.bridgeQuoteDiagnostics ?? getBridgeQuoteStreamDiagnostics(),
    massiveStockQuotes: getMassiveStockQuoteStreamDiagnostics(),
    optionQuotes: getBridgeOptionQuoteStreamDiagnostics(),
    stockAggregates: getStockAggregateStreamDiagnostics(),
    marketDataAdmission: getMarketDataAdmissionDiagnostics(),
  };
}
