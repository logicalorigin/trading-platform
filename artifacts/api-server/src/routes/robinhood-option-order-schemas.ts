import { z } from "zod";

const optionType = z.enum(["Call", "Put"]);
const side = z.enum(["Buy", "Sell"]);
const positionEffect = z.enum(["Open", "Close"]);
const orderType = z.enum(["Limit", "Market", "StopLimit", "StopMarket"]);
const timeInForce = z.enum(["Day", "GTC"]);
const marketHours = z.enum([
  "regular_hours",
  "regular_curb_hours",
  "regular_curb_overnight_hours",
]);
const underlyingType = z.enum(["equity", "index"]);

export const ReviewRobinhoodOptionOrderBody = z.object({
  contractSymbol: z.string(),
  multiplier: z.number(),
  sharesPerContract: z.number(),
  chainSymbol: z.string(),
  underlyingType: underlyingType.nullish(),
  expiration: z.string(),
  strike: z.number(),
  optionType,
  side,
  positionEffect,
  orderType,
  timeInForce,
  marketHours: marketHours.nullish(),
  quantity: z.number(),
  limitPrice: z.number().nullish(),
  stopPrice: z.number().nullish(),
});

export const PlaceRobinhoodOptionOrderBody =
  ReviewRobinhoodOptionOrderBody.extend({
    confirm: z.boolean().optional(),
    refId: z.string().uuid().nullish(),
    taxPreflightToken: z.string().nullish(),
    taxAcknowledgements: z.array(z.string()).nullish(),
  });

const account = z.object({
  id: z.string(),
  connectionId: z.string(),
  accountNumberLast4: z.string().nullable(),
  displayName: z.string(),
  baseCurrency: z.string(),
  mode: z.enum(["live"]),
  accountStatus: z.string().nullable(),
  executionReady: z.boolean(),
  executionBlockers: z.array(z.string()),
  lastSyncedAt: z.string().nullable(),
});

const orderDetails = z.object({
  optionId: z.string(),
  occSymbol: z.string(),
  multiplier: z.number(),
  sharesPerContract: z.number(),
  chainSymbol: z.string(),
  underlyingType,
  expiration: z.string(),
  strike: z.number(),
  optionType,
  side,
  positionEffect,
  orderType,
  timeInForce,
  marketHours,
  quantity: z.number(),
  limitPrice: z.number().nullable(),
  stopPrice: z.number().nullable(),
});

const quote = z.object({
  instrumentId: z.string().nullable(),
  markPrice: z.number().nullable(),
  adjustedMarkPrice: z.number().nullable(),
  bidPrice: z.number().nullable(),
  askPrice: z.number().nullable(),
  previousClosePrice: z.number().nullable(),
  impliedVolatility: z.number().nullable(),
  delta: z.number().nullable(),
  gamma: z.number().nullable(),
  theta: z.number().nullable(),
  vega: z.number().nullable(),
  updatedAt: z.string().nullable(),
});

export const ReviewRobinhoodOptionOrderResponse = z.object({
  provider: z.enum(["robinhood"]),
  checkedAt: z.string(),
  account,
  order: orderDetails,
  review: z.object({
    alerts: z.array(z.string()),
    orderChecks: z.unknown(),
    marketDataDisclosure: z.string().nullable(),
    quote: quote.nullable(),
    estimate: z.object({
      premium: z.number().nullable(),
      totalFee: z.number().nullable(),
      collateralAmount: z.number().nullable(),
      collateralDirection: z.string().nullable(),
      collateralInfinite: z.boolean(),
    }),
  }),
});

export const PlaceRobinhoodOptionOrderResponse = z.object({
  provider: z.enum(["robinhood"]),
  submittedAt: z.string(),
  account,
  order: orderDetails.extend({
    brokerageOrderId: z.string(),
    state: z.string().nullable(),
    refId: z.string(),
  }),
  alerts: z.array(z.string()),
});

export const ListRobinhoodOptionOrdersResponse = z.object({
  provider: z.enum(["robinhood"]),
  checkedAt: z.string(),
  account,
  orders: z.array(
    z.object({
      id: z.string().nullable(),
      chainSymbol: z.string().nullable(),
      state: z.string().nullable(),
      orderType: z.string().nullable(),
      quantity: z.number().nullable(),
      processedQuantity: z.number().nullable(),
      price: z.number().nullable(),
      stopPrice: z.number().nullable(),
      createdAt: z.string().nullable(),
    }),
  ),
});

export const CancelRobinhoodOptionOrderBody = z.object({
  orderId: z.string(),
});

export const CancelRobinhoodOptionOrderResponse = z.object({
  provider: z.enum(["robinhood"]),
  cancelledAt: z.string(),
  account,
  orderId: z.string(),
  accepted: z.boolean(),
});
