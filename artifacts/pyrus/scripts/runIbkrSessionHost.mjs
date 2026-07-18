import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { preloadCapsuleImage } from "../../../scripts/lib/ibkr-capsule-image.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const hostEntryUrl = pathToFileURL(
  path.join(repoRoot, "lib/ibkr-session-host/dist/index.mjs"),
).href;

export async function runIbkrSessionHost(env = process.env, options = {}) {
  const preloadCapsule = options.preloadCapsule ?? preloadCapsuleImage;
  const importHost = options.importHost ?? (() => import(hostEntryUrl));

  await preloadCapsule(env.IBKR_SESSION_CAPSULE_IMAGE, {
    expectedLabels: {
      "io.pyrus.ibkr.capsule-lease-protocol": "1",
      "io.pyrus.ibkr.runtime-spec": env.IBKR_SESSION_HOST_RUNTIME_SPEC_DIGEST,
      "io.pyrus.ibkr.workload-identity":
        env.IBKR_SESSION_HOST_WORKLOAD_IDENTITY_DIGEST,
    },
  });
  await importHost();
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    console.log("[ibkr-session-host] capsule_preload_start");
    await runIbkrSessionHost();
    console.log("[ibkr-session-host] capsule_preload_ready");
  } catch {
    console.error("[ibkr-session-host] capsule_preload_failed");
    process.exitCode = 1;
  }
}
