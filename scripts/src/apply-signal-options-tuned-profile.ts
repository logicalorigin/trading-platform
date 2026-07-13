import {
  resolveSignalOptionsExecutionProfile,
  tunedSignalOptionsExecutionProfilePatch,
  tunedSignalOptionsStrategySettings,
} from "@workspace/backtest-core";
import {
  algoDeploymentsTable,
  automationDiagnosticsTable,
  executionEventsTable,
  pool,
  db,
  signalMonitorProfilesTable,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual, parseArgs as parseNodeArgs } from "node:util";
import { isSignalOptionsShadowConfig } from "../../artifacts/api-server/src/services/algo-deployment-account";
import { normalizeLegacyAlgoBrandText } from "../../artifacts/api-server/src/services/algo-branding";
import { stripOvernightSpotFromSignalOptionsConfig } from "../../artifacts/api-server/src/services/algo-deployment-profile-shape";

type DeploymentRow = typeof algoDeploymentsTable.$inferSelect;
type SignalMonitorProfileRow = typeof signalMonitorProfilesTable.$inferSelect;

export type TunedProfileArgs = {
  commit: boolean;
  deploymentId: string | null;
};

const TARGET_DEPLOYMENT_NAME = "Pyrus Signals Options Shadow";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function parseTunedProfileArgs(
  args: string[],
  env: Record<string, string | undefined>,
): TunedProfileArgs {
  const tokens = args[0] === "--" ? args.slice(1) : [...args];
  const parsed = parseNodeArgs({
    args: tokens,
    options: {
      commit: { type: "boolean" },
      "deployment-id": { type: "string" },
    },
    strict: true,
    allowPositionals: false,
    tokens: true,
  });
  for (const name of ["commit", "deployment-id"] as const) {
    if (
      parsed.tokens.filter(
        (token) => token.kind === "option" && token.name === name,
      ).length > 1
    ) {
      throw new Error(`Duplicate argument: --${name}`);
    }
  }

  const rawCliDeploymentId = parsed.values["deployment-id"];
  if (rawCliDeploymentId !== undefined && !rawCliDeploymentId.trim()) {
    throw new Error("--deployment-id requires a UUID value.");
  }
  const cliDeploymentId = rawCliDeploymentId?.trim() || null;
  const commit = parsed.values.commit === true;
  const envDeploymentId =
    env["SIGNAL_OPTIONS_TUNED_PROFILE_DEPLOYMENT_ID"]?.trim() || null;
  if (
    cliDeploymentId &&
    envDeploymentId &&
    cliDeploymentId !== envDeploymentId
  ) {
    throw new Error(
      "--deployment-id conflicts with SIGNAL_OPTIONS_TUNED_PROFILE_DEPLOYMENT_ID.",
    );
  }
  const deploymentId = cliDeploymentId ?? envDeploymentId;
  if (deploymentId && !UUID_PATTERN.test(deploymentId)) {
    throw new Error("Deployment ID must be a UUID.");
  }
  if (commit && !deploymentId) {
    throw new Error(
      "--commit requires --deployment-id to bind the reviewed target.",
    );
  }

  return { commit, deploymentId };
}

function isSignalOptionsDeployment(deployment: DeploymentRow): boolean {
  return (
    deployment.providerAccountId === "shadow" &&
    deployment.mode === "shadow" &&
    isSignalOptionsShadowConfig(deployment.config)
  );
}

async function findTargetDeployment(
  requestedId: string | null,
): Promise<DeploymentRow> {
  if (requestedId) {
    const [deployment] = await db
      .select()
      .from(algoDeploymentsTable)
      .where(eq(algoDeploymentsTable.id, requestedId))
      .limit(1);
    if (!deployment) {
      throw new Error(`No deployment found for ${requestedId}.`);
    }
    if (!isSignalOptionsDeployment(deployment)) {
      throw new Error(
        `Deployment ${deployment.id} is not a shadow signal-options deployment.`,
      );
    }
    return deployment;
  }

  const deployments = await db
    .select()
    .from(algoDeploymentsTable)
    .where(
      and(
        eq(algoDeploymentsTable.mode, "shadow"),
        eq(algoDeploymentsTable.providerAccountId, "shadow"),
      ),
    )
    .orderBy(desc(algoDeploymentsTable.updatedAt));

  const deployment =
    deployments.find((row) => row.name === TARGET_DEPLOYMENT_NAME) ??
    deployments.find(isSignalOptionsDeployment);

  if (!deployment) {
    throw new Error("No shadow signal-options deployment found.");
  }
  if (!isSignalOptionsDeployment(deployment)) {
    throw new Error(
      `Deployment ${deployment.id} is not a shadow signal-options deployment.`,
    );
  }
  return deployment;
}

async function findShadowSignalMonitorProfile(): Promise<SignalMonitorProfileRow> {
  const [profile] = await db
    .select()
    .from(signalMonitorProfilesTable)
    .where(eq(signalMonitorProfilesTable.environment, "shadow"))
    .limit(1);
  if (!profile) {
    throw new Error(
      "The shared shadow signal-monitor profile is missing; initialize it before applying tuned settings.",
    );
  }
  return profile;
}

