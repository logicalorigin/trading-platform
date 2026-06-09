export const EMPTY_ALGO_MONITOR_STREAM_FRESHNESS = Object.freeze({
  deploymentId: null,
  deploymentScoped: false,
  algoLastEventAt: null,
  algoFresh: false,
  algoPrimaryFresh: false,
  algoFullFresh: false,
});

const normalizeDeploymentId = (value) => String(value || "").trim();

export const isAlgoStreamFreshnessForDeployment = (streamFreshness, deploymentId) => {
  const selectedDeploymentId = normalizeDeploymentId(deploymentId);
  const streamDeploymentId = normalizeDeploymentId(streamFreshness?.deploymentId);
  return Boolean(
    selectedDeploymentId &&
      streamDeploymentId &&
      streamDeploymentId === selectedDeploymentId,
  );
};

const normalizeAlgoStreamFreshness = (streamFreshness, overrides = {}) => ({
  ...EMPTY_ALGO_MONITOR_STREAM_FRESHNESS,
  ...(streamFreshness || {}),
  ...overrides,
});

export const resolveAlgoMonitorRestPolling = ({
  restQueriesActive = false,
  deploymentId = "",
  streamFreshness = null,
  pollMs = 30_000,
} = {}) => {
  const streamHydratesSelectedDeployment = isAlgoStreamFreshnessForDeployment(
    streamFreshness,
    deploymentId,
  );
  const deploymentDataFreshness = streamHydratesSelectedDeployment
    ? normalizeAlgoStreamFreshness(streamFreshness, {
        deploymentScoped: true,
      })
    : EMPTY_ALGO_MONITOR_STREAM_FRESHNESS;
  const active = Boolean(restQueriesActive);

  return {
    streamHydratesSelectedDeployment,
    deploymentDataFreshness,
    primaryPollInterval:
      active && !deploymentDataFreshness.algoPrimaryFresh ? pollMs : false,
    derivedPollInterval:
      active && !deploymentDataFreshness.algoFullFresh ? pollMs : false,
  };
};
