import { Router, type IRouter } from "express";
import {
  GenerateSnapTradeConnectionPortalBody,
  GenerateSnapTradeConnectionPortalResponse,
  GetBrokerExecutionIncludedAccountsResponse,
  GetIbkrOAuthReadinessResponse,
  GetRobinhoodReadinessResponse,
  GetSnapTradeReadinessResponse,
  GetSnapTradeAccountHistoryResponse,
  GetSnapTradeAccountPortfolioResponse,
  GetSnapTradeRecentOrdersResponse,
  SearchSnapTradeAccountSymbolsResponse,
  RegisterSnapTradeCurrentUserResponse,
  CheckSnapTradeEquityOrderImpactBody,
  CheckSnapTradeEquityOrderImpactResponse,
  CancelSchwabEquityOrderBody,
  CancelSchwabEquityOrderResponse,
  ListSnapTradeBrokeragesResponse,
  GetSchwabReadinessResponse,
  PreviewSchwabEquityOrderBody,
  PreviewSchwabEquityOrderResponse,
  StartRobinhoodConnectResponse,
  StartSchwabConnectResponse,
  SubmitSchwabEquityOrderBody,
  SubmitSchwabEquityOrderResponse,
  SubmitSnapTradeEquityOrderBody,
  SubmitSnapTradeEquityOrderResponse,
  SetBrokerExecutionIncludedAccountsBody,
  SetBrokerExecutionIncludedAccountsResponse,
  SyncRobinhoodConnectionsResponse,
  SyncSchwabConnectionsResponse,
  SyncSnapTradeBrokerageConnectionsResponse,
} from "@workspace/api-zod";

import {
  requireAdmin,
  requireAdminCsrf,
  requireEntitlement,
  requireEntitlementCsrf,
} from "./auth";
import { readIbkrOAuthReadiness } from "../services/ibkr-oauth-readiness";
import { syncRobinhoodConnections } from "../services/robinhood-account-sync";
import {
  cancelRobinhoodEquityOrder,
  listRobinhoodEquityOrders,
  placeRobinhoodEquityOrder,
  reviewRobinhoodEquityOrder,
} from "../services/robinhood-equity-orders";
import {
  CancelRobinhoodEquityOrderBody,
  CancelRobinhoodEquityOrderResponse,
  ListRobinhoodEquityOrdersResponse,
  PlaceRobinhoodEquityOrderBody,
  PlaceRobinhoodEquityOrderResponse,
  ReviewRobinhoodEquityOrderBody,
  ReviewRobinhoodEquityOrderResponse,
} from "./robinhood-equity-order-schemas";
import {
  completeRobinhoodConnect,
  startRobinhoodConnect,
} from "../services/robinhood-oauth";
import { readRobinhoodReadiness } from "../services/robinhood-readiness";
import { readRobinhoodUserReadiness } from "../services/robinhood-user-custody";
import { syncSchwabConnections } from "../services/schwab-account-sync";
import {
  completeSchwabConnect,
  startSchwabConnect,
} from "../services/schwab-oauth";
import { readSchwabReadiness } from "../services/schwab-readiness";
import { readSchwabUserReadiness } from "../services/schwab-user-custody";
import {
  cancelSchwabEquityOrder,
  isSchwabOrderSubmitReconcileRequired,
  previewSchwabEquityOrder,
  submitSchwabEquityOrder,
} from "../services/schwab-equity-orders";
import {
  listBrokerAccountInclusions,
  setBrokerAccountInclusions,
} from "../services/broker-account-inclusion";
import { getSnapTradeAccountPortfolio } from "../services/snaptrade-account-portfolio";
import { generateSnapTradeConnectionPortal } from "../services/snaptrade-connection-portal";
import {
  cancelSnapTradeEquityOrder,
  checkSnapTradeEquityOrderImpact,
  listSnapTradeRecentOrders,
  searchSnapTradeAccountSymbols,
  submitSnapTradeEquityOrder,
} from "../services/snaptrade-equity-orders";
import {
  CancelSnapTradeEquityOrderBody,
  CancelSnapTradeEquityOrderResponse,
} from "./snaptrade-equity-order-schemas";
import {
  cancelRobinhoodOptionOrder,
  listRobinhoodOptionOrders,
  placeRobinhoodOptionOrder,
  reviewRobinhoodOptionOrder,
} from "../services/robinhood-option-orders";
import {
  CancelRobinhoodOptionOrderBody,
  CancelRobinhoodOptionOrderResponse,
  ListRobinhoodOptionOrdersResponse,
  PlaceRobinhoodOptionOrderBody,
  PlaceRobinhoodOptionOrderResponse,
  ReviewRobinhoodOptionOrderBody,
  ReviewRobinhoodOptionOrderResponse,
} from "./robinhood-option-order-schemas";
import {
  cancelSnapTradeOptionOrder,
  checkSnapTradeOptionOrderImpact,
  listSnapTradeRecentOptionOrders,
  submitSnapTradeOptionOrder,
} from "../services/snaptrade-option-orders";
import {
  CancelSnapTradeOptionOrderBody,
  CancelSnapTradeOptionOrderResponse,
  CheckSnapTradeOptionOrderImpactBody,
  CheckSnapTradeOptionOrderImpactResponse,
  ListSnapTradeRecentOptionOrdersResponse,
  SubmitSnapTradeOptionOrderBody,
  SubmitSnapTradeOptionOrderResponse,
} from "./snaptrade-option-order-schemas";
import { listSchwabRecentOrders } from "../services/schwab-orders-read";
import { ListSchwabRecentOrdersResponse } from "./schwab-orders-read-schemas";
import {
  cancelSchwabOptionOrder,
  previewSchwabOptionOrder,
  submitSchwabOptionOrder,
} from "../services/schwab-option-orders";
import {
  CancelSchwabOptionOrderBody,
  CancelSchwabOptionOrderResponse,
  PreviewSchwabOptionOrderBody,
  PreviewSchwabOptionOrderResponse,
  SubmitSchwabOptionOrderBody,
  SubmitSchwabOptionOrderResponse,
} from "./schwab-option-order-schemas";
import { HttpError } from "../lib/errors";
import { logger } from "../lib/logger";
import { recordAuditEvent } from "../services/audit-events";
import { getSnapTradeAccountHistory } from "../services/snaptrade-account-history";
import {
  refreshSnapTradeAccountHistoryForUser,
  refreshSnapTradeAccountHistoryOnRead,
} from "../services/snaptrade-history-scheduler";
import { refreshRobinhoodAccountHistoryForUser } from "../services/robinhood-history-scheduler";
import { listSnapTradeBrokerages } from "../services/snaptrade-brokerages";
import { syncSnapTradeBrokerageConnections } from "../services/snaptrade-account-sync";
import { readSnapTradeReadiness } from "../services/snaptrade-readiness";
import { readSnapTradeUserReadiness } from "../services/snaptrade-user-custody";
import { registerSnapTradeCurrentUser } from "../services/snaptrade-user-registration";

