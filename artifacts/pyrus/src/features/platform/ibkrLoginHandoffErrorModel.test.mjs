import assert from "node:assert/strict";
import test from "node:test";

import {
  getIbkrPlatformErrorCode,
  isIbkrLoginKeyReadActivationNotFoundError,
  isTransientIbkrLoginKeyReadError,
} from "./ibkrLoginHandoffErrorModel.js";

test("treats browser abort errors with numeric codes as transient login-key reads", () => {
  const browserAbort = new Error("The user aborted a request.");
  browserAbort.code = 20;

  assert.equal(getIbkrPlatformErrorCode(browserAbort), null);
  assert.equal(isTransientIbkrLoginKeyReadError(browserAbort), true);
});

test("treats platform string error codes as terminal login-key reads", () => {
  const backendError = new Error("Activation was not found.");
  backendError.code = "ibkr_bridge_activation_not_found";

  assert.equal(
    isIbkrLoginKeyReadActivationNotFoundError(backendError),
    true,
  );
  assert.equal(isTransientIbkrLoginKeyReadError(backendError), false);
});

test("treats HTTP status failures as terminal login-key reads", () => {
  const requestError = new Error("Request failed (409)");
  requestError.status = 409;

  assert.equal(isTransientIbkrLoginKeyReadError(requestError), false);
});
