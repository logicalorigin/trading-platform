import { memo, useMemo } from "react";

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
  const srcDoc = useMemo(() => {
    const [exchange = "NASDAQ", ticker = "AAPL"] = symbol.split(":");
    const copyrightHref = `https://www.tradingview.com/symbols/${exchange}-${ticker}/`;
    const copyrightLabel = `${ticker} stock chart`;
    const config = JSON.stringify({
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

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      html, body {
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: ${theme === "dark" ? "#131722" : "#ffffff"};
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .tradingview-widget-container {
        width: 100%;
        height: 100%;
      }
      .tradingview-widget-container__widget {
        width: 100%;
        height: calc(100% - 32px);
      }
      .tradingview-widget-copyright {
        box-sizing: border-box;
        height: 32px;
        display: flex;
        align-items: center;
        padding: 0 10px;
        font-size: 11px;
        color: #64748b;
        background: ${theme === "dark" ? "#131722" : "#ffffff"};
        border-top: 1px solid ${theme === "dark" ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.08)"};
      }
      .tradingview-widget-copyright a {
        color: #2962ff;
        text-decoration: none;
      }
      .tradingview-widget-copyright span + span {
        margin-left: 4px;
      }
    </style>
  </head>
  <body>
    <div class="tradingview-widget-container">
      <div class="tradingview-widget-container__widget"></div>
      <div class="tradingview-widget-copyright">
        <a href="${copyrightHref}" rel="noopener nofollow" target="_blank">${copyrightLabel}</a>
        <span>by TradingView</span>
      </div>
      <script type="text/javascript" src="https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js" async>${config}</script>
    </div>
  </body>
</html>`;
  }, [interval, locale, symbol, theme]);

  return (
    <iframe
      data-testid={dataTestId}
      srcDoc={srcDoc}
      title="TradingView Widget Reference"
      sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      style={{
        width: "100%",
        height: "100%",
        border: "none",
        display: "block",
        background: theme === "dark" ? "#131722" : "#ffffff",
      }}
    />
  );
});

TradingViewWidgetReference.displayName = "TradingViewWidgetReference";
