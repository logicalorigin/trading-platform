import React from "react";

import { BrokerLogo } from "../brand/brokerLogos";
import {
  CSS_COLOR,
  FONT_WEIGHTS,
  RADII,
  T,
  cssColorMix,
  dim,
  fs,
  sp,
} from "../../lib/uiTokens.jsx";
import { motionVars } from "../../lib/motion.jsx";

const BROKER_ACCOUNT_TONES = Object.freeze({
  all: CSS_COLOR.accent,
  alpaca: CSS_COLOR.amber,
  brokerage: CSS_COLOR.textMuted,
  etrade: CSS_COLOR.purple,
  ibkr: CSS_COLOR.red,
  robinhood: CSS_COLOR.green,
  schwab: CSS_COLOR.blue,
  shadow: CSS_COLOR.pink,
  snaptrade: CSS_COLOR.cyan,
  webull: CSS_COLOR.blue,
});

export const brokerAccountTone = (provider) =>
  BROKER_ACCOUNT_TONES[String(provider || "").trim().toLowerCase()] ||
  BROKER_ACCOUNT_TONES.brokerage;

export const brokerAccountCardStyle = ({
  disabled = false,
  invalid = false,
  selected = false,
  tone = CSS_COLOR.accent,
} = {}) => {
  const stateTone = invalid ? CSS_COLOR.red : tone;
  return {
    ...motionVars({ accent: stateTone }),
    background: selected ? cssColorMix(tone, 7) : CSS_COLOR.bg1,
    border: `1px solid ${
      invalid || selected ? cssColorMix(stateTone, 62) : CSS_COLOR.border
    }`,
    borderRadius: dim(RADII.xs),
    boxShadow: selected ? `inset 2px 0 0 ${stateTone}` : "none",
    display: "grid",
    minWidth: 0,
    opacity: disabled ? 0.68 : 1,
    overflow: "hidden",
    position: "relative",
    transition:
      "background-color var(--ra-motion-standard) var(--ra-motion-ease), border-color var(--ra-motion-standard) var(--ra-motion-ease), box-shadow var(--ra-motion-standard) var(--ra-motion-ease), color var(--ra-motion-standard) var(--ra-motion-ease)",
    width: "100%",
  };
};

export const BrokerAccountCard = ({
  children,
  disabled = false,
  invalid = false,
  selected = false,
  style,
  tone = CSS_COLOR.accent,
  ...props
}) => (
  <div
    {...props}
    style={{
      ...brokerAccountCardStyle({ disabled, invalid, selected, tone }),
      ...style,
    }}
  >
    {children}
  </div>
);

export const BrokerAccountIdentity = ({
  dataTestId,
  detail = null,
  detailId,
  detailTone = CSS_COLOR.textMuted,
  eyebrow = "Brokerage",
  isPhone = false,
  label = "Account",
  provider = "brokerage",
  selected = false,
  tone = brokerAccountTone(provider),
}) => {
  const logoSize = dim(isPhone ? 28 : 32);
  return (
    <>
      <span
        aria-hidden="true"
        style={{
          alignSelf: "start",
          borderRadius: dim(RADII.xs),
          display: "grid",
          height: logoSize,
          overflow: "hidden",
          placeItems: "center",
          width: logoSize,
        }}
      >
        <BrokerLogo provider={provider} size={logoSize} />
      </span>
      <span
        data-testid={dataTestId}
        style={{
          alignSelf: "center",
          display: "grid",
          gap: sp(1),
          minWidth: 0,
        }}
      >
        <span
          style={{
            color: selected ? tone : CSS_COLOR.textMuted,
            fontFamily: T.sans,
            fontSize: fs(9),
            fontWeight: FONT_WEIGHTS.label,
            letterSpacing: "0.09em",
            lineHeight: 1.2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
          }}
        >
          {eyebrow}
        </span>
        <span
          style={{
            color: selected ? CSS_COLOR.text : CSS_COLOR.textSec,
            display: "grid",
            fontFamily: T.sans,
            fontSize: fs(isPhone ? 11 : 12),
            fontWeight: FONT_WEIGHTS.label,
            gap: sp(1),
            lineHeight: 1.25,
            minWidth: 0,
            overflow: "hidden",
          }}
        >
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </span>
          {detail && detail !== label ? (
            <span
              id={detailId}
              title={detail}
              style={{
                color: detailTone,
                fontSize: fs(isPhone ? 9 : 10),
                fontWeight: FONT_WEIGHTS.regular,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {detail}
            </span>
          ) : null}
        </span>
      </span>
    </>
  );
};
