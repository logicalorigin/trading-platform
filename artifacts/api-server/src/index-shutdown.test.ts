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

test("API shutdown arms its safeguard and closes the listener before awaiting the fleet coordinator", () => {
  const shutdownStart = indexSource.indexOf("function shutdownApi(");
  const shutdownEnd = indexSource.indexOf(
    'process.once("SIGINT"',
    shutdownStart,
  );
  const shutdown = indexSource.slice(shutdownStart, shutdownEnd);
  const forcedExitTimer = shutdown.indexOf("setTimeout(");
  const serverClose = shutdown.indexOf("server.close(");
  const coordinatorStop = shutdown.indexOf(
    "stopIbkrGatewayFleetCoordinator()",
  );

  assert.match(
    shutdown,
    /setTimeout\(\(\) => \{[\s\S]*?\}, 5_000\)\.unref\(\)/,
    "shutdown must retain the five-second forced-exit safeguard",
  );
  assert.ok(forcedExitTimer >= 0, "expected forced-exit timer in shutdownApi");
  assert.ok(serverClose >= 0, "expected server.close in shutdownApi");
  assert.ok(coordinatorStop >= 0, "expected coordinator stop in shutdownApi");
  assert.ok(
    forcedExitTimer < coordinatorStop,
    "shutdown must arm the forced-exit safeguard before awaiting the coordinator",
  );
  assert.ok(
    serverClose < coordinatorStop,
    "shutdown must stop accepting HTTP before awaiting the coordinator",
  );
});

test("API lifecycle starts and stops the IBKR fleet lease coordinator", () => {
  assert.match(
    indexSource,
    /import \{[\s\S]*?startIbkrGatewayFleetCoordinator,[\s\S]*?stopIbkrGatewayFleetCoordinator,[\s\S]*?\} from "\.\/services\/ibkr-portal-gateway-manager";/,
  );

  const shutdownStart = indexSource.indexOf("function shutdownApi(");
  const shutdownEnd = indexSource.indexOf(
    'process.once("SIGINT"',
    shutdownStart,
  );
  const shutdown = indexSource.slice(shutdownStart, shutdownEnd);
  const coordinatorStop = shutdown.indexOf(
    "stopIbkrGatewayFleetCoordinator()",
  );
  const databaseClose = shutdown.indexOf("closeDatabaseConnections()");
  assert.ok(coordinatorStop >= 0, "expected coordinator stop in shutdownApi");
  assert.match(
    shutdown,
    /await stopIbkrGatewayFleetCoordinator\(\)/,
    "shutdown must await the active coordinator sweep",
  );
  assert.ok(
    coordinatorStop < databaseClose,
    "coordinator must stop scheduling work before database pools close",
  );

  assert.match(
    indexSource,
    /const backgroundWorkers: Array<\(\) => void> = \[\s*startIbkrGatewayFleetCoordinator,/,
  );
});
