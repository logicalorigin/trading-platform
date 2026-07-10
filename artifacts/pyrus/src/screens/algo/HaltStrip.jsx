import {
  Activity,
  BadgeDollarSign,
  CircleDollarSign,
  Clock,
  CopyX,
  Cpu,
  DollarSign,
  Gauge,
  Layers,
  PlugZap,
  RefreshCcw,
  ServerCog,
  ShieldAlert,
  TrendingDown,
  Wallet,
} from "lucide-react";
import { AppTooltip } from "@/components/ui/tooltip";
import {
  CSS_COLOR,
  cssColorAlpha,
  cssColorMix,
  FONT_WEIGHTS,
  RADII,
  T,
  dim,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import {
  SIGNAL_OPTIONS_HALT_CONTROL_GROUPS,
  deriveSignalOptionsHaltControlStatus,
  numberFrom,
  signalOptionsHaltControlValue,
  signalOptionsHaltControlsChanged,
} from "./algoHelpers";
import {
  formatSettingValue,
  getCompactHaltSettingField,
  getCompactHaltStandaloneFields,
  getPathValue,
  isNumericSettingType,
} from "./algoSettingsFields";
import { normalizeLegacyAlgoBrandText } from "./algoBranding.js";
import { StatusPill } from "../../components/platform/primitives.jsx";

const STATUS_TONES = {
  armed: { color: CSS_COLOR.green, border: CSS_COLOR.green, background: cssColorMix(CSS_COLOR.green, 7) },
  active: { color: CSS_COLOR.red, border: cssColorMix(CSS_COLOR.red, 50), background: cssColorMix(CSS_COLOR.red, 7) },
  off: { color: CSS_COLOR.amber, border: cssColorMix(CSS_COLOR.amber, 50), background: cssColorMix(CSS_COLOR.amber, 7) },
  forced: { color: CSS_COLOR.red, border: CSS_COLOR.red, background: cssColorMix(CSS_COLOR.red, 9) },
};

const HALT_GROUP_LABELS = {
  risk: "Risk",
  signal: "Signal",
  quote: "Quote",
  position: "Position",
  infrastructure: "Infra",
};

const HALT_CONTROL_ICONS = {
  dailyLoss: TrendingDown,
  openSymbols: Layers,
  premiumBudget: BadgeDollarSign,
  tradingAllowance: Wallet,
  mtfAlignment: Activity,
  inversePutBlocklist: CopyX,
  bidAskRequired: CircleDollarSign,
  freshQuoteRequired: Clock,
  spreadGate: Gauge,
  minBidGate: DollarSign,
  sameDirectionPosition: Layers,
  oppositeSignalFlip: RefreshCcw,
  positionMarkFeed: Activity,
  gatewayReadiness: PlugZap,
  resourcePressure: Cpu,
  contractBackoff: ServerCog,
};

const HALT_CONTROL_SHORT_LABELS = {
  dailyLoss: "Daily",
  openSymbols: "Symbols",
  premiumBudget: "Premium",
  tradingAllowance: "Allowance",
  mtfAlignment: "MTF",
  inversePutBlocklist: "Inv puts",
  bidAskRequired: "Bid/ask",
  freshQuoteRequired: "Fresh",
  spreadGate: "Spread",
  minBidGate: "Min bid",
  sameDirectionPosition: "Same",
  oppositeSignalFlip: "Flip",
  positionMarkFeed: "Mark",
  gatewayReadiness: "Gateway",
  resourcePressure: "Load",
  contractBackoff: "Backoff",
};

const COMPACT_SETTING_ICONS = {
  maxContracts: Layers,
};

const overallHaltState = (statuses) => {
  if (statuses.some((status) => status.state === "active" || status.state === "forced")) {
    return { state: "active", label: "Active", color: CSS_COLOR.red };
  }
  if (statuses.length && statuses.every((status) => status.state === "off")) {
    return { state: "off", label: "Off", color: CSS_COLOR.amber };
  }
  return { state: "armed", label: "Armed", color: CSS_COLOR.green };
};

const STATE_RANK = { armed: 0, off: 1, active: 2, forced: 3 };

const groupRollupState = (statuses) => {
  if (!statuses.length) return { state: "armed", label: "Armed" };
  return statuses.reduce((worst, status) =>
    (STATE_RANK[status.state] || 0) > (STATE_RANK[worst.state] || 0)
      ? status
      : worst,
  );
};

const compactUnitLabel = (field) => {
  if (!field?.unit) return null;
  if (field.format === "money" || field.unit === "USD") return "$";
  if (field.unit === "% of mid" || field.unit === "%") return "%";
  if (field.unit === "symbols") return "sym";
  if (field.unit === "contracts") return "ct";
  return field.unit;
};

const compactInputStyle = ({ invalid, disabled }) => ({
  height: dim(20),
  width: dim(56),
  flex: "0 0 auto",
  minWidth: 0,
  padding: sp("0 5px"),
  border: `1px solid ${invalid ? CSS_COLOR.red : CSS_COLOR.border}`,
  borderRadius: dim(RADII.xs),
  background: CSS_COLOR.bg1,
  color: CSS_COLOR.text,
  fontFamily: T.data,
  fontSize: textSize("caption"),
  outline: "none",
  boxSizing: "border-box",
  opacity: disabled ? 0.55 : 1,
  textAlign: "right",
});

const CompactSettingInput = ({
  id,
  field,
  value,
  disabled,
  invalid,
  ariaLabel,
  patchProfileDraftPath,
}) => {
  const unitLabel = compactUnitLabel(field);
  const rangeHint =
    field.min != null && field.max != null
      ? `Enter ${field.min}–${field.max}`
      : field.min != null
        ? `Minimum ${field.min}`
        : field.max != null
          ? `Maximum ${field.max}`
          : "Value out of range";
  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: sp(2),
        minWidth: 0,
        width: "100%",
      }}
    >
      {invalid ? (
        <span
          aria-hidden="true"
          title={rangeHint}
          style={{
            color: CSS_COLOR.red,
            fontFamily: T.sans,
            fontSize: textSize("label"),
            fontWeight: FONT_WEIGHTS.emphasis,
            lineHeight: 1,
            flex: "0 0 auto",
          }}
        >
          !
        </span>
      ) : null}
      <input
        className="tnum"
        type="number"
        data-testid={`algo-halt-input-${id}`}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        title={invalid ? rangeHint : undefined}
        min={field.min}
        max={field.max}
        step={field.step}
        value={value ?? ""}
        disabled={disabled}
        onChange={(event) =>
          patchProfileDraftPath(
            field.path,
            numberFrom(event.target.value, value ?? field.min ?? 0),
          )
        }
        style={compactInputStyle({ invalid, disabled })}
      />
      {unitLabel ? (
        <span
          aria-hidden="true"
          style={{
            color: invalid ? CSS_COLOR.red : CSS_COLOR.textMuted,
            fontFamily: T.sans,
            fontSize: textSize("label"),
            lineHeight: 1,
            flex: "0 0 auto",
            width: dim(20),
            textAlign: "right",
          }}
        >
          {unitLabel}
        </span>
      ) : null}
    </span>
  );
};

