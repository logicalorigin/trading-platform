import { Link2, Unlink } from "lucide-react";
import {
  LINKED_WORKSPACE_GROUP_IDS,
} from "./linkedWorkspaceModel";
import { T, dim, fs, sp } from "../../lib/uiTokens";
import { AppTooltip } from "@/components/ui/tooltip";

export function WorkspaceLinkChip({
  panelId,
  context,
  compact = false,
  onChangeGroup,
}) {
  const linked = Boolean(context?.linked && context?.groupId);
  const activeGroup = context?.groupId || null;
  const size = compact ? 11 : 13;
  const label = linked ? `Linked workspace ${activeGroup}` : "Unlinked";
  return (
    <div
      data-testid={`workspace-link-chip-${panelId}`}
      data-linked-workspace-group={activeGroup || "none"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: sp(compact ? 2 : 3),
        padding: sp(compact ? "1px 2px" : "2px 3px"),
        border: `1px solid ${linked ? `${T.accent}44` : T.border}`,
        background: linked ? `${T.accent}12` : T.bg3,
        borderRadius: dim(3),
        color: linked ? T.accent : T.textDim,
        fontFamily: T.mono,
        fontSize: fs(compact ? 8 : 9),
        fontWeight: 900,
        whiteSpace: "nowrap",
      }}
    >
      <AppTooltip content={label}>
        <span
          aria-label={label}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: dim(compact ? 14 : 16),
            height: dim(compact ? 14 : 16),
          }}
        >
          {linked ? <Link2 size={size} /> : <Unlink size={size} />}
        </span>
      </AppTooltip>
      {LINKED_WORKSPACE_GROUP_IDS.map((groupId) => (
        <AppTooltip key={groupId} content={`Link ${panelId} to group ${groupId}`}>
          <button
            type="button"
            data-testid={`workspace-link-chip-${panelId}-${groupId}`}
            aria-pressed={activeGroup === groupId}
            onClick={() => onChangeGroup?.(panelId, groupId)}
            style={{
              minWidth: dim(compact ? 16 : 18),
              height: dim(compact ? 16 : 18),
              padding: sp("0 4px"),
              border: `1px solid ${activeGroup === groupId ? T.accent : "transparent"}`,
              background: activeGroup === groupId ? T.accent : "transparent",
              color: activeGroup === groupId ? "#fff" : T.textDim,
              borderRadius: dim(2),
              fontFamily: T.mono,
              fontSize: fs(compact ? 8 : 9),
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            {groupId}
          </button>
        </AppTooltip>
      ))}
      <AppTooltip content={`Unlink ${panelId}`}>
        <button
          type="button"
          data-testid={`workspace-link-chip-${panelId}-unlink`}
          aria-pressed={!linked}
          onClick={() => onChangeGroup?.(panelId, null)}
          style={{
            width: dim(compact ? 16 : 18),
            height: dim(compact ? 16 : 18),
            border: `1px solid ${!linked ? T.textDim : "transparent"}`,
            background: !linked ? `${T.textDim}22` : "transparent",
            color: !linked ? T.textSec : T.textDim,
            borderRadius: dim(2),
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          <Unlink size={size} />
        </button>
      </AppTooltip>
    </div>
  );
}
