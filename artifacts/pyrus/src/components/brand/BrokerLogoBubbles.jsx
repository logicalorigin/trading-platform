import React from "react";

import { BrokerLogo } from "./brokerLogos";
import { normalizeBrokerActivityBadges } from "./brokerLogoBubblesModel.js";

export function BrokerLogoBubbles({
  brokers = [],
  maxVisible = 3,
  size = 18,
  superscript = true,
  className,
  style,
}) {
  const { visible, overflow, accessibleLabel } =
    normalizeBrokerActivityBadges(brokers, maxVisible);
  if (!visible.length) return null;

  return (
    <span
      className={className}
      role="img"
      aria-label={accessibleLabel}
      data-testid="broker-logo-bubbles"
      style={{
        display: "inline-flex",
        alignItems: "center",
        flexShrink: 0,
        transform: superscript ? "translateY(-4px)" : undefined,
        ...style,
      }}
    >
      {visible.map((badge, index) => (
        <span
          key={badge.provider}
          aria-hidden="true"
          title={badge.label}
          style={{
            display: "inline-grid",
            placeItems: "center",
            width: size,
            height: size,
            marginLeft: index ? -Math.max(4, Math.round(size * 0.28)) : 0,
            overflow: "hidden",
            border: "2px solid var(--ra-surface-1, #101722)",
            borderRadius: "50%",
            background: "var(--ra-surface-1, #101722)",
            boxSizing: "content-box",
            position: "relative",
            zIndex: visible.length - index,
          }}
        >
          <BrokerLogo provider={badge.provider} size={size} />
        </span>
      ))}
      {overflow ? (
        <span
          aria-hidden="true"
          title={`${overflow} more ${overflow === 1 ? "broker" : "brokers"}`}
          style={{
            display: "inline-grid",
            placeItems: "center",
            width: size,
            height: size,
            marginLeft: -Math.max(4, Math.round(size * 0.28)),
            border: "2px solid var(--ra-surface-1, #101722)",
            borderRadius: "50%",
            background: "var(--ra-text-muted, #667085)",
            color: "#fff",
            boxSizing: "content-box",
            fontFamily: "Helvetica, Arial, sans-serif",
            fontSize: Math.max(8, Math.round(size * 0.48)),
            fontWeight: 700,
            lineHeight: 1,
          }}
        >
          +{overflow}
        </span>
      ) : null}
    </span>
  );
}

export default BrokerLogoBubbles;
