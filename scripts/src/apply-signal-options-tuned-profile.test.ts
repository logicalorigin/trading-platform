import assert from "node:assert/strict";
import test from "node:test";
import {
  algoDeploymentsTable,
  algoStrategiesTable,
  automationDiagnosticsTable,
  executionEventsTable,
  signalMonitorProfilesTable,
  type WorkspaceDatabase,
} from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";
import { eq } from "drizzle-orm";
import {
  applySignalOptionsTunedProfile,
  parseTunedProfileArgs,
} from "./apply-signal-options-tuned-profile";

const DEPLOYMENT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_DEPLOYMENT_ID = "22222222-2222-4222-8222-222222222222";

const originalDeploymentConfig = {
  source: "default_signal_options_seed",
  parameters: {
    executionMode: "signal_options",
    signalTimeframe: "15m",
    timeHorizon: 2,
    bosConfirmation: "close",
    customParameter: "preserve",
  },
  signalOptions: {
    optionSelection: {
      greekSelector: {
        enabled: false,
        maxCandidates: 7,
      },
    },
    riskCaps: {
      maxDailyLoss: 321,
      maxOpenSymbols: 2,
      maxPremiumPerEntry: 900,
    },
    exitPolicy: {
      hardStopPct: -50,
      trailActivationPct: 80,
    },
  },
  overnightSpot: { enabled: true },
} satisfies Record<string, unknown>;

const originalMonitorSettings = {
  __signalMonitorUniverseScope: "selected_watchlist",
  __signalMonitorUniverseScopeDefaultVersion: 2,
  customSetting: "preserve",
  timeHorizon: 2,
  marketStructure: {
    customNestedSetting: "preserve",
    timeHorizon: 2,
  },
};

async function seedTunedProfileState(
  db: WorkspaceDatabase,
  input: {
    mode?: "shadow" | "live";
    providerAccountId?: string;
    config?: Record<string, unknown>;
  } = {},
) {
  const mode = input.mode ?? "shadow";
  const [strategy] = await db
    .insert(algoStrategiesTable)
    .values({
      name: "Pyrus Signals Options Shadow",
      mode,
      enabled: false,
      symbolUniverse: ["AAPL"],
      config: originalDeploymentConfig,
    })
    .returning();
  assert.ok(strategy);

  const [deployment] = await db
    .insert(algoDeploymentsTable)
    .values({
      id: DEPLOYMENT_ID,
      strategyId: strategy.id,
      name: "Pyrus Signals Options Shadow",
      mode,
      enabled: true,
      providerAccountId:
        input.providerAccountId ??
        (mode === "shadow" ? "shadow" : "live-account"),
      symbolUniverse: ["AAPL"],
      config: input.config ?? originalDeploymentConfig,
      lastError: "old error",
    })
    .returning();
  assert.ok(deployment);

  const [profile] = await db
    .insert(signalMonitorProfilesTable)
    .values({
      environment: "shadow",
      timeframe: "15m",
      pyrusSignalsSettings: originalMonitorSettings,
    })
    .returning();
  assert.ok(profile);
  return { deployment, profile };
}

async function readDeployment(db: WorkspaceDatabase) {
  const [deployment] = await db
    .select()
    .from(algoDeploymentsTable)
    .where(eq(algoDeploymentsTable.id, DEPLOYMENT_ID));
  assert.ok(deployment);
  return deployment;
}

async function readShadowProfile(db: WorkspaceDatabase) {
  const [profile] = await db
    .select()
    .from(signalMonitorProfilesTable)
    .where(eq(signalMonitorProfilesTable.environment, "shadow"));
  assert.ok(profile);
  return profile;
}

function applyInput(input: Awaited<ReturnType<typeof seedTunedProfileState>>) {
  return {
    deploymentId: input.deployment.id,
    expectedDeploymentConfig: input.deployment.config,
    expectedDeploymentEnabled: input.deployment.enabled,
    expectedSignalMonitorProfile: input.profile,
  };
}

test("CLI writes require an explicit deployment ID and CLI commit flag", () => {
  assert.deepEqual(
    parseTunedProfileArgs(
      ["--", "--deployment-id", DEPLOYMENT_ID, "--commit"],
      {},
    ),
    { commit: true, deploymentId: DEPLOYMENT_ID },
  );
  assert.deepEqual(
    parseTunedProfileArgs([], {
      SIGNAL_OPTIONS_TUNED_PROFILE_COMMIT: "1",
      SIGNAL_OPTIONS_TUNED_PROFILE_DEPLOYMENT_ID: DEPLOYMENT_ID,
    }),
    { commit: false, deploymentId: DEPLOYMENT_ID },
  );
  assert.throws(
    () => parseTunedProfileArgs(["--commit"], {}),
    /--commit requires --deployment-id/,
  );
  assert.throws(
    () =>
      parseTunedProfileArgs(["--deployment-id", DEPLOYMENT_ID, "--commit"], {
        SIGNAL_OPTIONS_TUNED_PROFILE_DEPLOYMENT_ID: OTHER_DEPLOYMENT_ID,
      }),
    /conflicts with SIGNAL_OPTIONS_TUNED_PROFILE_DEPLOYMENT_ID/,
  );
  assert.throws(
    () =>
      parseTunedProfileArgs(["--deployment-id", DEPLOYMENT_ID, "--typo"], {}),
    /Unknown option '--typo'/,
  );
});

