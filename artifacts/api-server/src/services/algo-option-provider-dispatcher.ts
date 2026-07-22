import {
  algoDeploymentTargetsTable,
  algoDeploymentsTable,
  brokerAccountsTable,
  brokerConnectionsTable,
  db,
} from "@workspace/db";
import { eq } from "drizzle-orm";

import { HttpError } from "../lib/errors";
import {
  createAlgoOptionBrokerDispatcher,
  type AlgoOptionBrokerMutationAuthorityInput,
} from "./algo-option-broker-adapter";
import { createAlgoIbkrOptionAdapter } from "./algo-option-ibkr-adapter";
import { createAlgoRobinhoodOptionAdapter } from "./algo-option-robinhood-adapter";
import { createAlgoSchwabOptionAdapter } from "./algo-option-schwab-adapter";
import { createAlgoSnapTradeOptionAdapter } from "./algo-option-snaptrade-adapter";

function authorityError(code: string, message: string, statusCode = 409): never {
  throw new HttpError(statusCode, message, { code, expose: statusCode < 500 });
}

export async function authorizeAlgoOptionBrokerMutation(
  input: AlgoOptionBrokerMutationAuthorityInput,
): Promise<void> {
  const [context] = await db
    .select({
      deploymentId: algoDeploymentTargetsTable.deploymentId,
      accountId: algoDeploymentTargetsTable.brokerAccountId,
      lifecycle: algoDeploymentTargetsTable.lifecycle,
      executionEnabled: algoDeploymentTargetsTable.executionEnabled,
      deploymentOwnerId: algoDeploymentsTable.appUserId,
      deploymentMode: algoDeploymentsTable.mode,
      deploymentEnabled: algoDeploymentsTable.enabled,
      deploymentIsDraft: algoDeploymentsTable.isDraft,
      deploymentArchivedAt: algoDeploymentsTable.archivedAt,
      accountOwnerId: brokerAccountsTable.appUserId,
      accountMode: brokerAccountsTable.mode,
      includedInTrading: brokerAccountsTable.includedInTrading,
      accountStatus: brokerAccountsTable.accountStatus,
      executionBlockers: brokerAccountsTable.executionBlockers,
      connectionOwnerId: brokerConnectionsTable.appUserId,
      connectionType: brokerConnectionsTable.connectionType,
      connectionProvider: brokerConnectionsTable.brokerProvider,
      connectionStatus: brokerConnectionsTable.status,
    })
    .from(algoDeploymentTargetsTable)
    .innerJoin(
      algoDeploymentsTable,
      eq(algoDeploymentsTable.id, algoDeploymentTargetsTable.deploymentId),
    )
    .innerJoin(
      brokerAccountsTable,
      eq(brokerAccountsTable.id, algoDeploymentTargetsTable.brokerAccountId),
    )
    .innerJoin(
      brokerConnectionsTable,
      eq(brokerConnectionsTable.id, brokerAccountsTable.connectionId),
    )
    .where(eq(algoDeploymentTargetsTable.id, input.targetId))
    .limit(1);

  if (
    !context ||
    context.deploymentId !== input.deploymentId ||
    context.accountId !== input.accountId
  ) {
    return authorityError(
      "algo_target_not_found",
      "Algorithm broker target not found.",
      404,
    );
  }
  if (
    context.deploymentOwnerId !== input.appUserId ||
    context.accountOwnerId !== input.appUserId ||
    context.connectionOwnerId !== input.appUserId
  ) {
    return authorityError(
      "algo_target_forbidden",
      "Algorithm broker target access denied.",
      403,
    );
  }
  if (context.connectionProvider !== input.provider) {
    return authorityError(
      "algo_target_provider_mismatch",
      "The target broker provider does not match the requested adapter.",
    );
  }
  const lifecycleAllowed =
    context.lifecycle === "active" ||
    (input.action !== "entry" && context.lifecycle === "draining");
  if (!lifecycleAllowed) {
    return authorityError(
      "algo_target_lifecycle_blocked",
      "The target lifecycle blocks this action.",
    );
  }
  if (
    context.accountMode !== "live" ||
    context.connectionType !== "broker" ||
    context.connectionStatus !== "connected"
  ) {
    return authorityError(
      "algo_target_account_execution_blocked",
      "The target account is not connected for live broker actions.",
    );
  }
  if (input.action !== "entry") return;
  if (!context.executionEnabled) {
    return authorityError(
      "algo_target_execution_disabled",
      "This account target is configured but not enabled for execution.",
    );
  }
  if (
    context.deploymentMode !== "live" ||
    !context.deploymentEnabled ||
    context.deploymentIsDraft ||
    context.deploymentArchivedAt
  ) {
    return authorityError(
      "algo_live_deployment_not_running",
      "The live deployment is not running.",
    );
  }
  if (
    !context.includedInTrading ||
    (context.accountStatus !== null && context.accountStatus !== "open") ||
    context.executionBlockers.length > 0
  ) {
    return authorityError(
      "algo_target_account_execution_blocked",
      "The target account is not ready for automated options trading.",
    );
  }
}

export function createDefaultAlgoOptionBrokerDispatcher() {
  return createAlgoOptionBrokerDispatcher(
    [
      createAlgoRobinhoodOptionAdapter(),
      createAlgoSchwabOptionAdapter(),
      createAlgoSnapTradeOptionAdapter(),
      createAlgoIbkrOptionAdapter(),
    ],
    { authorizeMutation: authorizeAlgoOptionBrokerMutation },
  );
}
