import { z } from "zod";

// Local zod for the SnapTrade cancel route. The impact/place/recent SnapTrade
// routes use the orval-generated @workspace/api-zod contract, but cancel is not
// in that generated spec, so its request/response contract lives here (same
// rationale as routes/robinhood-equity-order-schemas.ts).

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
