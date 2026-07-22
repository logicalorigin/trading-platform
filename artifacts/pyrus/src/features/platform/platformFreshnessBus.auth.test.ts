import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getPlatformFreshnessArtifactId } from "./platformFreshnessBus";

test("cross-tab freshness namespaces are partitioned by authenticated user", () => {
  assert.notEqual(
    getPlatformFreshnessArtifactId("user-a"),
    getPlatformFreshnessArtifactId("user-b"),
  );

  const platformSource = readFileSync(
    new URL("./PlatformApp.jsx", import.meta.url),
    "utf8",
  );
  assert.match(
    platformSource,
    /getPlatformFreshnessArtifactId\(\s*authSession\.user\?\.id,?\s*\)/,
  );
  assert.match(
    platformSource,
    /useWorkspaceLeadership\(\{\s*artifactId: platformIdentityArtifactId,/,
  );
});
