import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.resolve(scriptDir, "..", "api-zod", "src", "index.ts");
const GENERATED_TYPES_EXPORT = 'export * from "./generated/types";\n';

async function main() {
  const current = await readFile(indexPath, "utf8");

  if (!current.includes(GENERATED_TYPES_EXPORT)) {
    return;
  }

  const next = current.replace(GENERATED_TYPES_EXPORT, "");
  await writeFile(indexPath, next, "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
