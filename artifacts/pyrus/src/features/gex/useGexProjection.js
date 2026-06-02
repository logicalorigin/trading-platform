import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { isFiniteNumber } from "./gexModel.js";

export const GEX_PROJECTION_QUERY_STALE_MS = 60_000;
export const GEX_PROJECTION_QUERY_REFETCH_MS = 60_000;

const normalizeGexTicker = (ticker) =>
  String(ticker || "")
    .trim()
    .toUpperCase();

export const fetchGexProjection = async (ticker, { signal } = {}) => {
  const normalizedTicker = normalizeGexTicker(ticker);
  if (!normalizedTicker) {
    return null;
  }

  const response = await fetch(
    `/api/gex/${encodeURIComponent(normalizedTicker)}/projection?view=chart`,
    { signal },
  );
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const payload = await response.json();
      message = payload?.detail || payload?.message || payload?.error || message;
    } catch {}
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return response.json();
};

export const buildGexProjectionConeOverlay = (payload) => {
  if (!payload || !Array.isArray(payload.overlayPoints)) {
    return null;
  }
  const points = payload.overlayPoints
    .filter((point) =>
      [
        point?.lower2,
        point?.lower1,
        point?.center,
        point?.upper1,
        point?.upper2,
      ].every(isFiniteNumber),
    )
    .map((point) => ({
      expirationDate: String(point.expirationDate || point.time || ""),
      lower2: Number(point.lower2),
      lower1: Number(point.lower1),
      center: Number(point.center),
      upper1: Number(point.upper1),
      upper2: Number(point.upper2),
      qualityStatus: point.qualityStatus || "partial",
    }))
    .filter((point) => point.expirationDate);

  if (!points.length || !isFiniteNumber(payload.spot) || payload.spot <= 0) {
    return null;
  }

  return {
    ticker: normalizeGexTicker(payload.ticker),
    spot: Number(payload.spot),
    asOf: payload.asOf || null,
    qualityStatus: payload.quality?.status || "partial",
    points,
  };
};

export const useGexProjection = (ticker, { enabled = true } = {}) => {
  const normalizedTicker = normalizeGexTicker(ticker);
  return useQuery({
    queryKey: ["gex-projection", normalizedTicker],
    enabled: Boolean(enabled && normalizedTicker),
    queryFn: ({ signal }) => fetchGexProjection(normalizedTicker, { signal }),
    staleTime: GEX_PROJECTION_QUERY_STALE_MS,
    refetchInterval: enabled ? GEX_PROJECTION_QUERY_REFETCH_MS : false,
    placeholderData: (previousData) => previousData,
  });
};

export const useGexProjectionConeOverlay = (ticker, options = {}) => {
  const query = useGexProjection(ticker, options);
  const overlay = useMemo(
    () => buildGexProjectionConeOverlay(query.data),
    [query.data],
  );
  return { ...query, overlay };
};
