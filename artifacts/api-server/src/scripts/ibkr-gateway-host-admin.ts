import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  IBKR_GATEWAY_HOST_ADMIN_USAGE,
  parseIbkrGatewayHostAdminArgs,
  runIbkrGatewayHostAdminCommand,
  type IbkrGatewayHostAdminDependencies,
} from "./ibkr-gateway-host-admin-cli";

export async function runIbkrGatewayHostAdmin(
  args: string[] = process.argv.slice(2),
): Promise<boolean> {
  const command = parseIbkrGatewayHostAdminArgs(args);
  if (!command) {
    process.stdout.write(`${IBKR_GATEWAY_HOST_ADMIN_USAGE}\n`);
    return true;
  }

  process.env["PYRUS_DB_PROFILE"] ??= "script";
  const [database, store] = await Promise.all([
    import("@workspace/db"),
    import("../services/ibkr-gateway-session-store"),
  ]);
  const dependencies: IbkrGatewayHostAdminDependencies = {
    approveHost: store.approveIbkrGatewayHost,
    disableHost: store.disableIbkrGatewayHost,
    readHost: async (hostId) => {
      const [host, activeLeaseCount] = await Promise.all([
        store.readIbkrGatewayHost(hostId),
        store.countActiveIbkrGatewayHostLeases(hostId),
      ]);
      return host && activeLeaseCount !== null
        ? { activeLeaseCount, host }
        : null;
    },
  };
  try {
    return await runIbkrGatewayHostAdminCommand(command, dependencies);
  } finally {
    await database.closeDatabaseConnections();
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  runIbkrGatewayHostAdmin().catch((error: unknown) => {
    const message =
      error instanceof Error &&
      (error.message === IBKR_GATEWAY_HOST_ADMIN_USAGE ||
        error.message === "IBKR gateway host preconditions failed.")
        ? error.message
        : "IBKR gateway host command failed.";
    process.stderr.write(`[ibkr-fleet-admin] ${message}\n`);
    process.exitCode = 1;
  });
}
