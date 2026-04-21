import { randomUUID } from "node:crypto";
import { HttpError } from "../../lib/errors";
import { fetchJson, withSearchParams, type QueryValue } from "../../lib/http";
import type { IbkrRuntimeConfig, RuntimeMode } from "../../lib/runtime";
import {
  asArray,
  asNumber,
  asRecord,
  asString,
  compact,
  findCaseInsensitiveValue,
  firstDefined,
  getNumberPath,
  getStringPath,
  normalizeSymbol,
  toDate,
  toIbkrMonthCode,
} from "../../lib/values";

type AssetClass = "equity" | "option";
type OptionRight = "call" | "put";
type OrderSide = "buy" | "sell";
type OrderStatus =
  | "pending_submit"
  | "submitted"
  | "accepted"
  | "partially_filled"
  | "filled"
  | "canceled"
  | "rejected"
  | "expired";
type OrderType = "market" | "limit" | "stop" | "stop_limit";
type TimeInForce = "day" | "gtc" | "ioc" | "fok";
type HeaderInput = ConstructorParameters<typeof Headers>[0];
type OptionContractSnapshot = {
  ticker: string;
  underlying: string;
  expirationDate: Date;
  strike: number;
  right: OptionRight;
  multiplier: number;
  sharesPerContract: number;
  providerContractId?: string | null;
};

export type BrokerAccountSnapshot = {
  id: string;
  providerAccountId: string;
  provider: "ibkr";
  mode: RuntimeMode;
  displayName: string;
  currency: string;
  buyingPower: number;
  cash: number;
  netLiquidation: number;
  updatedAt: Date;
};

export type BrokerPositionSnapshot = {
  id: string;
  accountId: string;
  symbol: string;
  assetClass: AssetClass;
  quantity: number;
  averagePrice: number;
  marketPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  optionContract: (OptionContractSnapshot & { providerContractId: string | null }) | null;
};

export type BrokerOrderSnapshot = {
  id: string;
  accountId: string;
  mode: RuntimeMode;
  symbol: string;
  assetClass: AssetClass;
  side: OrderSide;
  type: OrderType;
  timeInForce: TimeInForce;
  status: OrderStatus;
  quantity: number;
  filledQuantity: number;
  limitPrice: number | null;
  stopPrice: number | null;
  placedAt: Date;
  updatedAt: Date;
  optionContract: BrokerPositionSnapshot["optionContract"];
};

export type PlaceOrderInput = {
  accountId: string;
  mode: RuntimeMode;
  symbol: string;
  assetClass: AssetClass;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  limitPrice?: number | null;
  stopPrice?: number | null;
  timeInForce: TimeInForce;
  optionContract: OptionContractSnapshot | null;
};

const IBKR_TO_INTERNAL_TIF: Record<string, TimeInForce> = {
  DAY: "day",
  GTC: "gtc",
  IOC: "ioc",
  FOK: "fok",
};

const INTERNAL_TO_IBKR_TIF: Record<TimeInForce, string> = {
  day: "DAY",
  gtc: "GTC",
  ioc: "IOC",
  fok: "FOK",
};

const INTERNAL_TO_IBKR_ORDER_TYPE: Record<OrderType, string> = {
  market: "MKT",
  limit: "LMT",
  stop: "STP",
  stop_limit: "STP LMT",
};

function normalizeMetricKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function readMetricValue(metric: unknown): number | null {
  if (metric === null || metric === undefined) {
    return null;
  }

  const direct = asNumber(metric);
  if (direct !== null) {
    return direct;
  }

  const record = asRecord(metric);
  if (!record) {
    return null;
  }

  return firstDefined(
    asNumber(record["amount"]),
    asNumber(record["value"]),
    asNumber(record["current"]),
    asNumber(record["rawValue"]),
  );
}

function findMetric(source: unknown, candidates: string[]): number | null {
  const record = asRecord(source);
  if (!record) {
    return null;
  }

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeMetricKey(candidate);
    const entry = Object.entries(record).find(
      ([key]) => normalizeMetricKey(key) === normalizedCandidate,
    );

    if (entry) {
      const numeric = readMetricValue(entry[1]);
      if (numeric !== null) {
        return numeric;
      }
    }
  }

  return null;
}

function normalizeAssetClass(value: string | null): AssetClass | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toUpperCase();

  if (normalized === "OPT") {
    return "option";
  }

  if (normalized === "STK" || normalized === "ETF") {
    return "equity";
  }

  return null;
}

