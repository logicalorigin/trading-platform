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
  assert.match(shellSource, /const algoFrameRuntimeEnabled = Boolean/);
  assert.match(shellSource, /frameAuxiliaryDataEnabled/);
  assert.match(shellSource, /mode:\s*environment \|\| "paper"/);
  assert.match(shellSource, /eventLimit:\s*20/);
  assert.match(shellSource, /enabled:\s*algoFrameRuntimeEnabled/);
  assert.match(shellSource, /refetchInterval:[\s\S]*algoFrameRuntimeEnabled[\s\S]*30_000[\s\S]*false/);
  assert.match(shellSource, /onLiveEvents:\s*handleAlgoLiveEvents/);
  assert.match(shellSource, /handleAlgoAction=\{handleAlgoAction\}/);
  assert.match(shellSource, /algoEventsQuery=\{algoEventsQuery\}/);
  assert.match(shellSource, /handleSetScreen\("algo"\)/);
  assert.match(headerSource, /const ALGO_EVENT_ICONS = \{/);
  assert.match(headerSource, /entry:\s*LogIn/);
  assert.match(headerSource, /exit:\s*LogOut/);
  assert.match(headerSource, /skip:\s*SkipForward/);
  assert.match(headerSource, /blocked:\s*ShieldX/);
  assert.match(headerSource, /config:\s*SlidersHorizontal/);
  assert.match(headerSource, /working:\s*Clock/);
  assert.match(headerSource, /const ALGO_CONTEXT_ICONS = \{/);
  assert.match(headerSource, /call:\s*TrendingUp/);
  assert.match(headerSource, /put:\s*TrendingDown/);
  assert.match(headerSource, /money:\s*CircleDollarSign/);
  assert.match(headerSource, /context\.kind === "quantity" \|\| context\.kind === "dte"/);
  assert.match(headerSource, /<HeaderAlgoContextIcon/);
  assert.match(algoContextBlock, /const isContract = context\.kind === "contract"/);
  assert.match(algoContextBlock, /size=\{isContract \? \(compact \? 12 : 13\) : compact \? 11 : 12\}/);
  assert.match(headerSource, /const Icon = ALGO_EVENT_ICONS\[item\.iconKind\] \|\| Info/);
  assert.match(headerSource, /data-testid="header-algo-tape-trigger"[\s\S]*<Bot size=\{14\}/);
  assert.doesNotMatch(headerSource, />\s*\{item\.detail\}\s*<\/span>/);
  assert.notEqual(algoContextBlock, "", "Algo context icon renderer must be present");
  assert.notEqual(algoItemBlock, "", "Algo tape item renderer must be present");
  assert.match(algoItemBlock, /maxWidth=\{compact \? 260 : 320\}/);
  assert.match(headerSource, /boxSizing:\s*"border-box"/);
  assert.match(headerSource, /overflow:\s*"hidden"[\s\S]*textOverflow:\s*"ellipsis"/);
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
