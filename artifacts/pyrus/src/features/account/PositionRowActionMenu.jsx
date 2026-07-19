import { useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AppTooltip } from "@/components/ui/tooltip";
import { MetricChip } from "../../components/platform/primitives.jsx";
import {
  CSS_COLOR,
  FONT_WEIGHTS,
  RADII,
  T,
  cssColorMix,
  dim,
  fs,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";

const motionFast =
  "var(--ra-motion-fast, 140ms) var(--ra-motion-ease, ease)";
const motionMicro =
  "var(--ra-motion-micro, 90ms) var(--ra-motion-ease, ease)";

const actionTransition = [
  `background-color ${motionFast}`,
  `border-color ${motionFast}`,
  `box-shadow ${motionFast}`,
  `color ${motionFast}`,
  `opacity ${motionFast}`,
  `transform ${motionMicro}`,
].join(", ");

const toneColor = (tone) => {
  if (tone === "danger") return CSS_COLOR.red;
  if (tone === "success") return CSS_COLOR.green;
  if (tone === "warning") return CSS_COLOR.amber;
  if (tone === "info") return CSS_COLOR.cyan;
  return CSS_COLOR.accent;
};

const menuItemBaseStyle = {
  fontFamily: T.sans,
  fontSize: textSize("caption"),
  lineHeight: 1.12,
  transition: actionTransition,
};

const stopRowEvent = (event) => {
  event.stopPropagation();
};

const disabledActionLabel = (action) =>
  action?.disabled
    ? `${action.label || "Action"}, unavailable: ${action.description || "No reason provided"}`
    : undefined;

const runAction = (action, event, revealDisabledReason) => {
  stopRowEvent(event);
  if (action?.disabled) {
    event.preventDefault?.();
    revealDisabledReason?.(action);
    return;
  }
  action?.onSelect?.();
};

const renderIcon = (Icon, size = 13, style = {}) =>
  Icon ? (
    <Icon
      size={size}
      strokeWidth={1.8}
      aria-hidden="true"
      style={{ flexShrink: 0, ...style }}
    />
  ) : null;

const radialSlots = [
  { left: 8, top: 2 },
  { right: 8, top: 2 },
  { left: 0, top: 60 },
  { right: 0, top: 60 },
  { left: 8, top: 118 },
  { right: 8, top: 118 },
];

const QuoteStrip = ({ items = [] }) => {
  const visibleItems = items.filter(Boolean).slice(0, 4);
  if (!visibleItems.length) return null;

  return (
    <div
      data-testid="position-row-action-quote-strip"
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${Math.min(visibleItems.length, 4)}, minmax(0, 1fr))`,
        gap: sp(4),
        marginTop: sp(4),
      }}
    >
      {visibleItems.map((item) => (
        <MetricChip
          key={item.label}
          label={item.label}
          value={item.value}
          tone={item.tone || CSS_COLOR.textSec}
          title={item.value}
          style={{
            flexDirection: "column",
            alignItems: "stretch",
            gap: sp(1),
          }}
        />
      ))}
    </div>
  );
};

const RadialActionItem = ({ action, slot, revealDisabledReason }) => {
  const tone = toneColor(action?.tone);
  return (
    <DropdownMenuItem
      aria-disabled={action.disabled || undefined}
      aria-label={disabledActionLabel(action)}
      onFocus={() => revealDisabledReason(action)}
      onPointerDown={() => revealDisabledReason(action)}
      onSelect={(event) => runAction(action, event, revealDisabledReason)}
      title={action.description || action.label}
      style={{
        ...menuItemBaseStyle,
        position: "absolute",
        width: dim(86),
        minHeight: dim(48),
        padding: sp("6px 6px"),
        display: "grid",
        justifyItems: "center",
        alignContent: "center",
        gap: sp(3),
        border: `1px solid ${cssColorMix(tone, action.disabled ? 10 : 28)}`,
        background: action.disabled ? CSS_COLOR.bg0 : cssColorMix(tone, 6),
        color: action.disabled ? CSS_COLOR.textMuted : CSS_COLOR.text,
        cursor: action.disabled ? "not-allowed" : "pointer",
        textAlign: "center",
        opacity: action.disabled ? 0.52 : 1,
        ...slot,
      }}
    >
      {renderIcon(action.Icon, 14, {
        color: action.disabled ? CSS_COLOR.textMuted : tone,
      })}
      <span
        style={{
          maxWidth: "100%",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {action.label}
      </span>
    </DropdownMenuItem>
  );
};

const ManagementActionItem = ({ action, revealDisabledReason }) => {
  const tone = toneColor(action?.tone);
  return (
    <DropdownMenuItem
      aria-disabled={action.disabled || undefined}
      aria-label={disabledActionLabel(action)}
      onFocus={() => revealDisabledReason(action)}
      onPointerDown={() => revealDisabledReason(action)}
      onSelect={(event) => runAction(action, event, revealDisabledReason)}
      title={action.description || action.label}
      style={{
        ...menuItemBaseStyle,
        flex: "1 1 0",
        minWidth: 0,
        justifyContent: "center",
        padding: sp("6px 6px"),
        border: `1px solid ${cssColorMix(tone, action.disabled ? 10 : 30)}`,
        background: action.disabled ? CSS_COLOR.bg0 : cssColorMix(tone, 7),
        color: action.disabled ? CSS_COLOR.textMuted : tone,
        cursor: action.disabled ? "not-allowed" : "pointer",
        fontWeight: FONT_WEIGHTS.medium,
        opacity: action.disabled ? 0.5 : 1,
      }}
    >
      {renderIcon(action.Icon, 13)}
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {action.label}
      </span>
    </DropdownMenuItem>
  );
};

export const PositionRowActionMenu = ({
  symbol,
  contractLabel,
  sideLabel,
  primaryAction,
  utilityActions = [],
  managementActions = [],
  quoteItems = [],
  statusText,
  testId = "position-row-action-menu",
}) => {
  const [open, setOpen] = useState(false);
  const [primaryHover, setPrimaryHover] = useState(false);
  const [triggerHover, setTriggerHover] = useState(false);
  const [disabledReason, setDisabledReason] = useState(null);
  const primaryDisabled = Boolean(primaryAction?.disabled);
  const activeUtilities = utilityActions.filter(Boolean).slice(0, 6);
  const activeManagement = managementActions.filter(Boolean).slice(0, 4);
  const primaryTone = toneColor(primaryAction?.tone || "primary");
  const primaryTooltip =
    primaryAction?.description ||
    primaryAction?.label ||
    `Open ${symbol || "position"} in trade ticket`;
  const revealDisabledReason = (action) => {
    setDisabledReason(
      action?.disabled
        ? `${action.label || "Action"}: ${action.description || "Unavailable"}`
        : null,
    );
  };
  const handleOpenChange = (nextOpen) => {
    setOpen(nextOpen);
    if (!nextOpen) setDisabledReason(null);
  };

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <span
        data-testid={testId}
        onClick={stopRowEvent}
        style={{
          display: "inline-flex",
          justifyContent: "flex-end",
          width: "100%",
          minWidth: 0,
        }}
      >
        <span
          style={{
            display: "inline-flex",
            height: dim(24),
            minWidth: dim(74),
            maxWidth: "100%",
            overflow: "hidden",
            border: `1px solid ${open ? cssColorMix(primaryTone, 62) : CSS_COLOR.border}`,
            borderRadius: dim(RADII.xs),
            background: CSS_COLOR.bg0,
            boxShadow: open ? `0 0 0 1px ${cssColorMix(primaryTone, 24)}` : "none",
            transition: actionTransition,
          }}
        >
          <AppTooltip content={primaryTooltip}>
            <button
              type="button"
              aria-label={primaryTooltip}
              disabled={primaryDisabled}
              onClick={(event) => runAction(primaryAction, event)}
              onMouseEnter={() => setPrimaryHover(true)}
              onMouseLeave={() => setPrimaryHover(false)}
              onMouseDown={(event) => {
                if (!primaryDisabled) {
                  event.currentTarget.style.transform = "scale(0.96)";
                }
              }}
              onMouseUp={(event) => {
                event.currentTarget.style.transform = "scale(1)";
              }}
              onBlur={(event) => {
                event.currentTarget.style.transform = "scale(1)";
              }}
              style={{
                minWidth: 0,
                width: dim(50),
                border: "none",
                borderRight: `1px solid ${CSS_COLOR.border}`,
                background:
                  primaryHover && !primaryDisabled
                    ? cssColorMix(primaryTone, 16)
                    : "transparent",
                color: primaryDisabled ? CSS_COLOR.textMuted : primaryTone,
                cursor: primaryDisabled ? "not-allowed" : "pointer",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: sp(3),
                padding: sp("0 6px"),
                fontFamily: T.sans,
                fontSize: textSize("caption"),
                fontWeight: FONT_WEIGHTS.medium,
                lineHeight: 1,
                opacity: primaryDisabled ? 0.48 : 1,
                transition: actionTransition,
              }}
            >
              {renderIcon(primaryAction?.Icon, 12)}
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {primaryAction?.label || "Trade"}
              </span>
            </button>
          </AppTooltip>
          <AppTooltip content={`More actions for ${symbol || "position"}`}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`More actions for ${symbol || "position"}`}
                onClick={stopRowEvent}
                onMouseEnter={() => setTriggerHover(true)}
                onMouseLeave={() => setTriggerHover(false)}
                style={{
                  width: dim(24),
                  border: "none",
                  background:
                    triggerHover || open ? cssColorMix(CSS_COLOR.accent, 12) : "transparent",
                  color: open ? CSS_COLOR.accent : CSS_COLOR.textSec,
                  cursor: "pointer",
                  display: "inline-grid",
                  placeItems: "center",
                  padding: 0,
                  transition: actionTransition,
                }}
              >
                <ChevronDown
                  size={13}
                  strokeWidth={1.8}
                  aria-hidden="true"
                  style={{
                    transform: open ? "rotate(180deg)" : "rotate(0deg)",
                    transition: `transform ${motionFast}`,
                  }}
                />
              </button>
            </DropdownMenuTrigger>
          </AppTooltip>
        </span>
      </span>
      <DropdownMenuContent
        align="end"
        sideOffset={7}
        data-testid={`${testId}-content`}
        style={{
          width: dim(286),
          padding: sp(8),
          border: `1px solid ${CSS_COLOR.border}`,
          boxShadow: `var(--ra-elevation-lg), 0 0 0 1px ${cssColorMix(CSS_COLOR.bg0, 70)}`,
        }}
      >
        <DropdownMenuLabel
          style={{
            display: "grid",
            gap: sp(2),
            padding: sp("2px 3px 0"),
            textTransform: "none",
            letterSpacing: 0,
          }}
        >
          <span
            style={{
              color: CSS_COLOR.text,
              fontFamily: T.data,
              fontSize: textSize("body"),
              fontWeight: FONT_WEIGHTS.medium,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {symbol || "Position"}
          </span>
          <span
            style={{
              color: CSS_COLOR.textMuted,
              fontFamily: T.sans,
              fontSize: textSize("caption"),
              fontWeight: FONT_WEIGHTS.regular,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {[sideLabel, contractLabel].filter(Boolean).join(" · ") || "Position actions"}
          </span>
        </DropdownMenuLabel>
        <QuoteStrip items={quoteItems} />
        {activeUtilities.length ? (
          <>
            <DropdownMenuSeparator style={{ marginTop: sp(7), marginBottom: sp(7) }} />
            <div
              data-testid="position-row-action-radial-menu"
              style={{
                position: "relative",
                height: dim(166),
                margin: sp("0 0 2px"),
              }}
            >
              <div
                aria-hidden="true"
                style={{
                  position: "absolute",
                  left: "50%",
                  top: dim(55),
                  width: dim(92),
                  minHeight: dim(54),
                  transform: "translateX(-50%)",
                  display: "grid",
                  placeItems: "center",
                  padding: sp("5px 8px"),
                  border: `1px solid ${cssColorMix(primaryTone, 28)}`,
                  borderRadius: dim(RADII.md),
                  background: cssColorMix(primaryTone, 8),
                  boxShadow: `inset 0 1px 0 ${cssColorMix(CSS_COLOR.text, 8)}`,
                  textAlign: "center",
                }}
              >
                <span
                  style={{
                    color: CSS_COLOR.text,
                    fontFamily: T.data,
                    fontSize: textSize("caption"),
                    fontWeight: FONT_WEIGHTS.medium,
                    maxWidth: "100%",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {symbol || "Position"}
                </span>
                <span
                  style={{
                    color: CSS_COLOR.textMuted,
                    fontFamily: T.sans,
                    fontSize: fs(8),
                    maxWidth: "100%",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {statusText || "manage"}
                </span>
              </div>
              {activeUtilities.map((action, index) => (
                <RadialActionItem
                  key={action.id || action.label}
                  action={action}
                  slot={radialSlots[index]}
                  revealDisabledReason={revealDisabledReason}
                />
              ))}
            </div>
          </>
        ) : null}
        {activeManagement.length ? (
          <>
            <DropdownMenuSeparator style={{ marginTop: sp(7), marginBottom: sp(7) }} />
            <div
              data-testid="position-row-action-management-bar"
              style={{
                display: "flex",
                gap: sp(5),
              }}
            >
              {activeManagement.map((action) => (
                <ManagementActionItem
                  key={action.id || action.label}
                  action={action}
                  revealDisabledReason={revealDisabledReason}
                />
              ))}
            </div>
          </>
        ) : null}
        {disabledReason ? (
          <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            data-testid={`${testId}-disabled-reason`}
            style={{
              marginTop: sp(7),
              padding: sp("5px 7px"),
              border: `1px solid ${cssColorMix(CSS_COLOR.amber, 24)}`,
              borderRadius: dim(RADII.xs),
              background: cssColorMix(CSS_COLOR.amber, 6),
              color: CSS_COLOR.textSec,
              fontFamily: T.sans,
              fontSize: textSize("caption"),
              lineHeight: 1.35,
            }}
          >
            {disabledReason}
          </div>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default PositionRowActionMenu;