function normalizeOptionRight(value: string | null): OptionRight | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "call" || normalized === "c") {
    return "call";
  }

  if (normalized === "put" || normalized === "p") {
    return "put";
  }

  return null;
}

function normalizeOrderSide(value: string | null): OrderSide {
  return value?.trim().toUpperCase() === "SELL" ? "sell" : "buy";
}

function normalizeOrderType(value: string | null): OrderType {
  const normalized = value?.trim().toUpperCase() ?? "MKT";

  if (normalized === "LMT" || normalized === "LIMIT") {
    return "limit";
  }

  if (normalized === "STP" || normalized === "STOP") {
    return "stop";
  }

  if (normalized === "STP LMT" || normalized === "STOP_LIMIT") {
    return "stop_limit";
  }

  return "market";
}

function normalizeTimeInForce(value: string | null): TimeInForce {
  const normalized = value?.trim().toUpperCase() ?? "DAY";
  return IBKR_TO_INTERNAL_TIF[normalized] ?? "day";
}

function normalizeOrderStatus(
  value: string | null,
  filledQuantity: number,
  remainingQuantity: number,
): OrderStatus {
  const normalized = normalizeMetricKey(value ?? "");

  if (filledQuantity > 0 && remainingQuantity > 0) {
    return "partially_filled";
  }

  if (normalized.includes("pendingsubmit")) {
    return "pending_submit";
  }

  if (normalized.includes("accepted") || normalized.includes("working")) {
    return "accepted";
  }

  if (normalized.includes("submitted") || normalized.includes("presubmitted")) {
    return "submitted";
  }

  if (normalized.includes("filled")) {
    return "filled";
  }

  if (normalized.includes("cancel")) {
    return "canceled";
  }

  if (normalized.includes("expire")) {
    return "expired";
  }

  if (normalized.includes("reject") || normalized.includes("inactive")) {
    return "rejected";
  }

  return "submitted";
}

function parseOptionDetails(record: Record<string, unknown>): BrokerPositionSnapshot["optionContract"] {
  const providerContractId = asString(record["conid"]);
  const underlying =
    firstDefined(
      asString(record["ticker"]),
      asString(record["description1"]),
      asString(record["symbol"]),
    ) ?? null;
  const expirationDate = toDate(
    firstDefined(record["expiry"], record["maturityDate"]),
  );
  const strike =
    firstDefined(asNumber(record["strike"]), asNumber(record["strikePrice"])) ?? null;
  const right = normalizeOptionRight(
    firstDefined(asString(record["putOrCall"]), asString(record["right"])),
  );
  const multiplier = asNumber(record["multiplier"]) ?? 100;

  if (!underlying || !expirationDate || strike === null || !right) {
    return null;
  }

  const description = asString(record["contractDesc"]);
  const bracketMatch = description?.match(/\[([A-Z0-9 ]+\d{6}[CP]\d+)\s+\d+\]$/);
  const ticker =
    bracketMatch?.[1]?.replace(/\s+/g, "") ??
    asString(record["localSymbol"]) ??
    `${underlying}-${expirationDate.toISOString().slice(0, 10)}-${right}-${strike}`;

  return {
    ticker,
    underlying: normalizeSymbol(underlying),
    expirationDate,
    strike,
    right,
    multiplier,
    sharesPerContract: multiplier,
    providerContractId,
  };
}

export class IbkrClient {
  constructor(private readonly config: IbkrRuntimeConfig) {}

  private buildHeaders(initHeaders?: HeaderInput): Headers {
    const headers = new Headers({
      Accept: "application/json",
    });

    Object.entries(this.config.extraHeaders).forEach(([key, value]) => {
      headers.set(key, value);
    });

    if (this.config.bearerToken) {
      headers.set("Authorization", `Bearer ${this.config.bearerToken}`);
    }

    if (this.config.cookie) {
      headers.set("Cookie", this.config.cookie);
    }

    new Headers(initHeaders).forEach((value, key) => {
      headers.set(key, value);
    });

    return headers;
  }

  private buildUrl(path: string, params: Record<string, QueryValue> = {}): URL {
    return withSearchParams(`${this.config.baseUrl}${path}`, params);
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    params: Record<string, QueryValue> = {},
  ): Promise<T> {
    const headers = this.buildHeaders(init.headers);

    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    return fetchJson<T>(this.buildUrl(path, params), {
      ...init,
      headers,
    });
  }

