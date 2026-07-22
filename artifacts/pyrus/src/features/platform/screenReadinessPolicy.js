export const EMPTY_SCREEN_READINESS = Object.freeze({
  frameReady: false,
  contentReady: false,
  primaryReady: false,
  derivedReady: false,
  backgroundAllowed: false,
  error: null,
});

const normalizeError = (error) => {
  if (!error) return null;
  if (error instanceof Error) return error.message || error.name || "Screen failed";
  return String(error);
};

export const normalizeScreenReadinessPatch = (
  previous = EMPTY_SCREEN_READINESS,
  patch = {},
) => {
  const error =
    patch.error === undefined ? previous.error : normalizeError(patch.error);
  const next = {
    frameReady:
      patch.frameReady == null
        ? previous.frameReady
        : Boolean(patch.frameReady) || previous.frameReady,
    contentReady:
      patch.contentReady == null
        ? previous.contentReady
        : Boolean(patch.contentReady),
    primaryReady:
      patch.primaryReady == null
        ? previous.primaryReady
        : Boolean(patch.primaryReady),
    derivedReady:
      patch.derivedReady == null
        ? previous.derivedReady
        : Boolean(patch.derivedReady),
    backgroundAllowed:
      patch.backgroundAllowed == null
        ? previous.backgroundAllowed
        : Boolean(patch.backgroundAllowed),
    error,
  };

  if (!next.contentReady) {
    next.primaryReady = false;
    next.derivedReady = false;
    next.backgroundAllowed = false;
  } else if (next.error) {
    next.primaryReady = false;
    next.derivedReady = false;
    next.backgroundAllowed = false;
  } else if (next.derivedReady || next.backgroundAllowed) {
    next.primaryReady = true;
  }

  return next;
};
