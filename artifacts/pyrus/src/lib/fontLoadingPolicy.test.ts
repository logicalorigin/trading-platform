import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const readText = (path: string): string =>
  readFileSync(new URL(path, import.meta.url), "utf8");

const SOURCE_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".jsx",
  ".mjs",
  ".ts",
  ".tsx",
]);

const collectSourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return collectSourceFiles(path);
    }
    return SOURCE_EXTENSIONS.has(extname(entry.name)) ? [path] : [];
  });

test("PYRUS self-hosts app fonts instead of loading Google Fonts at runtime", () => {
  const indexHtml = readText("../../index.html");
  const indexCss = readText("../index.css");
  const mainTsx = readText("../main.tsx");
  const packageJson = JSON.parse(readText("../../package.json")) as {
    dependencies?: Record<string, string>;
  };
  const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
  const sourceFiles = [
    join(repoRoot, "index.html"),
    ...collectSourceFiles(join(repoRoot, "src")),
  ];
  const sourceText = sourceFiles
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");

  assert.doesNotMatch(sourceText, /fonts\.googleapis\.com/);
  assert.doesNotMatch(sourceText, /fonts\.gstatic\.com/);
  assert.doesNotMatch(indexCss, /@import\s+url\(["']https:\/\/fonts\.googleapis\.com/);

  assert.match(mainTsx, /@fontsource\/ibm-plex-sans\/400\.css/);
  assert.match(mainTsx, /@fontsource\/ibm-plex-sans\/500\.css/);
  assert.match(mainTsx, /@fontsource\/ibm-plex-sans\/600\.css/);
  assert.doesNotMatch(mainTsx, /@fontsource\/ibm-plex-sans\/400-italic\.css/);
  assert.doesNotMatch(mainTsx, /@fontsource\/ibm-plex-sans\/600-italic\.css/);
  assert.doesNotMatch(mainTsx, /@fontsource\/ibm-plex-sans\/700\.css/);
  assert.doesNotMatch(mainTsx, /@fontsource\/jetbrains-mono/);
  for (const [, importPath] of mainTsx.matchAll(/@fontsource\/([^"]+\.css)/g)) {
    assert.ok(
      existsSync(join(repoRoot, "node_modules", "@fontsource", importPath)),
      `Expected @fontsource import to resolve: ${importPath}`,
    );
  }

  assert.equal(typeof packageJson.dependencies?.["@fontsource/ibm-plex-sans"], "string");
  assert.equal(packageJson.dependencies?.["@fontsource/jetbrains-mono"], undefined);
});

test("PYRUS root CSS routes all app typography through IBM Plex Sans", () => {
  const indexCss = readText("../index.css");

  assert.match(indexCss, /--ra-font-sans:\s*'IBM Plex Sans'/);
  assert.match(indexCss, /--ra-font-display:\s*var\(--ra-font-sans\)/);
  assert.match(indexCss, /--ra-font-data:\s*var\(--ra-font-sans\)/);
  assert.match(indexCss, /html,\s*body,\s*#root\s*\{[^}]*font-family:\s*var\(--ra-font-sans\)/s);
  assert.match(indexCss, /body \*\s*\{[^}]*font-family:\s*inherit/s);
  assert.match(indexCss, /svg,\s*svg text,\s*svg tspan\s*\{[^}]*font-family:\s*inherit/s);
  assert.match(indexCss, /\.recharts-text,[^}]*font-family:\s*var\(--ra-font-sans\)/s);
  assert.match(indexCss, /button,\s*input,\s*select,\s*textarea,\s*option,\s*optgroup\s*\{[^}]*font-family:\s*inherit/s);
});

test("Algo operations source uses IBM Plex typography and exposes richer existing data", () => {
  const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
  const algoFiles = [
    join(repoRoot, "src", "screens", "AlgoScreen.jsx"),
    ...collectSourceFiles(join(repoRoot, "src", "screens", "algo")),
  ];
  const algoSource = algoFiles
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");

  assert.doesNotMatch(algoSource, /\bT\.mono\b/);
  assert.doesNotMatch(algoSource, /JetBrains|monospace|@fontsource\/jetbrains/);
  assert.match(algoSource, /data-testid="algo-snapshot-details"/);
  assert.match(algoSource, /candidateLatestActivityLabel/);
  assert.match(algoSource, /premiumAtRisk/);
  assert.match(algoSource, /lastMarkedAt/);
});
