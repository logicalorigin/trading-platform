import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("platform shell raises global algo entry and exit toasts from live cockpit stream", () => {
  const shellSource = readFileSync(new URL("./PlatformShell.jsx", import.meta.url), "utf8");
  const headerSource = readFileSync(new URL("./HeaderBroadcastScrollerStack.jsx", import.meta.url), "utf8");
  const toastSource = readFileSync(new URL("./algoEventToasts.js", import.meta.url), "utf8");
  const algoContextBlock =
    headerSource.match(/const HeaderAlgoContextIcon = \([\s\S]*?\n};\n\nconst HeaderAlgoTapeItem/)?.[0] ??
    "";
  const algoItemBlock =
    headerSource.match(/const HeaderAlgoTapeItem = \([\s\S]*?\n};\n\nconst HeaderLaneSettingsPopover/)?.[0] ??
    "";

  assert.match(shellSource, /useAlgoCockpitStream\(\{\s*deploymentId:\s*null/);
  assert.match(shellSource, /useListExecutionEvents\(\s*\{\s*limit:\s*20\s*\}/);
  assert.match(shellSource, /mode:\s*environment \|\| "paper"/);
  assert.match(shellSource, /eventLimit:\s*20/);
  assert.match(shellSource, /enabled:\s*true/);
  assert.match(shellSource, /onLiveEvents:\s*handleAlgoLiveEvents/);
  assert.match(shellSource, /onAlgoAction=\{handleAlgoAction\}/);
  assert.match(shellSource, /algoEvents=\{algoEventsQuery\.data\?\.events \|\| \[\]\}/);
  assert.match(shellSource, /handleSetScreen\("algo"\)/);
  assert.match(headerSource, /const ALGO_EVENT_ICONS = \{/);
  assert.match(headerSource, /entry:\s*LogIn/);
  assert.match(headerSource, /exit:\s*LogOut/);
  assert.match(headerSource, /skip:\s*SkipForward/);
  assert.match(headerSource, /blocked:\s*ShieldAlert/);
  assert.match(headerSource, /config:\s*SlidersHorizontal/);
  assert.match(headerSource, /Clock3 size=\{compact \? 10 : 11\}/);
  assert.match(headerSource, /const ALGO_CONTEXT_ICONS = \{/);
  assert.match(headerSource, /call:\s*TrendingUp/);
  assert.match(headerSource, /put:\s*TrendingDown/);
  assert.match(headerSource, /money:\s*CircleDollarSign/);
  assert.match(headerSource, /quantity:\s*Layers/);
  assert.match(headerSource, /<HeaderAlgoContextIcon/);
  assert.match(algoContextBlock, /const isContract = context\.kind === "contract"/);
  assert.match(algoContextBlock, /size=\{isContract \? \(compact \? 12 : 13\) : compact \? 10 : 11\}/);
  assert.match(headerSource, /const Icon = ALGO_EVENT_ICONS\[item\.iconKind\] \|\| Info/);
  assert.match(headerSource, /data-testid="header-algo-tape-trigger"[\s\S]*<Bot size=\{14\}/);
  assert.match(headerSource, /aria-label=\{iconLabel\}/);
  assert.doesNotMatch(headerSource, />\s*\{item\.detail\}\s*<\/span>/);
  assert.notEqual(algoContextBlock, "", "Algo context icon renderer must be present");
  assert.notEqual(algoItemBlock, "", "Algo tape item renderer must be present");
  assert.match(algoItemBlock, /maxWidth=\{compact \? 300 : 390\}/);
  assert.match(algoItemBlock, /border=\{`1px solid \$\{colorWithAlpha\(tone, 0\.26\)\}`\}/);
  assert.match(algoItemBlock, /boxShadow=\{`inset 0 0 0 1px/);
  assert.match(algoItemBlock, /boxSizing:\s*"border-box"/);
  assert.match(algoItemBlock, /flexShrink:\s*0/);
  assert.match(algoItemBlock, /textOverflow:\s*"ellipsis"/);
  assert.match(algoItemBlock, />\s*\{item\.actionLabel\}\s*<\/span>/);
  assert.match(algoItemBlock, />\s*\{item\.symbol\}\s*<\/span>/);
  assert.match(algoContextBlock, />\s*\{context\.valueLabel\}\s*<\/span>/);
  assert.match(algoItemBlock, />\s*\{timeLabel\}\s*<\/span>/);
  assert.doesNotMatch(algoItemBlock, /item\.detail/);
  assert.doesNotMatch(algoItemBlock, /item\.eventType/);
  assert.match(headerSource, /ariaLabel=\{title\}/);
  assert.match(shellSource, /const toastedEventIdsRef = useRef\(new Set\(\)\)/);
  assert.match(shellSource, /const hasReceivedLiveRef = useRef\(false\)/);
  assert.match(shellSource, /if \(!hasReceivedLiveRef\.current\)/);
  assert.match(shellSource, /toastedEventIdsRef\.current = new Set\(\)/);
  assert.match(shellSource, /Array\.from\(toastedEventIdsRef\.current\)\.slice\(-300\)/);
  assert.match(toastSource, /signal_options_shadow_entry/);
  assert.match(toastSource, /signal_options_shadow_exit/);
  assert.match(toastSource, /payload\?\.pnl/);
});
