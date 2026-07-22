import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const indexCss = readFileSync(
  new URL("../../index.css", import.meta.url),
  "utf8",
);
const bootShellSource = readFileSync(
  new URL("./BootShellLayout.tsx", import.meta.url),
  "utf8",
);

test("workspace neural clouds are centered, live, and have no visual panel", () => {
  assert.match(
    indexCss,
    /\.pyrus-workspace-loader\s*\{[\s\S]*?align-content:\s*center;[\s\S]*?flex:\s*1 1 0;/u,
  );
  assert.match(
    indexCss,
    /\.pyrus-workspace-loader-band\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 220px\);[\s\S]*?justify-items:\s*center;/u,
  );
  assert.match(
    indexCss,
    /\.pyrus-workspace-cloud\s*\{[\s\S]*?background:\s*transparent;[\s\S]*?border:\s*0;[\s\S]*?box-shadow:\s*none;[\s\S]*?justify-self:\s*center;[\s\S]*?overflow:\s*visible;/u,
  );
  assert.match(
    indexCss,
    /\.pyrus-workspace-cloud-live\s*\{[\s\S]*?height:\s*100%;[\s\S]*?width:\s*100%;/u,
  );
  assert.doesNotMatch(indexCss, /\.pyrus-workspace-cloud-static/u);
});

test("only the immersive boot shell renders the expanded static cloud", () => {
  const workspaceStart = bootShellSource.indexOf("if (isWorkspace)");
  const workspaceEnd = bootShellSource.indexOf(
    "const liveCloud",
    workspaceStart,
  );
  const workspaceBlock = bootShellSource.slice(workspaceStart, workspaceEnd);

  assert.match(bootShellSource, /import \{ PYRUS_NEURAL_CLOUD_SRC \}/u);
  assert.equal(
    bootShellSource.match(/src=\{PYRUS_NEURAL_CLOUD_SRC\}/gu)?.length,
    1,
  );
  assert.doesNotMatch(workspaceBlock, /PYRUS_NEURAL_CLOUD_SRC/u);
  assert.doesNotMatch(
    bootShellSource,
    /src="\/brand\/pyrus-neural-cloud\.webp"/u,
  );
});

test("workspace and Shadow clouds stay field-free on every theme", () => {
  const shadowMarkStyles =
    /\.pyrus-shadow-cloud-mark\s*\{([^}]*)\}/u.exec(indexCss)?.[1] ?? "";

  assert.doesNotMatch(
    shadowMarkStyles,
    /\b(?:background|box-shadow|isolation):/u,
  );
  assert.match(shadowMarkStyles, /pointer-events:\s*none/u);
  assert.doesNotMatch(indexCss, /pyrus-shadow-cloud-mark > canvas/u);
});
