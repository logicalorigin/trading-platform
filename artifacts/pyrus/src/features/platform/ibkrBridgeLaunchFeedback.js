export const IBKR_BRIDGE_FEEDBACK_PAINT_MAX_WAIT_MS = 250;

const hasHiddenDocument = (documentRef) =>
  Boolean(documentRef && documentRef.visibilityState === "hidden");

export const waitForBridgeLaunchFeedbackPaint = ({
  documentRef = globalThis.document,
  windowRef = globalThis.window,
} = {}) =>
  new Promise((resolve) => {
    if (!windowRef) {
      resolve();
      return;
    }

    let finished = false;
    let timeoutId = null;
    const finish = (afterFrame) => {
      if (finished) {
        return;
      }
      finished = true;
      if (
        timeoutId !== null &&
        typeof windowRef.clearTimeout === "function"
      ) {
        windowRef.clearTimeout(timeoutId);
      }
      if (afterFrame && typeof windowRef.setTimeout === "function") {
        windowRef.setTimeout(resolve, 0);
        return;
      }
      resolve();
    };

    if (
      hasHiddenDocument(documentRef) ||
      typeof windowRef.requestAnimationFrame !== "function"
    ) {
      finish(false);
      return;
    }

    if (typeof windowRef.setTimeout === "function") {
      timeoutId = windowRef.setTimeout(
        () => finish(false),
        IBKR_BRIDGE_FEEDBACK_PAINT_MAX_WAIT_MS,
      );
    }
    windowRef.requestAnimationFrame(() => finish(true));
  });