  private async getPortfolioAccounts(): Promise<Record<string, unknown>[]> {
    const payload = await this.request<unknown>("/portfolio/accounts");
    return compact(asArray(payload).map(asRecord));
  }

  private async getTradingAccountsInfo(): Promise<{
    accounts: string[];
    allowCustomerTime: boolean;
  }> {
    const payload = await this.request<unknown>("/iserver/accounts");
    const record = asRecord(payload);

    return {
      accounts: compact(asArray(record?.["accounts"]).map(asString)),
      allowCustomerTime: Boolean(record?.["allowCustomerTime"]),
    };
  }

  private async getAccountSummary(accountId: string): Promise<Record<string, unknown> | null> {
    const payload = await this.request<unknown>(
      `/portfolio/${encodeURIComponent(accountId)}/summary`,
    );

    return asRecord(payload);
  }

  private async getAccountLedger(accountId: string): Promise<Record<string, unknown> | null> {
    const payload = await this.request<unknown>(
      `/portfolio/${encodeURIComponent(accountId)}/ledger`,
    );

    return asRecord(payload);
  }

  private getBaseLedger(ledger: Record<string, unknown> | null): Record<string, unknown> | null {
    if (!ledger) {
      return null;
    }

    return (
      asRecord(findCaseInsensitiveValue(ledger, "BASE")) ??
      compact(Object.values(ledger).map(asRecord))[0] ??
      null
    );
  }

  async listAccounts(mode: RuntimeMode): Promise<BrokerAccountSnapshot[]> {
    const accounts = await this.getPortfolioAccounts();

    return Promise.all(
      accounts.map(async (account) => {
        const accountId =
          firstDefined(asString(account["accountId"]), asString(account["id"])) ??
          null;

        if (!accountId) {
          throw new HttpError(502, "IBKR returned an account without an account ID.", {
            code: "ibkr_invalid_account",
          });
        }

        const [summary, ledger] = await Promise.all([
          this.getAccountSummary(accountId),
          this.getAccountLedger(accountId),
        ]);

        const baseLedger = this.getBaseLedger(ledger);
        const currency =
          firstDefined(
            asString(account["currency"]),
            asString(baseLedger?.["currency"]),
            "USD",
          ) ?? "USD";

        const cash =
          firstDefined(
            findMetric(summary, ["totalcashvalue", "cashbalance", "settledcash"]),
            findMetric(baseLedger, ["cashbalance", "settledcash"]),
          ) ?? 0;

        const netLiquidation =
          firstDefined(
            findMetric(summary, ["netliquidation", "netliquidationvalue"]),
            findMetric(baseLedger, ["netliquidationvalue", "netliquidation"]),
          ) ?? cash;

        const buyingPower =
          firstDefined(
            findMetric(summary, ["buyingpower", "availablefunds"]),
            netLiquidation,
          ) ?? 0;

        return {
          id: accountId,
          providerAccountId: accountId,
          provider: "ibkr" as const,
          mode,
          displayName:
            firstDefined(
              asString(account["displayName"]),
              asString(account["accountTitle"]),
              asString(account["desc"]),
              accountId,
            ) ?? accountId,
          currency,
          buyingPower,
          cash,
          netLiquidation,
          updatedAt: new Date(),
        };
      }),
    );
  }

