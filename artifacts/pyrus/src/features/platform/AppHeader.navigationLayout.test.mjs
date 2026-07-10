import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readLocalSource = (relativePath) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("desktop header gives every navigation tab a reachable track", () => {
  const headerSource = readLocalSource("./AppHeader.jsx");
  const shellSource = readLocalSource("./PlatformShell.jsx");

  assert.match(
    shellSource,
    /: "max-content minmax\(0, 1fr\) max-content";/,
    "desktop navigation should own the flexible middle track",
  );
  assert.doesNotMatch(
    headerSource,
    /<div aria-hidden="true" style=\{\{ minWidth: 0 \}\} \/>/,
    "a separate spacer must not consume the navigation's available width",
  );
  assert.match(
    headerSource,
    /data-testid="platform-screen-nav"[\s\S]{0,700}overflowX: "auto"/,
    "constrained desktop navigation should remain natively scrollable",
  );
  assert.match(
    headerSource,
    /aria-current=\{activeScreen === screen\.id \? "page" : undefined\}[\s\S]{0,1800}flexShrink: 0/,
    "navigation buttons should retain their readable hit targets",
  );
});
