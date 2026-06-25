import assert from "node:assert/strict";
import test from "node:test";

// getMassiveRuntimeConfig() reads the API key from env; set it so the stream
// considers itself configured and accepts a subscriber.
process.env.MASSIVE_API_KEY = process.env.MASSIVE_API_KEY || "test-massive-key";

const { subscribeMassiveStockWebSocket, __massiveStockWebSocketInternalsForTests: internals } =
  await import("./massive-stock-websocket");

function makeMockSocket() {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const sock = {
    readyState: 0,
    send() {},
    close() {},
    terminate() {},
    removeAllListeners() {
      listeners.clear();
    },
    on(event: string, fn: (...args: unknown[]) => void) {
      const existing = listeners.get(event) ?? [];
      existing.push(fn);
      listeners.set(event, existing);
      return sock;
    },
  };
  return sock;
}

test("auth_failed re-arms a reconnect instead of latching the stream off (price-freeze recovery)", () => {
  internals.reset();
  internals.setWebSocketFactory(() => makeMockSocket() as never);

  const unsubscribe = subscribeMassiveStockWebSocket({
    channels: ["T"],
    symbols: ["AAPL"],
    onMessage() {},
  });

  // A starved/timed-out auth handshake under event-loop pressure comes back as
  // auth_failed exactly like a bad key. The old code parked authState in
  // "failed" with no reconnect -> the live price stream stayed dead until a
  // page reload churned the subscription.
  const handled = internals.handleProviderStatus({
    status: "auth_failed",
    message: "starved",
  });
  assert.equal(handled, true, "auth_failed is a recognized provider status");
  assert.equal(
    internals.hasReconnectScheduled(),
    true,
    "auth_failed must schedule a recovery reconnect while subscribers are present, not latch the stream off forever",
  );

  unsubscribe();
  internals.reset();
});