const router: IRouter = Router();
const SNAPTRADE_HISTORY_RANGES = new Set([
  "1D",
  "1W",
  "1M",
  "3M",
  "6M",
  "YTD",
  "1Y",
  "ALL",
]);

export const __brokerExecutionRouteInternalsForTests = {
  schwabOrders: {
    readSchwabReadiness,
    previewSchwabEquityOrder,
    submitSchwabEquityOrder,
    cancelSchwabEquityOrder,
  },
};

async function requireSchwabOrderReadiness(): Promise<void> {
  const readiness =
    await __brokerExecutionRouteInternalsForTests.schwabOrders.readSchwabReadiness();
  if (readiness.configured) {
    return;
  }
  throw new HttpError(503, "Schwab order routes are not ready", {
    code: "schwab_order_routes_not_ready",
    data: {
      status: readiness.status,
      limitations: readiness.limitations,
    },
  });
}

function readOptionalQueryString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function readOptionalHistoryDate(value: unknown, key: "from" | "to"): Date | null {
  const text = readOptionalQueryString(value);
  if (!text) {
    return null;
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, `Invalid SnapTrade history ${key} query.`, {
      code: `invalid_snaptrade_history_${key}`,
    });
  }
  return date;
}

function readOptionalHistoryRange(value: unknown): string | null {
  const range = readOptionalQueryString(value);
  if (!range) {
    return null;
  }
  if (!SNAPTRADE_HISTORY_RANGES.has(range)) {
    throw new HttpError(400, "Invalid SnapTrade history range query.", {
      code: "invalid_snaptrade_history_range",
    });
  }
  return range;
}

router.get("/broker-execution/snaptrade/readiness", async (req, res) => {
  const session = await requireEntitlement("broker_connect")(req);
  const data = GetSnapTradeReadinessResponse.parse(
    {
      ...(await readSnapTradeReadiness()),
      user: await readSnapTradeUserReadiness(session.user.id),
    },
  );
  res.json(data);
});

router.get("/broker-execution/ibkr/oauth/readiness", async (req, res) => {
  await requireAdmin(req);
  const data = GetIbkrOAuthReadinessResponse.parse(readIbkrOAuthReadiness());
  res.json(data);
});

router.get("/broker-execution/robinhood/readiness", async (req, res) => {
  const session = await requireEntitlement("broker_connect")(req);
  const data = GetRobinhoodReadinessResponse.parse({
    ...(await readRobinhoodReadiness()),
    user: await readRobinhoodUserReadiness(session.user.id),
  });
  res.json(data);
});

