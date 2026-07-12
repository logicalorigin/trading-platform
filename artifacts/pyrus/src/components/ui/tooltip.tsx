import * as React from "react"
import { createPortal } from "react-dom"

import { cn } from "@/lib/utils"

type AppTooltipProps = {
  content?: React.ReactNode
  children: React.ReactNode
  disabled?: boolean
  side?: "top" | "right" | "bottom" | "left"
  align?: "start" | "center" | "end"
  sideOffset?: number
  className?: string
  contentClassName?: string
}

type DisabledDomButton = React.ReactElement<{
  disabled?: boolean
  style?: React.CSSProperties
  children?: React.ReactNode
}>

const findDisabledDomButton = (
  children: React.ReactNode,
): DisabledDomButton | null => {
  for (const child of React.Children.toArray(children)) {
    if (!React.isValidElement<DisabledDomButton["props"]>(child)) continue
    if (child.type === "button" && child.props.disabled) return child
    const nestedButton = findDisabledDomButton(child.props.children)
    if (nestedButton) return nestedButton
  }
  return null
}

const disabledTriggerLayoutStyle = (
  children: React.ReactElement<{ style?: React.CSSProperties }>,
): React.CSSProperties | undefined => {
  const style = children.props.style
  if (!style) return undefined
  const layoutStyle = {
    alignSelf: style.alignSelf,
    flex: style.flex,
    flexBasis: style.flexBasis,
    flexGrow: style.flexGrow,
    flexShrink: style.flexShrink,
    gridColumn: style.gridColumn,
    gridRow: style.gridRow,
    justifySelf: style.justifySelf,
    maxWidth: style.maxWidth,
    minHeight: style.minHeight,
    minWidth: style.minWidth,
    width: style.width,
  } satisfies React.CSSProperties

  return Object.values(layoutStyle).some((value) => value != null)
    ? layoutStyle
    : undefined
}

type TooltipDomTriggerProps = {
  "aria-describedby"?: string
  onBlur?: React.FocusEventHandler<HTMLElement>
  onFocus?: React.FocusEventHandler<HTMLElement>
  onKeyDown?: React.KeyboardEventHandler<HTMLElement>
  onPointerDown?: React.PointerEventHandler<HTMLElement>
  onPointerEnter?: React.PointerEventHandler<HTMLElement>
  onPointerLeave?: React.PointerEventHandler<HTMLElement>
  title?: string
}

type AppTooltipPosition = {
  top: number
  left: number
}

const TOOLTIP_VIEWPORT_MARGIN = 8

const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? React.useEffect : React.useLayoutEffect

const composeTooltipHandler =
  <Event extends React.SyntheticEvent<HTMLElement>>(
    existing: ((event: Event) => void) | undefined,
    next: (event: Event) => void,
  ) =>
  (event: Event) => {
    existing?.(event)
    if (!event.defaultPrevented) {
      next(event)
    }
  }

