import { PyrusLoaderMark } from "./brand/pyrus-loader-mark";
import { FONT_CSS_VAR } from "../lib/typography";

export type BrandLoaderTone = "app" | "panel";

export type BrandLoaderProps = {
  label?: string;
  minHeight?: string | number;
  tone?: BrandLoaderTone;
  testId?: string;
};

const BRAND_LOADER_SHELL_BG = "#050914";
const BRAND_LOADER_PANEL_BG = "#050914";

const normalizeMinHeight = (value: string | number): string =>
  typeof value === "number" ? `${value}px` : value;

export function BrandLoader({
  label = "PYRUS",
  minHeight = "100vh",
  tone = "app",
  testId = "brand-loader",
}: BrandLoaderProps) {
  const normalizedMinHeight = normalizeMinHeight(minHeight);
  const isPanel = tone === "panel";

  return (
    <div
      role="status"
      aria-label={label}
      data-testid={testId}
      data-theme="dark"
      data-tone={tone}
      style={{
        minHeight: normalizedMinHeight,
        height: isPanel ? "100%" : undefined,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        background: isPanel ? BRAND_LOADER_PANEL_BG : BRAND_LOADER_SHELL_BG,
        fontFamily: FONT_CSS_VAR.sans,
      }}
    >
      <div aria-hidden="true" className="brand-loader-lockup">
        <div className="brand-loader-mark">
          <PyrusLoaderMark
            className={isPanel ? "h-[60px] w-[60px]" : "h-[104px] w-[104px]"}
          />
        </div>
        <img
          src="/brand/pyrus-wordmark-tight.png"
          alt="Pyrus"
          className="brand-loader-word"
          height={isPanel ? 18 : 26}
          width={isPanel ? 148 : 213}
          style={{ mixBlendMode: "screen" }}
        />
      </div>
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

export default BrandLoader;
