import {
  CapsuleError,
  CapsuleManager,
  checkCapsuleRuntime,
  execFileCommandRunner,
  loadSessionHostConfig,
} from "./capsule";
import { createSessionHostServer } from "./server";

async function main(): Promise<void> {
  const config = loadSessionHostConfig();
  const manager = new CapsuleManager(config, execFileCommandRunner);
  const readiness = await checkCapsuleRuntime(execFileCommandRunner, config);
  const server = createSessionHostServer({
    readiness: () => checkCapsuleRuntime(execFileCommandRunner, config),
    snapshot: () => manager.snapshot(),
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.bindHost, () => {
      server.off("error", reject);
      resolve();
    });
  });
  console.log(
    `[ibkr-session-host] listening on ${config.bindHost}:${config.port}; readiness=${readiness.ready ? "ready" : readiness.code}`,
  );

  const shutdown = (): void => {
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
