import { Button } from "../ui/Button.jsx";
import { CSS_COLOR, sp, T, textSize } from "../../lib/uiTokens.jsx";

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

export const getPaginationState = (total, pageSize = 25, page = 0) => {
  const safeTotal = Math.max(0, Math.floor(Number(total) || 0));
  const safePageSize = normalizePageSize(pageSize);
  const pageCount = getPageCount(safeTotal, safePageSize);
  const safePage = clampPageIndex(page, pageCount);
  return {
    canNext: safePage < pageCount - 1,
    canPrevious: safePage > 0,
    end: Math.min(safeTotal, (safePage + 1) * safePageSize),
    pageCount,
    pageSize: safePageSize,
    safePage,
    start: safeTotal ? safePage * safePageSize + 1 : 0,
    total: safeTotal,
  };
};

export const paginateRows = (rows, page = 0, pageSize = 25) => {
  const safeRows = Array.isArray(rows) ? rows : [];
  const pagination = getPaginationState(safeRows.length, pageSize, page);
  const startIndex = pagination.safePage * pagination.pageSize;
  const endIndex = pagination.end;
  return {
    endIndex,
    pageCount: pagination.pageCount,
    pageRows: safeRows.slice(startIndex, endIndex),
    pageSize: pagination.pageSize,
    safePage: pagination.safePage,
    startIndex,
    total: safeRows.length,
  };
};

export const PaginationFooter = ({
  dataTestId = "table-pagination-footer",
  label = "Rows",
  onPageChange,
  page,
  pageSize = 25,
  total,
  style,
}) => {
  const pagination = getPaginationState(total, pageSize, page);
  if (pagination.total <= pagination.pageSize) return null;

  return (
    <div
      data-testid={dataTestId}
      role="navigation"
      aria-label={`${label} pagination`}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: sp(5),
        color: CSS_COLOR.textDim,
        fontFamily: T.sans,
        fontSize: textSize("caption"),
        minWidth: 0,
        ...style,
      }}
    >
      <Button
        size="xs"
        variant="ghost"
        aria-label={`Previous ${label} page`}
        disabled={!pagination.canPrevious}
        onClick={() => onPageChange?.(pagination.safePage - 1)}
      >
        Previous
      </Button>
      <span aria-live="polite" aria-atomic="true">
        {label} {pagination.start}-{pagination.end} of {pagination.total}
      </span>
      <Button
        size="xs"
        variant="ghost"
        aria-label={`Next ${label} page`}
        disabled={!pagination.canNext}
        onClick={() => onPageChange?.(pagination.safePage + 1)}
      >
        Next
      </Button>
    </div>
  );
};
