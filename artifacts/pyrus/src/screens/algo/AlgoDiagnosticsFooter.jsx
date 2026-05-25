import {
  sp,
} from "../../lib/uiTokens.jsx";
import { AlgoDiagnosticsTab } from "./AlgoDiagnosticsTab";
import { SettingsSectionHeader } from "./SettingsSectionHeader";

export const AlgoDiagnosticsFooter = (props) => (
  <div
    data-testid="algo-diagnostics-footer"
    style={{
      padding: sp("8px 12px 12px"),
      background: "transparent",
      minWidth: 0,
    }}
  >
    <SettingsSectionHeader label="Diagnostics" helper="read-only" />
    <AlgoDiagnosticsTab {...props} readOnly />
  </div>
);

export default AlgoDiagnosticsFooter;
