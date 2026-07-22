import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const readSource = (path: string): string =>
  readFileSync(new URL(path, import.meta.url), "utf8");

const runtimeSource = readSource("./lib/runtime.ts");
const clientRuntimeSource = readSource("./services/ibkr-client-runtime.ts");
const portalRouteSource = readSource("./routes/ibkr-portal.ts");
const platformRouteSource = readSource("./routes/platform.ts");
const platformSource = readSource("./services/platform.ts");
const diagnosticsSource = readSource("./services/diagnostics.ts");
const envExampleSource = readSource("../../../.env.example");
const gitignoreSource = readSource("../../../.gitignore");
const openApiSource = readSource("../../../lib/api-spec/openapi.yaml");

test("the retired desktop bridge runtime override surface is absent", () => {
  for (const source of [runtimeSource, envExampleSource, gitignoreSource]) {
    assert.doesNotMatch(source, /IbkrBridgeRuntimeOverride/);
    assert.doesNotMatch(source, /IBKR_BRIDGE_(?:URL|BASE_URL|RUNTIME_OVERRIDE_FILE)/);
    assert.doesNotMatch(source, /PYRUS_IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE/);
    assert.doesNotMatch(source, /ibkr-bridge-runtime-override\.json/);
  }
  assert.doesNotMatch(
    runtimeSource,
    /IBKR_(?:CLIENT_PORTAL_)?(?:USERNAME|PASSWORD)/,
  );
});

test("IBKR runtime routing retains the per-user Client Portal gateway", () => {
  assert.match(runtimeSource, /IBKR_CLIENT_PORTAL_BASE_URL/);
  assert.match(clientRuntimeSource, /getIbkrClientPortalGatewaySnapshot/);
  assert.match(clientRuntimeSource, /prepareGatewayClientRequest/);
  assert.match(
    portalRouteSource,
    /\/api\/broker-execution\/ibkr-portal\/gateway/,
  );
});

test("API diagnostics contain no retired desktop-helper lifecycle", () => {
  const source = `${platformSource}\n${diagnosticsSource}`;

  assert.doesNotMatch(source, /desktopAgent|desktop bridge/i);
  assert.equal(
    existsSync(new URL("./services/ibkr-connection-audit.ts", import.meta.url)),
    false,
  );
});

test("the published API contract exposes Client Portal instead of the retired bridge", () => {
  assert.doesNotMatch(
    openApiSource,
    /IbkrBridge|IbkrRemoteDesktop|desktopAgent|runtimeOverride|credentialHandoff|managementToken/,
  );
  assert.doesNotMatch(openApiSource, /^\s+ibkrBridge:/m);
  assert.match(openApiSource, /^\s+connectionStyle:\n\s+type: string\n\s+enum: \[client_portal\]/m);
  assert.match(
    openApiSource,
    /enum: \[\/api\/broker-execution\/ibkr-portal\/readiness\]/,
  );
  assert.match(platformRouteSource, /GetSessionResponse\.parse\(session\)/);
  assert.doesNotMatch(platformRouteSource, /data\.runtime\.ibkr\s*=\s*\{/s);
});