router.post("/broker-execution/robinhood/connect", async (req, res) => {
  const session = await requireEntitlementCsrf("broker_connect")(req);
  const data = StartRobinhoodConnectResponse.parse(
    await startRobinhoodConnect({
      appUserId: session.user.id,
    }),
  );
  void recordAuditEvent({
    appUserId: session.user.id,
    eventType: "broker.connect_start",
    subject: { type: "broker_provider", id: "robinhood" },
    payload: { route: req.path },
  });
  res.json(data);
});

// Browser-facing OAuth redirect target (intentionally not in the JSON API
// contract): Robinhood sends the user's browser here after consent. Outcomes
// redirect back to Settings with a status flag instead of surfacing JSON.
router.get("/broker-execution/robinhood/oauth/callback", async (req, res) => {
  const session = await requireEntitlement("broker_connect")(req);
  const code = typeof req.query["code"] === "string" ? req.query["code"] : "";
  const state =
    typeof req.query["state"] === "string" ? req.query["state"] : "";
  const denied =
    typeof req.query["error"] === "string" && req.query["error"].length > 0;

  if (denied || !code || !state) {
    void recordAuditEvent({
      appUserId: session.user.id,
      eventType: "broker.connect_denied",
      subject: { type: "broker_provider", id: "robinhood" },
      payload: { denied, missingCode: !code, missingState: !state },
    });
    res.redirect(302, "/?screen=settings&robinhood=denied");
    return;
  }
  try {
    await completeRobinhoodConnect({
      appUserId: session.user.id,
      code,
      state,
    });
    // Best-effort initial sync so accounts appear without a manual step.
    await syncRobinhoodConnections({ appUserId: session.user.id }).catch(
      () => undefined,
    );
    // Fire-and-forget P&L history backfill so past trades populate without a
    // page open (mirrors the SnapTrade on-connect hook).
    void refreshRobinhoodAccountHistoryForUser(session.user.id).catch(
      (error) => {
        logger.warn(
          { err: error },
          "Robinhood connect history backfill failed",
        );
      },
    );
    void recordAuditEvent({
      appUserId: session.user.id,
      eventType: "broker.connect_complete",
      subject: { type: "broker_provider", id: "robinhood" },
    });
    res.redirect(302, "/?screen=settings&robinhood=connected");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      { err: message },
      "robinhood oauth callback token exchange failed",
    );
    void recordAuditEvent({
      appUserId: session.user.id,
      eventType: "broker.connect_error",
      subject: { type: "broker_provider", id: "robinhood" },
      payload: { error: message },
    });
    res.redirect(302, "/?screen=settings&robinhood=error");
  }
});

router.post("/broker-execution/robinhood/sync", async (req, res) => {
  const session = await requireEntitlementCsrf("broker_connect")(req);
  const data = SyncRobinhoodConnectionsResponse.parse(
    await syncRobinhoodConnections({
      appUserId: session.user.id,
    }),
  );
  // Keep P&L history fresh whenever accounts are re-synced (fire-and-forget).
  void refreshRobinhoodAccountHistoryForUser(session.user.id).catch((error) => {
    logger.warn({ err: error }, "Robinhood sync history backfill failed");
  });
  void recordAuditEvent({
    appUserId: session.user.id,
    eventType: "broker.sync",
    subject: { type: "broker_provider", id: "robinhood" },
  });
  res.json(data);
});

router.get("/broker-execution/schwab/readiness", async (req, res) => {
  const session = await requireEntitlement("broker_connect")(req);
  const userReadiness = await readSchwabUserReadiness(session.user.id);
  const data = GetSchwabReadinessResponse.parse({
    ...(await readSchwabReadiness({ userReadiness })),
    user: userReadiness,
  });
  res.json(data);
});

router.post("/broker-execution/schwab/connect", async (req, res) => {
  const session = await requireEntitlementCsrf("broker_connect")(req);
  const data = StartSchwabConnectResponse.parse(
    await startSchwabConnect({
      appUserId: session.user.id,
    }),
  );
  void recordAuditEvent({
    appUserId: session.user.id,
    eventType: "broker.connect_start",
    subject: { type: "broker_provider", id: "schwab" },
    payload: { route: req.path },
  });
  res.json(data);
});

