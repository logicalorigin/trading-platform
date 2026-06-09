import { normalizeSymbol } from "../lib/values";

const DEFAULT_RECENT_ACCOUNT_POSITION_SYMBOL_TTL_MS = 5 * 60_000;

const recentAccountPositionSymbolsByOwner = new Map<
  string,
  {
    symbols: Set<string>;
    expiresAt: number;
  }
>();

function normalizeOwner(owner: string): string {
  return owner.trim() || "account-position";
}

function expireRecentAccountPositionSymbols(now = Date.now()): void {
  recentAccountPositionSymbolsByOwner.forEach((entry, owner) => {
    if (entry.expiresAt <= now) {
      recentAccountPositionSymbolsByOwner.delete(owner);
    }
  });
}

export function recordRecentAccountPositionQuoteSymbols(
  owner: string,
  symbols: string[],
  ttlMs = DEFAULT_RECENT_ACCOUNT_POSITION_SYMBOL_TTL_MS,
): void {
  const normalizedOwner = normalizeOwner(owner);
  const normalizedSymbols = new Set(
    symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean),
  );
  if (!normalizedSymbols.size) {
    recentAccountPositionSymbolsByOwner.delete(normalizedOwner);
    return;
  }

  recentAccountPositionSymbolsByOwner.set(normalizedOwner, {
    symbols: normalizedSymbols,
    expiresAt: Date.now() + Math.max(1_000, ttlMs),
  });
}

export function readRecentAccountPositionQuoteSymbols(): Set<string> {
  expireRecentAccountPositionSymbols();
  const symbols = new Set<string>();
  recentAccountPositionSymbolsByOwner.forEach((entry) => {
    entry.symbols.forEach((symbol) => symbols.add(symbol));
  });
  return symbols;
}

export function __resetRecentAccountPositionQuoteSymbolsForTests(): void {
  recentAccountPositionSymbolsByOwner.clear();
}
