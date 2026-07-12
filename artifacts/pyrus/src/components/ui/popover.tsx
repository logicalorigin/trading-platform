import * as React from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"

import {
  cn,
} from "@/lib/utils";
// @ts-expect-error JSX module imported into TypeScript context
import { ELEVATION, RADII, T, dim, sp, textSize } from "../../lib/uiTokens.jsx";

const CSS_COLOR = {
  bg1: "var(--ra-surface-1)",
  text: "var(--ra-text-primary)",
}

const popoverSurfaceStyle: React.CSSProperties = {
  zIndex: 1000,
  pointerEvents: "auto",
  background: CSS_COLOR.bg1,
  color: CSS_COLOR.text,
  border: "none",
  borderRadius: dim(RADII.md),
  boxShadow: ELEVATION.md,
  padding: sp(14),
  fontFamily: T.sans,
  fontSize: textSize("paragraphMuted"),
}

const Popover = PopoverPrimitive.Root

const PopoverTrigger = PopoverPrimitive.Trigger

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 6, style, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "z-[260] w-72 outline-none",
        className,
      )}
      style={{ ...popoverSurfaceStyle, ...style }}
      {...props}
    />
  </PopoverPrimitive.Portal>
))
PopoverContent.displayName = PopoverPrimitive.Content.displayName

export { Popover, PopoverTrigger, PopoverContent }
