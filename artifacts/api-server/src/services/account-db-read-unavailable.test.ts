import assert from "node:assert/strict";
import test from "node:test";

import { HttpError } from "../lib/errors";
import { __accountDbReadInternalsForTests as internals } from "./account";

test("Account database availability failures become structured 503 errors", async () => {
  for (const code of ["ETIMEDOUT", "57014", "42P01"]) {
    const cause = Object.assign(new Error(`database failure ${code}`), {
      code,
    });
    await assert.rejects(
      internals.withAccountDbRead(async () => {
        throw cause;
      }),
      (error: unknown) =>
        error instanceof HttpError &&
        error.statusCode === 503 &&
        error.code === "account_db_unavailable" &&
        error.cause === cause,
    );
  }
});

test("Account database reads preserve successful values and programming errors", async () => {
  assert.deepEqual(await internals.withAccountDbRead(async () => ["current"]), [
    "current",
  ]);

  const programmingError = new Error("invalid projection");
  await assert.rejects(
    internals.withAccountDbRead(async () => {
      throw programmingError;
    }),
    (error: unknown) => error === programmingError,
  );
});