function buildTunedExecutionProfile(config: Record<string, unknown>) {
  const current = resolveSignalOptionsExecutionProfile(config);
  const patch = asRecord(tunedSignalOptionsExecutionProfilePatch);
  const patchKeys = Object.keys(patch);
  if (
    patchKeys.some(
      (key) => !["optionSelection", "riskCaps", "exitPolicy"].includes(key),
    )
  ) {
    // ponytail: this utility owns the three current tuned groups; move the
    // shared deep-patch helper into backtest-core if the tuned patch expands.
    throw new Error(
      "The tuned execution-profile patch has an unsupported group.",
    );
  }
  const optionSelectionPatch = asRecord(patch.optionSelection);
  return resolveSignalOptionsExecutionProfile({
    ...current,
    ...patch,
    optionSelection: {
      ...current.optionSelection,
      ...optionSelectionPatch,
      greekSelector: {
        ...current.optionSelection.greekSelector,
        ...asRecord(optionSelectionPatch.greekSelector),
      },
    },
    riskCaps: {
      ...current.riskCaps,
      ...asRecord(patch.riskCaps),
    },
    exitPolicy: {
      ...current.exitPolicy,
      ...asRecord(patch.exitPolicy),
    },
  });
}

function buildTunedDeploymentConfig(configValue: unknown) {
  const config = stripOvernightSpotFromSignalOptionsConfig(configValue);
  const parameters = asRecord(config.parameters);
  return {
    ...config,
    parameters: {
      ...parameters,
      signalTimeframe: tunedSignalOptionsStrategySettings.signalTimeframe,
      ...tunedSignalOptionsStrategySettings.pyrusSignalsSettings,
    },
    signalOptions: buildTunedExecutionProfile(config),
  };
}

function buildTunedMonitorSettings(settingsValue: unknown) {
  const current = asRecord(settingsValue);
  const patch = tunedSignalOptionsStrategySettings.pyrusSignalsSettings;
  return {
    ...current,
    ...patch,
    marketStructure: {
      ...asRecord(current.marketStructure),
      ...patch,
    },
  };
}

// ponytail: this transaction covers durable state and audit evidence. The live
// API owns separate short-TTL caches; add database-backed pub/sub only if an
// immediate cross-process refresh becomes a measured requirement.
export async function applySignalOptionsTunedProfile(input: {
  deploymentId: string;
  expectedDeploymentConfig: Record<string, unknown>;
  expectedDeploymentEnabled: boolean;
  expectedSignalMonitorProfile: Pick<
    SignalMonitorProfileRow,
    "enabled" | "timeframe" | "pyrusSignalsSettings"
  >;
}) {
  return db.transaction(async (tx) => {
    const [deployment] = await tx
      .select()
      .from(algoDeploymentsTable)
      .where(eq(algoDeploymentsTable.id, input.deploymentId))
      .for("update");
    if (!deployment) {
      throw new Error(`No deployment found for ${input.deploymentId}.`);
    }
    if (
      deployment.mode !== "shadow" ||
      deployment.providerAccountId !== "shadow"
    ) {
      throw new Error(
        `Deployment ${deployment.id} must still be a shadow deployment.`,
      );
    }
    if (!isSignalOptionsShadowConfig(deployment.config)) {
      throw new Error(
        `Deployment ${deployment.id} is not a signal-options deployment.`,
      );
    }
    if (
      deployment.enabled !== input.expectedDeploymentEnabled ||
      !isDeepStrictEqual(deployment.config, input.expectedDeploymentConfig)
    ) {
      throw new Error(
        `Deployment ${deployment.id} changed after it was reviewed; run the command again.`,
      );
    }

    const [signalMonitorProfile] = await tx
      .select()
      .from(signalMonitorProfilesTable)
      .where(eq(signalMonitorProfilesTable.environment, "shadow"))
      .for("update");
    if (!signalMonitorProfile) {
      throw new Error(
        "The shared shadow signal-monitor profile is missing; initialize it before applying tuned settings.",
      );
    }
    if (
      signalMonitorProfile.enabled !==
        input.expectedSignalMonitorProfile.enabled ||
      signalMonitorProfile.timeframe !==
        input.expectedSignalMonitorProfile.timeframe ||
      !isDeepStrictEqual(
        signalMonitorProfile.pyrusSignalsSettings,
        input.expectedSignalMonitorProfile.pyrusSignalsSettings,
      )
    ) {
      throw new Error(
        "The shared shadow signal-monitor profile changed after it was reviewed; run the command again.",
      );
    }

    const nextConfig = buildTunedDeploymentConfig(deployment.config);
    const nextPyrusSignalsSettings = buildTunedMonitorSettings(
      signalMonitorProfile.pyrusSignalsSettings,
    );
    const now = new Date();
    const [updatedDeployment] = await tx
      .update(algoDeploymentsTable)
      .set({
        config: nextConfig,
        updatedAt: now,
        lastError: null,
      })
      .where(
        and(
          eq(algoDeploymentsTable.id, deployment.id),
          eq(algoDeploymentsTable.mode, "shadow"),
          eq(algoDeploymentsTable.providerAccountId, "shadow"),
        ),
      )
      .returning();
    if (!updatedDeployment) {
      throw new Error(
        `Deployment ${deployment.id} stopped being an eligible shadow target.`,
      );
    }

    const [updatedSignalMonitorProfile] = await tx
      .update(signalMonitorProfilesTable)
      .set({
        timeframe: tunedSignalOptionsStrategySettings.signalTimeframe,
        pyrusSignalsSettings: nextPyrusSignalsSettings,
        updatedAt: now,
      })
      .where(eq(signalMonitorProfilesTable.id, signalMonitorProfile.id))
      .returning();
    if (!updatedSignalMonitorProfile) {
      throw new Error("The shared shadow signal-monitor profile disappeared.");
    }

    const deploymentName = normalizeLegacyAlgoBrandText(deployment.name);
    await tx.insert(automationDiagnosticsTable).values({
      deploymentId: deployment.id,
      providerAccountId: deployment.providerAccountId,
      eventType: "deployment_strategy_settings_updated",
      summary: `Updated strategy signal settings for ${deploymentName}`,
      payload: {
        timeHorizon:
          tunedSignalOptionsStrategySettings.pyrusSignalsSettings.timeHorizon,
        signalTimeframe: tunedSignalOptionsStrategySettings.signalTimeframe,
        pyrusSignalsSettings:
          tunedSignalOptionsStrategySettings.pyrusSignalsSettings,
        previousParameters: asRecord(asRecord(deployment.config).parameters),
        signalMonitorProfileId: signalMonitorProfile.id,
      },
      occurredAt: now,
    });
    await tx.insert(executionEventsTable).values({
      deploymentId: deployment.id,
      providerAccountId: deployment.providerAccountId,
      eventType: "signal_options_profile_updated",
      summary: `Updated signal-options profile for ${deploymentName}`,
      payload: {
        profile: nextConfig.signalOptions,
        metadata: {
          deploymentId: deployment.id,
          deploymentName,
        },
      },
      occurredAt: now,
    });

    return {
      previousDeployment: deployment,
      deployment: updatedDeployment,
      previousSignalMonitorProfile: signalMonitorProfile,
      signalMonitorProfile: updatedSignalMonitorProfile,
    };
  });
}

