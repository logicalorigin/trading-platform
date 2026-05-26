import {
  Activity,
  BadgeDollarSign,
  Ban,
  CircleDollarSign,
  Clock,
  CopyX,
  Cpu,
  DollarSign,
  Gauge,
  Layers,
  PlugZap,
  RadioTower,
  RefreshCcw,
  ServerCog,
  ShieldAlert,
  TrendingDown,
} from "lucide-react";
import { StatusPill } from "../../components/platform/primitives.jsx";
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

const STATUS_TONES = {
  armed: { color: CSS_COLOR.textSec, border: CSS_COLOR.border, background: CSS_COLOR.bg1 },
  active: { color: CSS_COLOR.red, border: `${cssColorMix(CSS_COLOR.red, 50)}`, background: `${cssColorMix(CSS_COLOR.red, 7)}` },
  off: { color: CSS_COLOR.amber, border: `${cssColorMix(CSS_COLOR.amber, 50)}`, background: `${cssColorMix(CSS_COLOR.amber, 7)}` },
  forced: { color: CSS_COLOR.red, border: CSS_COLOR.red, background: `${cssColorMix(CSS_COLOR.red, 9)}` },
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
  mtfAlignment: Activity,
  inversePutBlocklist: CopyX,
  bearishRegime: Ban,
  bidAskRequired: CircleDollarSign,
  freshQuoteRequired: Clock,
  spreadGate: Gauge,
  minBidGate: DollarSign,
  sameDirectionPosition: Layers,
  oppositeSignalFlip: RefreshCcw,
  positionMarkFeed: RadioTower,
  gatewayReadiness: PlugZap,
  resourcePressure: Cpu,
  contractBackoff: ServerCog,
};

const HALT_CONTROL_SHORT_LABELS = {
  dailyLoss: "Daily",
  openSymbols: "Symbols",
  premiumBudget: "Premium",
  mtfAlignment: "MTF",
  inversePutBlocklist: "Inv puts",
  bearishRegime: "Bear",
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
    return { label: "Active", color: CSS_COLOR.red };
  }
  if (statuses.length && statuses.every((status) => status.state === "off")) {
    return { label: "Off", color: CSS_COLOR.amber };
  }
  return { label: "Armed", color: CSS_COLOR.cyan };
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
  height: dim(22),
  width: "100%",
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
  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        gap: sp(2),
        minWidth: 0,
        width: "100%",
      }}
    >
      <input
        type="number"
        data-testid={`algo-halt-input-${id}`}
        aria-label={ariaLabel}
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
            fontSize: textSize("micro"),
            lineHeight: 1,
            flex: "0 0 auto",
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
  ariaLabel,
  testId,
  onClick,
}) => (
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
      border: `1px solid ${checked ? tone.color : CSS_COLOR.border}`,
      borderRadius: dim(7),
      background: checked ? cssColorAlpha(tone.color, "22") : "transparent",
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
        borderRadius: dim(4),
        background: checked ? tone.color : CSS_COLOR.textMuted,
        display: "block",
      }}
    />
  </button>
);

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
    <div
      data-testid={`algo-halt-control-${control.id}`}
      title={title}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: sp(2),
        minHeight: valueField ? dim(42) : dim(22),
        padding: sp("2px 0"),
        minWidth: 0,
        width: "100%",
        color: checked ? tone.color : CSS_COLOR.textMuted,
        opacity: disabled ? 0.55 : 1,
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
              borderRadius: dim(3),
              background: CSS_COLOR.accent,
              flex: "0 0 auto",
            }}
          />
        ) : null}
        <InlineSwitch
          checked={checked}
          disabled={disabled}
          tone={tone}
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
      {status.state === "active" || status.state === "forced" ? (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            width: dim(6),
            height: dim(6),
            borderRadius: dim(3),
            background: CSS_COLOR.red,
            boxShadow: `0 0 0 2px ${CSS_COLOR.bg2}`,
          }}
        />
      ) : null}
    </div>
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
    (!Number.isFinite(numericValue) ||
      (field.min != null && numericValue < field.min) ||
      (field.max != null && numericValue > field.max));
  const Icon = COMPACT_SETTING_ICONS[id] || Layers;
  const label = field.compactLabel || field.label;

  return (
    <div
      data-testid={`algo-halt-control-${id}`}
      title={[
        field.label,
        formatSettingValue(field, currentValue),
        dirty ? `was ${formatSettingValue(field, previousValue)}` : null,
      ]
        .filter(Boolean)
        .join(" · ")}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: sp(2),
        minHeight: dim(42),
        padding: sp("2px 0"),
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
              borderRadius: dim(3),
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
  );
};

export const HaltStrip = ({
  cockpit,
  profileBaseline,
  profileDraft,
  patchProfileDraftPath,
  focusedDeployment,
  updateProfileMutation,
  algoIsPhone = false,
  algoIsNarrow = false,
}) => {
  const statuses = SIGNAL_OPTIONS_HALT_CONTROL_GROUPS.flatMap((group) =>
    group.controls.map((control) =>
      deriveSignalOptionsHaltControlStatus({
        control,
        profile: profileDraft,
        cockpit,
      }),
    ),
  );
  const overall = overallHaltState(statuses);
  const dirty = signalOptionsHaltControlsChanged(
    profileDraft,
    profileBaseline,
  );
  const controlsDisabled = !focusedDeployment || updateProfileMutation?.isPending;
  const controlColumns = algoIsPhone ? 2 : algoIsNarrow ? 3 : 4;

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
          {focusedDeployment ? `RAY · ${focusedDeployment.name}` : "No deployment selected"}
        </span>
        <StatusPill color={overall.color}>{overall.label}</StatusPill>
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

      {SIGNAL_OPTIONS_HALT_CONTROL_GROUPS.map((group, index) => (
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
              color: CSS_COLOR.textMuted,
              fontFamily: T.sans,
              fontSize: textSize("micro"),
              fontWeight: 600,
              letterSpacing: 0,
              textTransform: "uppercase",
              marginBottom: sp(1),
            }}
          >
            {HALT_GROUP_LABELS[group.id] || group.label}
          </div>
          <div
            data-testid={`algo-halt-group-${group.id}`}
            data-halt-columns={controlColumns}
            data-algo-pocket-grid={controlColumns === 2 ? "two" : undefined}
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${controlColumns}, minmax(0, 1fr))`,
              columnGap: sp(5),
              rowGap: sp(4),
              minWidth: 0,
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
            {getCompactHaltStandaloneFields(group.id).map((field) => (
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
      ))}
    </div>
  );
};

export default HaltStrip;
