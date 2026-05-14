import { useMemo, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { getGexDashboard as getGexDashboardRequest } from "@workspace/api-client-react";
import {
  aggregateMetrics,
  isFiniteNumber,
  normalizeGexResponseOptions,
} from "./gexModel.js";
import { resolveTokenColor } from "../../lib/uiTokens.jsx";

export const GEX_DASHBOARD_QUERY_STALE_MS = 30_000;
export const GEX_DASHBOARD_QUERY_REFETCH_MS = 60_000;
export const GEX_ZERO_GAMMA_STALE_MS = 15 * 60_000;
export const GEX_ZERO_GAMMA_LABEL = "γ flip";

const GEX_ZERO_GAMMA_TOKEN = "--ra-gex-zero-gamma";
const GEX_ZERO_GAMMA_FALLBACK = "#6FB5C2";
const GEX_ZERO_GAMMA_STALE_BLEND_TOKEN = "--ra-surface-1";
const GEX_ZERO_GAMMA_STALE_BLEND_FALLBACK = "#1E1D22";
const THEME_ATTRIBUTE_FILTER = [
  "data-rayalgo-theme",
  "data-rayalgo-color-mode",
  "class",
  "style",
];

let gexTokenVersion = 0;
let gexTokenObserver = null;
const gexTokenListeners = new Set();

const notifyGexTokenListeners = () => {
  gexTokenVersion += 1;
  gexTokenListeners.forEach((listener) => listener());
};

const ensureGexTokenObserver = () => {
  if (
    gexTokenObserver ||
    typeof document === "undefined" ||
    typeof MutationObserver === "undefined"
  ) {
    return;
  }

  gexTokenObserver = new MutationObserver(notifyGexTokenListeners);
  gexTokenObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: THEME_ATTRIBUTE_FILTER,
  });
};

const subscribeGexTokenVersion = (listener) => {
  ensureGexTokenObserver();
  gexTokenListeners.add(listener);

  return () => {
    gexTokenListeners.delete(listener);
    if (!gexTokenListeners.size && gexTokenObserver) {
      gexTokenObserver.disconnect();
      gexTokenObserver = null;
    }
  };
};

const getGexTokenVersion = () => gexTokenVersion;
const getServerGexTokenVersion = () => 0;

const normalizeGexTicker = (ticker) =>
  String(ticker || "")
    .trim()
    .toUpperCase();

const resolveGexAsOf = (data) =>
  data?.timestamp ||
  data?.source?.chainUpdatedAt ||
  data?.source?.quoteUpdatedAt ||
  null;

const isStaleAsOf = (asOf, nowMs) => {
  if (!asOf) {
    return false;
  }
  const asOfMs = new Date(asOf).getTime();
  return Number.isFinite(asOfMs) && nowMs - asOfMs > GEX_ZERO_GAMMA_STALE_MS;
};

const parseRgbColor = (color) => {
  const value = String(color || "").trim();
  const hexMatch = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hexMatch) {
    const hex = hexMatch[1];
    const expanded =
      hex.length === 3
        ? hex
            .split("")
            .map((part) => `${part}${part}`)
            .join("")
        : hex;
    return [
      Number.parseInt(expanded.slice(0, 2), 16),
      Number.parseInt(expanded.slice(2, 4), 16),
      Number.parseInt(expanded.slice(4, 6), 16),
    ];
  }

  const rgbMatch = value.match(
    /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)/i,
  );
  if (!rgbMatch) {
    return null;
  }
  const components = [
    Number(rgbMatch[1]),
    Number(rgbMatch[2]),
    Number(rgbMatch[3]),
  ];
  if (!components.every(Number.isFinite)) {
    return null;
  }
  return components.map((component) =>
    Math.max(0, Math.min(255, Math.round(component))),
  );
};

const toHexColor = ([red, green, blue]) =>
  `#${[red, green, blue]
    .map((component) =>
      Math.max(0, Math.min(255, Math.round(component)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

export const blendGexOverlayColor = (
  color,
  target,
  ratio = 0.5,
) => {
  const from = parseRgbColor(color);
  const to = parseRgbColor(target);
  if (!from || !to) {
    return color;
  }
  const weight = Math.max(0, Math.min(1, ratio));
  return toHexColor([
    from[0] + (to[0] - from[0]) * weight,
    from[1] + (to[1] - from[1]) * weight,
    from[2] + (to[2] - from[2]) * weight,
  ]);
};

export const resolveGexZeroGammaOverlay = (
  data,
  nowMs = Date.now(),
) => {
  const spot = isFiniteNumber(data?.spot) ? Number(data?.spot) : null;
  const { rows } = normalizeGexResponseOptions(data?.options || []);
  const metrics = spot != null ? aggregateMetrics(rows, spot) : null;
  const price = isFiniteNumber(metrics?.zeroGamma)
    ? Number(metrics?.zeroGamma)
    : null;
  const asOf = resolveGexAsOf(data);

  return {
    price,
    asOf,
    isStale: Boolean(data?.isStale) || isStaleAsOf(asOf, nowMs),
  };
};

export const buildGexZeroGammaReferenceLine = (overlay) => {
  if (!isFiniteNumber(overlay?.price)) {
    return null;
  }

  const color = resolveTokenColor(
    GEX_ZERO_GAMMA_TOKEN,
    GEX_ZERO_GAMMA_FALLBACK,
  );
  const staleBlendColor = resolveTokenColor(
    GEX_ZERO_GAMMA_STALE_BLEND_TOKEN,
    GEX_ZERO_GAMMA_STALE_BLEND_FALLBACK,
  );

  return {
    price: Number(overlay?.price),
    color: overlay?.isStale
      ? blendGexOverlayColor(color, staleBlendColor, 0.5)
      : color,
    lineWidth: 1,
    axisLabelVisible: true,
    title: GEX_ZERO_GAMMA_LABEL,
  };
};

export function useGexZeroGammaReferenceLine(overlay) {
  const tokenVersion = useSyncExternalStore(
    subscribeGexTokenVersion,
    getGexTokenVersion,
    getServerGexTokenVersion,
  );

  return useMemo(
    () => buildGexZeroGammaReferenceLine(overlay),
    [overlay?.isStale, overlay?.price, tokenVersion],
  );
}

export function useGexZeroGamma(ticker, options = {}) {
  const normalizedTicker = useMemo(() => normalizeGexTicker(ticker), [ticker]);
  const enabled = Boolean((options.enabled ?? true) && normalizedTicker);
  const query = useQuery({
    queryKey: ["gex-dashboard", normalizedTicker],
    queryFn: ({ signal }) =>
      getGexDashboardRequest(encodeURIComponent(normalizedTicker), { signal }),
    enabled,
    staleTime: GEX_DASHBOARD_QUERY_STALE_MS,
    refetchInterval: enabled ? GEX_DASHBOARD_QUERY_REFETCH_MS : false,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  return useMemo(
    () => resolveGexZeroGammaOverlay(query.data),
    [query.data],
  );
}
