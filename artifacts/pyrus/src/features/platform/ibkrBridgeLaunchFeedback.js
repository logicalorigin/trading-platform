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
    const finish = () => {
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
      resolve();
    };
    const finishAfterFrame = () => {
      if (finished) {
        return;
      }
      if (typeof windowRef.setTimeout === "function") {
        windowRef.setTimeout(finish, 0);
        return;
      }
      finish();
    };

    if (
      hasHiddenDocument(documentRef) ||
      typeof windowRef.requestAnimationFrame !== "function"
    ) {
      finish();
      return;
    }

    if (typeof windowRef.setTimeout === "function") {
      timeoutId = windowRef.setTimeout(
        finish,
        IBKR_BRIDGE_FEEDBACK_PAINT_MAX_WAIT_MS,
      );
    }
    windowRef.requestAnimationFrame(finishAfterFrame);
  });
