import { useId, useMemo } from "react";
import { buildAlgoTuningImpact } from "../../features/platform/algoTuningImpactModel";
import {
  FONT_WEIGHTS,
  RADII,
  T,
  dim,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import {
  SIGNAL_OPTIONS_EXPANDED_CAPACITY,
  compactButtonStyle,
  formatChaseSteps,
  formatMoney,
  formatProgressiveTrailSteps,
  numberFrom,
  parseChaseSteps,
  parseProgressiveTrailSteps,
} from "./algoHelpers";
import {
  compactRailSettingGroups,
  countDirtyFieldsBySection,
  formatSettingValue,
  getPathValue,
  isCompactHaltSettingPath,
  isNumericSettingType,
  settingsRegionFields,
} from "./algoSettingsFields";
import { SegmentedControl } from "../../components/platform/primitives.jsx";
import { SettingsFormRow } from "./SettingsFormRow";
import { SettingsSectionHeader } from "./SettingsSectionHeader";
import { Slider } from "../../components/ui/Slider.jsx";

const COMPACT_SLIDER_TYPES = new Set(["slider", "logSlider"]);

const formatCompactSliderValue = (field, value) => {
  if (value == null || value === "") return "—";
  if (field.format === "money") return formatMoney(value);
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  if (field.step != null && field.step < 1) {
    const digits = Math.min(
      3,
      Math.max(0, -Math.floor(Math.log10(field.step))),
    );
    return num.toFixed(digits);
  }
  return String(Math.round(num));
};

const gridTemplateFor = (columns, { algoIsPhone, algoIsNarrow }) => {
  const resolvedColumns = algoIsPhone
    ? 1
    : algoIsNarrow
      ? Math.min(columns, 2)
      : columns;
  return `repeat(${resolvedColumns}, minmax(0, 1fr))`;
};

const compactGridTemplateFor = (columns, { algoIsPhone, algoIsNarrow }) => {
  const resolvedColumns = algoIsPhone
    ? 2
    : algoIsNarrow
      ? Math.min(columns, 3)
      : columns;
  return `repeat(${resolvedColumns}, minmax(0, 1fr))`;
};

const compactUnitLabel = (field) => {
  if (!field?.unit) return null;
  if (field.format === "money" || field.unit === "USD") return "$";
  if (field.unit === "% of mid" || field.unit === "%") return "%";
  if (field.unit === "% from entry") return "%";
  if (field.unit === "% gain") return "%";
  if (field.unit === "x ATR") return "ATR";
  if (field.unit === "x avg") return "avg";
  if (field.unit === "seconds") return "sec";
  if (field.unit === "bars") return "bars";
  if (field.unit === "days") return "d";
  if (field.unit === "matches") return "of 3";
  return field.unit;
};

const compactInputStyle = ({ invalid, disabled }) => ({
  height: dim(24),
  width: "100%",
  minWidth: 0,
  padding: sp("0 6px"),
  border: `1px solid ${invalid ? T.red : T.border}`,
  borderRadius: dim(RADII.xs),
  background: T.bg1,
  color: T.text,
  fontFamily: T.data,
  fontSize: textSize("caption"),
  outline: "none",
  boxSizing: "border-box",
  opacity: disabled ? 0.55 : 1,
});

const fieldKey = (field) => `${field.slice}.${field.path}`;

const getDraftRoot = ({ field, profileDraft, strategySettingsDraft }) =>
  field.slice === "profile" ? profileDraft : strategySettingsDraft;

const getBaselineRoot = ({ field, profileBaseline, strategyBaseline }) =>
  field.slice === "profile" ? profileBaseline : strategyBaseline;

const getPatchHandler = ({
  field,
  patchProfileDraftPath,
  patchStrategySettingsPath,
}) =>
  field.slice === "profile" ? patchProfileDraftPath : patchStrategySettingsPath;

const CompactSwitch = ({ checked, disabled, ariaLabel, testId, onChange }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={ariaLabel}
    data-testid={testId}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    style={{
      width: dim(27),
      height: dim(16),
      minWidth: dim(27),
      minHeight: dim(16),
      border: `1px solid ${checked ? T.accent : T.border}`,
      borderRadius: dim(8),
      background: checked ? `${T.accent}22` : "transparent",
      padding: dim(1),
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.55 : 1,
      display: "flex",
      alignItems: "center",
      justifyContent: checked ? "flex-end" : "flex-start",
      boxSizing: "border-box",
      lineHeight: 0,
      flex: "0 0 auto",
    }}
  >
    <span
      aria-hidden="true"
      style={{
        width: dim(10),
        height: dim(10),
        borderRadius: dim(5),
        background: checked ? T.accent : T.textMuted,
        display: "block",
      }}
    />
  </button>
);

const compactImpactSummary = (field, impact) => {
  if (!field.impact || !impact) return null;
  const count = Number(impact.count || 0);
  const hasImpact = count > 0;
  return {
    color: hasImpact && field.warningWhenNonZero !== false ? T.amber : T.textMuted,
    label:
      impact.total != null
        ? `${count}/${impact.total}`
        : hasImpact
          ? `${count} hit`
          : "clear",
  };
};

const CompactFieldInput = ({
  id,
  field,
  value,
  invalid,
  disabled,
  ariaLabel,
  testId,
  onPatch,
}) => {
  const inputStyle = compactInputStyle({ invalid, disabled });
  if (field.type === "select") {
    return (
      <select
        id={id}
        value={value ?? ""}
        disabled={disabled}
        aria-label={ariaLabel}
        data-testid={testId}
        onChange={(event) =>
          onPatch(
            field.path,
            field.coerce ? field.coerce(event.target.value) : event.target.value,
          )
        }
        style={inputStyle}
      >
        {(field.options || []).map((option) => {
          const optionValue = typeof option === "string" ? option : option.value;
          const optionLabel = typeof option === "string" ? option : option.label;
          return (
            <option key={optionValue} value={optionValue}>
              {optionLabel}
            </option>
          );
        })}
      </select>
    );
  }
  if (field.type === "text") {
    return (
      <input
        id={id}
        type="text"
        value={
          field.format === "chaseSteps"
            ? formatChaseSteps(value)
            : field.format === "progressiveTrailSteps"
              ? formatProgressiveTrailSteps(value)
              : value ?? ""
        }
        disabled={disabled}
        aria-label={ariaLabel}
        data-testid={testId}
        onChange={(event) =>
          onPatch(
            field.path,
            field.format === "chaseSteps"
              ? parseChaseSteps(event.target.value, value || [])
              : field.format === "progressiveTrailSteps"
                ? parseProgressiveTrailSteps(event.target.value, value || [])
              : event.target.value,
          )
        }
        style={inputStyle}
      />
    );
  }
  if (field.type === "segmented") {
    return (
      <span
        data-testid={testId}
        style={{
          display: "inline-flex",
          width: "100%",
          minWidth: 0,
        }}
      >
        <SegmentedControl
          options={field.options || []}
          value={value}
          onChange={(next) =>
            onPatch(field.path, field.coerce ? field.coerce(next) : next)
          }
          ariaLabel={ariaLabel}
          buttonTestId={(option) =>
            `${testId}-${typeof option === "string" ? option : option.value}`
          }
        />
      </span>
    );
  }
  if (COMPACT_SLIDER_TYPES.has(field.type)) {
    const scale = field.type === "logSlider" ? "log" : "linear";
    const safeValue = Number.isFinite(Number(value))
      ? Number(value)
      : field.min ?? 0;
    return (
      <span
        data-testid={testId}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: sp(2),
          width: "100%",
          minWidth: 0,
          opacity: invalid ? 1 : undefined,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            color: invalid ? T.red : T.text,
            fontFamily: T.data,
            fontSize: textSize("body"),
            fontWeight: FONT_WEIGHTS.label,
            minWidth: dim(28),
            textAlign: "right",
            flex: "0 0 auto",
          }}
        >
          {formatCompactSliderValue(field, value)}
        </span>
        <span style={{ flex: "1 1 auto", minWidth: 0 }}>
          <Slider
            value={safeValue}
            onChange={(next) => onPatch(field.path, next)}
            min={field.min}
            max={field.max}
            step={field.step}
            scale={scale}
            disabled={disabled}
            ariaLabel={ariaLabel}
          />
        </span>
      </span>
    );
  }
  return (
    <input
      id={id}
      type="number"
      min={field.min}
      max={field.max}
      step={field.step}
      value={value ?? ""}
      disabled={disabled}
      aria-label={ariaLabel}
      data-testid={testId}
      onChange={(event) =>
        onPatch(
          field.path,
          numberFrom(event.target.value, value ?? field.min ?? 0),
        )
      }
      style={inputStyle}
    />
  );
};

