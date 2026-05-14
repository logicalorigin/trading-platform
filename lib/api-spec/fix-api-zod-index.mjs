import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.resolve(scriptDir, "..", "api-zod", "src", "index.ts");
const generatedApiPath = path.resolve(
  scriptDir,
  "..",
  "api-zod",
  "src",
  "generated",
  "api.ts",
);
const reactGeneratedApiPath = path.resolve(
  scriptDir,
  "..",
  "api-client-react",
  "src",
  "generated",
  "api.ts",
);
const GENERATED_TYPES_EXPORTS = [
  'export * from "./generated/types";\n',
  "export * from './generated/types';\n",
];

async function writeIfChanged(filePath, nextContent) {
  const current = await readFile(filePath, "utf8");
  if (nextContent !== current) {
    await writeFile(filePath, nextContent, "utf8");
  }
}

async function stripTrailingWhitespace(filePath) {
  const current = await readFile(filePath, "utf8");
  await writeIfChanged(filePath, current.replace(/[ \t]+$/gm, ""));
}

async function main() {
  const current = await readFile(indexPath, "utf8");

  const withoutTypeExports = GENERATED_TYPES_EXPORTS.reduce(
    (value, exportLine) => value.replace(exportLine, ""),
    current,
  );
  await writeIfChanged(indexPath, withoutTypeExports);

  const generatedApi = await readFile(generatedApiPath, "utf8");
  await writeIfChanged(
    generatedApiPath,
    generatedApi.replaceAll("}.passthrough())", "}).passthrough()"),
  );
  await stripTrailingWhitespace(reactGeneratedApiPath);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