test("atomic apply updates both state owners and both audit rows", async () => {
  await withTestDb(async ({ db }) => {
    const seeded = await seedTunedProfileState(db);
    const result = await applySignalOptionsTunedProfile(applyInput(seeded));

    const deployment = await readDeployment(db);
    const config = deployment.config as Record<string, unknown>;
    const parameters = config.parameters as Record<string, unknown>;
    const signalOptions = config.signalOptions as Record<string, unknown>;
    const riskCaps = signalOptions.riskCaps as Record<string, unknown>;
    const optionSelection = signalOptions.optionSelection as Record<
      string,
      unknown
    >;
    const greekSelector = optionSelection.greekSelector as Record<
      string,
      unknown
    >;
    const exitPolicy = signalOptions.exitPolicy as Record<string, unknown>;

    assert.equal(config.overnightSpot, undefined);
    assert.equal(parameters.customParameter, "preserve");
    assert.equal(parameters.signalTimeframe, "5m");
    assert.equal(parameters.timeHorizon, 8);
    assert.equal(parameters.bosConfirmation, "wicks");
    assert.equal(riskCaps.maxDailyLoss, 321);
    assert.equal(riskCaps.maxOpenSymbols, 10);
    assert.equal(riskCaps.maxPremiumPerEntry, 1_500);
    assert.equal(greekSelector.enabled, true);
    assert.equal(greekSelector.maxCandidates, 24);
    assert.equal(exitPolicy.hardStopPct, -30);
    assert.equal(exitPolicy.earlyExitBars, 8);
    assert.equal(deployment.lastError, null);

    const profile = await readShadowProfile(db);
    const settings = profile.pyrusSignalsSettings as Record<string, unknown>;
    const marketStructure = settings.marketStructure as Record<string, unknown>;
    assert.equal(profile.id, seeded.profile.id);
    assert.equal(profile.timeframe, "5m");
    assert.equal(settings.customSetting, "preserve");
    assert.equal(settings.timeHorizon, 8);
    assert.equal(marketStructure.customNestedSetting, "preserve");
    assert.equal(marketStructure.timeHorizon, 8);

    const diagnostics = await db.select().from(automationDiagnosticsTable);
    const events = await db.select().from(executionEventsTable);
    assert.deepEqual(
      diagnostics.map((row) => row.eventType),
      ["deployment_strategy_settings_updated"],
    );
    assert.deepEqual(
      events.map((row) => row.eventType),
      ["signal_options_profile_updated"],
    );
    const diagnosticPayload = diagnostics[0]?.payload as Record<
      string,
      unknown
    >;
    const previousParameters = diagnosticPayload.previousParameters as Record<
      string,
      unknown
    >;
    const eventPayload = events[0]?.payload as Record<string, unknown>;
    const eventMetadata = eventPayload.metadata as Record<string, unknown>;
    assert.equal(diagnosticPayload.signalMonitorProfileId, seeded.profile.id);
    assert.equal(previousParameters.signalTimeframe, "15m");
    assert.equal(eventMetadata.deploymentId, DEPLOYMENT_ID);
    assert.equal(eventMetadata.deploymentName, "Pyrus Signals Options Shadow");
    assert.equal(result.deployment.id, DEPLOYMENT_ID);
    assert.equal(result.signalMonitorProfile.id, seeded.profile.id);
  });
});

test("diagnostics failure rolls back deployment and shared profile", async () => {
  await withTestDb(async ({ db, client }) => {
    const seeded = await seedTunedProfileState(db);
    await client.exec("DROP TABLE automation_diagnostics CASCADE");

    await assert.rejects(applySignalOptionsTunedProfile(applyInput(seeded)));

    assert.deepEqual(
      (await readDeployment(db)).config,
      seeded.deployment.config,
    );
    const profile = await readShadowProfile(db);
    assert.equal(profile.timeframe, seeded.profile.timeframe);
    assert.deepEqual(
      profile.pyrusSignalsSettings,
      seeded.profile.pyrusSignalsSettings,
    );
    assert.equal((await db.select().from(executionEventsTable)).length, 0);
  });
});

test("execution-event failure rolls back state and diagnostics", async () => {
  await withTestDb(async ({ db, client }) => {
    const seeded = await seedTunedProfileState(db);
    await client.exec("DROP TABLE execution_events CASCADE");

    await assert.rejects(applySignalOptionsTunedProfile(applyInput(seeded)));

    assert.deepEqual(
      (await readDeployment(db)).config,
      seeded.deployment.config,
    );
    const profile = await readShadowProfile(db);
    assert.equal(profile.timeframe, seeded.profile.timeframe);
    assert.deepEqual(
      profile.pyrusSignalsSettings,
      seeded.profile.pyrusSignalsSettings,
    );
    assert.equal(
      (await db.select().from(automationDiagnosticsTable)).length,
      0,
    );
  });
});

