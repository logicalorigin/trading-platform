import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ColumnHeaderCell,
  SortableColumnHeaderCell,
  TableHeaderDndContext,
} from "./InteractiveColumnHeader.jsx";
import {
  nextSortDirection,
  normalizeColumnOrder,
  orderColumnsById,
  reorderColumnOrder,
} from "./tableColumnInteractions.js";

const defaultGetRowId = (row, index) => String(row?.id ?? index);
const defaultGetCellProps = () => ({});
const defaultGetRowProps = () => ({});
const defaultGetRowDetailProps = () => ({});
const defaultIsRowExpanded = () => false;
const NESTED_INTERACTIVE_SELECTOR =
  'a,button,input,select,textarea,[contenteditable="true"],[role="button"],[role="link"],[role="menuitem"],[tabindex]:not([tabindex="-1"])';

const mergeClassName = (...values) => values.filter(Boolean).join(" ");

const buildCellStyle = (align) => ({
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  justifyContent:
    align === "right" ? "flex-end" : align === "center" ? "center" : "flex-start",
  overflow: "hidden",
  whiteSpace: "nowrap",
  textAlign: align || "left",
});

const isNestedInteractiveEvent = (event) => {
  const target = event?.target;
  const currentTarget = event?.currentTarget;
  if (!target || !currentTarget || target === currentTarget) return false;
  return Boolean(target.closest?.(NESTED_INTERACTIVE_SELECTOR));
};

/**
 * Shared row-activation contract. Clickable rows become keyboard reachable and
 * activate once on Enter/Space. A route-provided key handler runs first and can
 * prevent the fallback; nested controls retain their own keyboard behavior.
 */
export const buildAccessibleTableRowProps = (
  rowProps = {},
  { rowId, rowIndex = 0 } = {},
) => {
  const next = { ...rowProps };
  const onClick = rowProps.onClick;
  const onKeyDown = rowProps.onKeyDown;
  next.role = rowProps.role || "row";
  next["aria-rowindex"] = rowProps["aria-rowindex"] ?? rowIndex + 2;
  next["data-row-id"] = rowProps["data-row-id"] ?? String(rowId ?? rowIndex);

  if (typeof onClick !== "function") {
    return next;
  }
  next.tabIndex = rowProps.tabIndex ?? 0;
  next.onKeyDown = (event) => {
    onKeyDown?.(event);
    if (
      event.defaultPrevented ||
      (event.key !== "Enter" && event.key !== " ") ||
      isNestedInteractiveEvent(event)
    ) {
      return;
    }
    event.preventDefault();
    onClick(event);
  };
  return next;
};

export const areDenseVirtualRowsEqual = (previous, next) =>
  previous.columnCount === next.columnCount &&
  previous.columns === next.columns &&
  previous.getCellProps === next.getCellProps &&
  previous.getRowProps === next.getRowProps &&
  previous.gridTemplateColumns === next.gridTemplateColumns &&
  previous.row.id === next.row.id &&
  previous.row.original === next.row.original &&
  previous.rowIndex === next.rowIndex &&
  previous.rowTestId === next.rowTestId &&
  previous.size === next.size &&
  previous.start === next.start &&
  previous.virtualIndex === next.virtualIndex;

