import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"

import { cn } from "@/lib/utils"

const TooltipProvider = TooltipPrimitive.Provider

const Tooltip = TooltipPrimitive.Root

const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipPortal = TooltipPrimitive.Portal

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 7, children, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn("ra-tooltip-content", className)}
      {...props}
    >
      {children}
      <TooltipPrimitive.Arrow className="ra-tooltip-arrow" width={9} height={5} />
    </TooltipPrimitive.Content>
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

type AppTooltipProps = {
  content?: React.ReactNode
  children: React.ReactNode
  disabled?: boolean
  side?: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>["side"]
  align?: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>["align"]
  sideOffset?: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>["sideOffset"]
  className?: string
  contentClassName?: string
}

const isDisabledDomButton = (
  children: React.ReactNode,
): children is React.ReactElement<{
  disabled?: boolean
  style?: React.CSSProperties
}> =>
  React.isValidElement<{ disabled?: boolean }>(children) &&
  children.type === "button" &&
  Boolean(children.props.disabled)

const nativeTitleFromContent = (content: React.ReactNode) => {
  if (typeof content === "string") return content.trim() || undefined
  if (typeof content === "number") return String(content)
  return undefined
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
    height: style.height,
    justifySelf: style.justifySelf,
    maxHeight: style.maxHeight,
    maxWidth: style.maxWidth,
    minHeight: style.minHeight,
    minWidth: style.minWidth,
    width: style.width,
  } satisfies React.CSSProperties

  return Object.values(layoutStyle).some((value) => value != null)
    ? layoutStyle
    : undefined
}

const withNativeTitle = (
  children: React.ReactElement<{ title?: string }>,
  title: string | undefined,
) => {
  if (!title || children.props.title) return children
  return React.cloneElement(children, { title })
}

function AppTooltip({
  content,
  children,
  disabled = false,
  side = "top",
  align = "center",
  sideOffset,
  className,
  contentClassName,
}: AppTooltipProps) {
  if (
    disabled ||
    content == null ||
    content === false ||
    (typeof content === "string" && !content.trim())
  ) {
    return <>{children}</>
  }

  const nativeTitle = nativeTitleFromContent(content)
  const trigger = isDisabledDomButton(children) ? (
    <span
      className={cn("ra-tooltip-disabled-trigger", className)}
      style={disabledTriggerLayoutStyle(children)}
      title={nativeTitle}
    >
      {children}
    </span>
  ) : React.isValidElement<{ title?: string }>(children) ? (
    withNativeTitle(children, nativeTitle)
  ) : (
    <span className={className} title={nativeTitle}>
      {children}
    </span>
  )

  return (
    <Tooltip>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent
        side={side}
        align={align}
        sideOffset={sideOffset}
        className={contentClassName}
      >
        {content}
      </TooltipContent>
    </Tooltip>
  )
}

export {
  AppTooltip,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
}
