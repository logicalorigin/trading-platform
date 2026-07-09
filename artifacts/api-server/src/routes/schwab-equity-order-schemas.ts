import { z } from "zod";

const account = z.object({
  id: z.string(),
  connectionId: z.string(),
  accountHash: z.string(),
  displayName: z.string(),
  baseCurrency: z.string(),
  mode: z.enum(["live"]),
  accountStatus: z.string().nullable(),
  executionReady: z.boolean(),
  executionBlockers: z.array(z.string()),
  lastSyncedAt: z.string().nullable(),
});

export const ReplaceSchwabEquityOrderBody = z.object({
  symbol: z.string(),
  action: z.enum(["BUY", "SELL", "BUY_TO_COVER", "SELL_SHORT"]),
  quantity: z.number(),
  orderType: z.enum(["Market", "Limit", "Stop", "StopLimit"]),
  timeInForce: z.enum(["Day", "GoodTillCancel", "FillOrKill"]),
  session: z.enum(["Normal", "Am", "Pm", "Seamless"]).nullish(),
  limitPrice: z.number().nullish(),
  stopPrice: z.number().nullish(),
  confirm: z.boolean(),
  taxPreflightToken: z.string().nullish(),
  taxAcknowledgements: z.array(z.string()).nullish(),
});

export const ReplaceSchwabEquityOrderResponse = z.object({
  provider: z.enum(["schwab"]),
  replacedAt: z.string(),
  account,
  orderId: z.string(),
  previousOrderId: z.string(),
  status: z.enum(["replaced"]),
});