const CompactLabel = ({ label, dirty, previousValue, field, impact }) => (
  <span
    style={{
      display: "flex",
      alignItems: "center",
      gap: sp(2),
      minWidth: 0,
      width: "100%",
    }}
  >
    <span
      style={{
        color: T.textSec,
        fontFamily: T.sans,
        fontSize: textSize("caption"),
        fontWeight: FONT_WEIGHTS.label,
        lineHeight: 1.1,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        minWidth: 0,
      }}
    >
      {label}
    </span>
    {dirty ? (
      <span
        role="status"
        aria-label={`${label} unsaved`}
        title={`was: ${formatSettingValue(field, previousValue)}`}
        style={{
          width: dim(5),
          height: dim(5),
          borderRadius: dim(3),
          background: T.accent,
          flex: "0 0 auto",
        }}
      />
    ) : null}
    {impact ? (
      <span
        title={field.label}
        style={{
          color: impact.color,
          fontFamily: T.sans,
          fontSize: textSize("micro"),
          lineHeight: 1,
          marginLeft: "auto",
          flex: "0 0 auto",
        }}
      >
        {impact.label}
      </span>
    ) : null}
  </span>
);

const CompactSettingCell = ({
  item,
  profileDraft,
  profileBaseline,
  strategySettingsDraft,
  strategyBaseline,
  patchProfileDraftPath,
  patchStrategySettingsPath,
  disabled,
  dirtyFieldKeys,
  impact,
}) => {
  const id = useId().replace(/:/g, "");
  const field = item;
  const draftRoot = getDraftRoot({ field, profileDraft, strategySettingsDraft });
  const baselineRoot = getBaselineRoot({ field, profileBaseline, strategyBaseline });
  const value = getPathValue(draftRoot, field.path);
  const previousValue = getPathValue(baselineRoot, field.path);
  const dirty = dirtyFieldKeys.has(fieldKey(field));
  const numericValue = Number(value);
  const invalid =
    isNumericSettingType(field.type) &&
    (!Number.isFinite(numericValue) ||
      (field.min != null && numericValue < field.min) ||
      (field.max != null && numericValue > field.max));
  const onPatch = getPatchHandler({
    field,
    patchProfileDraftPath,
    patchStrategySettingsPath,
  });
  const unitLabel = compactUnitLabel(field);
  const impactBadge = compactImpactSummary(field, field.impact ? impact[field.impact] : null);

  return (
    <label
      htmlFor={field.type === "boolean" ? undefined : id}
      title={[
        field.label,
        formatSettingValue(field, value),
        dirty ? `was ${formatSettingValue(field, previousValue)}` : null,
      ]
        .filter(Boolean)
        .join(" · ")}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: sp(2),
        minHeight: dim(42),
        minWidth: 0,
        gridColumn: item.compactWide ? "span 2" : undefined,
      }}
      data-testid={`algo-compact-control-${field.compactId}`}
    >
      <CompactLabel
        label={field.compactLabel || field.label}
        dirty={dirty}
        previousValue={previousValue}
        field={field}
        impact={impactBadge}
      />
      {field.type === "boolean" ? (
        <span
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: sp(4),
            minWidth: 0,
            height: dim(24),
          }}
        >
          <span
            style={{
              color: value ? T.textSec : T.textMuted,
              fontFamily: T.sans,
              fontSize: textSize("micro"),
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {value ? "On" : "Off"}
          </span>
          <CompactSwitch
            checked={Boolean(value)}
            disabled={disabled}
            ariaLabel={field.label}
            testId={`algo-compact-toggle-${field.compactId}`}
            onChange={(nextValue) => onPatch(field.path, nextValue)}
          />
        </span>
      ) : (
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: sp(2),
            minWidth: 0,
          }}
        >
          <CompactFieldInput
            id={id}
            field={field}
            value={value}
            invalid={invalid}
            disabled={disabled}
            ariaLabel={field.label}
            testId={`algo-compact-input-${field.compactId}`}
            onPatch={onPatch}
          />
          {unitLabel ? (
            <span
              aria-hidden="true"
              style={{
                color: invalid ? T.red : T.textMuted,
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
      )}
      {invalid ? (
        <span
          style={{
            color: T.red,
            fontFamily: T.sans,
            fontSize: textSize("micro"),
          }}
        >
          {field.min}-{field.max}
        </span>
      ) : null}
    </label>
  );
};

