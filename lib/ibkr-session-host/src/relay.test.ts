import assert from "node:assert/strict";
import {
  createConnection,
  createServer,
  type AddressInfo,
  type Server,
} from "node:net";
import test from "node:test";

import { createCapsuleRelayServer, listenCapsuleRelay } from "./relay";

async function listen(server: Server): Promise<AddressInfo> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server.address() as AddressInfo;
}

async function close(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test("binds on loopback and forwards raw TCP to the current capsule target", async () => {
  const upstream = createServer((socket) => {
    socket.once("data", (data) => {
      socket.write(`capsule:${data.toString("utf8")}`);
    });
  });
  const upstreamAddress = await listen(upstream);
  const relay = createCapsuleRelayServer(() => ({
    host: "127.0.0.1",
    port: upstreamAddress.port,
  }));

  try {
    await listenCapsuleRelay(relay, 0);
    const relayAddress = relay.address() as AddressInfo;
    assert.equal(relayAddress.address, "127.0.0.1");
    const response = await new Promise<string>((resolve, reject) => {
      const client = createConnection({
        host: "127.0.0.1",
        port: relayAddress.port,
      });
      client.once("connect", () => client.write("hello"));
      client.once("data", (data) => {
        resolve(data.toString("utf8"));
        client.destroy();
      });
      client.once("error", reject);
    });
    assert.equal(response, "capsule:hello");
  } finally {
    await close(relay);
    await close(upstream);
  }
});

test("closes connections while no capsule target is active", async () => {
  const relay = createCapsuleRelayServer(() => null);
  try {
    await listenCapsuleRelay(relay, 0);
    const relayAddress = relay.address() as AddressInfo;
    await new Promise<void>((resolve, reject) => {
      const client = createConnection({
        host: "127.0.0.1",
        port: relayAddress.port,
      });
      client.once("close", () => resolve());
      client.once("error", (error) => {
        if ((error as NodeJS.ErrnoException).code === "ECONNRESET") {
          resolve();
        } else {
          reject(error);
        }
      });
    });
  } finally {
    await close(relay);
  }
});
