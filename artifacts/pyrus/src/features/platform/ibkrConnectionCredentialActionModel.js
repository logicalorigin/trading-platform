export const resolveIbkrCredentialActionState = ({
  activationActive = false,
  activationId = null,
  directActivationShouldReplaceCurrentLaunch = false,
  gatewayConnected = false,
  launchInFlight = false,
  managementToken = null,
} = {}) => {
  const launchCancelable = Boolean(
    !gatewayConnected &&
      activationId &&
      managementToken &&
      (activationActive || launchInFlight),
  );
  const resumeAvailable = Boolean(
    !directActivationShouldReplaceCurrentLaunch &&
      !gatewayConnected &&
      activationId &&
      managementToken &&
      activationActive &&
      launchInFlight,
  );

  return {
    launchCancelable,
    primaryBlockedByActiveLaunch: Boolean(
      launchCancelable &&
        !resumeAvailable &&
        !directActivationShouldReplaceCurrentLaunch,
    ),
    resumeAvailable,
  };
};
