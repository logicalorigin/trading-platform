import React, { type CSSProperties } from "react";

import {
  BROKER_LOGO_PNGS,
  PYRUS_NEURAL_CLOUD_SRC,
  type BrokerLogoProvider,
} from "./brokerLogoAssets";

const SYNTHETIC_MARKS = {
  all: { bg: "#168BFF", text: "Σ", fontSize: 13 },
  brokerage: { bg: "#788AA0", text: "BR", fontSize: 9 },
} as const;

export type BrokerProvider =
  | BrokerLogoProvider
  | keyof typeof SYNTHETIC_MARKS
  | "shadow";

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
  const normalizedProvider = String(provider || "").toLowerCase();
  const source =
    BROKER_LOGO_PNGS[normalizedProvider as BrokerLogoProvider] || null;
  const sharedStyle: CSSProperties = {
    flexShrink: 0,
    width: size,
    height: size,
  };

  if (normalizedProvider === "shadow") {
    return (
      <span
        className={["pyrus-shadow-cloud-mark", className]
          .filter(Boolean)
          .join(" ")}
        role={title ? "img" : undefined}
        aria-label={title || undefined}
        aria-hidden={title ? undefined : true}
        style={{ ...sharedStyle, ...style }}
      >
        <img
          alt=""
          aria-hidden="true"
          className="pyrus-shadow-cloud-image"
          decoding="async"
          draggable={false}
          src={PYRUS_NEURAL_CLOUD_SRC}
        />
      </span>
    );
  }

  if (source) {
    return (
      <img
        src={source}
        alt={title || ""}
        aria-hidden={title ? undefined : true}
        width={size}
        height={size}
        className={className}
        style={{
          ...sharedStyle,
          display: "block",
          borderRadius: "22%",
          objectFit: "contain",
          transform: normalizedProvider === "webull" ? "scale(1.2)" : undefined,
          ...style,
        }}
      />
    );
  }

  const mark =
    SYNTHETIC_MARKS[normalizedProvider as keyof typeof SYNTHETIC_MARKS] ||
    SYNTHETIC_MARKS.brokerage;
  return (
    <span
      className={className}
      role={title ? "img" : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
      style={{
        ...sharedStyle,
        display: "grid",
        placeItems: "center",
        borderRadius: "22%",
        background: mark.bg,
        color: "#FFFFFF",
        fontFamily: "Helvetica, Arial, sans-serif",
        fontSize: size * (mark.fontSize / 24),
        fontWeight: 700,
        lineHeight: 1,
        ...style,
      }}
    >
      {mark.text}
    </span>
  );
}

export default BrokerLogo;
