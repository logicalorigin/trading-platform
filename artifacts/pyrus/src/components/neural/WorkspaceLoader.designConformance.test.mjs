import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const bootShellSource = readFileSync(
  new URL("./BootShellLayout.tsx", import.meta.url),
  "utf8",
);
const neuralLoaderSource = readFileSync(
  new URL("./NeuralLoader.tsx", import.meta.url),
  "utf8",
);
const deferredRouteSource = readFileSync(
  new URL("../../screens/DeferredRouteScreen.jsx", import.meta.url),
  "utf8",
);
const algoScreenSource = readFileSync(
  new URL("../../screens/AlgoScreen.jsx", import.meta.url),
  "utf8",
);
const screenRegistrySource = readFileSync(
  new URL("../../features/platform/screenRegistry.jsx", import.meta.url),
  "utf8",
);
const platformShellSource = readFileSync(
  new URL("../../features/platform/PlatformShell.jsx", import.meta.url),
  "utf8",
);
const researchSource = readFileSync(
  new URL("../../features/research/PhotonicsObservatory.jsx", import.meta.url),
  "utf8",
);
const indexCss = readFileSync(
  new URL("../../index.css", import.meta.url),
  "utf8",
);

test("workspace loaders keep only the tight live cloud without changing boot", () => {
  const workspaceStart = bootShellSource.indexOf("if (isWorkspace)");
  const workspaceEnd = bootShellSource.indexOf(
    "const liveCloud",
    workspaceStart,
  );
  const workspaceBlock = bootShellSource.slice(workspaceStart, workspaceEnd);

  assert.notEqual(workspaceStart, -1);
  assert.notEqual(workspaceEnd, -1);
  assert.match(workspaceBlock, /className="pyrus-workspace-cloud-live"/);
  assert.match(
    workspaceBlock,
    /<NeuralCoreScene \{\.\.\.WORKSPACE_CLOUD_PROPS\} \/>/,
  );
  assert.doesNotMatch(workspaceBlock, /PYRUS_NEURAL_CLOUD_SRC/);
  assert.doesNotMatch(workspaceBlock, /pyrus-workspace-cloud-static/);
  assert.match(bootShellSource, /particles: 14000/);
  assert.match(bootShellSource, /orbitCount: 5400/);
  assert.match(bootShellSource, /particleSize: 0\.045/);
  assert.match(bootShellSource, /radius: 1\.35/);
  assert.match(bootShellSource, /stray: 0\.15/);
  assert.match(bootShellSource, /particles: 22000/);
  assert.match(bootShellSource, /radius: 3\.1/);
  assert.match(bootShellSource, /className="pyrus-boot-cloud-static"/);
  assert.match(bootShellSource, /className="pyrus-boot-cloud-live"/);
});

test("workspace loader is compact, app-styled, and motion safe", () => {
  assert.match(neuralLoaderSource, /variant\?: "immersive" \| "workspace"/);
  assert.match(bootShellSource, /role=\{loading \? "status" : undefined\}/);
  assert.match(
    bootShellSource,
    /aria-live=\{loading \? "polite" : undefined\}/,
  );
  assert.match(bootShellSource, /className="pyrus-workspace-loader"/);
  assert.match(bootShellSource, /className="pyrus-workspace-cloud"/);
  assert.match(
    bootShellSource,
    /!reducedMotion[\s\S]*?isNeuralWebglRendererSupported\(\)/,
  );
  assert.match(bootShellSource, /<Suspense fallback=\{null\}>/);
  assert.match(
    indexCss,
    /\.pyrus-workspace-cloud-live\s*\{[\s\S]*?inset: 0;[\s\S]*?position: absolute;/,
  );
  assert.doesNotMatch(indexCss, /\.pyrus-workspace-cloud-static/);
  assert.match(
    indexCss,
    /\.pyrus-workspace-loader-fill\s*\{[\s\S]*?background: var\(--ra-color-accent, #168bff\)/,
  );
});

test("workspace loader keeps interface copy in sans and progress data in mono", () => {
  assert.match(
    indexCss,
    /\.pyrus-workspace-loader\s*\{[\s\S]*?font-family:\s*var\(--ra-font-sans,[\s\S]*?\}/u,
  );
  assert.match(
    indexCss,
    /\.pyrus-workspace-loader-label\s*\{[\s\S]*?font-family:\s*var\(--ra-font-sans,[\s\S]*?\}/u,
  );
  assert.match(
    indexCss,
    /\.pyrus-workspace-loader-detail\s*\{[\s\S]*?font-family:\s*var\(--ra-font-sans,[\s\S]*?\}/u,
  );
  assert.match(
    indexCss,
    /\.pyrus-workspace-loader-percent\s*\{[\s\S]*?font-family:\s*var\(--ra-font-data,[\s\S]*?font-variant-numeric:\s*tabular-nums;[\s\S]*?\}/u,
  );
});

test("deferred routes use one compact loader for the mandatory Algo page", () => {
  assert.match(deferredRouteSource, /import \{ NeuralLoader \}/);
  assert.match(
    deferredRouteSource,
    /<NeuralLoader[\s\S]*?variant="workspace"[\s\S]*?testId=\{loadingTestId\}/,
  );
  assert.match(
    algoScreenSource,
    /import \{ AlgoLivePage \} from "\.\/algo\/AlgoLivePage";/,
  );
  assert.doesNotMatch(
    algoScreenSource,
    /retryDynamicImport\([\s\S]*?import\("\.\/algo\/AlgoLivePage"\)/,
  );
  assert.doesNotMatch(
    algoScreenSource,
    /<Suspense fallback=\{<AlgoLivePageLoadingStatus \/>\}>[\s\S]*?<LazyAlgoLivePage/,
    "the resolved Algo route must not reveal a second workspace-loading stage",
  );
  assert.doesNotMatch(algoScreenSource, /algo-live-page-loading/);
  assert.match(algoScreenSource, /<AlgoLivePage\b/);
});

test("all screen-level workspace waits use the same compact loader", () => {
  assert.match(
    screenRegistrySource,
    /<NeuralLoader[\s\S]*?variant="workspace"/,
  );
  assert.match(platformShellSource, /<NeuralLoader[\s\S]*?variant="workspace"/);
  assert.match(
    researchSource,
    /function ResearchLoadingState[\s\S]*?<NeuralLoader[\s\S]*?variant="workspace"/,
  );
});
