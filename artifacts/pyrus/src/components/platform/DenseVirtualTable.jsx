import { useCallback, useEffect, useMemo, useRef } from "react";
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
import { reorderColumnOrder } from "./tableColumnInteractions.js";

const defaultGetRowId = (row, index) => String(row?.id ?? index);
const defaultGetCellProps = () => ({});
const defaultGetRowProps = () => ({});
const defaultGetRowDetailProps = () => ({});
const defaultIsRowExpanded = () => false;

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

export function DenseVirtualTable({
  columnOrder,
  columns,
  data,
  emptyState = null,
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
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId,
  });
  const rows = table.getRowModel().rows;
  const gridTemplateColumns = useMemo(
    () => columns.map((column) => column.meta?.width || "minmax(0, 1fr)").join(" "),
    [columns],
  );
  const headerColumnIds = useMemo(
    () => columns.map((column) => column.id).filter(Boolean),
    [columns],
  );
  const lockedColumnSet = useMemo(() => {
    const next = new Set((lockedColumnIds || []).map((columnId) => String(columnId)));
    columns.forEach((column) => {
      if (column.meta?.reorderLocked) next.add(String(column.id));
    });
    return next;
  }, [columns, lockedColumnIds]);
  const reorderable = Boolean(onColumnOrderChange && headerColumnIds.length > 1);
  const sortStateId = sortState?.id ?? sortState?.key ?? null;
  const sortDirection = sortState?.direction ?? sortState?.dir ?? null;
  const handleColumnReorder = useCallback(
    (activeColumnId, overColumnId) => {
      const nextOrder = reorderColumnOrder(
        columnOrder || headerColumnIds,
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
      columnOrder,
      headerColumnIds,
      lockedColumnSet,
      onColumnOrderChange,
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
      style={{
        minWidth,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        ...style,
      }}
    >
      {table.getHeaderGroups().map((headerGroup) => {
        const headerRow = (
          <div
            key={headerGroup.id}
            data-testid="dense-virtual-table-header"
            style={{
              display: "grid",
              gridTemplateColumns,
              flexShrink: 0,
              ...headerStyle,
            }}
          >
            {headerGroup.headers.map((header) => {
              const meta = header.column.columnDef.meta || {};
              const sortKey = meta.sortKey || header.column.id;
              const sortable = Boolean(onSortChange && meta.sortable && sortKey);
              const activeSort = sortable && sortStateId === sortKey;
              const HeaderCell = reorderable ? SortableColumnHeaderCell : ColumnHeaderCell;
              const renderedHeader = header.isPlaceholder
                ? null
                : flexRender(header.column.columnDef.header, header.getContext());

              return (
                <HeaderCell
                  key={header.id}
                  id={header.column.id}
                  active={activeSort}
                  align={meta.align}
                  label={meta.label || header.column.id}
                  onSort={sortable ? () => onSortChange(sortKey, header.column.id) : undefined}
                  reorderable={reorderable && !lockedColumnSet.has(String(header.column.id))}
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

      {rows.length ? (
        <div
          ref={scrollRef}
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
                  style: detailStyle,
                  ...restDetailProps
                } = detailProps;

                return (
                  <div
                    key={virtualItem.key}
                    data-index={virtualRow.index}
                    data-testid={rowDetailTestId}
                    className={mergeClassName(detailClassName)}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`,
                      ...detailStyle,
                    }}
                    {...restDetailProps}
                  >
                    {renderRowDetail(row.original, virtualItem.rowIndex, row)}
                  </div>
                );
              }

              const rowProps = getRowProps(row.original, virtualItem.rowIndex, row) || {};
              const { className, style: rowStyle, ...restRowProps } = rowProps;

              return (
                <div
                  key={virtualItem.key}
                  data-index={virtualRow.index}
                  data-testid={rowTestId}
                  className={mergeClassName(className)}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                    display: "grid",
                    gridTemplateColumns,
                    ...rowStyle,
                  }}
                  {...restRowProps}
                >
                  {row.getVisibleCells().map((cell) => {
                    const cellProps =
                      getCellProps(
                        cell.column.id,
                        row.original,
                        virtualItem.rowIndex,
                        cell,
                      ) || {};
                    const {
                      className: cellClassName,
                      style: cellStyle,
                      ...restCellProps
                    } = cellProps;

                    return (
                      <div
                        key={cell.id}
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
            })}
          </div>
        </div>
      ) : (
        emptyState
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