  private async listAccountPositions(accountId: string): Promise<BrokerPositionSnapshot[]> {
    const positions: BrokerPositionSnapshot[] = [];
    let pageId = 0;

    while (pageId < 20) {
      const payload = await this.request<unknown>(
        `/portfolio/${encodeURIComponent(accountId)}/positions/${pageId}`,
      );
      const page = compact(asArray(payload).map(asRecord));

      if (page.length === 0) {
        break;
      }

      positions.push(
        ...compact(
          page.map((position) => {
            const assetClass = normalizeAssetClass(
              firstDefined(
                asString(position["assetClass"]),
                asString(position["secType"]),
              ),
            );
            const quantity = asNumber(position["position"]);

            if (!assetClass || quantity === null) {
              return null;
            }

            const optionContract =
              assetClass === "option" ? parseOptionDetails(position) : null;
            const symbol =
              assetClass === "option"
                ? optionContract?.underlying ?? normalizeSymbol(asString(position["ticker"]) ?? "")
                : normalizeSymbol(
                    firstDefined(
                      asString(position["ticker"]),
                      asString(position["contractDesc"]),
                      asString(position["description"]),
                    ) ?? "",
                  );

            if (!symbol) {
              return null;
            }

            const averagePrice =
              firstDefined(
                asNumber(position["avgPrice"]),
                asNumber(position["avgCost"]),
              ) ?? 0;
            const marketPrice =
              firstDefined(
                asNumber(position["mktPrice"]),
                asNumber(position["marketPrice"]),
              ) ?? averagePrice;
            const marketValue =
              firstDefined(
                asNumber(position["mktValue"]),
                asNumber(position["marketValue"]),
              ) ?? marketPrice * quantity;
            const unrealizedPnl =
              firstDefined(
                asNumber(position["unrealizedPnl"]),
                asNumber(position["unrealized_pnl"]),
              ) ?? 0;
            const multiplier = optionContract?.sharesPerContract ?? 1;
            const denominator =
              Math.abs(averagePrice * quantity * multiplier) || Math.abs(marketValue) || 1;

            return {
              id: `${accountId}:${asString(position["conid"]) ?? symbol}`,
              accountId,
              symbol,
              assetClass,
              quantity,
              averagePrice,
              marketPrice,
              marketValue,
              unrealizedPnl,
              unrealizedPnlPercent: (unrealizedPnl / denominator) * 100,
              optionContract,
            };
          }),
        ),
      );

      if (page.length < 100) {
        break;
      }

      pageId += 1;
    }

    return positions;
  }

  async listPositions(input: {
    accountId?: string;
    mode: RuntimeMode;
  }): Promise<BrokerPositionSnapshot[]> {
    const accountIds = input.accountId
      ? [input.accountId]
      : (await this.getPortfolioAccounts()).flatMap((account) => {
          const accountId =
            firstDefined(asString(account["accountId"]), asString(account["id"])) ??
            null;
          return accountId ? [accountId] : [];
        });

    const positions = await Promise.all(
      accountIds.map((accountId) => this.listAccountPositions(accountId)),
    );

    return positions.flat();
  }

  async listOrders(input: {
    accountId?: string;
    mode: RuntimeMode;
    status?: OrderStatus;
  }): Promise<BrokerOrderSnapshot[]> {
    const tradingAccounts = await this.getTradingAccountsInfo();
    const accountIds = input.accountId
      ? [input.accountId]
      : tradingAccounts.accounts.length > 0
        ? tradingAccounts.accounts
        : this.config.defaultAccountId
          ? [this.config.defaultAccountId]
          : [];

    if (accountIds.length === 0) {
      return [];
    }

    const orderLists: BrokerOrderSnapshot[][] = [];

    for (const accountId of accountIds) {
      const payload = await this.request<unknown>(
        "/iserver/account/orders",
        {},
        {
          force: true,
          accountId,
        },
      );
      const record = asRecord(payload);
      const orders = compact(
        asArray(record?.["orders"]).map((order) => {
          const raw = asRecord(order);
          if (!raw) {
            return null;
          }

          const filledQuantity =
            firstDefined(
              asNumber(raw["filledQuantity"]),
              asNumber(raw["filled_quantity"]),
            ) ?? 0;
          const remainingQuantity =
            firstDefined(
              asNumber(raw["remainingQuantity"]),
              asNumber(raw["remaining_quantity"]),
            ) ?? 0;
          const status = normalizeOrderStatus(
            firstDefined(
              asString(raw["order_ccp_status"]),
              asString(raw["status"]),
            ),
            filledQuantity,
            remainingQuantity,
          );

          const mapped: BrokerOrderSnapshot = {
            id:
              firstDefined(asString(raw["orderId"]), asString(raw["order_id"])) ??
              randomUUID(),
            accountId:
              firstDefined(
                asString(raw["acct"]),
                asString(raw["account"]),
                accountId,
              ) ?? accountId,
            mode: input.mode,
            symbol: normalizeSymbol(
              firstDefined(
                asString(raw["ticker"]),
                asString(raw["description1"]),
                asString(raw["description"]),
                "UNKNOWN",
              ) ?? "UNKNOWN",
            ),
            assetClass:
              normalizeAssetClass(asString(raw["secType"])) ?? "equity",
            side: normalizeOrderSide(asString(raw["side"])),
            type: normalizeOrderType(
              firstDefined(
                asString(raw["origOrderType"]),
                asString(raw["orderType"]),
              ),
            ),
            timeInForce: normalizeTimeInForce(asString(raw["timeInForce"])),
            status,
            quantity:
              firstDefined(
                asNumber(raw["totalSize"]),
                asNumber(raw["size"]),
                asNumber(raw["quantity"]),
              ) ?? 0,
            filledQuantity,
            limitPrice:
              normalizeOrderType(
                firstDefined(
                  asString(raw["origOrderType"]),
                  asString(raw["orderType"]),
                ),
              ) === "limit"
                ? asNumber(raw["price"])
                : null,
            stopPrice:
              normalizeOrderType(
                firstDefined(
                  asString(raw["origOrderType"]),
                  asString(raw["orderType"]),
                ),
              ) === "stop"
                ? asNumber(raw["price"])
                : asNumber(raw["auxPrice"]),
            placedAt:
              firstDefined(
                toDate(raw["lastExecutionTime_r"]),
                toDate(raw["submitted_at"]),
              ) ?? new Date(),
            updatedAt:
              firstDefined(
                toDate(raw["lastExecutionTime_r"]),
                toDate(raw["updated_at"]),
              ) ?? new Date(),
            optionContract:
              normalizeAssetClass(asString(raw["secType"])) === "option"
                ? parseOptionDetails(raw)
                : null,
          };

          return input.status && mapped.status !== input.status ? null : mapped;
        }),
      );

      orderLists.push(orders);
    }

    return orderLists.flat();
  }

