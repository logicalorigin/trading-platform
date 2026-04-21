import { memo, useEffect, useMemo, useRef } from "react";

type TradingViewWidgetReferenceProps = {
  symbol?: string;
  interval?: string;
  theme?: "light" | "dark";
  locale?: string;
  dataTestId?: string;
};

const resolveTradingViewInterval = (interval: string): string => {
  switch (interval) {
    case "1m":
      return "1";
    case "5m":
      return "5";
    case "15m":
      return "15";
    case "1h":
      return "60";
    case "1D":
      return "D";
    default:
      return "D";
  }
};

export const TradingViewWidgetReference = memo(({
  symbol = "NASDAQ:AAPL",
  interval = "1D",
  theme = "dark",
  locale = "en",
  dataTestId,
}: TradingViewWidgetReferenceProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const copyrightHref = useMemo(() => {
    const [exchange = "NASDAQ", ticker = "AAPL"] = symbol.split(":");
    return `https://www.tradingview.com/symbols/${exchange}-${ticker}/`;
  }, [symbol]);
  const copyrightLabel = useMemo(() => {
    const [, ticker = "AAPL"] = symbol.split(":");
    return `${ticker} stock chart`;
  }, [symbol]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      allow_symbol_change: true,
      calendar: false,
      details: false,
      hide_side_toolbar: true,
      hide_top_toolbar: false,
      hide_legend: false,
      hide_volume: false,
      hotlist: false,
      interval: resolveTradingViewInterval(interval),
      locale,
      save_image: true,
      style: "1",
      symbol,
      theme,
      timezone: "Etc/UTC",
      backgroundColor: theme === "dark" ? "#131722" : "#ffffff",
      gridColor: "rgba(46, 46, 46, 0.06)",
      watchlist: [],
      withdateranges: false,
      compareSymbols: [],
      studies: [],
      autosize: true,
    });

    container.appendChild(script);

    return () => {
      container.innerHTML = "";
    };
  }, [interval, locale, symbol, theme]);

  return (
    <div
      className="tradingview-widget-container"
      data-testid={dataTestId}
      style={{ width: "100%", height: "100%" }}
    >
      <div
        ref={containerRef}
        className="tradingview-widget-container__widget"
        style={{ width: "100%", height: "calc(100% - 32px)" }}
      />
      <div
        className="tradingview-widget-copyright"
        style={{
          height: 32,
          display: "flex",
          alignItems: "center",
          padding: "0 10px",
          fontSize: 11,
          fontFamily: "system-ui, -apple-system, sans-serif",
          color: "#64748b",
          background: theme === "dark" ? "#131722" : "#ffffff",
          borderTop: theme === "dark" ? "1px solid rgba(255,255,255,0.06)" : "1px solid rgba(15,23,42,0.08)",
          boxSizing: "border-box",
        }}
      >
        <a
          href={copyrightHref}
          rel="noopener nofollow"
          target="_blank"
          style={{ color: "#2962ff", textDecoration: "none" }}
        >
          {copyrightLabel}
        </a>
        <span style={{ marginLeft: 4 }}>by TradingView</span>
      </div>
    </div>
  );
});

TradingViewWidgetReference.displayName = "TradingViewWidgetReference";