// Browser-facing OAuth redirect target (intentionally not in the JSON API
// contract): Schwab sends the user's browser here after consent. Outcomes
// redirect back to Settings with a status flag instead of surfacing JSON.
router.get("/broker-execution/schwab/oauth/callback", async (req, res) => {
  const session = await requireEntitlement("broker_connect")(req);
  const code = typeof req.query["code"] === "string" ? req.query["code"] : "";
  const state =
    typeof req.query["state"] === "string" ? req.query["state"] : "";
  const denied =
    typeof req.query["error"] === "string" && req.query["error"].length > 0;

  if (denied || !code || !state) {
    void recordAuditEvent({
      appUserId: session.user.id,
      eventType: "broker.connect_denied",
      subject: { type: "broker_provider", id: "schwab" },
      payload: { denied, missingCode: !code, missingState: !state },
    });
    res.redirect(302, "/?screen=settings&schwab=denied");
    return;
  }
  try {
    await completeSchwabConnect({
      appUserId: session.user.id,
      code,
      state,
    });
    // Best-effort initial sync so accounts appear without a manual step.
    await syncSchwabConnections({ appUserId: session.user.id }).catch(
      () => undefined,
    );
    void recordAuditEvent({
      appUserId: session.user.id,
      eventType: "broker.connect_complete",
      subject: { type: "broker_provider", id: "schwab" },
    });
    res.redirect(302, "/?screen=settings&schwab=connected");
  } catch {
    res.redirect(302, "/?screen=settings&schwab=error");
  }
});

router.post("/broker-execution/schwab/sync", async (req, res) => {
  const session = await requireEntitlementCsrf("broker_connect")(req);
  const data = SyncSchwabConnectionsResponse.parse(
    await syncSchwabConnections({
      appUserId: session.user.id,
    }),
  );
  void recordAuditEvent({
    appUserId: session.user.id,
    eventType: "broker.sync",
    subject: { type: "broker_provider", id: "schwab" },
  });
  res.json(data);
});

router.post(
  "/broker-execution/schwab/accounts/:accountId/orders/preview",
  async (req, res) => {
    const session = await requireEntitlementCsrf("broker_connect")(req);
    const body = PreviewSchwabEquityOrderBody.parse(req.body ?? {});
    void recordAuditEvent({
      appUserId: session.user.id,
      eventType: "broker.order_mutation_attempt",
      subject: { type: "broker_provider", id: "schwab" },
      resource: { type: "broker_account", id: req.params.accountId },
      payload: {
        action: "preview",
        symbol: body.symbol,
        orderAction: body.action,
      },
    });
    await requireSchwabOrderReadiness();
    const data = PreviewSchwabEquityOrderResponse.parse(
      await __brokerExecutionRouteInternalsForTests.schwabOrders.previewSchwabEquityOrder({
        appUserId: session.user.id,
        accountId: req.params.accountId,
        input: body,
      }),
    );
    res.json(data);
  },
);

router.post(
  "/broker-execution/schwab/accounts/:accountId/orders",
  async (req, res) => {
    const session = await requireEntitlementCsrf("broker_connect")(req);
    const body = SubmitSchwabEquityOrderBody.parse(req.body ?? {});
    void recordAuditEvent({
      appUserId: session.user.id,
      eventType: "broker.order_mutation_attempt",
      subject: { type: "broker_provider", id: "schwab" },
      resource: { type: "broker_account", id: req.params.accountId },
      payload: {
        action: "submit",
        symbol: body.symbol,
        orderAction: body.action,
      },
    });
    await requireSchwabOrderReadiness();
    try {
      const data = SubmitSchwabEquityOrderResponse.parse(
        await __brokerExecutionRouteInternalsForTests.schwabOrders.submitSchwabEquityOrder({
          appUserId: session.user.id,
          accountId: req.params.accountId,
          input: body,
        }),
      );
      res.json(data);
    } catch (error) {
      if (!isSchwabOrderSubmitReconcileRequired(error)) {
        throw error;
      }
      res.status(error.statusCode).type("application/problem+json").json({
        type: "https://pyrus.local/problems/upstream",
        title: error.message,
        status: error.statusCode,
        code: error.code,
        data: error.data,
      });
    }
  },
);

router.post(
  "/broker-execution/schwab/accounts/:accountId/orders/cancel",
  async (req, res) => {
    const session = await requireEntitlementCsrf("broker_connect")(req);
    const body = CancelSchwabEquityOrderBody.parse(req.body ?? {});
    void recordAuditEvent({
      appUserId: session.user.id,
      eventType: "broker.order_mutation_attempt",
      subject: { type: "broker_provider", id: "schwab" },
      resource: { type: "broker_account", id: req.params.accountId },
      payload: { action: "cancel", orderId: body.orderId },
    });
    await requireSchwabOrderReadiness();
    const data = CancelSchwabEquityOrderResponse.parse(
      await __brokerExecutionRouteInternalsForTests.schwabOrders.cancelSchwabEquityOrder({
        appUserId: session.user.id,
        accountId: req.params.accountId,
        orderId: body.orderId,
      }),
    );
    res.json(data);
  },
);

router.get("/broker-execution/snaptrade/brokerages", async (req, res) => {
  await requireEntitlement("broker_connect")(req);
  const data = ListSnapTradeBrokeragesResponse.parse(
    await listSnapTradeBrokerages(),
  );
  res.json(data);
});