const DenseVirtualTableDataRow = memo(function DenseVirtualTableDataRow({
  getCellProps,
  getRowProps,
  gridTemplateColumns,
  row,
  rowIndex,
  rowTestId,
  size,
  start,
  virtualIndex,
}) {
  const rowProps = buildAccessibleTableRowProps(
    getRowProps(row.original, rowIndex, row) || {},
    { rowId: row.id, rowIndex },
  );
  const { className, style: rowStyle, ...restRowProps } = rowProps;

  return (
    <div
      data-index={virtualIndex}
      data-testid={rowTestId}
      className={mergeClassName(className)}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: `${size}px`,
        transform: `translateY(${start}px)`,
        display: "grid",
        gridTemplateColumns,
        ...rowStyle,
      }}
      {...restRowProps}
    >
      {row.getVisibleCells().map((cell, cellIndex) => {
        const cellProps =
          getCellProps(cell.column.id, row.original, rowIndex, cell) || {};
        const {
          "aria-colindex": ariaColumnIndex = cellIndex + 1,
          className: cellClassName,
          role: cellRole = "cell",
          style: cellStyle,
          ...restCellProps
        } = cellProps;

        return (
          <div
            key={cell.id}
            role={cellRole}
            aria-colindex={ariaColumnIndex}
            className={mergeClassName(cellClassName)}
            style={{
              ...buildCellStyle(cell.column.columnDef.meta?.align),
              ...cellStyle,
            }}
            {...restCellProps}
          >
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </div>
        );
      })}
    </div>
  );
}, areDenseVirtualRowsEqual);

