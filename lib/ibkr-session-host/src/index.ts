import {
  CapsuleError,
  CapsuleManager,
  capsuleTargetForSlot,
  checkCapsuleRuntime,
  execFileCommandRunner,
  loadSessionHostConfig,
} from "./capsule";
import { CapsuleFleetManager } from "./fleet";
import { loadIbkrHostControlIdentity } from "./control-config";
import { createCapsuleRelayServer, listenCapsuleRelay } from "./relay";
import { createSessionHostServer } from "./server";

async function main(): Promise<void> {
  const config = loadSessionHostConfig();
  const fleet = new CapsuleFleetManager(
    config.capacity,
    (slotNumber) =>
      new CapsuleManager(config, execFileCommandRunner, undefined, slotNumber),
  );
  const readiness = await checkCapsuleRuntime(execFileCommandRunner, config);
  const relays = Array.from({ length: config.capacity }, (_, index) => {
    const slotNumber = index + 1;
    return (["cpg", "console"] as const).map((kind) => ({
      kind,
      server: createCapsuleRelayServer(() =>
        fleet.getRelayTarget(slotNumber, kind),
      ),
      slotNumber,
    }));
  }).flat();
  const server = createSessionHostServer({
    controlIdentity: loadIbkrHostControlIdentity() ?? undefined,
    controlToken: process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"],
    ensureSession: (sessionId, generation, slotNumber) =>
      fleet.ensure(sessionId, generation, slotNumber),
    releaseSession: (sessionId, generation, slotNumber) =>
      fleet.release(sessionId, generation, slotNumber),
    readiness: () => checkCapsuleRuntime(execFileCommandRunner, config),
    snapshot: () => fleet.snapshot(),
    statusSession: (sessionId, generation, slotNumber) =>
      fleet.status(sessionId, generation, slotNumber),
    target: (sessionId, generation, kind, slotNumber) =>
      fleet.getTarget(sessionId, generation, slotNumber, kind),
  });

  await Promise.all([
    ...relays.map(({ kind, server: relay, slotNumber }) =>
      listenCapsuleRelay(relay, capsuleTargetForSlot(slotNumber, kind).port),
    ),
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
    for (const relay of relays) relay.server.close();
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
