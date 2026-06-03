const toStringId = (value) => String(value ?? "").trim();

export const normalizeColumnOrder = (value, validColumnIds, fallbackColumnIds = validColumnIds) => {
  const validIds = new Set((validColumnIds || []).map(toStringId).filter(Boolean));
  const fallbackIds = (fallbackColumnIds || validColumnIds || [])
    .map(toStringId)
    .filter((columnId) => columnId && validIds.has(columnId));
  const requested = Array.isArray(value) ? value : [];
  const seen = new Set();
  const ordered = [];

  requested.forEach((columnId) => {
    const normalizedId = toStringId(columnId);
    if (!normalizedId || !validIds.has(normalizedId) || seen.has(normalizedId)) {
      return;
    }
    seen.add(normalizedId);
    ordered.push(normalizedId);
  });

  fallbackIds.forEach((columnId) => {
    if (seen.has(columnId)) return;
    seen.add(columnId);
    ordered.push(columnId);
  });

  return ordered;
};

export const reorderColumnOrder = (
  value,
  activeColumnId,
  overColumnId,
  {
    fallbackColumnIds,
    lockedColumnIds = [],
    validColumnIds,
  } = {},
) => {
  const activeId = toStringId(activeColumnId);
  const overId = toStringId(overColumnId);
  const lockedIds = new Set((lockedColumnIds || []).map(toStringId).filter(Boolean));
  if (!activeId || !overId || activeId === overId) {
    return normalizeColumnOrder(value, validColumnIds || value, fallbackColumnIds);
  }
  if (lockedIds.has(activeId) || lockedIds.has(overId)) {
    return normalizeColumnOrder(value, validColumnIds || value, fallbackColumnIds);
  }

  const normalized = normalizeColumnOrder(value, validColumnIds || value, fallbackColumnIds);
  const activeIndex = normalized.indexOf(activeId);
  const overIndex = normalized.indexOf(overId);
  if (activeIndex < 0 || overIndex < 0) return normalized;

  const next = [...normalized];
  const [moved] = next.splice(activeIndex, 1);
  next.splice(overIndex, 0, moved);
  return next;
};

export const orderColumnsById = (columns, columnOrder, getColumnId = (column) => column?.id) => {
  const sourceColumns = Array.isArray(columns) ? columns : [];
  const byId = new Map(
    sourceColumns
      .map((column) => [toStringId(getColumnId(column)), column])
      .filter(([columnId]) => Boolean(columnId)),
  );
  const normalizedOrder = normalizeColumnOrder(
    columnOrder,
    Array.from(byId.keys()),
    sourceColumns.map(getColumnId),
  );
  return normalizedOrder.map((columnId) => byId.get(columnId)).filter(Boolean);
};