const InlineSwitch = ({
  checked,
  disabled,
  tone,
  state,
  ariaLabel,
  testId,
  onClick,
}) => {
  const stateIsOff = state === "off";
  const switchTone = stateIsOff ? STATUS_TONES.off : tone;
  const switchColor = checked || stateIsOff ? switchTone.color : CSS_COLOR.textMuted;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: dim(25),
        height: dim(14),
        minWidth: dim(25),
        minHeight: dim(14),
        border: `1px solid ${checked || stateIsOff ? switchTone.border : CSS_COLOR.border}`,
        borderRadius: dim(RADII.md),
        background:
          checked || stateIsOff
            ? cssColorAlpha(switchTone.color, checked ? "22" : "12")
            : "transparent",
        display: "flex",
        alignItems: "center",
        justifyContent: checked ? "flex-end" : "flex-start",
        padding: dim(1),
        boxSizing: "border-box",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        lineHeight: 0,
        flex: "0 0 auto",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: dim(8),
          height: dim(8),
          borderRadius: dim(RADII.xs),
          background: switchColor,
          display: "block",
        }}
      />
    </button>
  );
};

const ControlToggleCell = ({
  group,
  control,
  profileBaseline,
  profileDraft,
  cockpit,
  patchProfileDraftPath,
  disabled,
}) => {
  const checked = signalOptionsHaltControlValue(profileDraft, control);
  const status = deriveSignalOptionsHaltControlStatus({
    control,
    profile: profileDraft,
    cockpit,
  });
  const Icon = HALT_CONTROL_ICONS[control.id] || ShieldAlert;
  const tone = STATUS_TONES[status.state] || STATUS_TONES.armed;
  const valueField = getCompactHaltSettingField(control.id);
  const currentValue = valueField ? getPathValue(profileDraft, valueField.path) : null;
  const previousValue = valueField ? getPathValue(profileBaseline, valueField.path) : null;
  const valueDirty = valueField
    ? JSON.stringify(currentValue ?? null) !== JSON.stringify(previousValue ?? null)
    : false;
  const numericValue = Number(currentValue);
  const invalid =
    !!valueField &&
    isNumericSettingType(valueField.type) &&
    // An untouched/empty threshold is "not set", not out-of-range — don't flag it red.
    currentValue != null &&
    currentValue !== "" &&
    (!Number.isFinite(numericValue) ||
      (valueField.min != null && numericValue < valueField.min) ||
      (valueField.max != null && numericValue > valueField.max));
  const shortLabel =
    valueField?.compactLabel ||
    HALT_CONTROL_SHORT_LABELS[control.id] ||
    control.label;
  const title = [
    `${group.label}: ${control.label}`,
    status.reasonCount > 0 ? `${status.reasonCount} recent blocks` : status.label,
    valueField
      ? `${valueField.label}: ${formatSettingValue(valueField, currentValue)}`
      : null,
    valueDirty
      ? `was ${formatSettingValue(valueField, previousValue)}`
      : null,
    control.title,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <AppTooltip content={title}>
      <div
        data-testid={`algo-halt-control-${control.id}`}
        data-state={status.state}
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
        gap: sp(1),
        minHeight: valueField ? dim(34) : dim(19),
        padding: sp("1px 0 1px 4px"),
        minWidth: 0,
        width: "100%",
        color: checked ? tone.color : CSS_COLOR.textMuted,
        opacity: disabled ? 0.55 : 1,
        boxSizing: "border-box",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: dim(2),
          borderRadius: dim(RADII.xs),
          background:
            status.state === "active" || status.state === "forced"
              ? tone.color
              : "transparent",
        }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: sp(3),
          minWidth: 0,
          width: "100%",
        }}
      >
        <Icon
          size={13}
          strokeWidth={1.9}
          aria-hidden="true"
          style={{ color: tone.color, flex: "0 0 auto" }}
        />
        <span
          data-testid={`algo-halt-label-${control.id}`}
          style={{
            color: checked ? CSS_COLOR.textSec : CSS_COLOR.textMuted,
            fontFamily: T.sans,
            fontSize: textSize("caption"),
            fontWeight: FONT_WEIGHTS.label,
            lineHeight: 1.1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
            flex: "1 1 auto",
          }}
        >
          {shortLabel}
        </span>
        {valueDirty ? (
          <span
            role="status"
            aria-label={`${shortLabel} threshold unsaved`}
            style={{
              width: dim(5),
              height: dim(5),
              borderRadius: dim(RADII.xs),
              background: CSS_COLOR.accent,
              flex: "0 0 auto",
            }}
          />
        ) : null}
        <InlineSwitch
          checked={checked}
          disabled={disabled}
          tone={tone}
          state={status.state}
          ariaLabel={`${control.label} halt control ${checked ? "enabled" : "disabled"}; ${status.label}`}
          testId={`algo-halt-toggle-${control.id}`}
          onClick={() =>
            patchProfileDraftPath(`${control.section}.${control.key}`, !checked)
          }
        />
      </div>
      {valueField ? (
        <CompactSettingInput
          id={control.id}
          field={valueField}
          value={currentValue}
          disabled={disabled}
          invalid={invalid}
          ariaLabel={`${control.label} ${valueField.label}`}
          patchProfileDraftPath={patchProfileDraftPath}
        />
      ) : null}
      </div>
    </AppTooltip>
  );
};

