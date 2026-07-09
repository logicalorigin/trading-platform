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

export const ListSchwabRecentOrdersResponse = z.object({
  provider: z.enum(["schwab"]),
  checkedAt: z.string(),
  account,
  orders: z.array(
    z.object({
      orderId: z.string().nullable(),
      symbol: z.string().nullable(),
      assetType: z.string().nullable(),
      instruction: z.string().nullable(),
      quantity: z.number().nullable(),
      filledQuantity: z.number().nullable(),
      status: z.string(),
      orderType: z.string().nullable(),
      price: z.number().nullable(),
      enteredTime: z.string().nullable(),
    }),
  ),
});
