import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTH_PASSWORD_MIN_LENGTH,
  buildFirstRunBody,
  buildSignInBody,
  describeSessionUser,
  validateFirstRunInput,
  validateSignInInput,
} from "./headerSessionModel.js";

test("sign-in validation requires a plausible email and any password", () => {
  assert.equal(validateSignInInput({}).ok, false);
  assert.equal(validateSignInInput({ email: "nope", password: "x" }).ok, false);
  assert.equal(
    validateSignInInput({ email: "a@b.co", password: "" }).ok,
    false,
  );
  assert.deepEqual(validateSignInInput({ email: " a@b.co ", password: "x" }), {
    ok: true,
    error: "",
  });
});

test("first-run validation enforces backend password minimum and setup token", () => {
  const base = {
    email: "a@b.co",
    password: "p".repeat(AUTH_PASSWORD_MIN_LENGTH),
    bootstrapToken: "tok",
  };
  assert.equal(validateFirstRunInput(base).ok, true);
  assert.equal(
    validateFirstRunInput({ ...base, password: "short" }).ok,
    false,
  );
  assert.match(
    validateFirstRunInput({ ...base, password: "short" }).error,
    new RegExp(String(AUTH_PASSWORD_MIN_LENGTH)),
  );
  assert.equal(
    validateFirstRunInput({ ...base, bootstrapToken: "  " }).ok,
    false,
  );
  assert.equal(validateFirstRunInput({ ...base, email: "bad" }).ok, false);
});

test("request bodies trim identity fields but never the password", () => {
  assert.deepEqual(buildSignInBody({ email: " a@b.co ", password: " pw " }), {
    email: "a@b.co",
    password: " pw ",
  });

  const firstRun = buildFirstRunBody({
    email: " a@b.co ",
    displayName: "  ",
    password: "p".repeat(12),
    bootstrapToken: " tok ",
  });
  assert.deepEqual(firstRun, {
    email: "a@b.co",
    password: "p".repeat(12),
    bootstrapToken: "tok",
  });
  assert.equal(
    buildFirstRunBody({
      email: "a@b.co",
      displayName: " Riley ",
      password: "x".repeat(12),
      bootstrapToken: "tok",
    }).displayName,
    "Riley",
  );
});

test("session user description prefers display name, then email", () => {
  assert.equal(describeSessionUser(null), "Signed out");
  assert.equal(describeSessionUser({ email: "a@b.co" }), "a@b.co");
  assert.equal(
    describeSessionUser({ displayName: "Riley", email: "a@b.co" }),
    "Riley",
  );
  assert.equal(describeSessionUser({}), "Signed in");
});
