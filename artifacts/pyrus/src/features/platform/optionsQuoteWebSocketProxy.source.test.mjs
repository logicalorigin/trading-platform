import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const viteSource = await readFile(
  new URL("../../../vite.config.ts", import.meta.url),
  "utf8",
);

test("Vite forwards the browser host on option-quote WebSocket upgrades", () => {
  const apiProxy = viteSource.slice(
    viteSource.indexOf('"/api": {'),
    viteSource.indexOf("\n    watch:", viteSource.indexOf('"/api": {')),
  );

  assert.match(apiProxy, /proxy\.on\("proxyReqWs"/);
  assert.match(
    apiProxy,
    /proxyRequest\.setHeader\("x-forwarded-host", originalHost\)/,
  );
  assert.match(apiProxy, /proxyRequest\.removeHeader\("x-forwarded-host"\)/);
});
