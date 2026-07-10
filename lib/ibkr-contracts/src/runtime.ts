export type RuntimeMode = "shadow" | "live";

export type IbkrRuntimeConfig = {
  baseUrl: string;
  bearerToken: string | null;
  cookie: string | null;
  defaultAccountId: string | null;
  extOperator: string | null;
  extraHeaders: Record<string, string>;
  username: string | null;
  password: string | null;
  allowInsecureTls: boolean;
  paperAccountOnly?: boolean;
};

export type MarketDataTransport =
  | "client_portal"
  | "tws"
  | "massive_rest"
  | "massive_websocket";

export type IbkrMarketDataMode =
  | "live"
  | "frozen"
  | "delayed"
  | "delayed_frozen"
  | "unknown";
