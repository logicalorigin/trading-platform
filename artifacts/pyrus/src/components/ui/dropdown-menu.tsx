import * as React from "react"
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu"
import {
  Check,
  Circle,
} from "lucide-react";
import {
  cn,
} from "@/lib/utils";
// @ts-expect-error JSX module imported into TypeScript context
import { cssColorMix, dim, ELEVATION, FONT_WEIGHTS, RADII, sp, T, textSize } from "../../lib/uiTokens.jsx";

const CSS_COLOR = {
  bg1: "var(--ra-surface-1)",
  border: "var(--ra-border-default)",
  text: "var(--ra-text-primary)",
  textMuted: "var(--ra-text-muted)",
  accent: "var(--ra-color-accent)",
}

const contentSurfaceStyle: React.CSSProperties = {
  zIndex: 1000,
  pointerEvents: "auto",
  background: CSS_COLOR.bg1,
  color: CSS_COLOR.text,
  border: "none",
  borderRadius: dim(RADII.md),
  boxShadow: ELEVATION.md,
  fontFamily: T.sans,
  fontSize: textSize("paragraphMuted"),
  padding: sp(6),
}

const itemBaseStyle: React.CSSProperties = {
  color: CSS_COLOR.text,
  borderRadius: dim(RADII.sm),
}

const labelStyle: React.CSSProperties = {
  color: CSS_COLOR.textMuted,
  fontFamily: T.sans,
  fontSize: textSize("caption"),
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  fontWeight: FONT_WEIGHTS.medium,
  padding: sp("4px 8px"),
}

const separatorStyle: React.CSSProperties = {
  background: CSS_COLOR.border,
  height: 1,
  margin: `${sp(4)}px ${sp(2)}px`,
}

const itemFocusClass =
  "data-[highlighted]:bg-[color:var(--ra-dropdown-hover)] data-[highlighted]:text-[color:var(--ra-dropdown-hover-fg)]"

const DropdownMenu = DropdownMenuPrimitive.Root

const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger

const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup

const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 6, style, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-[260] max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-[10rem] overflow-y-auto overflow-x-hidden",
        className,
      )}
      style={{ ...contentSurfaceStyle, ...style }}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
))
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName

const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
    inset?: boolean
  }
>(({ className, inset, style, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center gap-2 px-2 py-1.5 outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&>svg]:size-4 [&>svg]:shrink-0",
      itemFocusClass,
      inset && "pl-8",
      className,
    )}
    style={{
      ...itemBaseStyle,
      ["--ra-dropdown-hover" as any]: cssColorMix(CSS_COLOR.accent, 6),
      ["--ra-dropdown-hover-fg" as any]: CSS_COLOR.text,
      ...style,
    }}
    {...props}
  />
))
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName

const DropdownMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(({ className, children, checked, style, ...props }, ref) => (
  <DropdownMenuPrimitive.CheckboxItem
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center py-1.5 pl-8 pr-2 outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      itemFocusClass,
      className,
    )}
    checked={checked}
    style={{
      ...itemBaseStyle,
      ["--ra-dropdown-hover" as any]: cssColorMix(CSS_COLOR.accent, 6),
      ["--ra-dropdown-hover-fg" as any]: CSS_COLOR.text,
      ...style,
    }}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Check className="h-4 w-4" style={{ color: CSS_COLOR.accent }} />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.CheckboxItem>
))
DropdownMenuCheckboxItem.displayName =
  DropdownMenuPrimitive.CheckboxItem.displayName

const DropdownMenuRadioItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(({ className, children, style, ...props }, ref) => (
  <DropdownMenuPrimitive.RadioItem
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center py-1.5 pl-8 pr-2 outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      itemFocusClass,
      className,
    )}
    style={{
      ...itemBaseStyle,
      ["--ra-dropdown-hover" as any]: cssColorMix(CSS_COLOR.accent, 6),
      ["--ra-dropdown-hover-fg" as any]: CSS_COLOR.text,
      ...style,
    }}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Circle className="h-2 w-2 fill-current" style={{ color: CSS_COLOR.accent }} />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.RadioItem>
))
DropdownMenuRadioItem.displayName = DropdownMenuPrimitive.RadioItem.displayName

const DropdownMenuLabel = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & {
    inset?: boolean
  }
>(({ className, inset, style, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn(inset && "pl-8", className)}
    style={{ ...labelStyle, ...style }}
    {...props}
  />
))
DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName

const DropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, style, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={className}
    style={{ ...separatorStyle, ...style }}
    {...props}
  />
))
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
}
