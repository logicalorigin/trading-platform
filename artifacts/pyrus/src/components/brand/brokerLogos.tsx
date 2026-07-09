import { type CSSProperties } from "react";

// Inline-SVG broker marks so account cards carry no external/CDN image
// dependency (same self-contained approach as PyrusMark). Each provider renders
// as an app-icon-style rounded tile: a brand-colored square with a white glyph.
// Robinhood gets its real feather mark; the rest use tasteful brand-colored
// monograms/wordmarks that read cleanly at 20-28px. Unknown providers fall back
// to a neutral slate tile so a card never renders an empty logo.

type BrokerMark =
  | { bg: string; text: string; fontSize: number; path?: undefined }
  | { bg: string; path: string; text?: undefined; fontSize?: undefined };

// Robinhood feather, inlined as a path filled white on the brand-green tile —
// this is Robinhood's real app-icon mark, not a monogram.
const ROBINHOOD_FEATHER =
  "M2.84 24h.53c.096 0 .192-.048.224-.128C7.591 13.696 11.94 8.656 14.67 5.638c.112-.128.064-.225-.096-.225h-4.88a.55.55 0 0 0-.45.225L5.746 9.972c-.514.642-.642 1.236-.642 2.086v4.43c-1.14 3.194-1.862 5.361-2.392 7.32-.032.125.016.192.129.192M20.447.646c-.754-.802-4.157-.834-5.73-.224a3 3 0 0 0-.786.465 41 41 0 0 0-3.323 3.178c-.112.113-.064.225.097.225h5.409c.497 0 .786.289.786.786v6.1c0 .16.128.208.225.064l3.258-4.254c.53-.69.69-.898.835-1.861.192-1.413.08-3.58-.77-4.479m-6.982 16.18 2.231-3.676a.7.7 0 0 0 .064-.29V6.73c0-.16-.112-.225-.224-.097-3.355 3.74-5.971 7.672-8.395 12.407-.06.12.016.225.16.177l5.009-1.54c.565-.174.882-.402 1.155-.852";

const BROKER_MARKS: Record<string, BrokerMark> = {
  robinhood: { bg: "#00C805", path: ROBINHOOD_FEATHER },
  schwab: { bg: "#00A0DF", text: "CS", fontSize: 10 },
  etrade: { bg: "#6F3FD8", text: "E∗", fontSize: 11 },
  snaptrade: { bg: "#168BFF", text: "ST", fontSize: 10 },
  ibkr: { bg: "#CC0000", text: "IBKR", fontSize: 7.5 },
  all: { bg: "#168BFF", text: "Σ", fontSize: 13 },
  shadow: { bg: "#FF5F9E", text: "SH", fontSize: 9 },
  brokerage: { bg: "#788AA0", text: "BR", fontSize: 9 },
};

const LOGO_FONT = "Helvetica, Arial, sans-serif";

export type BrokerProvider = keyof typeof BROKER_MARKS;

export function BrokerLogo({
  provider,
  size = 24,
  title,
  className,
  style,
}: {
  provider: string;
  size?: number;
  title?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const mark =
    BROKER_MARKS[String(provider || "").toLowerCase()] || BROKER_MARKS.brokerage;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      role={title ? "img" : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
      style={{ display: "block", flexShrink: 0, ...style }}
    >
      <rect x={0} y={0} width={24} height={24} rx={5.5} fill={mark.bg} />
      {mark.path ? (
        <path
          d={mark.path}
          fill="#FFFFFF"
          transform="translate(2.4 2.4) scale(0.8)"
        />
      ) : (
        <text
          x={12}
          y={12.5}
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily={LOGO_FONT}
          fontWeight={700}
          fontSize={mark.fontSize}
          fill="#FFFFFF"
        >
          {mark.text}
        </text>
      )}
    </svg>
  );
}

export default BrokerLogo;
