import * as React from "react";

type MarkProps = {
  size?: number;
  title?: string;
  animated?: boolean;
};

type WordmarkProps = {
  className?: string;
  title?: string;
  width?: number;
};

type LockupProps = {
  className?: string;
  compact?: boolean;
  descriptor?: string;
  showDescriptor?: boolean;
};

const PYRUS_BLUE = "#168BFF";
const PYRUS_RED = "#FF3048";
const PYRUS_MAGENTA = "#A14DFF";

export function PyrusRadialMark({
  size = 28,
  title = "PYRUS",
  animated = false,
}: MarkProps) {
  const titleId = React.useId().replaceAll(":", "");
  return (
    <svg
      aria-labelledby={title ? titleId : undefined}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block", overflow: "visible" }}
    >
      {title ? <title id={titleId}>{title}</title> : null}
      <defs>
        <radialGradient id={`${titleId}-core`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.96" />
          <stop offset="48%" stopColor={PYRUS_MAGENTA} stopOpacity="0.9" />
          <stop offset="100%" stopColor={PYRUS_BLUE} stopOpacity="0.12" />
        </radialGradient>
        <linearGradient id={`${titleId}-sweep`} x1="5" y1="32" x2="59" y2="32">
          <stop offset="0%" stopColor={PYRUS_BLUE} />
          <stop offset="48%" stopColor={PYRUS_MAGENTA} />
          <stop offset="100%" stopColor={PYRUS_RED} />
        </linearGradient>
        <filter id={`${titleId}-glow`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="2.4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g
        filter={`url(#${titleId}-glow)`}
        style={{
          transformBox: "fill-box",
          transformOrigin: "center",
          animation: animated
            ? "pyrusMarkPulse 1600ms cubic-bezier(0.4, 0, 0.2, 1) infinite"
            : undefined,
        }}
      >
        <circle cx="32" cy="32" r="25" stroke={`url(#${titleId}-sweep)`} strokeWidth="3" />
        <path
          d="M12 35c6-16 18-23 36-21"
          stroke={PYRUS_BLUE}
          strokeWidth="3.2"
          strokeLinecap="round"
        />
        <path
          d="M16 46c9-17 22-24 40-20"
          stroke={PYRUS_RED}
          strokeWidth="3.2"
          strokeLinecap="round"
        />
        <path
          d="M22 54c8-12 18-17 30-15"
          stroke={PYRUS_MAGENTA}
          strokeWidth="2.6"
          strokeLinecap="round"
          opacity="0.86"
        />
        <circle cx="32" cy="32" r="10" fill={`url(#${titleId}-core)`} />
        <circle cx="14" cy="34" r="3.2" fill={PYRUS_BLUE} />
        <circle cx="50" cy="27" r="3.2" fill={PYRUS_RED} />
      </g>
    </svg>
  );
}

export function PyrusWordmark({
  className,
  title = "PYRUS",
  width = 86,
}: WordmarkProps) {
  const titleId = React.useId().replaceAll(":", "");
  const height = Math.round(width * 0.245);
  return (
    <svg
      aria-labelledby={title ? titleId : undefined}
      aria-hidden={title ? undefined : true}
      className={className}
      role={title ? "img" : undefined}
      width={width}
      height={height}
      viewBox="0 0 420 104"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block" }}
    >
      {title ? <title id={titleId}>{title}</title> : null}
      <defs>
        <linearGradient id={`${titleId}-word`} x1="0" y1="52" x2="420" y2="52">
          <stop offset="0%" stopColor="#EAF5FF" />
          <stop offset="38%" stopColor={PYRUS_BLUE} />
          <stop offset="65%" stopColor={PYRUS_MAGENTA} />
          <stop offset="100%" stopColor={PYRUS_RED} />
        </linearGradient>
      </defs>
      <text
        x="0"
        y="82"
        fill={`url(#${titleId}-word)`}
        fontFamily="'IBM Plex Sans', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
        fontSize="86"
        fontWeight="700"
        letterSpacing="0"
      >
        PYRUS
      </text>
    </svg>
  );
}

export function PyrusBrandLockup({
  className,
  compact = false,
  descriptor = "TRADING OS",
  showDescriptor = true,
}: LockupProps) {
  return (
    <div
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: compact ? 7 : 9,
        minWidth: 0,
        flexShrink: 0,
      }}
    >
      <PyrusRadialMark size={compact ? 22 : 28} title="" />
      <span
        style={{
          display: "inline-flex",
          flexDirection: "column",
          minWidth: 0,
          gap: 1,
        }}
      >
        <PyrusWordmark width={compact ? 62 : 82} title="PYRUS" />
        {showDescriptor ? (
          <span
            aria-hidden="true"
            style={{
              color: "var(--ra-text-dim)",
              fontSize: compact ? 7 : 8,
              fontWeight: 600,
              letterSpacing: 0,
              lineHeight: 1,
              textTransform: "uppercase",
              whiteSpace: "nowrap",
            }}
          >
            {descriptor}
          </span>
        ) : null}
      </span>
    </div>
  );
}

export default PyrusBrandLockup;
