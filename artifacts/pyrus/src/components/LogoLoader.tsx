import * as React from "react";
import { LogoLockup } from "./brand/PyrusLogo";
import { FONT_CSS_VAR } from "../lib/typography";

type LogoLoaderTone = "app" | "panel";

type LogoLoaderProps = {
  label?: string;
  minHeight?: string | number;
  tone?: LogoLoaderTone;
  testId?: string;
};

const LOGO_LOADER_PALETTES = {
  dark: {
    shellBg: "#050814",
    panelBg: "#090D18",
  },
  light: {
    shellBg: "#F7FAFF",
    panelBg: "#FFFFFF",
  },
} as const;

const resolveLogoLoaderTheme = (): keyof typeof LOGO_LOADER_PALETTES => {
  if (typeof document !== "undefined") {
    return document.documentElement.dataset.pyrusTheme === "light" ? "light" : "dark";
  }

  return "dark";
};

const normalizeMinHeight = (value: string | number): string =>
  typeof value === "number" ? `${value}px` : value;

export function LogoLoader({
  label = "PYRUS",
  minHeight = "100vh",
  tone = "app",
  testId = "logo-loader",
}: LogoLoaderProps) {
  const themeKey = resolveLogoLoaderTheme();
  const palette = LOGO_LOADER_PALETTES[themeKey];
  const normalizedMinHeight = normalizeMinHeight(minHeight);

  return (
    <div
      role="status"
      aria-label={label}
      data-testid={testId}
      data-theme={themeKey}
      data-tone={tone}
      style={{
        minHeight: normalizedMinHeight,
        height: tone === "panel" ? "100%" : undefined,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        background: tone === "panel" ? palette.panelBg : palette.shellBg,
        fontFamily: FONT_CSS_VAR.sans,
      }}
    >
      <span aria-hidden="true" className="pyrus-loader-lockup">
        <LogoLockup
          descriptor={tone === "panel" ? "" : "Algo Trading Platform"}
          markClassName={tone === "panel" ? "h-12 w-12" : "h-32 w-32"}
          wordmarkWidth={tone === "panel" ? 116 : 190}
        />
      </span>
      <span
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          overflow: "hidden",
          clip: "rect(0 0 0 0)",
        }}
      >
        {label}
      </span>
    </div>
  );
}

export default LogoLoader;
