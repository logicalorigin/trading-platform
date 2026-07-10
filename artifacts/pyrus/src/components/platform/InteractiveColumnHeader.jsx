import { forwardRef } from "react";
import { ChevronDown } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS, useCombinedRefs } from "@dnd-kit/utilities";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import {
  CSS_COLOR,
  FONT_WEIGHTS,
  T,
  dim,
  sp,
} from "../../lib/uiTokens.jsx";
import { AppTooltip } from "@/components/ui/tooltip";

export const sortDirectionToAria = (direction) =>
  direction === "asc"
    ? "ascending"
    : direction === "desc"
      ? "descending"
      : "none";

const justifyForAlign = (align) =>
  align === "right" ? "flex-end" : align === "center" ? "center" : "flex-start";

export function TableHeaderDndContext({ children, columnIds, onReorder }) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const handleDragEnd = ({ active, over }) => {
    const activeId = String(active?.id || "");
    const overId = String(over?.id || "");
    if (!activeId || !overId || activeId === overId) return;
    onReorder?.(activeId, overId);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={columnIds || []}
        strategy={horizontalListSortingStrategy}
      >
        {children}
      </SortableContext>
    </DndContext>
  );
}

export const ColumnHeaderCell = forwardRef(function ColumnHeaderCell({
  active = false,
  align = "left",
  as: Element = "div",
  children,
  className,
  dragAttributes,
  dragListeners,
  iconSize = 12,
  id,
  label,
  onSort,
  reorderable = false,
  role = "columnheader",
  scope,
  sortDirection = "desc",
  sortable = false,
  sortTitle,
  style,
  testId,
  title,
}, ref) {
  const labelNode = children ?? label;
  const labelText = String(label || id || "column");
  const ariaSort = sortable
    ? sortDirectionToAria(active ? sortDirection : null)
    : undefined;
  const sortColor = active ? CSS_COLOR.text : CSS_COLOR.textMuted;
  const tableCellElement = Element === "th" || Element === "td";
  const sortTooltip = sortTitle || title || `Sort by ${labelText}`;
  // Reordering moved off a dedicated grip button onto the whole header: spread the
  // dnd-kit listeners/attributes onto the header element itself (the sortable node
  // doubles as the drag activator). Strip dnd's button-only attributes so the
  // element keeps role="columnheader" / aria-sort. The 4px PointerSensor activation
  // distance keeps a plain click firing the sort handler while a drag starts a reorder.
  const {
    role: _ignoredDragRole,
    "aria-pressed": _ignoredDragPressed,
    ...dragAttributesRest
  } = dragAttributes || {};
  const reorderHandleProps = reorderable
    ? { ...dragAttributesRest, ...dragListeners }
    : null;
  const content = (
    <>
      <span
        style={{
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {labelNode}
      </span>
      {sortable ? (
        <ChevronDown
          size={iconSize}
          strokeWidth={1.8}
          aria-hidden="true"
          style={{
            color: active ? CSS_COLOR.accent : CSS_COLOR.textMuted,
            flex: "0 0 auto",
            opacity: active ? 1 : 0.58,
            transform:
              active && sortDirection === "asc" ? "rotate(180deg)" : "none",
          }}
        />
      ) : null}
    </>
  );

  return (
    <Element
      ref={ref}
      className={className}
      data-testid={testId}
      role={role}
      scope={scope}
      aria-sort={ariaSort}
      {...reorderHandleProps}
      style={{
        minWidth: 0,
        display: tableCellElement ? undefined : "flex",
        alignItems: tableCellElement ? undefined : "center",
        justifyContent: tableCellElement ? undefined : justifyForAlign(align),
        gap: tableCellElement ? undefined : sp(3),
        overflow: "hidden",
        whiteSpace: "nowrap",
        textAlign: align,
        boxSizing: "border-box",
        cursor: reorderable ? "grab" : undefined,
        touchAction: reorderable ? "none" : undefined,
        ...style,
      }}
    >
      <span
        style={{
          minWidth: 0,
          width: "100%",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: justifyForAlign(align),
          gap: sp(3),
          overflow: "hidden",
        }}
      >
        {sortable ? (
          <AppTooltip content={sortTooltip}>
            <button
              type="button"
              aria-pressed={active}
              aria-label={`${sortTooltip}; ${
                active ? `currently ${ariaSort}` : "not sorted"
              }`}
              onClick={onSort}
              style={{
                minWidth: 0,
                width: "100%",
                height: "100%",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: justifyForAlign(align),
                gap: sp(3),
                border: 0,
                background: "transparent",
                color: sortColor,
                cursor: reorderable ? "grab" : "pointer",
                fontFamily: T.sans,
                fontSize: "inherit",
                fontWeight: active ? FONT_WEIGHTS.medium : FONT_WEIGHTS.regular,
                letterSpacing: "inherit",
                lineHeight: "inherit",
                padding: 0,
                textAlign: align,
                textDecoration: active ? `underline ${CSS_COLOR.accent}` : "none",
                textUnderlineOffset: dim(3),
                textTransform: "inherit",
              }}
            >
              {content}
            </button>
          </AppTooltip>
        ) : (
          <AppTooltip content={title}>
            <span
              style={{
                minWidth: 0,
                width: "100%",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: justifyForAlign(align),
                gap: sp(3),
                color: active ? CSS_COLOR.text : "inherit",
                fontFamily: "inherit",
                fontSize: "inherit",
                overflow: "hidden",
              }}
            >
              {content}
            </span>
          </AppTooltip>
        )}
      </span>
    </Element>
  );
});

export function SortableColumnHeaderCell({
  id,
  reorderable = true,
  style,
  ...props
}) {
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id, disabled: !reorderable });
  const sortableRef = useCombinedRefs(setNodeRef, setActivatorNodeRef);

  return (
    <ColumnHeaderCell
      id={id}
      reorderable={reorderable}
      dragAttributes={attributes}
      dragListeners={listeners}
      style={{
        opacity: isDragging ? 0.72 : 1,
        position: isDragging ? "relative" : undefined,
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 4 : undefined,
        ...style,
      }}
      ref={sortableRef}
      {...props}
    />
  );
}
