// lightweight-charts ultimately paints through canvas; CSS variables and
// color-mix() strings must be resolved before they reach chart options.
// @ts-expect-error JSX module imported into TypeScript context
import { THEMES, cssColorAlpha, resolveCssColor } from "../../lib/uiTokens.jsx";

const hexToRgba = (color: string, opacity = 1): string | null => {
  const match = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(color.trim());
  if (!match) return null;
  const hex = match[1];
  const alpha = match[2] ? Number.parseInt(match[2], 16) / 255 : 1;
  const resolvedOpacity = Math.max(0, Math.min(1, alpha * opacity));
  const channels = [0, 2, 4].map((offset) =>
    Number.parseInt(hex.slice(offset, offset + 2), 16),
  );
  return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${Number(resolvedOpacity.toFixed(4))})`;
};

const rgbToRgba = (color: string, opacity = 1): string | null => {
  const match = /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+))?\s*\)$/i.exec(
    color.trim(),
  );
  if (!match) return null;
  const channels = [match[1], match[2], match[3]].map((channel) =>
    Math.max(0, Math.min(255, Math.round(Number(channel)))),
  );
  if (channels.some((channel) => !Number.isFinite(channel))) return null;
  const alpha = match[4] == null ? 1 : Number(match[4]);
  if (!Number.isFinite(alpha)) return null;
  const resolvedOpacity = Math.max(0, Math.min(1, alpha * opacity));
  return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${Number(resolvedOpacity.toFixed(4))})`;
};

const colorToRgba = (color: string, opacity = 1): string | null =>
  hexToRgba(color, opacity) || rgbToRgba(color, opacity);

export const resolveCanvasColor = (
  color: unknown,
  fallback = THEMES.dark.text,
): string => {
  const raw = typeof color === "string" ? color.trim() : "";
  if (!raw) return fallback;

  const mix = /^color-mix\(\s*in\s+srgb\s*,\s*(.+?)\s+([0-9.]+)%\s*,\s*transparent\s*\)$/i.exec(raw);
  if (mix) {
    const baseColor = resolveCanvasColor(mix[1], fallback);
    const opacity = Math.max(0, Math.min(100, Number(mix[2]))) / 100;
    return colorToRgba(baseColor, opacity) || fallback;
  }

  const resolved = resolveCssColor(raw, fallback);
  if (!resolved || resolved.includes("var(") || /^color-mix\(/i.test(resolved)) {
    return fallback;
  }
  if (/^#[0-9a-fA-F]{8}$/.test(resolved)) {
    return colorToRgba(resolved) || fallback;
  }
  return resolved;
};

export const resolveCanvasColorMaybe = (
  color: unknown,
  fallback = THEMES.dark.text,
): string | undefined =>
  typeof color === "string" && color.trim()
    ? resolveCanvasColor(color, fallback)
    : undefined;

export const resolveCanvasAlphaColor = (
  color: unknown,
  alphaHex: string,
  fallback = THEMES.dark.text,
): string => {
  const baseColor = resolveCanvasColor(color, fallback);
  return resolveCanvasColor(cssColorAlpha(baseColor, alphaHex), baseColor);
};

export const resolveChartColorOptions = (
  value: unknown,
  fallback = THEMES.dark.text,
): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => resolveChartColorOptions(entry, fallback));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      /color/i.test(key) && typeof entry === "string"
        ? resolveCanvasColor(entry, fallback)
        : resolveChartColorOptions(entry, fallback),
    ]),
  );
};
