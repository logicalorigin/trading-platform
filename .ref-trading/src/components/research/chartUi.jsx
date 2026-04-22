import React from "react";
import { B, BORDER, F, FS } from "./insights/shared.jsx";

export const SURFACE = "#f8fafc";
export const TEXT = "#0f172a";
export const MUTED = "#94a3b8";
export const GRID = "#eef2f7";
export const PANEL_RADIUS = 10;
export const PANEL_HEADER_BACKGROUND = "linear-gradient(180deg, #fcfdff 0%, #f8fafc 100%)";
export const PANEL_VIEWPORT_BACKGROUND = "linear-gradient(180deg, #fcfdff 0%, #f8fafc 100%)";

const MENU_SHADOW = "0 18px 34px rgba(15,23,42,0.14), 0 4px 10px rgba(15,23,42,0.08)";

export function ChevronDownIcon({ open = false, color = "#64748b" }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      aria-hidden="true"
      style={{
        flexShrink: 0,
        transform: open ? "rotate(180deg)" : "rotate(0deg)",
        transition: "transform 0.16s ease",
      }}
    >
      <path
        d="M2 3.5 5 6.5 8 3.5"
        fill="none"
        stroke={color}
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LinkIcon({ linked = false, color = "#64748b" }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <path
        d="M4.2 7.8 3 9a2 2 0 0 1-2.8-2.8l1.8-1.8A2 2 0 0 1 4.8 4"
        fill="none"
        stroke={color}
        strokeWidth="1.15"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={linked ? 1 : 0.72}
      />
      <path
        d="m7.8 4.2 1.2-1.2A2 2 0 1 1 11.8 5l-1.8 1.8A2 2 0 0 1 7.2 8"
        fill="none"
        stroke={color}
        strokeWidth="1.15"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={linked ? 1 : 0.72}
      />
      <path
        d="M4.5 7.5 7.5 4.5"
        fill="none"
        stroke={color}
        strokeWidth="1.15"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={linked ? 1 : 0.4}
      />
    </svg>
  );
}

export function DropdownTrigger({
  label,
  value,
  open = false,
  onClick,
  emphasis = "primary",
  compact = false,
}) {
  const isPrimary = emphasis === "primary";

  return (
    <button
      type="button"
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: compact ? 8 : 10,
        minHeight: compact ? 32 : 38,
        padding: compact
          ? (isPrimary ? "4px 9px 4px 10px" : "4px 8px 4px 9px")
          : (isPrimary ? "5px 10px 5px 11px" : "5px 9px 5px 10px"),
        borderRadius: 10,
        border: `1px solid ${open ? `${B}3d` : isPrimary ? `${B}28` : GRID}`,
        background: open
          ? `${B}10`
          : isPrimary
            ? "linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)"
            : SURFACE,
        boxShadow: open ? "0 2px 6px rgba(79,70,229,0.12)" : "none",
        color: TEXT,
        cursor: "pointer",
        transition: "border-color 0.14s ease, background 0.14s ease, box-shadow 0.14s ease",
      }}
      >
      <div
        style={{
          display: "flex",
          flexDirection: compact ? "row" : "column",
          alignItems: compact ? "center" : "flex-start",
          gap: compact ? 6 : 1,
          minWidth: 0,
        }}
      >
        <span
          style={{
            fontSize: compact ? 10 : 9,
            fontFamily: FS,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: MUTED,
            lineHeight: 1.1,
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontSize: compact ? 12 : 13,
            fontFamily: F,
            fontWeight: isPrimary ? 700 : 600,
            color: open && isPrimary ? B : TEXT,
            lineHeight: 1.1,
            whiteSpace: "nowrap",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {value}
        </span>
      </div>
      <ChevronDownIcon open={open} color={open && isPrimary ? B : "#64748b"} />
    </button>
  );
}

export function ControlGroup({ label, children }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        minHeight: 34,
        padding: "4px 6px",
        border: `1px solid ${GRID}`,
        borderRadius: 10,
        background: SURFACE,
        flexWrap: "wrap",
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontFamily: FS,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: MUTED,
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
        {children}
      </div>
    </div>
  );
}

export function ControlButton({ active = false, children, onClick, tone = "accent" }) {
  const activeStyles = tone === "dark"
    ? {
        background: "#111827",
        color: "#ffffff",
        borderColor: "#111827",
        boxShadow: "0 1px 2px rgba(15,23,42,0.16)",
      }
    : {
        background: `${B}10`,
        color: B,
        borderColor: `${B}2e`,
        boxShadow: "0 1px 2px rgba(15,23,42,0.05)",
      };

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "4px 8px",
        borderRadius: 7,
        fontSize: 12,
        fontFamily: F,
        fontWeight: active ? 700 : 500,
        border: `1px solid ${active ? activeStyles.borderColor : "transparent"}`,
        background: active ? activeStyles.background : "transparent",
        color: active ? activeStyles.color : "#64748b",
        cursor: "pointer",
        transition: "all 0.12s",
        boxShadow: active ? activeStyles.boxShadow : "none",
        lineHeight: 1.2,
      }}
    >
      {children}
    </button>
  );
}

