import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetTaxOverviewQueryKey,
  getGetTaxProfileQueryKey,
  getGetTaxReserveQueryKey,
  getGetTaxStateRulesStatusQueryKey,
  useGetTaxProfile,
  useGetTaxReserve,
  useGetTaxStateRulesStatus,
  usePlanTaxReserve,
  useUpdateTaxProfile,
} from "@workspace/api-client-react";
import { Button } from "../../components/ui/Button.jsx";
import {
  Select,
  StatTile,
  StatusPill,
  SurfacePanel,
  TextField,
} from "../../components/platform/primitives.jsx";
import { useAuthSession } from "../../features/auth/authSession.jsx";
import { useToast } from "../../features/platform/platformContexts.jsx";
import {
  CSS_COLOR,
  FONT_WEIGHTS,
  RADII,
  T,
  cssColorMix,
  dim,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import { formatAccountMoney } from "../account/accountUtils.jsx";

const STATE_OPTIONS = [
  { value: "", label: "Not set" },
  ..."AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY"
    .split(" ")
    .map((state) => ({ value: state, label: state })),
];

const FILING_STATUS_OPTIONS = [
  { value: "single", label: "Single" },
  { value: "married_joint", label: "Married filing jointly" },
  { value: "married_separate", label: "Married filing separately" },
  { value: "head_of_household", label: "Head of household" },
];

const asRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
const asArray = (value) => (Array.isArray(value) ? value : []);

const blankNumber = (value) =>
  value == null || value === "" || Number.isNaN(Number(value))
    ? ""
    : String(Number(value));

const parseOptionalNumber = (value) => {
  if (value == null || String(value).trim() === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const normalizeDraft = (snapshot) => {
  const profile = asRecord(asRecord(snapshot).profile);
  return {
    taxYear: String(profile.taxYear || new Date().getFullYear()),
    filingStatus: String(profile.filingStatus || "single"),
    residentState: String(profile.residentState || ""),
    marginalFederalRate: blankNumber(profile.marginalFederalRate),
    marginalStateRate: blankNumber(profile.marginalStateRate),
    priorYearFederalTax: blankNumber(profile.priorYearFederalTax),
    priorYearStateTax: blankNumber(profile.priorYearStateTax),
    cpaOverrideAmount: blankNumber(profile.cpaOverrideAmount),
    annualizedIncomeEnabled: Boolean(profile.annualizedIncomeEnabled),
    brokerReserveBetaEnabled: Boolean(profile.brokerReserveBetaEnabled),
    reserveInstrumentAllowlistText: asArray(profile.reserveInstrumentAllowlist).join(", "),
  };
};

const draftToPayload = (draft) => ({
  taxYear: Number(draft.taxYear) || new Date().getFullYear(),
  filingStatus: draft.filingStatus,
  residentState: draft.residentState || null,
  marginalFederalRate: parseOptionalNumber(draft.marginalFederalRate),
  marginalStateRate: parseOptionalNumber(draft.marginalStateRate),
  priorYearFederalTax: parseOptionalNumber(draft.priorYearFederalTax),
  priorYearStateTax: parseOptionalNumber(draft.priorYearStateTax),
  cpaOverrideAmount: parseOptionalNumber(draft.cpaOverrideAmount),
  annualizedIncomeEnabled: Boolean(draft.annualizedIncomeEnabled),
  brokerReserveBetaEnabled: Boolean(draft.brokerReserveBetaEnabled),
  reserveInstrumentAllowlist: String(draft.reserveInstrumentAllowlistText || "")
    .split(",")
    .map((entry) => entry.trim().toUpperCase())
    .filter(Boolean),
});

const statusTone = (status) => {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "available" || normalized === "verified" || normalized === "ready") {
    return CSS_COLOR.green;
  }
  if (normalized === "failed_validation") {
    return CSS_COLOR.red;
  }
  return CSS_COLOR.amber;
};

const fieldGridStyle = (isSingleColumn = false) => ({
  display: "grid",
  gridTemplateColumns: isSingleColumn
    ? "minmax(0, 1fr)"
    : "repeat(auto-fit, minmax(min(100%, 190px), 1fr))",
  gap: sp(8),
});

const summaryGridStyle = (phoneColumns = 0) => ({
  display: "grid",
  gridTemplateColumns: phoneColumns
    ? `repeat(${phoneColumns}, minmax(0, 1fr))`
    : "repeat(auto-fit, minmax(min(100%, 132px), 1fr))",
  gap: 0,
  minWidth: 0,
});

function SummaryCell({ label, value, tone = CSS_COLOR.text }) {
  return (
    <StatTile
      label={label}
      value={value}
      tone={tone}
      divider
      minWidth={0}
      style={{
        minWidth: 0,
        width: "100%",
        padding: sp("5px 8px"),
        justifyContent: "flex-start",
        overflowWrap: "anywhere",
      }}
    />
  );
}

function CheckboxRow({ checked, label, detail, onChange, disabled = false }) {
  return (
    <label
      style={{
        display: "grid",
        gridTemplateColumns: "auto minmax(0, 1fr)",
        gap: sp(7),
        alignItems: "start",
        border: `1px solid ${CSS_COLOR.border}`,
        borderRadius: dim(RADII.sm),
        background: CSS_COLOR.bg0,
        padding: sp("8px 9px"),
        color: disabled ? CSS_COLOR.textMuted : CSS_COLOR.text,
        fontFamily: T.sans,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        style={{ marginTop: 2 }}
      />
      <span style={{ minWidth: 0 }}>
        <span
          style={{
            display: "block",
            fontSize: textSize("bodyStrong"),
            fontWeight: FONT_WEIGHTS.medium,
          }}
        >
          {label}
        </span>
        <span
          style={{
            display: "block",
            color: CSS_COLOR.textMuted,
            fontSize: textSize("caption"),
            marginTop: sp(2),
            lineHeight: 1.35,
          }}
        >
          {detail}
        </span>
      </span>
    </label>
  );
}

export default function TaxSettingsPanel({ enabled = true, isPhone = false }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const authSession = useAuthSession();
  const csrfHeaders = useMemo(
    () => (authSession.csrfToken ? { "x-csrf-token": authSession.csrfToken } : {}),
    [authSession.csrfToken],
  );
  const profileQuery = useGetTaxProfile({
    query: { enabled, staleTime: 30_000 },
  });
  const [draft, setDraft] = useState(() => normalizeDraft(null));
  const taxYear = Number(draft.taxYear) || new Date().getFullYear();
  const stateRulesQuery = useGetTaxStateRulesStatus(
    { taxYear },
    { query: { enabled, staleTime: 30_000 } },
  );
  const reserveQuery = useGetTaxReserve({
    query: { enabled, staleTime: 30_000 },
  });
  const updateProfileMutation = useUpdateTaxProfile({
    request: { headers: csrfHeaders },
  });
  const planReserveMutation = usePlanTaxReserve({
    request: { headers: csrfHeaders },
  });

  useEffect(() => {
    if (profileQuery.data) {
      setDraft(normalizeDraft(profileQuery.data));
    }
  }, [profileQuery.data]);

  const profileAccounts = asArray(profileQuery.data?.accounts);
  const stateSummary = asRecord(stateRulesQuery.data?.summary);
  const reserve = asRecord(reserveQuery.data);
  const reserveCapability = asRecord(reserve.capability);
  const stateReady = Boolean(stateRulesQuery.data?.ready);
  const updateDraft = (key, value) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const invalidateTaxQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getGetTaxProfileQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetTaxOverviewQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetTaxReserveQueryKey() }),
      queryClient.invalidateQueries({
        queryKey: getGetTaxStateRulesStatusQueryKey({ taxYear }),
      }),
    ]);
  };

  const saveProfile = async () => {
    if (!authSession.csrfToken) {
      toast.push({
        kind: "warn",
        title: "Auth session required",
        body: "Refresh the app session before saving tax settings.",
      });
      return;
    }
    try {
      await updateProfileMutation.mutateAsync({ data: draftToPayload(draft) });
      await invalidateTaxQueries();
      toast.push({
        kind: "success",
        title: "Tax settings saved",
        body: "Profile and reserve assumptions were updated.",
      });
    } catch (error) {
      toast.push({
        kind: "error",
        title: "Tax settings not saved",
        body: error?.message || "The server rejected the tax profile update.",
      });
    }
  };

  const saveReserveTarget = async () => {
    if (!authSession.csrfToken) {
      toast.push({
        kind: "warn",
        title: "Auth session required",
        body: "Refresh the app session before updating the tax reserve.",
      });
      return;
    }
    try {
      await planReserveMutation.mutateAsync({
        data: { targetAmount: parseOptionalNumber(draft.cpaOverrideAmount) ?? 0 },
      });
      await queryClient.invalidateQueries({ queryKey: getGetTaxReserveQueryKey() });
      toast.push({
        kind: "success",
        title: "Reserve target updated",
        body: "The virtual tax reserve target now matches the CPA override amount.",
      });
    } catch (error) {
      toast.push({
        kind: "error",
        title: "Reserve target not updated",
        body: error?.message || "The reserve plan update failed.",
      });
    }
  };

  if (profileQuery.isLoading) {
    return (
      <SurfacePanel title="Tax" subtitle="Profile, reserve, estimates">
        <div style={{ color: CSS_COLOR.textSec, fontFamily: T.sans, fontSize: textSize("caption") }}>
          Loading tax settings
        </div>
      </SurfacePanel>
    );
  }

  if (profileQuery.error) {
    return (
      <SurfacePanel title="Tax" subtitle="Profile, reserve, estimates">
        <div role="alert" style={{ color: CSS_COLOR.red, fontFamily: T.sans, fontSize: textSize("caption") }}>
          Tax settings unavailable.
        </div>
      </SurfacePanel>
    );
  }

  return (
    <div style={{ display: "grid", gap: sp(14), minWidth: 0 }}>
      <SurfacePanel
        title="Tax Profile"
        subtitle="Connected taxable accounts only"
        rightRail={<StatusPill color={stateReady ? CSS_COLOR.green : CSS_COLOR.amber}>{stateReady ? "state ready" : "state unavailable"}</StatusPill>}
        action={
          <Button
            size="sm"
            variant="primary"
            onClick={saveProfile}
            loading={updateProfileMutation.isPending}
          >
            Save Tax Profile
          </Button>
        }
      >
        <div style={{ display: "grid", gap: sp(10), minWidth: 0 }}>
          <div style={fieldGridStyle(isPhone)}>
            <TextField
              label="Tax year"
              type="number"
              value={draft.taxYear}
              onChange={(event) => updateDraft("taxYear", event.target.value)}
              inputProps={{ min: 2000, max: 2100, step: 1 }}
            />
            <Select
              label="Filing status"
              value={draft.filingStatus}
              onChange={(value) => updateDraft("filingStatus", value)}
              options={FILING_STATUS_OPTIONS}
            />
            <Select
              label="Resident state"
              value={draft.residentState}
              onChange={(value) => updateDraft("residentState", value)}
              options={STATE_OPTIONS}
            />
          </div>
          <div style={fieldGridStyle(isPhone)}>
            <TextField
              label="Federal rate"
              type="number"
              value={draft.marginalFederalRate}
              onChange={(event) => updateDraft("marginalFederalRate", event.target.value)}
              inputProps={{ min: 0, max: 1, step: 0.001 }}
            />
            <TextField
              label="State rate"
              type="number"
              value={draft.marginalStateRate}
              onChange={(event) => updateDraft("marginalStateRate", event.target.value)}
              inputProps={{ min: 0, max: 1, step: 0.001 }}
            />
            <TextField
              label="CPA override"
              type="number"
              value={draft.cpaOverrideAmount}
              onChange={(event) => updateDraft("cpaOverrideAmount", event.target.value)}
              inputProps={{ min: 0, step: 1 }}
            />
          </div>
          <div style={fieldGridStyle(isPhone)}>
            <TextField
              label="Prior federal tax"
              type="number"
              value={draft.priorYearFederalTax}
              onChange={(event) => updateDraft("priorYearFederalTax", event.target.value)}
              inputProps={{ min: 0, step: 1 }}
            />
            <TextField
              label="Prior state tax"
              type="number"
              value={draft.priorYearStateTax}
              onChange={(event) => updateDraft("priorYearStateTax", event.target.value)}
              inputProps={{ min: 0, step: 1 }}
            />
            <TextField
              label="Reserve symbols"
              value={draft.reserveInstrumentAllowlistText}
              onChange={(event) => updateDraft("reserveInstrumentAllowlistText", event.target.value)}
              placeholder="VMFXX, SPAXX"
            />
          </div>
          <div style={fieldGridStyle(isPhone)}>
            <CheckboxRow
              checked={draft.annualizedIncomeEnabled}
              label="Annualized income method"
              detail="Store the preference now; the estimator still marks visible-gains tax as not computed."
              onChange={(value) => updateDraft("annualizedIncomeEnabled", value)}
            />
            <CheckboxRow
              checked={draft.brokerReserveBetaEnabled}
              label="Broker reserve beta"
              detail="Keep broker purchases gated by capability checks and explicit confirmation."
              onChange={(value) => updateDraft("brokerReserveBetaEnabled", value)}
            />
          </div>
        </div>
      </SurfacePanel>

      <SurfacePanel
        title="State Rule Packs"
        subtitle="Fail-closed until every jurisdiction is source verified"
        rightRail={<StatusPill color={stateReady ? CSS_COLOR.green : CSS_COLOR.amber}>{stateReady ? "verified" : "unavailable"}</StatusPill>}
      >
        <div style={{ display: "grid", gap: sp(8), minWidth: 0 }}>
          <div
            data-preserve-mobile-layout
            style={summaryGridStyle(isPhone ? 2 : 0)}
          >
            <SummaryCell label="Available" value={stateSummary.available ?? 0} tone={CSS_COLOR.green} />
            <SummaryCell label="Stale" value={stateSummary.stale ?? 0} tone={CSS_COLOR.amber} />
            <SummaryCell label="Unavailable" value={stateSummary.unavailable ?? 0} tone={CSS_COLOR.amber} />
            <SummaryCell label="Failed" value={stateSummary.failed_validation ?? 0} tone={CSS_COLOR.red} />
          </div>
          <div
            style={{
              color: CSS_COLOR.textSec,
              fontFamily: T.sans,
              fontSize: textSize("caption"),
              lineHeight: 1.4,
            }}
          >
            State estimates stay unavailable until the backend has verified rule packs for all 50 states plus DC.
          </div>
        </div>
      </SurfacePanel>

      <SurfacePanel
        title="Tax Reserve"
        subtitle="Virtual tracking now, broker purchase beta later"
        rightRail={<StatusPill color={statusTone(reserveCapability.reason)}>{reserveCapability.supportsBrokerReserve ? "broker capable" : "virtual"}</StatusPill>}
        action={
          <Button
            size="sm"
            variant="secondary"
            onClick={saveReserveTarget}
            loading={planReserveMutation.isPending}
          >
            Match Override
          </Button>
        }
      >
        <div style={{ display: "grid", gap: sp(9), minWidth: 0 }}>
          <div
            data-preserve-mobile-layout
            style={summaryGridStyle(isPhone ? 3 : 0)}
          >
            <SummaryCell
              label="Target"
              value={formatAccountMoney(reserve.targetAmount || 0, reserve.currency || "USD")}
            />
            <SummaryCell
              label="Reserved"
              value={formatAccountMoney(reserve.reservedAmount || 0, reserve.currency || "USD")}
            />
            <SummaryCell
              label="Coverage"
              value={`${Math.round((Number(reserve.coverageRatio) || 0) * 100)}%`}
              tone={(Number(reserve.coverageRatio) || 0) >= 1 ? CSS_COLOR.green : CSS_COLOR.amber}
            />
          </div>
          <div
            style={{
              border: `1px solid ${cssColorMix(CSS_COLOR.amber, 28)}`,
              borderRadius: dim(RADII.sm),
              background: cssColorMix(CSS_COLOR.amber, 7),
              color: CSS_COLOR.textSec,
              fontFamily: T.sans,
              fontSize: textSize("caption"),
              lineHeight: 1.4,
              padding: sp("8px 9px"),
            }}
          >
            Broker money-market purchases are disabled until account capabilities, settlement rules,
            instrument allowlists, and explicit user confirmation are all verified.
          </div>
        </div>
      </SurfacePanel>

      <SurfacePanel title="Coverage" subtitle="Tax profile account scope">
        <div
          data-preserve-mobile-layout
          style={summaryGridStyle(isPhone ? 3 : 0)}
        >
          <SummaryCell label="Connected accounts" value={profileAccounts.length} />
          <SummaryCell
            label="Included"
            value={profileAccounts.filter((account) => account.included).length}
            tone={CSS_COLOR.green}
          />
          <SummaryCell label="External accounts" value="Not modeled" tone={CSS_COLOR.amber} />
        </div>
      </SurfacePanel>
    </div>
  );
}
