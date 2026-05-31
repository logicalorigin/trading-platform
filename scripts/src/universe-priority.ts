import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  instrumentsTable,
  watchlistItemsTable,
  watchlistsTable,
} from "@workspace/db/schema";

type UniversePriorityDb = {
  select: typeof db.select;
};

export function normalizeUniversePrioritySymbol(
  symbol: string | null | undefined,
) {
  return String(symbol ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9./_-]/g, "");
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
  if (!raw) return [];
  return uniqueUniversePrioritySymbols(
    raw
      .split(",")
      .map((symbol) => symbol.trim())
      .filter(Boolean),
  );
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