const clampTooltipValue = (value: number, min: number, max: number) => {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

const resolveTooltipCoordinate = (
  triggerRect: DOMRect,
  tooltipRect: DOMRect | null,
  side: NonNullable<AppTooltipProps["side"]>,
  align: NonNullable<AppTooltipProps["align"]>,
  sideOffset: number,
): AppTooltipPosition => {
  const tooltipWidth = tooltipRect?.width ?? 0
  const tooltipHeight = tooltipRect?.height ?? 0
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight

  let top = triggerRect.bottom + sideOffset
  let left = triggerRect.left + triggerRect.width / 2 - tooltipWidth / 2

  if (side === "top") {
    top = triggerRect.top - sideOffset - tooltipHeight
  } else if (side === "left") {
    top = triggerRect.top + triggerRect.height / 2 - tooltipHeight / 2
    left = triggerRect.left - sideOffset - tooltipWidth
  } else if (side === "right") {
    top = triggerRect.top + triggerRect.height / 2 - tooltipHeight / 2
    left = triggerRect.right + sideOffset
  }

  if (side === "top" || side === "bottom") {
    if (align === "start") {
      left = triggerRect.left
    } else if (align === "end") {
      left = triggerRect.right - tooltipWidth
    }
  } else if (align === "start") {
    top = triggerRect.top
  } else if (align === "end") {
    top = triggerRect.bottom - tooltipHeight
  }

  return {
    top: clampTooltipValue(
      top,
      TOOLTIP_VIEWPORT_MARGIN,
      viewportHeight - tooltipHeight - TOOLTIP_VIEWPORT_MARGIN,
    ),
    left: clampTooltipValue(
      left,
      TOOLTIP_VIEWPORT_MARGIN,
      viewportWidth - tooltipWidth - TOOLTIP_VIEWPORT_MARGIN,
    ),
  }
}

const tooltipPositionsEqual = (
  left: AppTooltipPosition | null,
  right: AppTooltipPosition,
) => {
  if (!left) return false
  return (
    Math.round(left.top) === Math.round(right.top) &&
    Math.round(left.left) === Math.round(right.left)
  )
}

const tooltipTextFromContent = (content: React.ReactNode) => {
  if (typeof content === "string" || typeof content === "number") {
    return String(content)
  }
  return null
}

const normalizeTooltipText = (value: string) =>
  value
    .replace(/[^a-z0-9.%$]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()

const TOOLTIP_BOILERPLATE_TOKENS = new Set([
  "a",
  "an",
  "by",
  "choose",
  "column",
  "columns",
  "configure",
  "filter",
  "filters",
  "for",
  "hide",
  "in",
  "open",
  "row",
  "rows",
  "search",
  "select",
  "show",
  "sort",
  "the",
  "this",
  "to",
])

const tooltipContentTokens = (value: string) =>
  normalizeTooltipText(value).split(" ").filter(Boolean)

const tooltipTokensContained = (
  needleTokens: string[],
  haystackTokens: Set<string>,
) =>
  needleTokens.length > 0 &&
  needleTokens.every((token) => haystackTokens.has(token))

const hasScreenReaderOnlyClass = (element: Element) => {
  const className = element.getAttribute("class") || ""
  return /\b(?:sr-only|screen-reader-only|visually-hidden)\b/i.test(className)
}

const elementHiddenFromTooltipText = (element: Element) => {
  if (
    element.getAttribute("aria-hidden") === "true" ||
    element.hasAttribute("hidden") ||
    hasScreenReaderOnlyClass(element)
  ) {
    return true
  }

  if (typeof window === "undefined" || !window.getComputedStyle) {
    return false
  }

  const style = window.getComputedStyle(element)
  return style.display === "none" || style.visibility === "hidden"
}

const collectVisibleTooltipText = (node: Node): string => {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent || ""
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return ""
  }

  const element = node as Element
  if (elementHiddenFromTooltipText(element)) {
    return ""
  }

  return Array.from(element.childNodes)
    .map((child) => collectVisibleTooltipText(child))
    .join(" ")
}

const elementHasClippedText = (element: Element): boolean => {
  const htmlElement =
    typeof HTMLElement !== "undefined" && element instanceof HTMLElement
      ? element
      : null
  if (
    htmlElement &&
    (htmlElement.scrollWidth > htmlElement.clientWidth + 1 ||
      htmlElement.scrollHeight > htmlElement.clientHeight + 1)
  ) {
    return true
  }

  return Array.from(element.children).some((child) => elementHasClippedText(child))
}

const isTooltipContentRedundant = (
  trigger: HTMLElement,
  content: React.ReactNode,
) => {
  const contentText = tooltipTextFromContent(content)
  if (!contentText) return false

  const triggerText = collectVisibleTooltipText(trigger)
  const clipped = elementHasClippedText(trigger)
  const normalizedTriggerText = normalizeTooltipText(triggerText)
  const normalizedContentText = normalizeTooltipText(contentText)
  if (
    !triggerText ||
    !normalizedTriggerText ||
    !normalizedContentText
  ) {
    return false
  }

  // Keep exact same-text tooltips only when the UI has clipped the visible value.
  if (normalizedTriggerText === normalizedContentText) {
    return !clipped
  }

  if (clipped) return false

  const triggerTokenSet = new Set(tooltipContentTokens(triggerText))
  const contentTokens = tooltipContentTokens(contentText)
  if (tooltipTokensContained(contentTokens, triggerTokenSet)) {
    return true
  }

  const meaningTokens = contentTokens.filter(
    (token) => !TOOLTIP_BOILERPLATE_TOKENS.has(token),
  )
  return tooltipTokensContained(meaningTokens, triggerTokenSet)
}

function AppTooltip({
  content,
  children,
  disabled = false,
  side = "top",
  align = "center",
  sideOffset = 7,
  className,
  contentClassName,
}: AppTooltipProps) {
  const [open, setOpen] = React.useState(false)
  const [position, setPosition] = React.useState<AppTooltipPosition | null>(null)
  const tooltipId = React.useId()
  const triggerRef = React.useRef<HTMLElement | null>(null)
  const contentRef = React.useRef<HTMLDivElement | null>(null)
  const tooltipDisabled =
    disabled ||
    content == null ||
    content === false ||
    (typeof content === "string" && !content.trim())

  const updatePosition = React.useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger || typeof window === "undefined") return
    const nextPosition = resolveTooltipCoordinate(
      trigger.getBoundingClientRect(),
      contentRef.current?.getBoundingClientRect() ?? null,
      side,
      align,
      sideOffset,
    )
    setPosition((currentPosition) =>
      tooltipPositionsEqual(currentPosition, nextPosition)
        ? currentPosition
        : nextPosition,
      )
  }, [align, side, sideOffset])

  const showTooltip = React.useCallback(
    (event: React.SyntheticEvent<HTMLElement>) => {
      if (tooltipDisabled) return
      triggerRef.current = event.currentTarget
      if (isTooltipContentRedundant(event.currentTarget, content)) {
        setOpen(false)
        return
      }
      setOpen(true)
      updatePosition()
    },
    [content, tooltipDisabled, updatePosition],
  )

  const hideTooltip = React.useCallback(() => {
    setOpen(false)
  }, [])

  const tooltipTriggerProps = React.useCallback(
    (props: TooltipDomTriggerProps): TooltipDomTriggerProps => ({
      "aria-describedby": open
        ? [props["aria-describedby"], tooltipId].filter(Boolean).join(" ")
        : props["aria-describedby"],
      title: undefined,
      onPointerEnter: composeTooltipHandler(
        props.onPointerEnter,
        (event: React.PointerEvent<HTMLElement>) => {
          if (event.pointerType !== "touch") {
            showTooltip(event)
          }
        },
      ),
      onPointerLeave: composeTooltipHandler(props.onPointerLeave, hideTooltip),
      onFocus: composeTooltipHandler(props.onFocus, showTooltip),
      onBlur: composeTooltipHandler(props.onBlur, hideTooltip),
      onKeyDown: composeTooltipHandler(
        props.onKeyDown,
        (event: React.KeyboardEvent<HTMLElement>) => {
          if (event.key === "Escape") {
            hideTooltip()
          }
        },
      ),
      onPointerDown: composeTooltipHandler(
        props.onPointerDown,
        (event: React.PointerEvent<HTMLElement>) => {
          if (event.pointerType === "touch" || event.pointerType === "pen") {
            triggerRef.current = event.currentTarget
            setOpen((currentOpen) => !currentOpen)
            updatePosition()
          }
        },
      ),
    }),
    [hideTooltip, open, showTooltip, tooltipId, updatePosition],
  )

  const disabledDomButton = findDisabledDomButton(children)
  const trigger = disabledDomButton ? (
    <span
      className={cn("ra-tooltip-disabled-trigger", className)}
      style={disabledTriggerLayoutStyle(disabledDomButton)}
      tabIndex={0}
      {...tooltipTriggerProps({})}
    >
      {children}
    </span>
  ) : React.isValidElement<TooltipDomTriggerProps>(children) &&
    typeof children.type === "string" ? (
    React.cloneElement(children, tooltipTriggerProps(children.props))
  ) : (
    <span
      className={className}
      {...tooltipTriggerProps({})}
    >
      {children}
    </span>
  )

  useIsomorphicLayoutEffect(() => {
    if (open && !tooltipDisabled) updatePosition()
  }, [content, open, tooltipDisabled, updatePosition])

  React.useEffect(() => {
    if (!open || tooltipDisabled) return undefined
    const handleWindowChange = () => updatePosition()
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (triggerRef.current?.contains(target)) return
      if (contentRef.current?.contains(target)) return
      setOpen(false)
    }
    window.addEventListener("resize", handleWindowChange)
    window.addEventListener("scroll", handleWindowChange, true)
    document.addEventListener("pointerdown", handlePointerDown, true)
    return () => {
      window.removeEventListener("resize", handleWindowChange)
      window.removeEventListener("scroll", handleWindowChange, true)
      document.removeEventListener("pointerdown", handlePointerDown, true)
    }
  }, [open, tooltipDisabled, updatePosition])

  if (tooltipDisabled) {
    return <>{children}</>
  }

  const tooltip =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            id={tooltipId}
            ref={contentRef}
            role="tooltip"
            className={cn("ra-tooltip-content", contentClassName)}
            style={{
              position: "fixed",
              top: position?.top ?? 0,
              left: position?.left ?? 0,
              maxWidth: "min(360px, calc(100vw - 16px))",
              visibility: position ? "visible" : "hidden",
              zIndex: 90,
            }}
          >
            {content}
          </div>,
          document.body,
        )
      : null

  return (
    <>
      {trigger}
      {tooltip}
    </>
  )
}

export { AppTooltip }