router.post("/broker-execution/snaptrade/users/current", async (req, res) => {
  const session = await requireEntitlementCsrf("broker_connect")(req);
  const data = RegisterSnapTradeCurrentUserResponse.parse(
    await registerSnapTradeCurrentUser({
      appUserId: session.user.id,
    }),
  );
  void recordAuditEvent({
    appUserId: session.user.id,
    eventType: "broker.connect_start",
    subject: { type: "broker_provider", id: "snaptrade" },
    payload: { created: data.created, stage: "user_registration" },
  });
  res.status(data.created ? 201 : 200).json(data);
});

router.post("/broker-execution/snaptrade/connection-portal", async (req, res) => {
  const session = await requireEntitlementCsrf("broker_connect")(req);
  const body = GenerateSnapTradeConnectionPortalBody.parse(req.body ?? {});
  const data = GenerateSnapTradeConnectionPortalResponse.parse(
    await generateSnapTradeConnectionPortal({
      appUserId: session.user.id,
      input: body,
    }),
  );
  void recordAuditEvent({
    appUserId: session.user.id,
    eventType: "broker.connect_start",
    subject: { type: "broker_provider", id: "snaptrade" },
    payload: {
      stage: "connection_portal",
      connectionType: body.connectionType,
      reconnect: Boolean(body.reconnect),
    },
  });
  res.json(data);
});

router.post("/broker-execution/snaptrade/sync", async (req, res) => {
  const session = await requireEntitlementCsrf("broker_connect")(req);
  const data = SyncSnapTradeBrokerageConnectionsResponse.parse(
    await syncSnapTradeBrokerageConnections({
      appUserId: session.user.id,
    }),
  );
  void recordAuditEvent({
    appUserId: session.user.id,
    eventType: "broker.connect_complete",
    subject: { type: "broker_provider", id: "snaptrade" },
    payload: { accountCount: data.accounts.length },
  });
  // Kick off a background history backfill for the just-synced accounts so past
  // P&L populates without the user opening each account page. Fire-and-forget:
  // the sync response must not wait on the (potentially slow) SnapTrade activity
  // pulls, and the scheduler also covers these accounts on its next cycle.
  void refreshSnapTradeAccountHistoryForUser(session.user.id).catch((error) => {
    logger.warn(
      { err: error, appUserId: session.user.id },
      "SnapTrade connect-time history backfill failed",
    );
  });
  res.json(data);
});

router.get("/broker-execution/included-accounts", async (req, res) => {
  const session = await requireEntitlement("broker_connect")(req);
  const data = GetBrokerExecutionIncludedAccountsResponse.parse(
    await listBrokerAccountInclusions({ appUserId: session.user.id }),
  );
  res.json(data);
});

router.post("/broker-execution/included-accounts", async (req, res) => {
  const session = await requireEntitlementCsrf("broker_connect")(req);
  const body = SetBrokerExecutionIncludedAccountsBody.parse(req.body ?? {});
  const data = SetBrokerExecutionIncludedAccountsResponse.parse(
    await setBrokerAccountInclusions({
      appUserId: session.user.id,
      includedAccountIds: body.includedAccountIds,
    }),
  );
  res.json(data);
});

router.get(
  "/broker-execution/snaptrade/accounts/:accountId/portfolio",
  async (req, res) => {
    const session = await requireEntitlement("broker_connect")(req);
    const data = GetSnapTradeAccountPortfolioResponse.parse(
      await getSnapTradeAccountPortfolio({
        appUserId: session.user.id,
        accountId: req.params.accountId,
      }),
    );
    res.json(data);
  },
);

router.get(
  "/broker-execution/snaptrade/accounts/:accountId/history",
  async (req, res) => {
    const session = await requireEntitlement("broker_connect")(req);
    const data = GetSnapTradeAccountHistoryResponse.parse(
      await getSnapTradeAccountHistory({
        appUserId: session.user.id,
        accountId: req.params.accountId,
        from: readOptionalHistoryDate(req.query.from, "from"),
        to: readOptionalHistoryDate(req.query.to, "to"),
        range: readOptionalHistoryRange(req.query.range),
      }),
    );
    // Stored-first: the response above is served from persisted data (fast); keep
    // it fresh with a throttled, non-blocking background refresh for next time.
    refreshSnapTradeAccountHistoryOnRead({
      appUserId: session.user.id,
      accountId: req.params.accountId,
    });
    res.json(data);
  },
);

router.get(
  "/broker-execution/snaptrade/accounts/:accountId/orders/recent",
  async (req, res) => {
    const session = await requireEntitlement("broker_connect")(req);
    const data = GetSnapTradeRecentOrdersResponse.parse(
      await listSnapTradeRecentOrders({
        appUserId: session.user.id,
        accountId: req.params.accountId,
        includeNonExecuted: true,
      }),
    );
    res.json(data);
  },
);

