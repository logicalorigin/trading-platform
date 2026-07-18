import assert from "node:assert/strict";
import test from "node:test";

import {
  IBKR_WEBSOCKIFY_PATH,
  buildIbkrViewerWebSocketUrl,
} from "./viewerModel";

test("IBKR viewer uses only the same-origin WebSocket tunnel", () => {
  assert.equal(
    buildIbkrViewerWebSocketUrl({
      host: "pyrus.example.test",
      protocol: "https:",
    }),
    `wss://pyrus.example.test${IBKR_WEBSOCKIFY_PATH}`,
  );
  assert.equal(
    buildIbkrViewerWebSocketUrl({
      host: "127.0.0.1:18747",
      protocol: "http:",
    }),
    `ws://127.0.0.1:18747${IBKR_WEBSOCKIFY_PATH}`,
  );
  assert.throws(
    () =>
      buildIbkrViewerWebSocketUrl({
        host: "pyrus.example.test",
        protocol: "file:",
      }),
    /HTTP origin/,
  );
});