const CompactCompoundSettingCell = ({
  item,
  profileDraft,
  profileBaseline,
  strategySettingsDraft,
  strategyBaseline,
  patchProfileDraftPath,
  patchStrategySettingsPath,
  disabled,
  dirtyFieldKeys,
}) => {
  const id = useId().replace(/:/g, "");
  const { toggleField, valueField } = item;
  const toggleDraftRoot = getDraftRoot({
    field: toggleField,
    profileDraft,
    strategySettingsDraft,
  });
  const toggleBaselineRoot = getBaselineRoot({
    field: toggleField,
    profileBaseline,
    strategyBaseline,
  });
  const valueDraftRoot = getDraftRoot({
    field: valueField,
    profileDraft,
    strategySettingsDraft,
  });
  const valueBaselineRoot = getBaselineRoot({
    field: valueField,
    profileBaseline,
    strategyBaseline,
  });
  const toggleValue = getPathValue(toggleDraftRoot, toggleField.path);
  const previousToggleValue = getPathValue(toggleBaselineRoot, toggleField.path);
  const value = getPathValue(valueDraftRoot, valueField.path);
  const previousValue = getPathValue(valueBaselineRoot, valueField.path);
  const dirty =
    dirtyFieldKeys.has(fieldKey(toggleField)) ||
    dirtyFieldKeys.has(fieldKey(valueField));
  const numericValue = Number(value);
  const invalid =
    isNumericSettingType(valueField.type) &&
    (!Number.isFinite(numericValue) ||
      (valueField.min != null && numericValue < valueField.min) ||
      (valueField.max != null && numericValue > valueField.max));
  const togglePatch = getPatchHandler({
    field: toggleField,
    patchProfileDraftPath,
    patchStrategySettingsPath,
  });
  const valuePatch = getPatchHandler({
    field: valueField,
    patchProfileDraftPath,
    patchStrategySettingsPath,
  });
  const unitLabel = compactUnitLabel(valueField);

  return (
    <div
      title={[
        toggleField.label,
        formatSettingValue(toggleField, toggleValue),
        valueField.label,
        formatSettingValue(valueField, value),
        dirty
          ? `was ${formatSettingValue(toggleField, previousToggleValue)} / ${formatSettingValue(valueField, previousValue)}`
          : null,
      ]
        .filter(Boolean)
        .join(" · ")}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: sp(2),
        minHeight: dim(42),
        minWidth: 0,
        gridColumn: "span 2",
      }}
      data-testid={`algo-compact-control-${item.compactId}`}
    >
      <CompactLabel
        label={item.compactLabel}
        dirty={dirty}
        previousValue={`${formatSettingValue(toggleField, previousToggleValue)} / ${formatSettingValue(valueField, previousValue)}`}
        field={valueField}
        impact={null}
      />
      <span
        style={{
          display: "grid",
          gridTemplateColumns: "auto minmax(0, 1fr)",
          alignItems: "center",
          columnGap: sp(4),
          minWidth: 0,
        }}
      >
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: sp(3),
            minWidth: 0,
          }}
        >
          <span
            style={{
              color: T.textMuted,
              fontFamily: T.sans,
              fontSize: textSize("micro"),
              lineHeight: 1,
            }}
          >
            {toggleField.compactLabel}
          </span>
          <CompactSwitch
            checked={Boolean(toggleValue)}
            disabled={disabled}
            ariaLabel={toggleField.label}
            testId={`algo-compact-toggle-${item.compactId}`}
            onChange={(nextValue) => togglePatch(toggleField.path, nextValue)}
          />
        </span>
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: sp(2),
            minWidth: 0,
          }}
        >
          <CompactFieldInput
            id={id}
            field={valueField}
            value={value}
            invalid={invalid}
            disabled={disabled}
            ariaLabel={valueField.label}
            testId={`algo-compact-input-${item.compactId}`}
            onPatch={valuePatch}
          />
          {unitLabel ? (
            <span
              aria-hidden="true"
              style={{
                color: invalid ? T.red : T.textMuted,
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
      </span>
      {invalid ? (
        <span
          style={{
            color: T.red,
            fontFamily: T.sans,
            fontSize: textSize("micro"),
          }}
        >
          {valueField.min}-{valueField.max}
        </span>
      ) : null}
    </div>
  );
};

const ExpandedLimitsSection = ({
  disabled,
  handleApplyExpandedCapacity,
  updateProfileMutation,
}) => (
  <section style={{ minWidth: 0 }}>
    <SettingsSectionHeader label="Expanded Limits" />
    <div
      data-testid="algo-profile-capacity-banner"
      style={{
        border: `1px solid ${T.amber}35`,
        borderRadius: dim(RADII.sm),
        background: `${T.amber}0d`,
        padding: sp("8px 10px"),
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: sp(8),
        flexWrap: "wrap",
        minWidth: 0,
      }}
    >
      <span
        style={{
          color: T.textDim,
          fontFamily: T.sans,
          fontSize: textSize("body"),
        }}
      >
        {SIGNAL_OPTIONS_EXPANDED_CAPACITY.maxOpenSymbols} symbols ·{" "}
        {formatMoney(SIGNAL_OPTIONS_EXPANDED_CAPACITY.maxDailyLoss)} halt
      </span>
      <button
        type="button"
        data-testid="signal-options-expanded-capacity"
        onClick={handleApplyExpandedCapacity}
        disabled={disabled || updateProfileMutation?.isPending}
        style={{
          ...compactButtonStyle({
            disabled: disabled || updateProfileMutation?.isPending,
          }),
          border: `1px solid ${T.amber}`,
          background: T.amber,
          color: T.onAccent,
        }}
      >
        APPLY
      </button>
    </div>
  </section>
);

export const AlgoSettingsRegion = ({
  cockpit,
  signalOptionsPositions,
  profileDraft,
  profileBaseline,
  strategySettingsDraft,
  strategyBaseline,
  patchProfileDraftPath,
  patchStrategySettingsPath,
  dirtyFields,
  focusedDeployment,
  handleApplyExpandedCapacity,
  updateProfileMutation,
  updateStrategySettingsMutation,
  algoIsPhone,
  algoIsNarrow,
}) => {
  const impact = useMemo(
    () =>
      buildAlgoTuningImpact({
        cockpit,
        profile: profileDraft,
        positions: signalOptionsPositions,
      }),
    [cockpit, profileDraft, signalOptionsPositions],
  );
  const regionDirtyFields = dirtyFields.filter(
    (field) => !isCompactHaltSettingPath(field.path),
  );
  const dirtyFieldKeys = new Set(regionDirtyFields.map(fieldKey));
  const dirtyCounts = countDirtyFieldsBySection(regionDirtyFields);
  const disabled =
    !focusedDeployment ||
    updateProfileMutation?.isPending ||
    updateStrategySettingsMutation?.isPending;

  return (
    <div
      data-testid="algo-settings-region"
      style={{
        padding: sp("2px 12px 12px"),
        display: "flex",
        flexDirection: "column",
        gap: sp(5),
        minWidth: 0,
      }}
    >
      {compactRailSettingGroups.map((group, index) => {
        const dirtyCount = group.items.reduce((count, item) => {
          if (item.kind === "compound") {
            return (
              count +
              (dirtyFieldKeys.has(fieldKey(item.toggleField)) ? 1 : 0) +
              (dirtyFieldKeys.has(fieldKey(item.valueField)) ? 1 : 0)
            );
          }
          return count + (dirtyFieldKeys.has(fieldKey(item)) ? 1 : 0);
        }, 0);
        return (
          <section
            key={group.groupId}
            data-testid={`algo-compact-group-${group.groupId}`}
            style={{
              borderTop: index === 0 ? "none" : `1px solid ${T.borderLight}`,
              paddingTop: index === 0 ? 0 : sp(4),
              minWidth: 0,
            }}
          >
            <SettingsSectionHeader
              label={group.label}
              helper={dirtyCount ? `${dirtyCount} unsaved` : null}
            />
            <div
              style={{
                display: "grid",
                gridTemplateColumns: compactGridTemplateFor(group.columns, {
                  algoIsPhone,
                  algoIsNarrow,
                }),
                columnGap: sp(5),
                rowGap: sp(4),
                alignItems: "start",
                minWidth: 0,
              }}
            >
              {group.items.map((item) =>
                item.kind === "compound" ? (
                  <CompactCompoundSettingCell
                    key={item.compactId}
                    item={item}
                    profileDraft={profileDraft}
                    profileBaseline={profileBaseline}
                    strategySettingsDraft={strategySettingsDraft}
                    strategyBaseline={strategyBaseline}
                    patchProfileDraftPath={patchProfileDraftPath}
                    patchStrategySettingsPath={patchStrategySettingsPath}
                    disabled={disabled}
                    dirtyFieldKeys={dirtyFieldKeys}
                  />
                ) : (
                  <CompactSettingCell
                    key={`${item.slice}.${item.path}`}
                    item={item}
                    profileDraft={profileDraft}
                    profileBaseline={profileBaseline}
                    strategySettingsDraft={strategySettingsDraft}
                    strategyBaseline={strategyBaseline}
                    patchProfileDraftPath={patchProfileDraftPath}
                    patchStrategySettingsPath={patchStrategySettingsPath}
                    disabled={disabled}
                    dirtyFieldKeys={dirtyFieldKeys}
                    impact={impact}
                  />
                ),
              )}
            </div>
          </section>
        );
      })}

      {settingsRegionFields.map((section) => (
        <section key={section.sectionId} style={{ minWidth: 0 }}>
          <SettingsSectionHeader
            label={section.sectionLabel}
            helper={
              dirtyCounts[section.sectionLabel]
                ? `${dirtyCounts[section.sectionLabel]} unsaved`
                : null
            }
          />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: gridTemplateFor(section.columns, {
                algoIsPhone,
                algoIsNarrow,
              }),
              columnGap: sp(3),
              rowGap: sp(3),
              minWidth: 0,
            }}
          >
            {section.fields.map((field) => {
              const draft =
                field.slice === "profile" ? profileDraft : strategySettingsDraft;
              const baseline =
                field.slice === "profile" ? profileBaseline : strategyBaseline;
              const currentValue = getPathValue(draft, field.path);
              const previousValue = getPathValue(baseline, field.path);
              const dirty = regionDirtyFields.some(
                (dirtyField) =>
                  dirtyField.slice === field.slice &&
                  dirtyField.path === field.path,
              );
              return (
                <SettingsFormRow
                  key={`${field.slice}.${field.path}`}
                  field={field}
                  value={currentValue}
                  previousValue={previousValue}
                  dirty={dirty}
                  disabled={disabled}
                  impact={field.impact ? impact[field.impact] : null}
                  onPatch={
                    field.slice === "profile"
                      ? patchProfileDraftPath
                      : patchStrategySettingsPath
                  }
                />
              );
            })}
          </div>
        </section>
      ))}

      <ExpandedLimitsSection
        disabled={!focusedDeployment}
        handleApplyExpandedCapacity={handleApplyExpandedCapacity}
        updateProfileMutation={updateProfileMutation}
      />
    </div>
  );
};

export default AlgoSettingsRegion;