router.get(
  "/broker-execution/snaptrade/accounts/:accountId/symbols/search",
  async (req, res) => {
    const session = await requireEntitlement("broker_connect")(req);
    const data = SearchSnapTradeAccountSymbolsResponse.parse(
      await searchSnapTradeAccountSymbols({
        appUserId: session.user.id,
        accountId: req.params.accountId,
        query: String(req.query.query ?? ""),
      }),
    );
    res.json(data);
  },
);

router.post(
  "/broker-execution/snaptrade/accounts/:accountId/orders/impact",
  async (req, res) => {
    const session = await requireAdminCsrf(req);
    const body = CheckSnapTradeEquityOrderImpactBody.parse(req.body ?? {});
    void recordAuditEvent({
      appUserId: session.user.id,
      eventType: "broker.order_mutation_attempt",
      subject: { type: "broker_provider", id: "snaptrade" },
      resource: { type: "broker_account", id: req.params.accountId },
      payload: {
        action: "impact",
        symbol: body.symbol,
        orderAction: body.action,
      },
    });
    const data = CheckSnapTradeEquityOrderImpactResponse.parse(
      await checkSnapTradeEquityOrderImpact({
        appUserId: session.user.id,
        accountId: req.params.accountId,
        input: body,
      }),
    );
    res.json(data);
  },
);

router.post(
  "/broker-execution/snaptrade/accounts/:accountId/orders",
  async (req, res) => {
    const session = await requireAdminCsrf(req);
    const body = SubmitSnapTradeEquityOrderBody.parse(req.body ?? {});
    void recordAuditEvent({
      appUserId: session.user.id,
      eventType: "broker.order_mutation_attempt",
      subject: { type: "broker_provider", id: "snaptrade" },
      resource: { type: "broker_account", id: req.params.accountId },
      payload: {
        action: "submit",
        symbol: body.symbol,
        orderAction: body.action,
      },
    });
    const data = SubmitSnapTradeEquityOrderResponse.parse(
      await submitSnapTradeEquityOrder({
        appUserId: session.user.id,
        accountId: req.params.accountId,
        input: body,
      }),
    );
    res.json(data);
  },
);

router.post(
  "/broker-execution/robinhood/accounts/:accountId/orders/impact",
  async (req, res) => {
    const session = await requireAdminCsrf(req);
    const body = ReviewRobinhoodEquityOrderBody.parse(req.body ?? {});
    void recordAuditEvent({
      appUserId: session.user.id,
      eventType: "broker.order_mutation_attempt",
      subject: { type: "broker_provider", id: "robinhood" },
      resource: { type: "broker_account", id: req.params.accountId },
      payload: {
        action: "impact",
        symbol: body.symbol,
        orderAction: body.side,
      },
    });
    const data = ReviewRobinhoodEquityOrderResponse.parse(
      await reviewRobinhoodEquityOrder({
        appUserId: session.user.id,
        accountId: req.params.accountId,
        input: body,
      }),
    );
    res.json(data);
  },
);

router.post(
  "/broker-execution/robinhood/accounts/:accountId/orders",
  async (req, res) => {
    const session = await requireAdminCsrf(req);
    const body = PlaceRobinhoodEquityOrderBody.parse(req.body ?? {});
    void recordAuditEvent({
      appUserId: session.user.id,
      eventType: "broker.order_mutation_attempt",
      subject: { type: "broker_provider", id: "robinhood" },
      resource: { type: "broker_account", id: req.params.accountId },
      payload: {
        action: "submit",
        symbol: body.symbol,
        orderAction: body.side,
      },
    });
    const data = PlaceRobinhoodEquityOrderResponse.parse(
      await placeRobinhoodEquityOrder({
        appUserId: session.user.id,
        accountId: req.params.accountId,
        input: body,
      }),
    );
    res.json(data);
  },
);

router.get(
  "/broker-execution/robinhood/accounts/:accountId/orders/recent",
  async (req, res) => {
    const session = await requireEntitlement("broker_connect")(req);
    const data = ListRobinhoodEquityOrdersResponse.parse(
      await listRobinhoodEquityOrders({
        appUserId: session.user.id,
        accountId: req.params.accountId,
      }),
    );
    res.json(data);
  },
);

router.post(
  "/broker-execution/robinhood/accounts/:accountId/orders/cancel",
  async (req, res) => {
    const session = await requireEntitlementCsrf("broker_connect")(req);
    const body = CancelRobinhoodEquityOrderBody.parse(req.body ?? {});
    void recordAuditEvent({
      appUserId: session.user.id,
      eventType: "broker.order_mutation_attempt",
      subject: { type: "broker_provider", id: "robinhood" },
      resource: { type: "broker_account", id: req.params.accountId },
      payload: { action: "cancel", orderId: body.orderId },
    });
    const data = CancelRobinhoodEquityOrderResponse.parse(
      await cancelRobinhoodEquityOrder({
        appUserId: session.user.id,
        accountId: req.params.accountId,
        orderId: body.orderId,
      }),
    );
    res.json(data);
  },
);

