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
const GENERATED_TYPES_EXPORTS = [
  'export * from "./generated/types";\n',
  "export * from './generated/types';\n",
];

async function main() {
  const current = await readFile(indexPath, "utf8");

  const withoutTypeExports = GENERATED_TYPES_EXPORTS.reduce(
    (value, exportLine) => value.replace(exportLine, ""),
    current,
  );
  if (withoutTypeExports !== current) {
    await writeFile(indexPath, withoutTypeExports, "utf8");
  }

  const generatedApi = await readFile(generatedApiPath, "utf8");
  const fixedGeneratedApi = generatedApi.replaceAll(
    "}.passthrough())",
    "}).passthrough()",
  );
  if (fixedGeneratedApi !== generatedApi) {
    await writeFile(generatedApiPath, fixedGeneratedApi, "utf8");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
