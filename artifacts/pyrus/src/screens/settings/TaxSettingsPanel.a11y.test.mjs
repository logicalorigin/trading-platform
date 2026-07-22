import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./TaxSettingsPanel.jsx", import.meta.url), "utf8");

test("tax status rails use non-interactive status primitives", () => {
  assert.doesNotMatch(source, /<Pill\b/);
  assert.match(source, /<StatusPill\b/);
  assert.doesNotMatch(source, /<StatusPill\b[^>]*\btone=/);
});

test("tax profile refreshes preserve an in-progress local draft", () => {
  assert.match(source, /const lastProfileDraftJsonRef = useRef\(null\)/);
  assert.match(
    source,
    /currentJson === previousProfileDraftJson/,
  );
  assert.match(
    source,
    /const saved = await updateProfileMutation\.mutateAsync/,
  );
  assert.match(source, /const savedDraft = normalizeDraft\(saved\)/);
  assert.match(source, /const submittedDraftJson = JSON\.stringify\(draft\)/);
  assert.match(
    source,
    /setDraft\(\(current\) =>[\s\S]*?JSON\.stringify\(current\) === submittedDraftJson[\s\S]*?savedDraft[\s\S]*?: current/,
  );
});
