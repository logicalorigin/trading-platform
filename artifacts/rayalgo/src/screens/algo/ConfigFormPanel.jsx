import { AlgoProfileTab } from "./AlgoProfileTab";

/**
 * Wraps the full Profile-form field surface (Signal / Risk / Gates /
 * Strikes / Fills / Exits) for the right-rail. Functionally identical
 * to the old AlgoTuningTab "Config-only" sub-view — exported as a
 * standalone panel so the right rail can collapse / re-order it
 * independently of the live-impact rows.
 */
export const ConfigFormPanel = (props) => <AlgoProfileTab {...props} />;

export default ConfigFormPanel;