export function LinkToggleChip({
  linked = false,
  driving = false,
  onClick,
  title = undefined,
}) {
  const color = linked ? (driving ? "#312e81" : B) : "#64748b";
  const borderColor = linked ? (driving ? "#312e81" : `${B}30`) : GRID;
  const background = linked
    ? (driving ? "linear-gradient(180deg, rgba(79,70,229,0.18) 0%, rgba(79,70,229,0.10) 100%)" : `${B}10`)
    : SURFACE;

  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        minHeight: 32,
        padding: "4px 10px",
        borderRadius: 999,
        border: `1px solid ${borderColor}`,
        background,
        color,
        cursor: "pointer",
        transition: "border-color 0.14s ease, background 0.14s ease, color 0.14s ease",
        boxShadow: linked ? "0 1px 2px rgba(15,23,42,0.05)" : "none",
      }}
    >
      <LinkIcon linked={linked} color={color} />
      <span
        style={{
          fontSize: 10,
          fontFamily: FS,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          whiteSpace: "nowrap",
        }}
      >
        {linked ? "Linked" : "Unlinked"}
      </span>
    </button>
  );
}

export function MenuOption({
  label,
  detail = "",
  selected = false,
  onClick,
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onClick}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "8px 10px",
        border: "none",
        borderRadius: 9,
        background: selected ? `${B}10` : "transparent",
        color: TEXT,
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 8,
          height: 8,
          marginTop: 4,
          borderRadius: 999,
          background: selected ? B : "transparent",
          boxShadow: selected ? `0 0 0 3px ${B}14` : `inset 0 0 0 1px ${GRID}`,
          flexShrink: 0,
        }}
      />
      <span style={{ display: "flex", flexDirection: "column", gap: detail ? 2 : 0, minWidth: 0 }}>
        <span
          style={{
            fontSize: 12,
            fontFamily: F,
            fontWeight: selected ? 700 : 600,
            color: selected ? B : TEXT,
            lineHeight: 1.2,
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
        {detail ? (
          <span
            style={{
              fontSize: 11,
              fontFamily: FS,
              color: "#64748b",
              lineHeight: 1.3,
            }}
          >
            {detail}
          </span>
        ) : null}
      </span>
    </button>
  );
}

export function SelectionDropdown({
  label,
  value,
  selectedValue,
  sections,
  open = false,
  onToggle,
  onSelect,
  width = 220,
  emphasis = "primary",
  compact = false,
}) {
  return (
    <div style={{ position: "relative", minWidth: 0 }}>
      <DropdownTrigger
        label={label}
        value={value}
        open={open}
        onClick={onToggle}
        emphasis={emphasis}
        compact={compact}
      />
      {open ? (
        <div
          role="menu"
          aria-label={label}
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            zIndex: 8,
            width,
            padding: 6,
            borderRadius: 12,
            border: `1px solid ${BORDER}`,
            background: "#ffffff",
            boxShadow: MENU_SHADOW,
          }}
        >
          {sections.map((section, sectionIndex) => (
            <div
              key={section.label}
              style={{
                paddingTop: sectionIndex === 0 ? 0 : 7,
                marginTop: sectionIndex === 0 ? 0 : 7,
                borderTop: sectionIndex === 0 ? "none" : `1px solid ${GRID}`,
              }}
            >
              <div
                style={{
                  padding: "2px 8px 5px",
                  fontSize: 9,
                  fontFamily: FS,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: MUTED,
                }}
              >
                {section.label}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {section.options.map((option) => (
                  <MenuOption
                    key={option.value}
                    label={option.label}
                    detail={option.detail}
                    selected={selectedValue === option.value}
                    onClick={() => onSelect(option.value)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function StatusChip({
  label,
  value,
  color = "#334155",
  background = "#f8fafc",
  border = "#e2e8f0",
  title = undefined,
}) {
  return (
    <div
      title={title}
      style={{
        minWidth: 0,
        border: `1px solid ${border}`,
        borderRadius: 10,
        padding: "5px 8px",
        background,
      }}
    >
      <div
        style={{
          fontSize: 9,
          fontFamily: FS,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: MUTED,
          marginBottom: 2,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 12,
          fontFamily: F,
          fontWeight: 700,
          color,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
    </div>
  );
}
