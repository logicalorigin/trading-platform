import { Button } from "./primitives.jsx";
import { T, sp, textSize } from "../../lib/uiTokens.jsx";

const normalizePageSize = (pageSize) => {
  const numeric = Math.floor(Number(pageSize));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 25;
};

export const getPageCount = (total, pageSize = 25) => {
  const safeTotal = Math.max(0, Math.floor(Number(total) || 0));
  return Math.max(1, Math.ceil(safeTotal / normalizePageSize(pageSize)));
};

export const clampPageIndex = (page, pageCount) => {
  const safePageCount = Math.max(1, Math.floor(Number(pageCount) || 1));
  const numeric = Math.floor(Number(page) || 0);
  return Math.min(Math.max(0, numeric), safePageCount - 1);
};

export const paginateRows = (rows, page = 0, pageSize = 25) => {
  const safeRows = Array.isArray(rows) ? rows : [];
  const safePageSize = normalizePageSize(pageSize);
  const pageCount = getPageCount(safeRows.length, safePageSize);
  const safePage = clampPageIndex(page, pageCount);
  const startIndex = safePage * safePageSize;
  const endIndex = Math.min(safeRows.length, startIndex + safePageSize);
  return {
    endIndex,
    pageCount,
    pageRows: safeRows.slice(startIndex, endIndex),
    pageSize: safePageSize,
    safePage,
    startIndex,
    total: safeRows.length,
  };
};

export const PaginationFooter = ({
  dataTestId = "table-pagination-footer",
  label = "Rows",
  onPageChange,
  page,
  pageCount,
  pageSize = 25,
  total,
  style,
}) => {
  const safeTotal = Math.max(0, Math.floor(Number(total) || 0));
  const safePageSize = normalizePageSize(pageSize);
  if (safeTotal <= safePageSize) return null;

  const safePageCount = getPageCount(safeTotal, safePageSize);
  const resolvedPage = clampPageIndex(page, pageCount ?? safePageCount);
  const start = resolvedPage * safePageSize + 1;
  const end = Math.min(safeTotal, (resolvedPage + 1) * safePageSize);

  return (
    <div
      data-testid={dataTestId}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: sp(5),
        color: T.textDim,
        fontFamily: T.sans,
        fontSize: textSize("caption"),
        minWidth: 0,
        ...style,
      }}
    >
      <Button
        size="xs"
        variant="ghost"
        disabled={resolvedPage <= 0}
        onClick={() => onPageChange?.(resolvedPage - 1)}
      >
        Previous
      </Button>
      <span>
        {label} {start}-{end} of {safeTotal}
      </span>
      <Button
        size="xs"
        variant="ghost"
        disabled={resolvedPage >= safePageCount - 1}
        onClick={() => onPageChange?.(resolvedPage + 1)}
      >
        Next
      </Button>
    </div>
  );
};