  private async resolveStockContract(symbol: string): Promise<{
    conid: number;
    secType: string;
    listingExchange: string;
  }> {
    const payload = await this.request<unknown>(
      "/iserver/secdef/search",
      {},
      {
        symbol: normalizeSymbol(symbol),
        secType: "STK",
      },
    );

    const results = compact(asArray(payload).map(asRecord));
    const match =
      results.find(
        (result) =>
          normalizeSymbol(asString(result["symbol"]) ?? "") === normalizeSymbol(symbol),
      ) ?? results[0];

    if (!match) {
      throw new HttpError(404, `Unable to resolve IBKR contract for ${symbol}.`, {
        code: "ibkr_contract_not_found",
      });
    }

    const conid = asNumber(match["conid"]);

    if (conid === null) {
      throw new HttpError(502, `IBKR returned an invalid contract identifier for ${symbol}.`, {
        code: "ibkr_invalid_conid",
      });
    }

    return {
      conid,
      secType: "STK",
      listingExchange:
        firstDefined(
          asString(match["description"]),
          asString(match["listingExchange"]),
          "SMART",
        ) ?? "SMART",
    };
  }

  private async resolveOptionContract(
    optionContract: NonNullable<PlaceOrderInput["optionContract"]>,
  ): Promise<{
    conid: number;
    secType: string;
    listingExchange: string;
  }> {
    const providedConid = asNumber(optionContract.providerContractId);

    if (providedConid !== null) {
      return {
        conid: providedConid,
        secType: "OPT",
        listingExchange: "SMART",
      };
    }

    const underlying = await this.resolveStockContract(optionContract.underlying);
    const month = toIbkrMonthCode(optionContract.expirationDate);

    const payload = await this.request<unknown>(
      "/iserver/secdef/info",
      {},
      {
        conid: underlying.conid,
        sectype: "OPT",
        month,
        right: optionContract.right === "call" ? "C" : "P",
        strike: optionContract.strike,
        exchange: "SMART",
      },
    );

    const results = compact(asArray(payload).map(asRecord));
    const expectedExpiration = optionContract.expirationDate.toISOString().slice(0, 10).replace(/-/g, "");
    const match =
      results.find((result) => {
        const maturity = asString(result["maturityDate"]);
        const strike = asNumber(result["strike"]);
        const right = normalizeOptionRight(asString(result["right"]));

        return (
          maturity === expectedExpiration &&
          strike === optionContract.strike &&
          right === optionContract.right
        );
      }) ?? results[0];

    if (!match) {
      throw new HttpError(
        404,
        `Unable to resolve IBKR option contract for ${optionContract.ticker}.`,
        {
          code: "ibkr_option_contract_not_found",
        },
      );
    }

    const conid = asNumber(match["conid"]);

    if (conid === null) {
      throw new HttpError(502, "IBKR returned an invalid option contract identifier.", {
        code: "ibkr_invalid_option_conid",
      });
    }

    return {
      conid,
      secType: "OPT",
      listingExchange:
        firstDefined(
          asString(match["exchange"]),
          asString(match["listingExchange"]),
          "SMART",
        ) ?? "SMART",
    };
  }

