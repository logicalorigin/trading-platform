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
const TAX_EVENTS_RETRY_AFTER_SECONDS = 15;

const AccountIdParam = z.object({ accountId: z.string().min(1) });
const TaxYearQuery = z.object({
  taxYear: z.coerce.number().int().min(2000).max(2100).optional(),
});

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
  try {
    res.json(await listAccountTaxEvents(params.accountId));
  } catch (error) {
    const reason = isStatementTimeoutError(error)
      ? "statement_timeout"
      : isPoolContentionError(error)
        ? "pool_acquire_timeout"
        : null;
    if (!reason) throw error;

    res.setHeader("X-Pyrus-Admission-Action", "shed");
    res.setHeader("Retry-After", String(TAX_EVENTS_RETRY_AFTER_SECONDS));
    res.status(503).type("application/problem+json").json({
      type: "https://pyrus.local/problems/tax-events-unavailable",
      title: "Tax events temporarily unavailable",
      status: 503,
      detail:
        "Tax events could not be loaded because the database is temporarily unavailable.",
      code: "tax_events_unavailable",
      retryable: true,
      reason,
    });
  }
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
