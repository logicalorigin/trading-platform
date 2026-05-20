import {
  tunedSignalOptionsExecutionProfilePatch,
  tunedSignalOptionsStrategySettings,
} from "@workspace/backtest-core";
import {
  algoDeploymentsTable,
  pool,
  db,
} from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { pathToFileURL } from "node:url";
import { updateAlgoDeploymentStrategySettings } from "../../artifacts/api-server/src/services/automation";
import { updateSignalOptionsExecutionProfile } from "../../artifacts/api-server/src/services/signal-options-automation";

type DeploymentRow = typeof algoDeploymentsTable.$inferSelect;

const TARGET_DEPLOYMENT_NAME = "RayReplica Signal Options Shadow Paper";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readArgValue(name: string): string | null {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function shouldCommit(): boolean {
  return (
    process.argv.includes("--commit") ||
    process.env["SIGNAL_OPTIONS_TUNED_PROFILE_COMMIT"] === "1"
  );
}

function isSignalOptionsDeployment(deployment: DeploymentRow): boolean {
  const config = asRecord(deployment.config);
  return (
    deployment.providerAccountId === "shadow" &&
    deployment.mode === "paper" &&
    (deployment.name === TARGET_DEPLOYMENT_NAME ||
      asRecord(config.parameters).executionMode === "signal_options" ||
      Object.keys(asRecord(config.signalOptions)).length > 0)
  );
}

async function findTargetDeployment(): Promise<DeploymentRow> {
  const requestedId =
    readArgValue("--deployment-id") ??
    process.env["SIGNAL_OPTIONS_TUNED_PROFILE_DEPLOYMENT_ID"] ??
    null;
  const deployments = await db
    .select()
    .from(algoDeploymentsTable)
    .where(eq(algoDeploymentsTable.mode, "paper"))
    .orderBy(desc(algoDeploymentsTable.updatedAt));

  const deployment = requestedId
    ? deployments.find((row) => row.id === requestedId)
    : deployments.find((row) => row.name === TARGET_DEPLOYMENT_NAME) ??
      deployments.find(isSignalOptionsDeployment);

  if (!deployment) {
    throw new Error(
      requestedId
        ? `No paper deployment found for ${requestedId}.`
        : "No paper signal-options deployment found.",
    );
  }
  if (!isSignalOptionsDeployment(deployment)) {
    throw new Error(
      `Deployment ${deployment.id} is not a paper shadow signal-options deployment.`,
    );
  }
  return deployment;
}

function summarizeDeployment(deployment: DeploymentRow) {
  const config = asRecord(deployment.config);
  const parameters = asRecord(config.parameters);
  const profile = asRecord(config.signalOptions);
  return {
    id: deployment.id,
    name: deployment.name,
    enabled: deployment.enabled,
    providerAccountId: deployment.providerAccountId,
    parameters: {
      signalTimeframe: parameters.signalTimeframe ?? null,
      timeHorizon: parameters.timeHorizon ?? null,
      bosConfirmation: parameters.bosConfirmation ?? null,
      chochAtrBuffer: parameters.chochAtrBuffer ?? null,
      chochBodyExpansionAtr: parameters.chochBodyExpansionAtr ?? null,
      chochVolumeGate: parameters.chochVolumeGate ?? null,
    },
    riskCaps: asRecord(profile.riskCaps),
    exitPolicy: asRecord(profile.exitPolicy),
  };
}

async function main() {
  const deployment = await findTargetDeployment();
  const commit = shouldCommit();
  const target = {
    signalTimeframe: tunedSignalOptionsStrategySettings.signalTimeframe,
    ...tunedSignalOptionsStrategySettings.rayReplicaSettings,
    profilePatch: tunedSignalOptionsExecutionProfilePatch,
  };

  console.log(
    JSON.stringify(
      {
        dryRun: !commit,
        current: summarizeDeployment(deployment),
        target,
      },
      null,
      2,
    ),
  );

  if (!commit) {
    return;
  }

  await updateAlgoDeploymentStrategySettings({
    deploymentId: deployment.id,
    signalTimeframe: tunedSignalOptionsStrategySettings.signalTimeframe,
    ...tunedSignalOptionsStrategySettings.rayReplicaSettings,
  });
  await updateSignalOptionsExecutionProfile({
    deploymentId: deployment.id,
    patch: tunedSignalOptionsExecutionProfilePatch,
  });
  console.log(
    JSON.stringify(
      {
        applied: true,
        deploymentId: deployment.id,
        deploymentName: deployment.name,
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end();
    });
}
