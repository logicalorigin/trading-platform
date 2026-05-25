import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";

const defaultGetRowId = (row, index) => String(row?.id ?? index);
const defaultGetCellProps = () => ({});
const defaultGetRowProps = () => ({});

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
  columns,
  data,
  emptyState = null,
  getCellProps = defaultGetCellProps,
  getRowId = defaultGetRowId,
  getRowProps = defaultGetRowProps,
  headerStyle,
  minWidth,
  onVisibleRowsChange,
  overscan = 12,
  rowHeight = 34,
  rowTestId,
  scrollAlign = "center",
  scrollKey,
  scrollToIndex = null,
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
  const handleVisibleRangeChange = useCallback(
    ({ virtualItems }) => {
      if (!onVisibleRowsChange) return;
      onVisibleRowsChange(
        virtualItems
          .map((virtualRow) => rows[virtualRow.index]?.original)
          .filter(Boolean),
        { virtualItems },
      );
    },
    [onVisibleRowsChange, rows],
  );
  const {
    scrollRef,
    totalSize,
    virtualItems,
  } = useDenseVirtualRows({
    count: rows.length,
    onVisibleRangeChange: handleVisibleRangeChange,
    overscan,
    rowHeight,
    scrollAlign,
    scrollKey,
    scrollToIndex,
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
      {table.getHeaderGroups().map((headerGroup) => (
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
          {headerGroup.headers.map((header) => (
            <div
              key={header.id}
              style={buildCellStyle(header.column.columnDef.meta?.align)}
            >
              {header.isPlaceholder
                ? null
                : flexRender(header.column.columnDef.header, header.getContext())}
            </div>
          ))}
        </div>
      ))}

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
              const row = rows[virtualRow.index];
              const rowProps = getRowProps(row.original, virtualRow.index, row) || {};
              const { className, style: rowStyle, ...restRowProps } = rowProps;

              return (
                <div
                  key={row.id}
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
                      getCellProps(cell.column.id, row.original, virtualRow.index, cell) || {};
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
  onVisibleRangeChange,
  overscan = 12,
  rowHeight = 34,
  scrollAlign = "center",
  scrollKey,
  scrollToIndex = null,
}) {
  const scrollRef = useRef(null);
  const lastScrollRequestRef = useRef(null);
  const rowVirtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan,
  });
  const virtualItems = rowVirtualizer.getVirtualItems();
  const virtualItemSignature = virtualItems
    .map((virtualRow) => `${virtualRow.index}:${virtualRow.start}:${virtualRow.size}`)
    .join("|");

  useEffect(() => {
    if (!onVisibleRangeChange) return;
    onVisibleRangeChange({
      endIndex: virtualItems.length
        ? virtualItems[virtualItems.length - 1].index + 1
        : 0,
      startIndex: virtualItems[0]?.index ?? 0,
      virtualItems,
    });
  }, [onVisibleRangeChange, virtualItemSignature]);

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
