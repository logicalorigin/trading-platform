import { z } from "zod";

// Local (non-generated) request/response contracts for the Robinhood agentic
// equity order routes. Kept here rather than in @workspace/api-zod because that
// package is orval-generated from @workspace/api-spec; the Robinhood order lane
// is driven service-level and does not yet need a generated client. Response
// schemas double as the sanitize-on-egress guarantee (no account_number, no
// raw upstream payloads).

const side = z.enum(["BUY", "SELL"]);
const orderType = z.enum(["Market", "Limit", "StopMarket", "StopLimit"]);
const timeInForce = z.enum(["Day", "GTC"]);
const marketHours = z.enum([
  "regular_hours",
  "extended_hours",
  "all_day_hours",
]);

export const ReviewRobinhoodEquityOrderBody = z.object({
  symbol: z.string(),
  side,
  orderType,
  timeInForce,
  marketHours: marketHours.nullish(),
  quantity: z.number().nullish(),
  notionalValue: z.number().nullish(),
  limitPrice: z.number().nullish(),
  stopPrice: z.number().nullish(),
});

export const PlaceRobinhoodEquityOrderBody = ReviewRobinhoodEquityOrderBody.extend(
  {
    confirm: z.boolean(),
    refId: z.string().uuid().nullish(),
    taxPreflightToken: z.string().nullish(),
    taxAcknowledgements: z.array(z.string()).nullish(),
  },
);

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
  symbol: z.string(),
  side,
  orderType,
  timeInForce,
  marketHours,
  quantity: z.number().nullable(),
  notionalValue: z.number().nullable(),
  limitPrice: z.number().nullable(),
  stopPrice: z.number().nullable(),
});

export const ReviewRobinhoodEquityOrderResponse = z.object({
  provider: z.enum(["robinhood"]),
  checkedAt: z.string(),
  account,
  order: orderDetails,
  review: z.object({
    lastTradePrice: z.number().nullable(),
    bidPrice: z.number().nullable(),
    askPrice: z.number().nullable(),
    previousClose: z.number().nullable(),
    marketDataDisclosure: z.string().nullable(),
    alerts: z.array(z.string()),
  }),
});

export const PlaceRobinhoodEquityOrderResponse = z.object({
  provider: z.enum(["robinhood"]),
  submittedAt: z.string(),
  account,
  order: orderDetails.extend({
    brokerageOrderId: z.string().nullable(),
    state: z.string().nullable(),
    refId: z.string(),
  }),
  alerts: z.array(z.string()),
});

export const ListRobinhoodEquityOrdersResponse = z.object({
  provider: z.enum(["robinhood"]),
  checkedAt: z.string(),
  account,
  orders: z.array(
    z.object({
      id: z.string().nullable(),
      symbol: z.string().nullable(),
      side: z.string().nullable(),
      state: z.string().nullable(),
      quantity: z.number().nullable(),
      averagePrice: z.number().nullable(),
      createdAt: z.string().nullable(),
    }),
  ),
});
