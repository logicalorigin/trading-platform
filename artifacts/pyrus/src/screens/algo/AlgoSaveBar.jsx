import {
  useNumberTick,
} from "../../lib/numberTick";
import { Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/Button.jsx";
import {
  CSS_COLOR,
  RADII,
  T,
  dim,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import { formatSettingValue } from "./algoSettingsFields";

export const AlgoSaveBar = ({
  dirtyFields,
  isDirty,
  pending,
  focusedDeployment,
  onDiscard,
  onSave,
}) => {
  const [open, setOpen] = useState(false);
  const dirtyCount = dirtyFields.length;
  const tickedCount = useNumberTick(dirtyCount, 200);
  const saveDisabled = !focusedDeployment || !isDirty || pending;
  const discardDisabled = !isDirty || pending;

  const handleDiscard = () => {
    if (dirtyCount > 5 && !window.confirm(`Discard ${dirtyCount} unsaved changes?`)) {
      return;
    }
    setOpen(false);
    onDiscard();
  };

  return (
    <div
      data-testid="algo-save-bar"
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
      style={{
        position: "sticky",
        bottom: 0,
        zIndex: 20,
        padding: sp("10px 16px"),
        background: CSS_COLOR.bg1,
        borderTop: `1px solid ${CSS_COLOR.border}`,
        boxShadow: "0 -8px 16px -12px rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: sp(3),
        minWidth: 0,
      }}
    >
      <div style={{ position: "relative", minWidth: 0 }}>
        {!isDirty ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: sp(2),
              color: CSS_COLOR.textMuted,
              fontFamily: T.sans,
              fontSize: textSize("caption"),
            }}
          >
            <Check size={12} color={CSS_COLOR.green} />
            All changes saved
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: sp(2),
              border: "none",
              background: "transparent",
              color: CSS_COLOR.amber,
              fontFamily: T.sans,
              fontSize: textSize("caption"),
              cursor: "pointer",
              padding: 0,
            }}
          >
            {Math.round(tickedCount)} unsaved{" "}
            {dirtyCount === 1 ? "change" : "changes"}
            <ChevronDown size={12} />
          </button>
        )}
        {open && dirtyFields.length ? (
          <div
            role="dialog"
            aria-label="Unsaved changes"
            style={{
              position: "absolute",
              left: 0,
              bottom: "calc(100% + 10px)",
              padding: sp(3),
              background: CSS_COLOR.bg2,
              border: `1px solid ${CSS_COLOR.border}`,
              borderRadius: dim(RADII.md),
              maxHeight: dim(240),
              overflowY: "auto",
              minWidth: dim(280),
              boxShadow: "0 12px 28px rgba(0,0,0,0.35)",
              display: "grid",
              gap: sp(2),
            }}
          >
            {dirtyFields.map((field) => (
              <div
                key={`${field.slice}.${field.path}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) auto",
                  gap: sp(4),
                  alignItems: "baseline",
                  color: CSS_COLOR.textSec,
                  fontFamily: T.sans,
                  fontSize: textSize("caption"),
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {field.sectionLabel} · {field.label}
                </span>
                <span
                  style={{
                    color: CSS_COLOR.textMuted,
                    fontFamily: T.data,
                    whiteSpace: "nowrap",
                  }}
                >
                  {formatSettingValue(field, field.previousValue)} →{" "}
                  {formatSettingValue(field, field.currentValue)}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: sp(2),
          flex: "0 0 auto",
        }}
      >
        <Button
          variant="ghost"
          size="sm"
          disabled={discardDisabled}
          onClick={handleDiscard}
        >
          Discard
        </Button>
        <Button
          variant="primary"
          size="sm"
          loading={pending}
          disabled={saveDisabled}
          onClick={onSave}
          aria-keyshortcuts="Control+S Meta+S"
        >
          {pending ? "Saving..." : "Save changes"}
        </Button>
      </div>
    </div>
  );
};

export default AlgoSaveBar;
