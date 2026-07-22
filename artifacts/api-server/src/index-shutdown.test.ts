import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const indexSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

test("API shutdown drains HTTP requests before ending database pools", () => {
  const shutdownStart = indexSource.indexOf("function shutdownApi(");
  const shutdownEnd = indexSource.indexOf(
    'process.once("SIGINT"',
    shutdownStart,
  );
  const shutdown = indexSource.slice(shutdownStart, shutdownEnd);
  const serverClose = shutdown.indexOf("server.close(");
  const databaseClose = shutdown.indexOf("closeDatabaseConnections()");

  assert.ok(serverClose >= 0, "expected server.close in shutdownApi");
  assert.ok(databaseClose >= 0, "expected database close in shutdownApi");
  assert.ok(
    databaseClose > serverClose,
    "database pools must remain available until server.close drains requests",
  );
});
