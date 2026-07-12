import {
  CapsuleError,
  CapsuleManager,
  checkCapsuleRuntime,
  execFileCommandRunner,
  loadSessionHostConfig,
} from "./capsule";
import {
  createCapsuleRelayServer,
  listenCapsuleRelay,
} from "./relay";
import { createSessionHostServer } from "./server";

async function main(): Promise<void> {
  const config = loadSessionHostConfig();
  const manager = new CapsuleManager(config, execFileCommandRunner);
  const readiness = await checkCapsuleRuntime(execFileCommandRunner, config);
  const cpgRelay = createCapsuleRelayServer(() => manager.getRelayTarget("cpg"));
  const consoleRelay = createCapsuleRelayServer(() => manager.getRelayTarget("console"));
  const server = createSessionHostServer({
    controlToken: process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"],
    ensureSession: (sessionId) => manager.ensure(sessionId),
    releaseSession: (sessionId) => manager.release(sessionId),
    readiness: () => checkCapsuleRuntime(execFileCommandRunner, config),
    snapshot: () => manager.snapshot(),
    statusSession: (sessionId) => manager.status(sessionId),
    target: (sessionId, kind) => manager.getTarget(sessionId, kind),
  });

  await Promise.all([
    listenCapsuleRelay(cpgRelay, 15000),
    listenCapsuleRelay(consoleRelay, 16080),
    new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(config.port, config.bindHost, () => {
        server.off("error", reject);
        resolve();
      });
    }),
  ]);
  console.log(
    `[ibkr-session-host] listening on ${config.bindHost}:${config.port}; readiness=${readiness.ready ? "ready" : readiness.code}`,
  );

  const shutdown = (): void => {
    cpgRelay.close();
    consoleRelay.close();
    server.close(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((error: unknown) => {
  const code = error instanceof CapsuleError ? error.code : "startup_failed";
  console.error(`[ibkr-session-host] ${code}`);
  process.exit(1);
});