  private async confirmOrderReplies(responsePayload: unknown): Promise<Record<string, unknown>> {
    let currentPayload = responsePayload;

    for (let replyCount = 0; replyCount < 5; replyCount += 1) {
      const results = compact(asArray(currentPayload).map(asRecord));
      const successfulOrder = results.find(
        (result) =>
          asString(result["order_id"]) !== null || asString(result["orderId"]) !== null,
      );

      if (successfulOrder) {
        return successfulOrder;
      }

      const reply = results.find((result) => asString(result["id"]) !== null);

      if (!reply) {
        break;
      }

      const replyId = asString(reply["id"]);

      if (!replyId) {
        break;
      }

      currentPayload = await this.request<unknown>(
        `/iserver/reply/${encodeURIComponent(replyId)}`,
        {
          method: "POST",
          body: JSON.stringify({ confirmed: true }),
        },
      );
    }

    throw new HttpError(502, "IBKR order submission did not return a final order acknowledgement.", {
      code: "ibkr_missing_order_ack",
    });
  }

  async placeOrder(input: PlaceOrderInput): Promise<BrokerOrderSnapshot> {
    const tradingAccounts = await this.getTradingAccountsInfo();
    const accountId =
      input.accountId || this.config.defaultAccountId || tradingAccounts.accounts[0];

    if (!accountId) {
      throw new HttpError(400, "No IBKR account was provided for order placement.", {
        code: "ibkr_missing_account_id",
      });
    }

    const resolvedContract =
      input.assetClass === "option" && input.optionContract
        ? await this.resolveOptionContract(input.optionContract)
        : await this.resolveStockContract(input.symbol);

    const body: Record<string, unknown> = {
      orders: [
        {
          acctId: accountId,
          conid: resolvedContract.conid,
          manualIndicator: true,
          secType: `${resolvedContract.conid}:${resolvedContract.secType}`,
          cOID: randomUUID(),
          orderType: INTERNAL_TO_IBKR_ORDER_TYPE[input.type],
          listingExchange: resolvedContract.listingExchange,
          outsideRTH: false,
          side: input.side.toUpperCase(),
          ticker: normalizeSymbol(input.symbol),
          tif: INTERNAL_TO_IBKR_TIF[input.timeInForce],
          quantity: input.quantity,
        },
      ],
    };

    const order = asRecord(asArray(body["orders"])[0]);

    if (!order) {
      throw new HttpError(500, "Order payload construction failed.", {
        code: "ibkr_order_payload_invalid",
      });
    }

    if (tradingAccounts.allowCustomerTime) {
      order["manualOrderTime"] = Date.now();
    }

    if (input.type === "limit" || input.type === "stop_limit") {
      order["price"] = input.limitPrice;
    }

    if (input.type === "stop") {
      order["price"] = input.stopPrice;
    }

    if (input.type === "stop_limit") {
      order["auxPrice"] = input.stopPrice;
    }

    const responsePayload = await this.request<unknown>(
      `/iserver/account/${encodeURIComponent(accountId)}/orders`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );
    const result = await this.confirmOrderReplies(responsePayload);
    const placedAt = new Date();
    const status = normalizeOrderStatus(
      firstDefined(asString(result["order_status"]), asString(result["status"])),
      0,
      input.quantity,
    );

    return {
      id:
        firstDefined(asString(result["order_id"]), asString(result["orderId"])) ??
        randomUUID(),
      accountId,
      mode: input.mode,
      symbol: normalizeSymbol(input.symbol),
      assetClass: input.assetClass,
      side: input.side,
      type: input.type,
      timeInForce: input.timeInForce,
      status,
      quantity: input.quantity,
      filledQuantity: 0,
      limitPrice: input.limitPrice ?? null,
      stopPrice: input.stopPrice ?? null,
      placedAt,
      updatedAt: placedAt,
      optionContract: input.optionContract
        ? {
            ...input.optionContract,
            providerContractId: input.optionContract.providerContractId ?? null,
          }
        : null,
    };
  }
}