const CompactStandaloneSettingCell = ({
  field,
  profileBaseline,
  profileDraft,
  patchProfileDraftPath,
  disabled,
}) => {
  const id = field.compactId || field.path;
  const currentValue = getPathValue(profileDraft, field.path);
  const previousValue = getPathValue(profileBaseline, field.path);
  const dirty =
    JSON.stringify(currentValue ?? null) !== JSON.stringify(previousValue ?? null);
  const numericValue = Number(currentValue);
  const invalid =
    isNumericSettingType(field.type) &&
    // An untouched/empty threshold is "not set", not out-of-range — don't flag it red.
    currentValue != null &&
    currentValue !== "" &&
    (!Number.isFinite(numericValue) ||
      (field.min != null && numericValue < field.min) ||
      (field.max != null && numericValue > field.max));
  const Icon = COMPACT_SETTING_ICONS[id] || Layers;
  const label = field.compactLabel || field.label;

  return (
    <AppTooltip
      content={[
        field.label,
        formatSettingValue(field, currentValue),
        dirty ? `was ${formatSettingValue(field, previousValue)}` : null,
      ]
        .filter(Boolean)
        .join(" · ")}
    >
      <div
        data-testid={`algo-halt-control-${id}`}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: sp(1),
          minHeight: dim(36),
          padding: sp("1px 0"),
          minWidth: 0,
          width: "100%",
          boxSizing: "border-box",
        }}
      >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: sp(3),
          minWidth: 0,
          width: "100%",
        }}
      >
        <Icon
          size={13}
          strokeWidth={1.9}
          aria-hidden="true"
          style={{ color: CSS_COLOR.textMuted, flex: "0 0 auto" }}
        />
        <span
          data-testid={`algo-halt-label-${id}`}
          style={{
            color: CSS_COLOR.textSec,
            fontFamily: T.sans,
            fontSize: textSize("caption"),
            fontWeight: FONT_WEIGHTS.label,
            lineHeight: 1.1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
            flex: "1 1 auto",
          }}
        >
          {label}
        </span>
        {dirty ? (
          <span
            role="status"
            aria-label={`${label} unsaved`}
            style={{
              width: dim(5),
              height: dim(5),
              borderRadius: dim(RADII.xs),
              background: CSS_COLOR.accent,
              flex: "0 0 auto",
            }}
          />
        ) : null}
      </div>
      <CompactSettingInput
        id={id}
        field={field}
        value={currentValue}
        disabled={disabled}
        invalid={invalid}
        ariaLabel={field.label}
        patchProfileDraftPath={patchProfileDraftPath}
      />
      </div>
    </AppTooltip>
  );
};