function summarizeDeployment(deployment: DeploymentRow) {
  const config = asRecord(deployment.config);
  const parameters = asRecord(config.parameters);
  const profile = asRecord(config.signalOptions);
  return {
    id: deployment.id,
    name: deployment.name,
    mode: deployment.mode,
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
    greekSelector: asRecord(asRecord(profile.optionSelection).greekSelector),
    riskCaps: asRecord(profile.riskCaps),
    exitPolicy: asRecord(profile.exitPolicy),
  };
}

function summarizeSignalMonitorProfile(profile: SignalMonitorProfileRow) {
  const settings = asRecord(profile.pyrusSignalsSettings);
  return {
    id: profile.id,
    environment: profile.environment,
    enabled: profile.enabled,
    timeframe: profile.timeframe,
    pyrusSignalsSettings: {
      timeHorizon: settings.timeHorizon ?? null,
      bosConfirmation: settings.bosConfirmation ?? null,
      chochAtrBuffer: settings.chochAtrBuffer ?? null,
      chochBodyExpansionAtr: settings.chochBodyExpansionAtr ?? null,
      chochVolumeGate: settings.chochVolumeGate ?? null,
    },
  };
}

export async function main(
  args = process.argv.slice(2),
  env: Record<string, string | undefined> = process.env,
) {
  const options = parseTunedProfileArgs(args, env);
  const deployment = await findTargetDeployment(options.deploymentId);
  const signalMonitorProfile = await findShadowSignalMonitorProfile();
  const target = {
    signalTimeframe: tunedSignalOptionsStrategySettings.signalTimeframe,
    ...tunedSignalOptionsStrategySettings.pyrusSignalsSettings,
    profilePatch: tunedSignalOptionsExecutionProfilePatch,
  };

  console.log(
    JSON.stringify(
      {
        dryRun: !options.commit,
        current: {
          deployment: summarizeDeployment(deployment),
          sharedSignalMonitorProfile:
            summarizeSignalMonitorProfile(signalMonitorProfile),
        },
        target,
      },
      null,
      2,
    ),
  );

  if (!options.commit) {
    return;
  }

  const applied = await applySignalOptionsTunedProfile({
    deploymentId: deployment.id,
    expectedDeploymentConfig: deployment.config,
    expectedDeploymentEnabled: deployment.enabled,
    expectedSignalMonitorProfile: signalMonitorProfile,
  });
  console.log(
    JSON.stringify(
      {
        applied: true,
        atomic: true,
        deployment: summarizeDeployment(applied.deployment),
        sharedSignalMonitorProfile: summarizeSignalMonitorProfile(
          applied.signalMonitorProfile,
        ),
      },
      null,
      2,
    ),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void (async () => {
    try {
      await main();
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    try {
      await pool.end();
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  })();
}