router.post(
  "/broker-execution/snaptrade/accounts/:accountId/orders/cancel",
  async (req, res) => {
    const session = await requireEntitlementCsrf("broker_connect")(req);
    const body = CancelSnapTradeEquityOrderBody.parse(req.body ?? {});
    void recordAuditEvent({
      appUserId: session.user.id,
      eventType: "broker.order_mutation_attempt",
      subject: { type: "broker_provider", id: "snaptrade" },
      resource: { type: "broker_account", id: req.params.accountId },
      payload: { action: "cancel", orderId: body.orderId },
    });
    const data = CancelSnapTradeEquityOrderResponse.parse(
      await cancelSnapTradeEquityOrder({
        appUserId: session.user.id,
        accountId: req.params.accountId,
        orderId: body.orderId,
      }),
    );
    res.json(data);
  },
);

// --- Robinhood options ---
router.post(
  "/broker-execution/robinhood/accounts/:accountId/options/impact",
  async (req, res) => {
    const session = await requireAdminCsrf(req);
    const body = ReviewRobinhoodOptionOrderBody.parse(req.body ?? {});
    void recordAuditEvent({
      appUserId: session.user.id,
      eventType: "broker.order_mutation_attempt",
      subject: { type: "broker_provider", id: "robinhood" },
      resource: { type: "broker_account", id: req.params.accountId },
      payload: { action: "option_impact" },
    });
    const data = ReviewRobinhoodOptionOrderResponse.parse(
      await reviewRobinhoodOptionOrder({
        appUserId: session.user.id,
        accountId: req.params.accountId,
        input: body,
      }),
    );
    res.json(data);
  },
);

router.post(
  "/broker-execution/robinhood/accounts/:accountId/options",
  async (req, res) => {
    const session = await requireAdminCsrf(req);
    const body = PlaceRobinhoodOptionOrderBody.parse(req.body ?? {});
    void recordAuditEvent({
      appUserId: session.user.id,
      eventType: "broker.order_mutation_attempt",
      subject: { type: "broker_provider", id: "robinhood" },
      resource: { type: "broker_account", id: req.params.accountId },
      payload: { action: "option_submit" },
    });
    const data = PlaceRobinhoodOptionOrderResponse.parse(
      await placeRobinhoodOptionOrder({
        appUserId: session.user.id,
        accountId: req.params.accountId,
        input: body,
      }),
    );
    res.json(data);
  },
);

router.get(
  "/broker-execution/robinhood/accounts/:accountId/options/recent",
  async (req, res) => {
    const session = await requireEntitlement("broker_connect")(req);
    const data = ListRobinhoodOptionOrdersResponse.parse(
      await listRobinhoodOptionOrders({
        appUserId: session.user.id,
        accountId: req.params.accountId,
      }),
    );
    res.json(data);
  },
);

router.post(
  "/broker-execution/robinhood/accounts/:accountId/options/cancel",
  async (req, res) => {
    const session = await requireEntitlementCsrf("broker_connect")(req);
    const body = CancelRobinhoodOptionOrderBody.parse(req.body ?? {});
    void recordAuditEvent({
      appUserId: session.user.id,
      eventType: "broker.order_mutation_attempt",
      subject: { type: "broker_provider", id: "robinhood" },
      resource: { type: "broker_account", id: req.params.accountId },
      payload: { action: "option_cancel", orderId: body.orderId },
    });
    const data = CancelRobinhoodOptionOrderResponse.parse(
      await cancelRobinhoodOptionOrder({
        appUserId: session.user.id,
        accountId: req.params.accountId,
        input: body,
      }),
    );
    res.json(data);
  },
);

// --- SnapTrade options ---
router.post(
  "/broker-execution/snaptrade/accounts/:accountId/options/impact",
  async (req, res) => {
    const session = await requireAdminCsrf(req);
    const body = CheckSnapTradeOptionOrderImpactBody.parse(req.body ?? {});
    void recordAuditEvent({
      appUserId: session.user.id,
      eventType: "broker.order_mutation_attempt",
      subject: { type: "broker_provider", id: "snaptrade" },
      resource: { type: "broker_account", id: req.params.accountId },
      payload: { action: "option_impact" },
    });
    const data = CheckSnapTradeOptionOrderImpactResponse.parse(
      await checkSnapTradeOptionOrderImpact({
        appUserId: session.user.id,
        accountId: req.params.accountId,
        input: body,
      }),
    );
    res.json(data);
  },
);

