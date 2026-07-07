import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBrokerConnectQrDataUri,
  buildBrokerConnectQrSvg,
  copyBrokerConnectLaunchUrl,
} from "./brokerConnectHandoffQr.js";

test("buildBrokerConnectQrSvg renders a deterministic offline QR for a launch URL", () => {
  const url = "https://broker.example/connect?state=abc123&redirect_uri=https%3A%2F%2Fpyrus.example%2Fcallback";
  const svg = buildBrokerConnectQrSvg(url, { scale: 2, border: 4 });

  assert.match(svg, /^<svg /);
  assert.match(svg, /<title>Broker connect QR code<\/title>/);
  assert.match(svg, /<path d="M/);
  assert.match(svg, /state=abc123&amp;redirect_uri=/);
});

test("buildBrokerConnectQrDataUri encodes the QR as an inline SVG data URI", () => {
  const dataUri = buildBrokerConnectQrDataUri("https://broker.example/connect");

  assert.match(dataUri, /^data:image\/svg\+xml,/);
  assert.match(decodeURIComponent(dataUri), /Broker connect QR code/);
});

test("copyBrokerConnectLaunchUrl copies the current launch URL", async () => {
  const writes = [];
  const url = "https://broker.example/current-launch";

  await copyBrokerConnectLaunchUrl(url, {
    writeText: async (value) => {
      writes.push(value);
    },
  });

  assert.deepEqual(writes, [url]);
});
