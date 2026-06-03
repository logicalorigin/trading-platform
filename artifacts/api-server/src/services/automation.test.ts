import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("algo strategy settings API patches deployment and signal monitor settings", () => {
  const routeSource = readFileSync(
    new URL("../routes/automation.ts", import.meta.url),
    "utf8",
  );
  const serviceSource = readFileSync(
    new URL("./automation.ts", import.meta.url),
    "utf8",
  );
  const signalOptionsServiceSource = readFileSync(
    new URL("./signal-options-automation.ts", import.meta.url),
    "utf8",
  );
  const shadowScanRouteSource = routeSource.match(
    /router\.post\("\/algo\/deployments\/:deploymentId\/signal-options\/shadow-scan"[\s\S]*?\n}\);/,
  )?.[0] ?? "";

  assert.match(
    routeSource,
    /\/algo\/deployments\/:deploymentId\/strategy-settings/,
  );
  assert.match(routeSource, /\/streams\/algo\/cockpit/);
  assert.match(routeSource, /fetchAlgoCockpitCriticalPayload/);
  assert.match(routeSource, /subscribeAlgoCockpitSnapshots/);
  assert.match(routeSource, /SIGNAL_OPTIONS_STATE_SUMMARY_ROUTE_TIMEOUT_MS = 7_000/);
  assert.match(routeSource, /SIGNAL_OPTIONS_STATE_FULL_ROUTE_TIMEOUT_MS = 9_000/);
  assert.match(routeSource, /SIGNAL_OPTIONS_COCKPIT_SUMMARY_ROUTE_TIMEOUT_MS = 5_000/);
  assert.match(routeSource, /SIGNAL_OPTIONS_COCKPIT_FULL_ROUTE_TIMEOUT_MS = 9_000/);
  assert.match(routeSource, /SIGNAL_OPTIONS_SHADOW_SCAN_ROUTE_TIMEOUT_MS = 45_000/);
  assert.match(routeSource, /SIGNAL_OPTIONS_MANUAL_SCAN_ACTION_BUDGET_MS = 15_000/);
  assert.match(routeSource, /SIGNAL_OPTIONS_MANUAL_SCAN_ACTION_ITEM_LIMIT = 4/);
  assert.match(
    routeSource,
    /view === "full"[\s\S]*\? SIGNAL_OPTIONS_STATE_FULL_ROUTE_TIMEOUT_MS[\s\S]*: SIGNAL_OPTIONS_STATE_SUMMARY_ROUTE_TIMEOUT_MS/,
  );
  assert.match(
    routeSource,
    /view === "full"[\s\S]*\? SIGNAL_OPTIONS_COCKPIT_FULL_ROUTE_TIMEOUT_MS[\s\S]*: SIGNAL_OPTIONS_COCKPIT_SUMMARY_ROUTE_TIMEOUT_MS/,
  );
  assert.match(routeSource, /withSignalOptionsRouteTimeout/);
  assert.match(routeSource, /withAbortableSignalOptionsRouteTimeout/);
  assert.match(routeSource, /signal_options_state_route_timeout/);
  assert.match(routeSource, /signal_options_cockpit_route_timeout/);
  assert.match(routeSource, /signal_options_shadow_scan_route_timeout/);
  assert.match(routeSource, /req\.query\.view === "full" \? "full" : "summary"/);
  assert.match(routeSource, /function readOptionalBoolean/);
  assert.match(routeSource, /function signalOptionsAdmissionCacheMode/);
  assert.match(
    routeSource,
    /return admission\.cacheOnly \? "cache-only" : undefined/,
  );
  assert.doesNotMatch(routeSource, /admission\.cacheOnly \? "cache-only" : "normal"/);
  assert.match(routeSource, /req\.query\.includePayload === "true"/);
  assert.match(routeSource, /includePayload,/);
  assert.match(shadowScanRouteSource, /readOptionalBoolean\(body\.forceEvaluate\)/);
  assert.match(shadowScanRouteSource, /readOptionalBoolean\(body\.refreshSignals\)/);
  assert.match(shadowScanRouteSource, /readOptionalBoolean\(body\.runActions\)/);
  assert.match(shadowScanRouteSource, /readOptionalBoolean\(body\.actionScan\)/);
  assert.match(shadowScanRouteSource, /preferStoredMonitorState:\s*forceEvaluate !== true/);
  assert.match(shadowScanRouteSource, /responseMode:\s*"summary"/);
  assert.match(shadowScanRouteSource, /skipActionWork:\s*runActions !== true/);
  assert.match(shadowScanRouteSource, /forceEvaluate,[\s\S]*source:\s*"manual"[\s\S]*signal,/);
  assert.match(
    shadowScanRouteSource,
    /actionWorkBudgetMs:\s*SIGNAL_OPTIONS_MANUAL_SCAN_ACTION_BUDGET_MS/,
  );
  assert.match(
    shadowScanRouteSource,
    /actionWorkItemLimit:\s*SIGNAL_OPTIONS_MANUAL_SCAN_ACTION_ITEM_LIMIT/,
  );
  assert.doesNotMatch(shadowScanRouteSource, /forceEvaluate:\s*true/);
  assert.match(serviceSource, /updateAlgoDeploymentStrategySettings/);
  assert.match(serviceSource, /notifyAlgoCockpitChanged/);
  assert.match(serviceSource, /invalidateSignalOptionsDashboardCaches/);
  assert.match(serviceSource, /includePayload\?: boolean/);
  assert.match(
    serviceSource,
    /payload:\s*input\.includePayload \? normalizeLegacyAlgoBranding\(event\.payload\) : \{\}/,
  );
  assert.match(
    serviceSource,
    /RETIRED_SHADOW_EQUITY_FORWARD_EXECUTION_MODE\s*=\s*"signal_equity_shadow"/,
  );
  assert.match(serviceSource, /isRetiredShadowEquityForwardDeployment/);
  assert.match(serviceSource, /normalizeLegacyAlgoBrandText/);
  assert.match(serviceSource, /normalizeLegacyAlgoBranding/);
  assert.match(signalOptionsServiceSource, /normalizeSignalOptionsDeploymentBranding/);
  assert.match(
    serviceSource,
    /\.filter\(\(deployment\) => !isRetiredShadowEquityForwardDeployment\(deployment\)\)/,
  );
  assert.match(signalOptionsServiceSource, /notifyAlgoCockpitChanged/);
  assert.match(
    serviceSource,
    /parameters:\s*\{[\s\S]*signalTimeframe,[\s\S]*\.\.\.pyrusSignalsSettingsPatch,/,
  );
  assert.match(routeSource, /bosConfirmation:\s*body\.bosConfirmation/);
  assert.match(routeSource, /chochAtrBuffer:\s*body\.chochAtrBuffer/);
  assert.match(serviceSource, /readOptionalBosConfirmation\(input\.bosConfirmation\)/);
  assert.match(serviceSource, /chochBodyExpansionAtr/);
  assert.match(serviceSource, /chochVolumeGate/);
  assert.match(serviceSource, /pyrusSignalsSettingsPatch\s*=\s*\{[\s\S]*timeHorizon,[\s\S]*bosConfirmation/);
  assert.match(serviceSource, /updateSignalMonitorProfile\(\{[\s\S]*timeframe:\s*signalTimeframe,[\s\S]*pyrusSignalsSettings:\s*nextPyrusSignalsSettings,/);
  assert.match(
    serviceSource.match(
      /export async function updateAlgoDeploymentStrategySettings[\s\S]*?\n}\n\nexport async function listExecutionEvents/,
    )?.[0] ?? "",
    /deployment_strategy_settings_updated[\s\S]*invalidateSignalOptionsDashboardCaches\(deployment\.id\)[\s\S]*notifyAlgoCockpitChanged/,
  );
  assert.doesNotMatch(
    serviceSource,
    /signalOptions:\s*resolveSignalOptionsExecutionProfile/,
  );
  assert.match(
    signalOptionsServiceSource,
    /tunedSignalOptionsStrategySettings/,
  );
  assert.match(
    signalOptionsServiceSource,
    /signalOptions:\s*tunedSignalOptionsExecutionProfile/,
  );
});