export const HaltStrip = ({
  cockpit,
  profileBaseline,
  profileDraft,
  patchProfileDraftPath,
  focusedDeployment,
  controlBaselineReady = true,
  updateProfileMutation,
}) => {
  const statusesByGroup = SIGNAL_OPTIONS_HALT_CONTROL_GROUPS.map((group) => ({
    group,
    statuses: group.controls.map((control) =>
      deriveSignalOptionsHaltControlStatus({ control, profile: profileDraft, cockpit }),
    ),
  }));
  const statuses = statusesByGroup.flatMap((item) => item.statuses);
  const overall = overallHaltState(statuses);
  const dirty = signalOptionsHaltControlsChanged(
    profileDraft,
    profileBaseline,
  );
  const controlsDisabled =
    !focusedDeployment || !controlBaselineReady || updateProfileMutation?.isPending;

  return (
    <div
      data-testid="algo-halt-strip"
      style={{
        padding: sp("8px 12px"),
        background: "transparent",
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr)",
        gap: sp(3),
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: sp(4),
          minWidth: 0,
        }}
      >
        <span
          style={{
            color: focusedDeployment ? CSS_COLOR.text : CSS_COLOR.textMuted,
            fontFamily: T.sans,
            fontSize: textSize("body"),
            fontWeight: FONT_WEIGHTS.label,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
          }}
        >
          {focusedDeployment
            ? focusedDeployment.name
              ? `Pyrus · ${normalizeLegacyAlgoBrandText(focusedDeployment.name)}`
              : "Pyrus"
            : "No deployment selected"}
        </span>
        {focusedDeployment ? (
          <AppTooltip content={`Halt controls ${overall.label}`}>
            <StatusPill color={overall.color}>{overall.label}</StatusPill>
          </AppTooltip>
        ) : null}
      </div>
      {dirty ? (
        <div
          style={{
            color: CSS_COLOR.amber,
            fontFamily: T.sans,
            fontSize: textSize("caption"),
          }}
        >
          Unsaved halt changes
        </div>
      ) : null}

      {statusesByGroup.map(({ group, statuses: groupStatuses }, index) => {
        const rollup = groupRollupState(groupStatuses);
        const rollupTone = STATUS_TONES[rollup.state] || STATUS_TONES.armed;
        const standaloneFields = getCompactHaltStandaloneFields(group.id);
        return (
        <section
          key={group.id}
          aria-label={`${group.label} halt controls`}
          style={{
            borderTop: index === 0 ? "none" : `1px solid ${CSS_COLOR.borderLight}`,
            paddingTop: index === 0 ? 0 : sp(2),
            minWidth: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: sp(4),
              marginBottom: sp(1),
              minWidth: 0,
            }}
          >
            <span
              style={{
                color: CSS_COLOR.textSec,
                fontFamily: T.sans,
                fontSize: textSize("label"),
                fontWeight: 600,
                letterSpacing: 0,
                textTransform: "uppercase",
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {HALT_GROUP_LABELS[group.id] || group.label}
            </span>
            <AppTooltip content={`${group.label} halt controls ${rollup.label}`}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: sp(2),
                  flex: "0 0 auto",
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: dim(6),
                    height: dim(6),
                    borderRadius: dim(RADII.pill),
                    background: rollupTone.color,
                    flex: "0 0 auto",
                  }}
                />
                <span
                  style={{
                    color: rollupTone.color,
                    fontFamily: T.sans,
                    fontSize: textSize("caption"),
                    fontWeight: FONT_WEIGHTS.medium,
                    letterSpacing: "0.02em",
                    textTransform: "uppercase",
                    whiteSpace: "nowrap",
                  }}
                >
                  {rollup.label}
                </span>
              </span>
            </AppTooltip>
          </div>
          <div
            data-testid={`algo-halt-group-${group.id}`}
            className="algo-settings-grid"
            style={{
              // auto-fill (not auto-fit) keeps the column tracks so RISK/QUOTE stay 4-up,
              // but lone/few-control groups don't stretch their toggles across the row.
              gridTemplateColumns: `repeat(auto-fill, minmax(${dim(88)}px, 1fr))`,
              columnGap: sp(3),
            }}
          >
            {group.controls.map((control) => (
              <ControlToggleCell
                key={`${control.section}.${control.key}`}
                group={group}
                control={control}
                profileBaseline={profileBaseline}
                profileDraft={profileDraft}
                cockpit={cockpit}
                patchProfileDraftPath={patchProfileDraftPath}
                disabled={controlsDisabled}
              />
            ))}
            {standaloneFields.map((field) => (
              <CompactStandaloneSettingCell
                key={field.path}
                field={field}
                profileBaseline={profileBaseline}
                profileDraft={profileDraft}
                patchProfileDraftPath={patchProfileDraftPath}
                disabled={controlsDisabled}
              />
            ))}
          </div>
        </section>
        );
      })}
    </div>
  );
};

export default HaltStrip;
