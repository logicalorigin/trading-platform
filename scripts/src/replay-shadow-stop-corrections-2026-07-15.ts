import {
  resolveSignalOptionsExecutionProfile,
  type SignalOptionsExecutionProfile,
} from "@workspace/backtest-core";
import { pool } from "@workspace/db";
import {
  computeSignalOptionsOvernightPositionExit,
  computeSignalOptionsPositionStop,
  type SignalOptionsEntryQuality,
} from "../../artifacts/api-server/src/services/signal-options-exit-policy";

const ENTRY_EVENT_IDS = [
  "874fbc9f-ccd0-4951-a2c8-950cfbe6af08",
  "e37f718b-75f5-4719-9f87-b57b4b9ec13c",
  "291b68ac-30c0-40f7-9d99-43489c73e834",
  "26fff6c3-fb60-4215-a93c-f197ec02460e",
] as const;
const CLOSE_AT = new Date("2026-07-15T20:00:00.000Z");
const OVERNIGHT_WINDOW_AT = new Date("2026-07-15T19:45:00.000Z");

type RecordValue = Record<string, unknown>;
type Quote = { at: Date; bid: number; ask: number; mid: number };

function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
}

function number(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid number: ${String(value)}`);
  return parsed;
}

function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Invalid text: ${String(value)}`);
  }
  return value.trim();
}

function quoteTimestamp(value: RecordValue): Date | null {
  const raw = value.sip_timestamp ?? value.participant_timestamp;
  if (typeof raw !== "number" && typeof raw !== "string") return null;
  const numeric = BigInt(raw);
  const millis = Number(numeric / 1_000_000n);
  const result = new Date(millis);
  return Number.isFinite(result.getTime()) ? result : null;
}

function parseQuote(value: unknown): Quote | null {
  const row = record(value);
  const at = quoteTimestamp(row);
  const bid = Number(row.bid_price ?? row.bid);
  const ask = Number(row.ask_price ?? row.ask);
  if (!at || !(bid > 0) || !(ask >= bid)) return null;
  return { at, bid, ask, mid: (bid + ask) / 2 };
}

async function fetchQuotes(ticker: string, from: Date): Promise<Quote[]> {
  const apiKey = process.env.MASSIVE_API_KEY ?? process.env.MASSIVE_MARKET_DATA_API_KEY;
  if (!apiKey) throw new Error("Missing Massive API key.");
  const url = new URL(`https://api.massive.com/v3/quotes/${encodeURIComponent(ticker)}`);
  url.searchParams.set("timestamp.gte", String(BigInt(from.getTime()) * 1_000_000n));
  url.searchParams.set("timestamp.lte", String(BigInt(CLOSE_AT.getTime()) * 1_000_000n));
  url.searchParams.set("order", "asc");
  url.searchParams.set("sort", "timestamp");
  url.searchParams.set("limit", "50000");
  url.searchParams.set("apiKey", apiKey);
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Massive quotes failed: HTTP ${response.status}`);
  const body = record(await response.json());
  return (Array.isArray(body.results) ? body.results : [])
    .flatMap((value) => {
      const quote = parseQuote(value);
      return quote ? [quote] : [];
    })
    .sort((left, right) => left.at.getTime() - right.at.getTime());
}

function sellFill(quote: Quote, stopFloor?: number | null) {
  const gapFraction = (quote.mid - quote.bid) / quote.mid;
  const executable = gapFraction > 0.4
    ? quote.mid
    : quote.mid - (quote.mid - quote.bid) * 0.9;
  return Number(Math.max(executable, stopFloor ?? 0).toFixed(2));
}

async function main() {
  const result = await pool.query<{
    id: string;
    symbol: string;
    occurred_at: Date;
    payload: RecordValue;
  }>(
    `select id::text, symbol, occurred_at, payload
       from execution_events
      where id = any($1::uuid[])
      order by occurred_at`,
    [ENTRY_EVENT_IDS],
  );
  if (result.rowCount !== ENTRY_EVENT_IDS.length) {
    throw new Error(`Expected ${ENTRY_EVENT_IDS.length} entries, found ${result.rowCount}.`);
  }

  const output = [];
  for (const row of result.rows) {
    const payload = record(row.payload);
    const position = record(payload.position);
    const contract = record(payload.selectedContract);
    const profile = resolveSignalOptionsExecutionProfile(
      record(payload.profile),
    ) as SignalOptionsExecutionProfile;
    const entryPrice = number(position.entryPrice);
    const quantity = number(position.quantity);
    const ticker = text(contract.ticker);
    const signalQuality = record(position.signalQuality) as SignalOptionsEntryQuality;
    const quotes = await fetchQuotes(ticker, row.occurred_at);
    let peakPrice = entryPrice;
    let corrected: RecordValue | null = null;
    for (const quote of quotes) {
      peakPrice = Math.max(peakPrice, quote.mid);
      const stop = computeSignalOptionsPositionStop({
        entryPrice,
        peakPrice,
        markPrice: quote.mid,
        profile,
        quantity,
        signalQuality,
        scaleOutAlreadyFired: false,
        wireTrailEnforceEnabled: false,
      });
      const overnight = quote.at >= OVERNIGHT_WINDOW_AT
        ? computeSignalOptionsOvernightPositionExit({
            entryPrice,
            peakPrice,
            markPrice: quote.mid,
            profile,
            signalQuality,
          })
        : null;
      const reason = stop.exitReason ?? overnight?.exitReason ?? null;
      if (!reason) continue;
      const stopFloor = reason === "hard_stop" || reason === "runner_trail_stop"
        ? stop.stopPrice
        : null;
      const exitPrice = sellFill(quote, stopFloor);
      corrected = {
        reason,
        occurredAt: quote.at.toISOString(),
        entryPrice,
        exitPrice,
        quantity,
        grossPnl: Number(((exitPrice - entryPrice) * quantity * 100).toFixed(2)),
        peakPrice: Number(peakPrice.toFixed(6)),
        markPrice: Number(quote.mid.toFixed(6)),
        bid: quote.bid,
        ask: quote.ask,
        stop,
        overnight,
      };
      break;
    }
    output.push({
      entryEventId: row.id,
      symbol: row.symbol,
      ticker,
      quoteCount: quotes.length,
      corrected,
    });
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

void main().finally(() => pool.end());
