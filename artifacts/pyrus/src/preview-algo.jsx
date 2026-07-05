// DEV-ONLY design preview harness for the algo control area.
// Mounts HaltStrip + AlgoSettingsRegion in isolation with the real default
// profile so the headless browser can screenshot the panel the live app gates
// behind broker/deployment data. Throwaway: delete with preview-algo.html.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AlgoSettingsRegion } from "./screens/algo/AlgoSettingsRegion.jsx";
import { HaltStrip } from "./screens/algo/HaltStrip.jsx";
import { SIGNAL_OPTIONS_DEFAULT_PROFILE } from "./screens/algo/algoHelpers.js";
import { RADII } from "./lib/uiTokens.jsx";

const setPath = (obj, path, value) => {
  const next = structuredClone(obj);
  const parts = path.split(".");
  let cur = next;
  for (let i = 0; i < parts.length - 1; i += 1) {
    cur[parts[i]] = { ...(cur[parts[i]] ?? {}) };
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
  return next;
};

const COCKPIT = { candidates: [] };
const DEPLOYMENT = { id: "preview", mode: "shadow", label: "Preview" };
const MUT = { isPending: false };
const RAIL_WIDTHS = [360];

function Panel({ width }) {
  const [profile, setProfile] = useState(() =>
    structuredClone(SIGNAL_OPTIONS_DEFAULT_PROFILE),
  );
  const common = {
    cockpit: COCKPIT,
    profileDraft: profile,
    profileBaseline: SIGNAL_OPTIONS_DEFAULT_PROFILE,
    patchProfileDraftPath: (p, v) => setProfile((cur) => setPath(cur, p, v)),
    focusedDeployment: DEPLOYMENT,
    controlBaselineReady: true,
    updateProfileMutation: MUT,
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div
        style={{
          fontFamily: "ui-monospace, monospace",
          fontSize: 11,
          color: "var(--ra-text-muted)",
        }}
      >
        rail width: {width}px
      </div>
      <div
        className="algo-rail-cq"
        style={{
          width,
          border: "1px solid var(--ra-border-default)",
          borderRadius: RADII.md,
          background: "var(--ra-surface-1)",
          overflow: "hidden",
        }}
      >
        <HaltStrip {...common} />
        <AlgoSettingsRegion
          {...common}
          signalOptionsPositions={[]}
          strategySettingsDraft={{}}
          strategyBaseline={{}}
          patchStrategySettingsPath={() => {}}
          dirtyFields={[]}
          handleApplyExpandedCapacity={() => {}}
          updateStrategySettingsMutation={MUT}
        />
      </div>
    </div>
  );
}

function Preview() {
  return (
    <TooltipProvider>
      <div
        style={{
          background: "var(--ra-surface-0)",
          minHeight: "100vh",
          padding: 20,
          display: "flex",
          gap: 24,
          alignItems: "flex-start",
        }}
      >
        {RAIL_WIDTHS.map((w) => (
          <Panel key={w} width={w} />
        ))}
      </div>
    </TooltipProvider>
  );
}

createRoot(document.getElementById("preview-root")).render(<Preview />);
