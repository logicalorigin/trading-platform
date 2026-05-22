import * as React from "react";
import { PyrusRadialMark, PyrusWordmark } from "./brand/PyrusLogo";
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
    text: "#B8C4D6",
    accent: "#168BFF",
    accentEnd: "#FF3048",
  },
  light: {
    shellBg: "#F7FAFF",
    panelBg: "#FFFFFF",
    text: "#33435A",
    accent: "#0B66D8",
    accentEnd: "#D92840",
  },
} as const;

const resolveLogoLoaderTheme = (): keyof typeof LOGO_LOADER_PALETTES => {
  if (typeof document !== "undefined") {
    return document.documentElement.dataset.pyrusTheme === "light" ||
      document.documentElement.dataset.rayalgoTheme === "light"
      ? "light"
      : "dark";
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
        gap: 18,
        background: tone === "panel" ? palette.panelBg : palette.shellBg,
        color: palette.text,
        fontFamily: FONT_CSS_VAR.sans,
      }}
    >
      <style>
        {`
          @keyframes pyrusBootFade {
            from { opacity: 0; transform: translateY(4px); }
            to { opacity: 1; transform: translateY(0); }
          }
          @keyframes pyrusBootBar {
            0%, 100% { opacity: 0.25; }
            50% { opacity: 1; }
          }
          @keyframes pyrusMarkPulse {
            0%, 100% { opacity: 0.78; transform: scale(0.98); }
            50% { opacity: 1; transform: scale(1.02); }
          }
          @media (prefers-reduced-motion: reduce) {
            .pyrus-boot-wordmark { animation: none; }
            .pyrus-boot-bar { animation: none; opacity: 0.6; }
          }
        `}
      </style>
      <span
        aria-hidden="true"
        className="pyrus-boot-wordmark"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 12,
          animation: "pyrusBootFade 420ms cubic-bezier(0, 0, 0.2, 1) both",
        }}
      >
        <PyrusRadialMark size={38} title="" animated />
        <PyrusWordmark width={112} title="" />
      </span>
      <span
        aria-hidden="true"
        style={{
          display: "inline-flex",
          gap: 4,
        }}
      >
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className="pyrus-boot-bar"
            style={{
              width: 18,
              height: 2,
              background:
                index === 0
                  ? palette.accent
                  : index === 1
                    ? "linear-gradient(90deg, #168BFF, #A14DFF, #FF3048)"
                    : palette.accentEnd,
              borderRadius: 1,
              opacity: 0.25,
              animation: `pyrusBootBar 1200ms ease-in-out ${index * 200}ms infinite`,
            }}
          />
        ))}
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
