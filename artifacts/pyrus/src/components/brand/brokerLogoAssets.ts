const configuredBaseUrl = (
  import.meta as unknown as { env?: { BASE_URL?: unknown } }
).env?.BASE_URL;
const runtimeBaseUrl =
  typeof configuredBaseUrl === "string" ? configuredBaseUrl : "/";

const normalizeBaseUrl = (baseUrl: string) => `${baseUrl.replace(/\/+$/, "")}/`;

export const pyrusBrandAssetForBase = (filename: string, baseUrl = "/") =>
  `${normalizeBaseUrl(baseUrl)}brand/${filename.replace(/^\/+/, "")}`;

export const brokerLogoPngsForBase = (baseUrl = "/") =>
  Object.freeze({
    alpaca: pyrusBrandAssetForBase("brokers/alpaca.png", baseUrl),
    etrade: pyrusBrandAssetForBase("brokers/etrade.png", baseUrl),
    ibkr: pyrusBrandAssetForBase("brokers/ibkr.png", baseUrl),
    robinhood: pyrusBrandAssetForBase("brokers/robinhood.png", baseUrl),
    schwab: pyrusBrandAssetForBase("brokers/schwab.png", baseUrl),
    snaptrade: pyrusBrandAssetForBase("brokers/snaptrade.png", baseUrl),
    webull: pyrusBrandAssetForBase("brokers/webull.png", baseUrl),
  });

export const BROKER_LOGO_PNGS = brokerLogoPngsForBase(runtimeBaseUrl);

export const PYRUS_NEURAL_CLOUD_SRC = pyrusBrandAssetForBase(
  "pyrus-neural-cloud.webp",
  runtimeBaseUrl,
);

export type BrokerLogoProvider = keyof typeof BROKER_LOGO_PNGS;
