import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..");
const outputRoot = process.env.PYRUS_API_CODEGEN_OUTPUT_ROOT
  ? path.resolve(process.env.PYRUS_API_CODEGEN_OUTPUT_ROOT)
  : repoRoot;
const indexPath = path.resolve(outputRoot, "lib", "api-zod", "src", "index.ts");
const generatedApiPath = path.resolve(
  outputRoot,
  "lib",
  "api-zod",
  "src",
  "generated",
  "api.ts",
);
const reactGeneratedApiPath = path.resolve(
  outputRoot,
  "lib",
  "api-client-react",
  "src",
  "generated",
  "api.ts",
);
const GENERATED_TYPES_EXPORTS = [
  'export * from "./generated/types";\n',
  "export * from './generated/types';\n",
];
const ZOD_IMPORT = "import * as zod from 'zod';";
const BOOLEAN_QUERY_COERCION = "zod.coerce.boolean()";
const BOOLEAN_QUERY_SCHEMA = "booleanQueryParam";
const BOOLEAN_QUERY_HELPER = `${ZOD_IMPORT}\n\nconst ${BOOLEAN_QUERY_SCHEMA} = zod.preprocess(\n  (value) => value === 'true' ? true : value === 'false' ? false : value,\n  zod.boolean(),\n);`;

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

function fixBooleanQueryCoercion(content) {
  if (!content.includes(BOOLEAN_QUERY_COERCION)) {
    return content;
  }
  if (!content.includes(ZOD_IMPORT)) {
    throw new Error("Generated Zod API is missing its expected import");
  }

  return content
    .replace(ZOD_IMPORT, BOOLEAN_QUERY_HELPER)
    .replaceAll(BOOLEAN_QUERY_COERCION, BOOLEAN_QUERY_SCHEMA);
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
    fixBooleanQueryCoercion(
      generatedApi.replaceAll("}.passthrough())", "}).passthrough()"),
    ),
  );
  await stripTrailingWhitespace(reactGeneratedApiPath);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
