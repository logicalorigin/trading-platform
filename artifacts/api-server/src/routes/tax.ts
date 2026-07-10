import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  isPoolContentionError,
  isStatementTimeoutError,
} from "../lib/transient-db-error";
import { requireUserCsrf } from "./auth";
import {
  createTaxOrderPreflight,
  getAccountTaxOverview,
  getTaxOverview,
  getTaxProfileSnapshot,
  getTaxReserveSnapshot,
  getTaxStateRulesStatus,
  listAccountReconciliationIssues,
  listAccountTaxEvents,
  listAccountTaxLots,
  listAccountWashWindows,
  planTaxReserve,
  previewTaxReserveAction,
  submitTaxReserveAction,
  updateTaxProfileSnapshot,
} from "../services/tax-planning";

const router: IRouter = Router();
const TAX_EVENTS_ROUTE_TIMEOUT_MS = 1_500;
const TAX_EVENTS_RETRY_AFTER_SECONDS = 15;
const TAX_EVENTS_TIMEOUT = Symbol("tax_events_timeout");

const AccountIdParam = z.object({ accountId: z.string().min(1) });
const TaxYearQuery = z.object({
  taxYear: z.coerce.number().int().min(2000).max(2100).optional(),
});

type TaxEventsDegradedReason =
  | "tax_events_timeout"
  | "statement_timeout"
  | "pool_acquire_timeout";

const degradedTaxEvents = (reason: TaxEventsDegradedReason) => ({
  events: [],
  sourceFreshness: "temporarily_unavailable",
  basisConfidence: "unknown",
  degraded: true,
  partial: true,
  retryable: true,
  reason,
});

async function listAccountTaxEventsWithinRouteBudget(accountId: string) {
  const request = listAccountTaxEvents(accountId);
  // ponytail: this caps response latency only; thread cancellation through the
  // tax-planning DB reads if they gain per-query AbortSignal support.
  request.catch(() => {});
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    const result = await Promise.race([
      request,
      new Promise<typeof TAX_EVENTS_TIMEOUT>((resolve) => {
        timeout = setTimeout(
          () => resolve(TAX_EVENTS_TIMEOUT),
          TAX_EVENTS_ROUTE_TIMEOUT_MS,
        );
        timeout.unref?.();
      }),
    ]);
    return result === TAX_EVENTS_TIMEOUT
      ? degradedTaxEvents("tax_events_timeout")
      : result;
  } catch (error) {
    if (isStatementTimeoutError(error)) {
      return degradedTaxEvents("statement_timeout");
    }
    if (isPoolContentionError(error)) {
      return degradedTaxEvents("pool_acquire_timeout");
    }
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

router.get("/tax/profile", async (_req, res) => {
  res.json(await getTaxProfileSnapshot());
});

router.put("/tax/profile", async (req, res) => {
  await requireUserCsrf(req);
  res.json(await updateTaxProfileSnapshot(req.body ?? {}));
});

router.get("/tax/state-rules/status", async (req, res) => {
  const query = TaxYearQuery.parse(req.query);
  res.json(await getTaxStateRulesStatus(query.taxYear));
});

router.get("/tax/overview", async (_req, res) => {
  res.json(await getTaxOverview());
});

router.get("/accounts/:accountId/tax/overview", async (req, res) => {
  const params = AccountIdParam.parse(req.params);
  res.json(await getAccountTaxOverview(params.accountId));
});

router.get("/accounts/:accountId/tax/events", async (req, res) => {
  const params = AccountIdParam.parse(req.params);
  const payload = await listAccountTaxEventsWithinRouteBudget(params.accountId);
  if ("degraded" in payload) {
    res.setHeader("Retry-After", String(TAX_EVENTS_RETRY_AFTER_SECONDS));
  }
  res.json(payload);
});

router.get("/accounts/:accountId/tax/lots", async (req, res) => {
  const params = AccountIdParam.parse(req.params);
  res.json(await listAccountTaxLots(params.accountId));
});

router.get("/accounts/:accountId/tax/wash-windows", async (req, res) => {
  const params = AccountIdParam.parse(req.params);
  res.json(await listAccountWashWindows(params.accountId));
});

router.get("/accounts/:accountId/tax/reconciliation", async (req, res) => {
  const params = AccountIdParam.parse(req.params);
  res.json(await listAccountReconciliationIssues(params.accountId));
});

router.post("/accounts/:accountId/tax/preflight", async (req, res) => {
  await requireUserCsrf(req);
  const params = AccountIdParam.parse(req.params);
  res.json(
    await createTaxOrderPreflight({
      ...(req.body ?? {}),
      order: {
        ...((req.body && typeof req.body === "object" && "order" in req.body
          ? (req.body as { order?: unknown }).order
          : req.body) || {}),
        accountId: params.accountId,
      },
    }),
  );
});

router.get("/tax/reserve", async (_req, res) => {
  res.json(await getTaxReserveSnapshot());
});

router.post("/tax/reserve/plan", async (req, res) => {
  await requireUserCsrf(req);
  res.json(await planTaxReserve(req.body ?? {}));
});

router.post("/tax/reserve/actions/preview", async (req, res) => {
  await requireUserCsrf(req);
  res.json(await previewTaxReserveAction(req.body ?? {}));
});

router.post("/tax/reserve/actions/submit", async (req, res) => {
  await requireUserCsrf(req);
  res.json(await submitTaxReserveAction(req.body ?? {}));
});

export default router;
