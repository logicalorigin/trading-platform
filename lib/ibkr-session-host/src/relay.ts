import {
  connect,
  createServer,
  type Server,
  type Socket,
} from "node:net";

export type RelayTarget = { host: string; port: number };

export function createCapsuleRelayServer(
  resolveTarget: () => RelayTarget | null,
): Server {
  return createServer((downstream) => {
    let target: RelayTarget | null;
    try {
      target = resolveTarget();
    } catch {
      downstream.destroy();
      return;
    }
    if (!target) {
      downstream.destroy();
      return;
    }

    const upstream = connect(target);
    const destroy = (socket: Socket): void => {
      if (!socket.destroyed) socket.destroy();
    };
    downstream.on("error", () => destroy(upstream));
    downstream.on("close", () => destroy(upstream));
    upstream.on("error", () => destroy(downstream));
    upstream.on("close", () => destroy(downstream));
    downstream.pipe(upstream);
    upstream.pipe(downstream);
  });
}

export async function listenCapsuleRelay(
  server: Server,
  port: number,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });
}
