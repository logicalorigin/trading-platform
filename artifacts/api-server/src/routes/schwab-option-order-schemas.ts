import { z } from "zod";

const optionType = z.enum(["Call", "Put"]);
const instruction = z.enum([
  "BuyToOpen",
  "SellToClose",
  "SellToOpen",
  "BuyToClose",
]);
const orderType = z.enum(["Market", "Limit"]);
const duration = z.enum(["Day", "GoodTillCancel", "FillOrKill"]);
const session = z.enum(["Normal", "Am", "Pm", "Seamless"]);

export const PreviewSchwabOptionOrderBody = z.object({
  underlyingSymbol: z.string(),
  expiration: z.string(),
  strike: z.number(),
  optionType,
  instruction,
  orderType,
  duration,
  session,
  quantity: z.number(),
  limitPrice: z.number().nullish(),
});

export const SubmitSchwabOptionOrderBody = PreviewSchwabOptionOrderBody.extend({
  confirm: z.boolean(),
  taxPreflightToken: z.string().nullish(),
  taxAcknowledgements: z.array(z.string()).nullish(),
});

export const CancelSchwabOptionOrderBody = z.object({
  orderId: z.string(),
});

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

export const PreviewSchwabOptionOrderResponse = z.object({
  provider: z.enum(["schwab"]),
  checkedAt: z.string(),
  account,
  preview: z.unknown(),
});

export const SubmitSchwabOptionOrderResponse = z.object({
  provider: z.enum(["schwab"]),
  submittedAt: z.string(),
  account,
  orderId: z.string().nullable(),
  status: z.enum(["submitted"]),
  reconcileRequired: z.literal(true).optional(),
  reconciliationReason: z
    .enum(["tax_preflight_order_submit_record_failed"])
    .optional(),
});

export const CancelSchwabOptionOrderResponse = z.object({
  provider: z.enum(["schwab"]),
  canceledAt: z.string(),
  account,
  orderId: z.string(),
  status: z.enum(["canceled"]),
});