test("apply fails closed when the selected deployment is live", async () => {
  await withTestDb(async ({ db }) => {
    const seeded = await seedTunedProfileState(db, { mode: "live" });

    await assert.rejects(
      applySignalOptionsTunedProfile(applyInput(seeded)),
      /must still be a shadow deployment/,
    );

    assert.deepEqual(
      (await readDeployment(db)).config,
      seeded.deployment.config,
    );
    assert.deepEqual(
      (await readShadowProfile(db)).pyrusSignalsSettings,
      seeded.profile.pyrusSignalsSettings,
    );
    assert.equal(
      (await db.select().from(automationDiagnosticsTable)).length,
      0,
    );
    assert.equal((await db.select().from(executionEventsTable)).length, 0);
  });
});

test("apply fails closed for a non-shadow provider account", async () => {
  await withTestDb(async ({ db }) => {
    const seeded = await seedTunedProfileState(db, {
      providerAccountId: "broker-account",
    });

    await assert.rejects(
      applySignalOptionsTunedProfile(applyInput(seeded)),
      /must still be a shadow deployment/,
    );

    assert.deepEqual(
      (await readDeployment(db)).config,
      seeded.deployment.config,
    );
    assert.equal(
      (await db.select().from(automationDiagnosticsTable)).length,
      0,
    );
    assert.equal((await db.select().from(executionEventsTable)).length, 0);
  });
});

test("apply rejects state changed after the printed review", async () => {
  await withTestDb(async ({ db }) => {
    const seeded = await seedTunedProfileState(db);
    const changedConfig = {
      ...originalDeploymentConfig,
      parameters: {
        ...originalDeploymentConfig.parameters,
        concurrentChange: true,
      },
    };
    await db
      .update(algoDeploymentsTable)
      .set({ config: changedConfig, updatedAt: new Date() })
      .where(eq(algoDeploymentsTable.id, DEPLOYMENT_ID));

    await assert.rejects(
      applySignalOptionsTunedProfile(applyInput(seeded)),
      /changed after it was reviewed/,
    );

    assert.deepEqual((await readDeployment(db)).config, changedConfig);
    assert.deepEqual(
      (await readShadowProfile(db)).pyrusSignalsSettings,
      seeded.profile.pyrusSignalsSettings,
    );
    assert.equal(
      (await db.select().from(automationDiagnosticsTable)).length,
      0,
    );
    assert.equal((await db.select().from(executionEventsTable)).length, 0);
  });
});

test("background evaluation timestamps do not invalidate reviewed settings", async () => {
  await withTestDb(async ({ db }) => {
    const seeded = await seedTunedProfileState(db);
    const heartbeatAt = new Date(seeded.profile.updatedAt.getTime() + 1_000);
    await db
      .update(algoDeploymentsTable)
      .set({ updatedAt: heartbeatAt, lastEvaluatedAt: heartbeatAt })
      .where(eq(algoDeploymentsTable.id, DEPLOYMENT_ID));
    await db
      .update(signalMonitorProfilesTable)
      .set({ updatedAt: heartbeatAt, lastEvaluatedAt: heartbeatAt })
      .where(eq(signalMonitorProfilesTable.id, seeded.profile.id));

    await applySignalOptionsTunedProfile(applyInput(seeded));

    const parameters = (await readDeployment(db)).config.parameters as Record<
      string,
      unknown
    >;
    assert.equal(parameters.signalTimeframe, "5m");
    assert.equal((await readShadowProfile(db)).timeframe, "5m");
  });
});

test("apply rejects shared profile settings changed after review", async () => {
  await withTestDb(async ({ db }) => {
    const seeded = await seedTunedProfileState(db);
    const changedSettings = {
      ...originalMonitorSettings,
      concurrentChange: true,
    };
    await db
      .update(signalMonitorProfilesTable)
      .set({ pyrusSignalsSettings: changedSettings, updatedAt: new Date() })
      .where(eq(signalMonitorProfilesTable.id, seeded.profile.id));

    await assert.rejects(
      applySignalOptionsTunedProfile(applyInput(seeded)),
      /shared shadow signal-monitor profile changed after it was reviewed/,
    );

    assert.deepEqual(
      (await readDeployment(db)).config,
      seeded.deployment.config,
    );
    assert.deepEqual(
      (await readShadowProfile(db)).pyrusSignalsSettings,
      changedSettings,
    );
    assert.equal(
      (await db.select().from(automationDiagnosticsTable)).length,
      0,
    );
    assert.equal((await db.select().from(executionEventsTable)).length, 0);
  });
});

test("apply rejects a shadow row that is not a signal-options deployment", async () => {
  await withTestDb(async ({ db }) => {
    const seeded = await seedTunedProfileState(db, {
      config: { parameters: { executionMode: "other" } },
    });

    await assert.rejects(
      applySignalOptionsTunedProfile(applyInput(seeded)),
      /not a signal-options deployment/,
    );
    assert.equal(
      (await db.select().from(automationDiagnosticsTable)).length,
      0,
    );
    assert.equal((await db.select().from(executionEventsTable)).length, 0);
  });
});
