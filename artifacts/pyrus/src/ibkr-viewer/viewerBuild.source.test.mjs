import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("IBKR viewer is an isolated first-party Vite entry", () => {
  const packageJson = JSON.parse(read("../../package.json"));
  const vite = read("../../vite.config.ts");
  const html = read("../../ibkr-viewer.html");
  const viewer = read("./viewer.ts");
  const appEntry = read("../main.tsx");

  assert.equal(packageJson.dependencies["@novnc/novnc"], "1.3.0");
  assert.match(
    vite,
    /ibkrViewer:\s*path\.resolve\(import\.meta\.dirname,\s*"ibkr-viewer\.html"\)/,
  );
  assert.match(vite, /path\.basename\(ctx\.filename\) !== "index\.html"/);
  assert.match(
    vite,
    /packageName === "@novnc\/novnc"[\s\S]*?return "ibkr-viewer-vendor"/,
  );
  assert.match(vite, /modulePreload:\s*\{[\s\S]*?polyfill:\s*false/);
  assert.doesNotMatch(appEntry, /modulepreload-polyfill/);
  assert.doesNotMatch(viewer, /modulepreload-polyfill/);
  assert.match(html, /src="\/src\/ibkr-viewer\/viewer\.ts"/);
  assert.match(html, /role="status"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /type="button"[\s\S]*?>\s*Retry connection\s*</);
  assert.match(
    viewer,
    /new RFB\(\s*screen,\s*buildIbkrViewerWebSocketUrl\(window\.location\),?\s*\)/,
  );
  assert.match(viewer, /connection\.viewOnly = false/);
  assert.match(viewer, /connection\.scaleViewport = true/);
  assert.match(viewer, /connection\.resizeSession = true/);
  assert.doesNotMatch(viewer, /token|password|credential/i);
});
