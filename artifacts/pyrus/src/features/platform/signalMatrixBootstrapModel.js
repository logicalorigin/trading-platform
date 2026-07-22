export const resolveSignalMatrixStreamFramePublication = (
  kind,
  payload = null,
) => {
  if (kind !== "bootstrap") {
    return {
      markBootstrapReceived: false,
      publishHeaderStates: true,
      publishSnapshotStates: true,
    };
  }

  // Older servers emitted one bootstrap frame without page metadata. Preserve
  // that contract while requiring the explicit final-page flag from paged
  // bootstraps before widening the stream or replacing the header projection.
  const complete =
    payload?.bootstrapPage == null ||
    payload.bootstrapPage.complete === true;
  return {
    markBootstrapReceived: complete,
    publishHeaderStates: complete,
    publishSnapshotStates: complete,
  };
};

export const buildSignalMatrixProfileUniverseStreamKey = ({
  profile,
  universeScope,
  universeSymbolLimit,
  watchlistSymbolsKey,
} = {}) =>
  JSON.stringify({
    profileId: profile?.id || "",
    watchlistId: profile?.watchlistId || "",
    enabled: profile?.enabled !== false,
    timeframe: profile?.timeframe || "",
    freshWindowBars: profile?.freshWindowBars ?? null,
    pyrusSignalsSettings: profile?.pyrusSignalsSettings ?? null,
    universeScope: universeScope || "",
    universeSymbolLimit: universeSymbolLimit ?? null,
    watchlistSymbolsKey: watchlistSymbolsKey || "",
  });
