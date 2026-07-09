import { z } from "zod";

// Local zod for the SnapTrade cancel/replace routes. The impact/place/recent
// routes use the orval-generated @workspace/api-zod contract, but these are not
// in that generated spec, so their request/response contracts live here.

const account = z.object({
  id: z.string(),
  connectionId: z.string(),
  snapTradeAccountId: z.string(),
  displayName: z.string(),
  baseCurrency: z.string(),
  mode: z.enum(["live"]),
  accountStatus: z.string().nullable(),
  executionReady: z.boolean(),
  executionBlockers: z.array(z.string()),
  lastSyncedAt: z.string().nullable(),
});

export const CancelSnapTradeEquityOrderBody = z.object({
  orderId: z.string(),
});

export const CancelSnapTradeEquityOrderResponse = z.object({
  provider: z.enum(["snaptrade"]),
  canceledAt: z.string(),
  account,
  orderId: z.string(),
  status: z.string(),
});

export const ReplaceSnapTradeEquityOrderBody = z.object({
  confirm: z.boolean(),
  action: z.enum(["BUY", "SELL"]),
  symbol: z.string(),
  orderType: z.enum(["Market", "Limit", "Stop", "StopLimit"]),
  timeInForce: z.enum(["Day", "GTC", "FOK", "IOC"]),
  units: z.number().nullish(),
  price: z.number().nullish(),
  stop: z.number().nullish(),
  taxPreflightToken: z.string().nullish(),
  taxAcknowledgements: z.array(z.string()).nullish(),
});

export const ReplaceSnapTradeEquityOrderResponse = z.object({
  provider: z.enum(["snaptrade"]),
  replacedAt: z.string(),
  account,
  orderId: z.string(),
  previousOrderId: z.string(),
  status: z.string(),
});
