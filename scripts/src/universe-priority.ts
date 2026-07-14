import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  instrumentsTable,
  watchlistItemsTable,
  watchlistsTable,
} from "@workspace/db/schema";
import { normalizeSymbol } from "../../artifacts/api-server/src/lib/values";

type UniversePriorityDb = {
  select: typeof db.select;
};

const UNIVERSE_PRIORITY_SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9./_-]{0,63}$/u;

export function normalizeUniversePrioritySymbol(
  symbol: string | null | undefined,
) {
  const raw = String(symbol ?? "").trim();
  if (!raw) return "";
  if (/[^\x00-\x7f]/u.test(raw)) {
    throw new Error("Invalid universe priority symbol.");
  }
  const normalized = normalizeSymbol(raw);
  if (!UNIVERSE_PRIORITY_SYMBOL_PATTERN.test(normalized)) {
    throw new Error("Invalid universe priority symbol.");
  }
  return normalized;
}

export function uniqueUniversePrioritySymbols(
  symbols: readonly (string | null | undefined)[],
): string[] {
  return [
    ...new Set(
      symbols
        .map((symbol) => normalizeUniversePrioritySymbol(symbol))
        .filter(Boolean),
    ),
  ];
}

export function parseUniversePrioritySymbolList(raw: string | null): string[] {
  if (raw === null) return [];
  const symbols = raw.split(",").map((symbol) => symbol.trim());
  if (symbols.some((symbol) => !symbol)) {
    throw new Error("Symbol list must contain non-empty values.");
  }
  return uniqueUniversePrioritySymbols(symbols);
}

export async function loadWatchlistUniversePrioritySymbols(
  database: UniversePriorityDb = db,
): Promise<string[]> {
  const rows = await database
    .select({
      symbol: instrumentsTable.symbol,
    })
    .from(watchlistItemsTable)
    .innerJoin(
      watchlistsTable,
      eq(watchlistsTable.id, watchlistItemsTable.watchlistId),
    )
    .innerJoin(
      instrumentsTable,
      eq(instrumentsTable.id, watchlistItemsTable.instrumentId),
    )
    .where(
      and(
        eq(instrumentsTable.assetClass, "equity"),
        eq(instrumentsTable.isActive, true),
      ),
    )
    .orderBy(
      desc(watchlistsTable.isDefault),
      asc(watchlistsTable.name),
      asc(watchlistItemsTable.sortOrder),
      asc(instrumentsTable.symbol),
    );

  return uniqueUniversePrioritySymbols(rows.map((row) => row.symbol));
}