router.post(
  "/broker-execution/snaptrade/accounts/:accountId/options",
  async (req, res) => {
    const session = await requireAdminCsrf(req);
    const body = SubmitSnapTradeOptionOrderBody.parse(req.body ?? {});
    void recordAuditEvent({
      appUserId: session.user.id,
      eventType: "broker.order_mutation_attempt",
      subject: { type: "broker_provider", id: "snaptrade" },
      resource: { type: "broker_account", id: req.params.accountId },
      payload: { action: "option_submit" },
    });
    const data = SubmitSnapTradeOptionOrderResponse.parse(
      await submitSnapTradeOptionOrder({
        appUserId: session.user.id,
        accountId: req.params.accountId,
        input: body,
      }),
    );
    res.json(data);
  },
);

router.get(
  "/broker-execution/snaptrade/accounts/:accountId/options/recent",
  async (req, res) => {
    const session = await requireEntitlement("broker_connect")(req);
    const data = ListSnapTradeRecentOptionOrdersResponse.parse(
      await listSnapTradeRecentOptionOrders({
        appUserId: session.user.id,
        accountId: req.params.accountId,
      }),
    );
    res.json(data);
  },
);

// --- Schwab options ---
router.post(
  "/broker-execution/schwab/accounts/:accountId/options/preview",
  async (req, res) => {
    const session = await requireEntitlementCsrf("broker_connect")(req);
    const body = PreviewSchwabOptionOrderBody.parse(req.body ?? {});
    void recordAuditEvent({
      appUserId: session.user.id,
      eventType: "broker.order_mutation_attempt",
      subject: { type: "broker_provider", id: "schwab" },
      resource: { type: "broker_account", id: req.params.accountId },
      payload: { action: "option_preview" },
    });
    await requireSchwabOrderReadiness();
    const data = PreviewSchwabOptionOrderResponse.parse(
      await previewSchwabOptionOrder({
        appUserId: session.user.id,
        accountId: req.params.accountId,
        input: body,
      }),
    );
    res.json(data);
  },
);

router.post(
  "/broker-execution/schwab/accounts/:accountId/options",
  async (req, res) => {
    const session = await requireEntitlementCsrf("broker_connect")(req);
    const body = SubmitSchwabOptionOrderBody.parse(req.body ?? {});
    void recordAuditEvent({
      appUserId: session.user.id,
      eventType: "broker.order_mutation_attempt",
      subject: { type: "broker_provider", id: "schwab" },
      resource: { type: "broker_account", id: req.params.accountId },
      payload: { action: "option_submit" },
    });
    await requireSchwabOrderReadiness();
    const data = SubmitSchwabOptionOrderResponse.parse(
      await submitSchwabOptionOrder({
        appUserId: session.user.id,
        accountId: req.params.accountId,
        input: body,
      }),
    );
    res.json(data);
  },
);

router.post(
  "/broker-execution/schwab/accounts/:accountId/options/cancel",
  async (req, res) => {
    const session = await requireEntitlementCsrf("broker_connect")(req);
    const body = CancelSchwabOptionOrderBody.parse(req.body ?? {});
    void recordAuditEvent({
      appUserId: session.user.id,
      eventType: "broker.order_mutation_attempt",
      subject: { type: "broker_provider", id: "schwab" },
      resource: { type: "broker_account", id: req.params.accountId },
      payload: { action: "option_cancel", orderId: body.orderId },
    });
    await requireSchwabOrderReadiness();
    const data = CancelSchwabOptionOrderResponse.parse(
      await cancelSchwabOptionOrder({
        appUserId: session.user.id,
        accountId: req.params.accountId,
        orderId: body.orderId,
      }),
    );
    res.json(data);
  },
);

// --- Schwab recent orders (equity + options) ---
router.get(
  "/broker-execution/schwab/accounts/:accountId/orders/recent",
  async (req, res) => {
    const session = await requireEntitlement("broker_connect")(req);
    await requireSchwabOrderReadiness();
    const data = ListSchwabRecentOrdersResponse.parse(
      await listSchwabRecentOrders({
        appUserId: session.user.id,
        accountId: req.params.accountId,
      }),
    );
    res.json(data);
  },
);

// --- SnapTrade option cancel ---
router.post(
  "/broker-execution/snaptrade/accounts/:accountId/options/cancel",
  async (req, res) => {
    const session = await requireEntitlementCsrf("broker_connect")(req);
    const body = CancelSnapTradeOptionOrderBody.parse(req.body ?? {});
    void recordAuditEvent({
      appUserId: session.user.id,
      eventType: "broker.order_mutation_attempt",
      subject: { type: "broker_provider", id: "snaptrade" },
      resource: { type: "broker_account", id: req.params.accountId },
      payload: { action: "option_cancel", orderId: body.orderId },
    });
    const data = CancelSnapTradeOptionOrderResponse.parse(
      await cancelSnapTradeOptionOrder({
        appUserId: session.user.id,
        accountId: req.params.accountId,
        input: body,
      }),
    );
    res.json(data);
  },
);

export default router;
