export const resolveOptionChainScrollIndex = (
  chain,
  selectedStrike,
  atmStrike,
) => {
  if (!Array.isArray(chain) || !chain.length) return -1;
  const selectedIndex = chain.findIndex((row) => row?.k === selectedStrike);
  if (selectedIndex >= 0) return selectedIndex;

  const atmIndex = chain.findIndex((row) =>
    Number.isFinite(atmStrike) ? row?.k === atmStrike : row?.isAtm,
  );
  return atmIndex >= 0 ? atmIndex : -1;
};

export const buildOptionChainVirtualEntries = (chain, virtualItems) => {
  if (!Array.isArray(chain) || !Array.isArray(virtualItems)) return [];
  return virtualItems
    .map((virtualItem) => {
      const row = chain[virtualItem.index];
      return row ? { index: virtualItem.index, row, virtualItem } : null;
    })
    .filter(Boolean);
};

export const mergeVisibleOptionChainRows = (visibleRows, selectedRow) => {
  const rows = Array.isArray(visibleRows) ? [...visibleRows] : [];
  if (
    selectedRow &&
    selectedRow.k != null &&
    !rows.some((row) => row?.k === selectedRow.k)
  ) {
    rows.push(selectedRow);
  }
  return rows;
};

export const buildOptionChainRowsIdentitySignature = (rows = []) =>
  (Array.isArray(rows) ? rows : [])
    .map((row) => {
      if (row?.k == null) return null;
      return [
        row.k,
        row.cContract?.providerContractId || "",
        row.pContract?.providerContractId || "",
      ].join(":");
    })
    .filter(Boolean)
    .join("|");
