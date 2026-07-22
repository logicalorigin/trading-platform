import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readLocalSource = (relativePath) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

const readButtonSource = (source, testId) => {
  const anchor = source.indexOf(`data-testid="${testId}"`);
  assert.notEqual(anchor, -1, `${testId} should exist`);
  return source.slice(source.lastIndexOf("<button", anchor), source.indexOf("</button>", anchor));
};

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

test("tablet header controls use the shared touch target floors", () => {
  const headerSource = readLocalSource("./AppHeader.jsx");
  const accountSource = readLocalSource("./HeaderAccountStrip.jsx");
  const navigationButton = headerSource.match(
    /<button\s+key=\{screen\.id\}[\s\S]*?<\/button>/,
  )?.[0];
  const commandButton = readButtonSource(
    headerSource,
    "header-command-palette-trigger",
  );
  const notificationButton = readButtonSource(
    headerSource,
    "header-notifications-trigger",
  );

  assert.ok(navigationButton, "screen navigation button should exist");
  assert.match(navigationButton, /\bra-touch-target-y\b/);
  assert.doesNotMatch(navigationButton, /minHeight:/);
  assert.match(commandButton, /\bra-touch-target-y\b/);
  assert.doesNotMatch(commandButton, /minHeight:/);
  assert.match(notificationButton, /\bra-touch-target\b/);
  assert.match(
    accountSource,
    /<select\s+className="ra-touch-target-y"\s+aria-label="Active broker account"/,
  );
});

test("compact phones keep the Market symbol readable without a clipped screen label", () => {
  const headerSource = readLocalSource("./AppHeader.jsx");
  const styles = readLocalSource("../../index.css");

  assert.match(
    headerSource,
    /className="ra-mobile-header-context-label"[\s\S]{0,360}>\s*\{label\}/,
  );
  assert.match(
    styles,
    /@media \(max-width: 380px\) \{[\s\S]{0,220}\.ra-mobile-header-context-label\s*\{\s*display: none;/,
  );
});