export function DenseVirtualTable({
  ariaDescribedBy,
  ariaLabel = "Data table",
  columnOrder,
  columns = [],
  dataTestId = "dense-virtual-table",
  data = [],
  emptyState = null,
  emptyStateLabel = "No table rows",
  getCellProps = defaultGetCellProps,
  getRowId = defaultGetRowId,
  getRowDetailProps = defaultGetRowDetailProps,
  getRowProps = defaultGetRowProps,
  headerStyle,
  isRowExpanded = defaultIsRowExpanded,
  lockedColumnIds = [],
  minWidth,
  onColumnOrderChange,
  onSortChange,
  onVisibleRowsChange,
  overscan = 12,
  renderRowDetail = null,
  rowDetailHeight = 320,
  rowDetailTestId,
  rowHeight = 34,
  rowTestId,
  scrollAlign = "center",
  scrollKey,
  scrollToIndex = null,
  sortState = null,
  style,
}) {
  /**
   * Dense table contract:
   * - `columnOrder` is controlled and normalized against the current columns;
   * - headers remain present for empty states and sticky during vertical work;
   * - numeric content inherits tabular figures;
   * - virtualization changes rendering volume, never row/cell semantics;
   * - narrow routes keep decision columns first, then choose an explicit detail
   *   disclosure, an owning horizontal scroller via `minWidth`, or stacked rows.
   */
  const sourceColumnIds = useMemo(
    () =>
      columns
        .map((column) => String(column.id ?? column.accessorKey ?? "").trim())
        .filter(Boolean),
    [columns],
  );
  const resolvedColumnOrder = useMemo(
    () => normalizeColumnOrder(columnOrder, sourceColumnIds, sourceColumnIds),
    [columnOrder, sourceColumnIds],
  );
  const orderedColumns = useMemo(
    () =>
      orderColumnsById(
        columns,
        resolvedColumnOrder,
        (column) => column.id ?? column.accessorKey,
      ),
    [columns, resolvedColumnOrder],
  );
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId,
    state: { columnOrder: resolvedColumnOrder },
  });
  const rows = table.getRowModel().rows;
  const gridTemplateColumns = useMemo(
    () =>
      orderedColumns
        .map((column) => column.meta?.width || "minmax(0, 1fr)")
        .join(" "),
    [orderedColumns],
  );
  const headerColumnIds = resolvedColumnOrder;
  const lockedColumnSet = useMemo(() => {
    const next = new Set(
      (lockedColumnIds || []).map((columnId) => String(columnId)),
    );
    columns.forEach((column) => {
      const columnId = column.id ?? column.accessorKey;
      if (column.meta?.reorderLocked && columnId != null) {
        next.add(String(columnId));
      }
    });
    return next;
  }, [columns, lockedColumnIds]);
  const reorderable = Boolean(
    onColumnOrderChange && headerColumnIds.length > 1,
  );
  const sortStateId = sortState?.id ?? sortState?.key ?? null;
  const sortDirection = sortState?.direction ?? sortState?.dir ?? null;
  const handleColumnReorder = useCallback(
    (activeColumnId, overColumnId) => {
      const nextOrder = reorderColumnOrder(
        resolvedColumnOrder,
        activeColumnId,
        overColumnId,
        {
          fallbackColumnIds: headerColumnIds,
          lockedColumnIds: Array.from(lockedColumnSet),
          validColumnIds: headerColumnIds,
        },
      );
      onColumnOrderChange?.(nextOrder, {
        activeColumnId,
        overColumnId,
      });
    },
    [
      headerColumnIds,
      lockedColumnSet,
      onColumnOrderChange,
      resolvedColumnOrder,
    ],
  );
  const { layoutKey, virtualRows } = useMemo(() => {
    const nextRows = [];
    const detailLayout = [];
    rows.forEach((row, rowIndex) => {
      nextRows.push({
        key: row.id,
        row,
        rowIndex,
        size: rowHeight,
        type: "row",
      });
      if (!renderRowDetail || !isRowExpanded(row.original, rowIndex, row)) {
        return;
      }
      const detailSize =
        typeof rowDetailHeight === "function"
          ? rowDetailHeight(row.original, rowIndex, row)
          : rowDetailHeight;
      const size = Number.isFinite(Number(detailSize))
        ? Math.max(1, Number(detailSize))
        : rowHeight;
      nextRows.push({
        key: `${row.id}:detail`,
        row,
        rowIndex,
        size,
        type: "detail",
      });
      detailLayout.push(`${rowIndex}:${size}`);
    });
    return {
      layoutKey: detailLayout.join("|"),
      virtualRows: nextRows,
    };
  }, [
    isRowExpanded,
    renderRowDetail,
    rowDetailHeight,
    rowHeight,
    rows,
  ]);
  const estimateItemSize = useCallback(
    (index) => virtualRows[index]?.size ?? rowHeight,
    [rowHeight, virtualRows],
  );
  const scrollToVirtualIndex = useMemo(() => {
    if (!Number.isInteger(scrollToIndex) || scrollToIndex < 0) {
      return null;
    }
    const nextIndex = virtualRows.findIndex(
      (item) => item.type === "row" && item.rowIndex === scrollToIndex,
    );
    return nextIndex >= 0 ? nextIndex : null;
  }, [scrollToIndex, virtualRows]);
  const handleVisibleRangeChange = useCallback(
    ({ visibleVirtualItems, virtualItems }) => {
      if (!onVisibleRowsChange) return;
      const seenRowIds = new Set();
      const visibleRows = [];
      (visibleVirtualItems || virtualItems).forEach((virtualRow) => {
        const item = virtualRows[virtualRow.index];
        const original = item?.row?.original;
        if (!original || seenRowIds.has(item.row.id)) {
          return;
        }
        seenRowIds.add(item.row.id);
        visibleRows.push(original);
      });
      onVisibleRowsChange(
        visibleRows,
        { virtualItems },
      );
    },
    [onVisibleRowsChange, virtualRows],
  );
  const {
    scrollRef,
    totalSize,
    virtualItems,
  } = useDenseVirtualRows({
    count: virtualRows.length,
    estimateSize: estimateItemSize,
    layoutKey,
    onVisibleRangeChange: handleVisibleRangeChange,
    overscan,
    rowHeight,
    scrollAlign,
    scrollKey,
    scrollToIndex: scrollToVirtualIndex,
  });

  return (
    <div
      data-testid={dataTestId}
      role="table"
      aria-colcount={orderedColumns.length}
      aria-describedby={ariaDescribedBy}
      aria-label={ariaLabel}
      aria-rowcount={rows.length + 1}
      style={{
        minWidth,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        fontVariantNumeric: "tabular-nums",
        ...style,
      }}
    >
      <div role="rowgroup" data-testid="dense-virtual-table-head">
        {table.getHeaderGroups().map((headerGroup) => {
          const headerRow = (
            <div
              key={headerGroup.id}
              role="row"
              aria-rowindex={1}
              data-testid="dense-virtual-table-header"
              style={{
                position: "sticky",
                top: 0,
                zIndex: 2,
                display: "grid",
                gridTemplateColumns,
                flexShrink: 0,
                ...headerStyle,
              }}
            >
              {headerGroup.headers.map((header) => {
                const meta = header.column.columnDef.meta || {};
                const sortKey = meta.sortKey || header.column.id;
                const sortable = Boolean(
                  onSortChange && meta.sortable && sortKey,
                );
                const activeSort = sortable && sortStateId === sortKey;
                const nextDirection = nextSortDirection(
                  activeSort ? sortDirection : null,
                  meta.initialSortDirection,
                );
                const HeaderCell = reorderable
                  ? SortableColumnHeaderCell
                  : ColumnHeaderCell;
                const renderedHeader = header.isPlaceholder
                  ? null
                  : flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    );

                return (
                  <HeaderCell
                    key={header.id}
                    id={header.column.id}
                    active={activeSort}
                    align={meta.align}
                    label={meta.label || header.column.id}
                    onSort={
                      sortable
                        ? () =>
                            onSortChange(sortKey, header.column.id, {
                              direction: nextDirection,
                              previousDirection: activeSort
                                ? sortDirection
                                : null,
                            })
                        : undefined
                    }
                    reorderable={
                      reorderable &&
                      !lockedColumnSet.has(String(header.column.id))
                    }
                    sortDirection={activeSort ? sortDirection : null}
                    sortable={sortable}
                    sortTitle={meta.sortTitle}
                    style={buildCellStyle(meta.align)}
                    testId={meta.headerTestId}
                    title={meta.title}
                  >
                    {renderedHeader}
                  </HeaderCell>
                );
              })}
            </div>
          );

          if (!reorderable) return headerRow;
          return (
            <TableHeaderDndContext
              key={headerGroup.id}
              columnIds={headerColumnIds}
              onReorder={handleColumnReorder}
            >
              {headerRow}
            </TableHeaderDndContext>
          );
        })}
      </div>

      {rows.length ? (
        <div
          ref={scrollRef}
          role="rowgroup"
          data-testid="dense-virtual-table-scroll"
          style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden" }}
        >
          <div
            style={{
              height: `${totalSize}px`,
              minWidth,
              position: "relative",
            }}
          >
            {virtualItems.map((virtualRow) => {
              const virtualItem = virtualRows[virtualRow.index];
              if (!virtualItem) return null;
              const row = virtualItem.row;

              if (virtualItem.type === "detail") {
                const detailProps =
                  getRowDetailProps(row.original, virtualItem.rowIndex, row) || {};
                const {
                  className: detailClassName,
                  role: detailContentRole,
                  style: detailStyle,
                  ...restDetailProps
                } = detailProps;

                return (
                  <div
                    key={virtualItem.key}
                    role="row"
                    data-index={virtualRow.index}
                    data-testid={rowDetailTestId}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    <div
                      role="cell"
                      aria-colspan={Math.max(1, orderedColumns.length)}
                      style={{ width: "100%", height: "100%" }}
                    >
                      <div
                        role={detailContentRole}
                        className={mergeClassName(detailClassName)}
                        style={{
                          width: "100%",
                          height: "100%",
                          ...detailStyle,
                        }}
                        {...restDetailProps}
                      >
                        {renderRowDetail(
                          row.original,
                          virtualItem.rowIndex,
                          row,
                        )}
                      </div>
                    </div>
                  </div>
                );
              }

              return (
                <DenseVirtualTableDataRow
                  key={virtualItem.key}
                  columnCount={orderedColumns.length}
                  columns={orderedColumns}
                  getCellProps={getCellProps}
                  getRowProps={getRowProps}
                  gridTemplateColumns={gridTemplateColumns}
                  row={row}
                  rowIndex={virtualItem.rowIndex}
                  rowTestId={rowTestId}
                  size={virtualRow.size}
                  start={virtualRow.start}
                  virtualIndex={virtualRow.index}
                />
              );
            })}
          </div>
        </div>
      ) : (
        <div
          role="rowgroup"
          data-testid="dense-virtual-table-state"
          style={{ flex: 1, minHeight: 0, display: "flex" }}
        >
          <div
            role="row"
            aria-rowindex={2}
            style={{ minWidth, width: "100%", display: "flex" }}
          >
            <div
              role="cell"
              aria-colspan={Math.max(1, orderedColumns.length)}
              aria-label={emptyStateLabel}
              style={{ width: "100%", minWidth: 0 }}
            >
              {emptyState}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function useDenseVirtualRows({
  count,
  estimateSize,
  layoutKey,
  onVisibleRangeChange,
  overscan = 12,
  rowHeight = 34,
  scrollAlign = "center",
  scrollKey,
  scrollToIndex = null,
}) {
  const scrollRef = useRef(null);
  const lastScrollRequestRef = useRef(null);
  // Hold the (frequently re-created) estimateSize callback in a ref so this
  // callback's identity stays stable. Otherwise it changes on every render
  // (estimateSize depends on virtualRows -> rows, which is a fresh array each
  // live tick), which made the measure() effect below re-run on every render
  // and every scroll frame — forcing a full virtualizer re-measure (jank).
  const estimateSizeRef = useRef(estimateSize);
  estimateSizeRef.current = estimateSize;
  const estimateItemSize = useCallback(
    (index) => estimateSizeRef.current?.(index) ?? rowHeight,
    [rowHeight],
  );
  const rowVirtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: estimateItemSize,
    overscan,
  });

  useEffect(() => {
    rowVirtualizer.measure();
  }, [count, estimateItemSize, layoutKey, rowVirtualizer]);

  const virtualItems = rowVirtualizer.getVirtualItems();
  const virtualItemSignature = virtualItems
    .map((virtualRow) => `${virtualRow.index}:${virtualRow.start}:${virtualRow.size}`)
    .join("|");

  useEffect(() => {
    if (!onVisibleRangeChange) return;
    const scrollElement = scrollRef.current;
    const viewportStart = Math.max(0, (scrollElement?.scrollTop ?? 0) - rowHeight);
    const viewportEnd =
      (scrollElement?.scrollTop ?? 0) +
      (scrollElement?.clientHeight || Number.POSITIVE_INFINITY) +
      rowHeight;
    const visibleVirtualItems = virtualItems.filter((virtualItem) => {
      const itemStart = virtualItem.start ?? 0;
      const itemEnd =
        virtualItem.end ?? itemStart + (virtualItem.size ?? rowHeight);
      return itemEnd > viewportStart && itemStart < viewportEnd;
    });
    onVisibleRangeChange({
      endIndex: virtualItems.length
        ? virtualItems[virtualItems.length - 1].index + 1
        : 0,
      startIndex: virtualItems[0]?.index ?? 0,
      visibleVirtualItems,
      virtualItems,
    });
  }, [onVisibleRangeChange, rowHeight, virtualItemSignature]);

  useEffect(() => {
    if (
      !Number.isInteger(scrollToIndex) ||
      scrollToIndex < 0 ||
      scrollToIndex >= count
    ) {
      return;
    }
    const requestSignature = [
      scrollKey ?? "",
      scrollToIndex,
      scrollAlign,
      count,
    ].join(":");
    if (lastScrollRequestRef.current === requestSignature) {
      return;
    }
    lastScrollRequestRef.current = requestSignature;
    rowVirtualizer.scrollToIndex(scrollToIndex, { align: scrollAlign });
  }, [count, rowVirtualizer, scrollAlign, scrollKey, scrollToIndex]);

  return {
    scrollRef,
    totalSize: rowVirtualizer.getTotalSize(),
    virtualItems,
    virtualizer: rowVirtualizer,
  };
}
