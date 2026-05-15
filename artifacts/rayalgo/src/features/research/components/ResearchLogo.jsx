import { BRAND } from "../data/researchSymbols";
import { MarketIdentityMark } from "../../platform/marketIdentity";
import { T } from "../../../lib/uiTokens.jsx";

export function Logo({ ticker, size = 16, style = {} }) {
  const b = BRAND[ticker] || [T.textDim, ticker?.slice(0,2) || "?"];
  return (
    <MarketIdentityMark
      item={{ ticker, brandColor: b[0], brandText: b[1] }}
      size={size}
      style={{ verticalAlign: "middle", ...style }}
    />
  );
}

/* ════════════════════════ LIVE DATA FETCHER ════════════════════════ */
