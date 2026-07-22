import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./PyrusSignalsSettingsMenu.tsx", import.meta.url),
  "utf8",
);

test("numeric settings preserve an in-progress decimal draft", () => {
  assert.match(source, /const \[draft, setDraft\] = useState/);
  assert.match(source, /value=\{draft\}/);
  assert.match(source, /setDraft\(event\.target\.value\)/);
  assert.match(source, /if \(!editing\)[\s\S]*setDraft\(formatNumber\(value\)\)/);
});

test("settings controls expose programmatic names", () => {
  assert.match(source, /"aria-label": formatSettingLabel\(settingKey\)/);
  assert.match(source, /aria-label=\{`\$\{label\} color picker`\}/);
  assert.match(source, /"aria-label": `\$\{label\} color value`/);

  const directCheckboxes = [
    ...source.matchAll(/<input type="checkbox"[^\n]*\/>/g),
  ].map((match) => match[0]);
  assert.ok(directCheckboxes.length > 0);
  directCheckboxes.forEach((tag) => assert.match(tag, /aria-label=/));

  const selectTags = [...source.matchAll(/<Select[\s\S]*?\/>/g)].map(
    (match) => match[0],
  );
  assert.ok(selectTags.length > 0);
  selectTags.forEach((tag) => assert.match(tag, /ariaLabel=/));
});
