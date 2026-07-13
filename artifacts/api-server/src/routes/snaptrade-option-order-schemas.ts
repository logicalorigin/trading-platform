import { z } from "zod";

const optionType = z.enum(["Call", "Put"]);
const action = z.enum([
  "BUY_TO_OPEN",
  "SELL_TO_CLOSE",
  "SELL_TO_OPEN",
  "BUY_TO_CLOSE",
]);
const orderType = z.enum(["Market", "Limit"]);
const timeInForce = z.enum(["Day", "GTC", "FOK", "IOC"]);

const optionOrderInput = z.object({
  contractSymbol: z.string(),
  multiplier: z.number(),
  sharesPerContract: z.number(),
  underlyingSymbol: z.string(),
  expiration: z.string(),
  strike: z.number(),
  optionType,
  action,
  orderType,
  timeInForce,
  units: z.number(),
  price: z.number().nullish(),
});

export const CheckSnapTradeOptionOrderImpactBody = optionOrderInput;

export const SubmitSnapTradeOptionOrderBody = optionOrderInput.extend({
  confirm: z.boolean(),
  taxPreflightToken: z.string().nullish(),
  taxAcknowledgements: z.array(z.string()).nullish(),
});

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

const orderDetails = z.object({
  underlyingSymbol: z.string(),
  occSymbol: z.string(),
  expiration: z.string(),
  strike: z.number(),
  optionType,
  action,
  orderType,
  timeInForce,
  units: z.number(),
  price: z.number().nullable(),
  multiplier: z.number(),
  sharesPerContract: z.number(),
});

export const CheckSnapTradeOptionOrderImpactResponse = z.object({
  provider: z.enum(["snaptrade"]),
  checkedAt: z.string(),
  account,
  order: orderDetails,
  impact: z.object({
    estimatedCashChange: z.number().nullable(),
    cashChangeDirection: z.string().nullable(),
    estimatedFeeTotal: z.number().nullable(),
  }),
});

export const SubmitSnapTradeOptionOrderResponse = z.object({
  provider: z.enum(["snaptrade"]),
  submittedAt: z.string(),
  account,
  order: orderDetails.extend({
    brokerageOrderId: z.string(),
    status: z.string(),
  }),
});

export const CancelSnapTradeOptionOrderBody = z.object({
  orderId: z.string(),
});

export const CancelSnapTradeOptionOrderResponse = z.object({
  provider: z.enum(["snaptrade"]),
  canceledAt: z.string(),
  account,
  orderId: z.string(),
  status: z.string(),
});

export const ListSnapTradeRecentOptionOrdersResponse = z.object({
  provider: z.enum(["snaptrade"]),
  checkedAt: z.string(),
  account,
  orders: z.array(
    z.object({
      brokerageOrderId: z.string().nullable(),
      brokerageGroupOrderId: z.string().nullable(),
      orderRole: z.string().nullable(),
      status: z.string(),
      symbol: z.string().nullable(),
      rawSymbol: z.string().nullable(),
      description: z.string().nullable(),
      universalSymbolId: z.string().nullable(),
      optionSymbolId: z.string().nullable(),
      optionTicker: z.string().nullable(),
      action: z.string().nullable(),
      totalQuantity: z.number().nullable(),
      openQuantity: z.number().nullable(),
      canceledQuantity: z.number().nullable(),
      filledQuantity: z.number().nullable(),
      executionPrice: z.number().nullable(),
      limitPrice: z.number().nullable(),
      stopPrice: z.number().nullable(),
      orderType: z.string().nullable(),
      timeInForce: z.string().nullable(),
      timePlaced: z.string().nullable(),
      timeUpdated: z.string().nullable(),
      timeExecuted: z.string().nullable(),
      expiryDate: z.string().nullable(),
    }),
  ),
});
