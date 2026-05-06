#!/usr/bin/env bash

set -euo pipefail

repo_root="$(
  cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd
)"
codex_home="${CODEX_HOME:-$HOME/.codex}"
target_dir="$codex_home/skills"

source_roots=(
  "$repo_root/.local/skills"
  "$repo_root/.agents/skills"
)

mkdir -p "$target_dir"

declare -A managed_names=()
skipped_count=0

skip_skill_link() {
  local skill_dir="$1"
  local reason="$2"

  skipped_count=$((skipped_count + 1))
  printf "Skipping invalid skill %s: %s\n" "$skill_dir" "$reason" >&2
}

skill_has_frontmatter_field() {
  local skill_file="$1"
  local field_name="$2"

  awk -v field_name="$field_name" '
    /^---[[:space:]]*$/ {
      frontmatter_section += 1
      next
    }

    frontmatter_section == 1 && $0 ~ ("^" field_name ":[[:space:]]*[^[:space:]]") {
      found = 1
      exit
    }

    frontmatter_section > 1 {
      exit
    }

    END {
      exit found ? 0 : 1
    }
  ' "$skill_file"
}

skill_has_unsupported_agent_icon() {
  local skill_dir="$1"
  local agent_file="$skill_dir/agents/openai.yaml"

  [[ -f "$agent_file" ]] || return 1

  awk '
    /^[[:space:]]*icon_(small|large):/ && $0 ~ /\.\./ {
      found = 1
      exit
    }

    END {
      exit found ? 0 : 1
    }
  ' "$agent_file"
}

install_skill_link() {
  local skill_dir="$1"
  local skill_file="$skill_dir/SKILL.md"
  local skill_name
  skill_name="$(basename "$skill_dir")"

  if [[ ! -f "$skill_file" ]]; then
    skip_skill_link "$skill_dir" "missing SKILL.md"
    return
  fi

  if ! skill_has_frontmatter_field "$skill_file" "name"; then
    skip_skill_link "$skill_dir" "SKILL.md missing frontmatter name"
    return
  fi

  if ! skill_has_frontmatter_field "$skill_file" "description"; then
    skip_skill_link "$skill_dir" "SKILL.md missing frontmatter description"
    return
  fi

  if skill_has_unsupported_agent_icon "$skill_dir"; then
    skip_skill_link "$skill_dir" "agents/openai.yaml icon path contains '..'"
    return
  fi

  managed_names["$skill_name"]=1
  ln -sfn "$skill_dir" "$target_dir/$skill_name"
}

for source_root in "${source_roots[@]}"; do
  if [[ ! -d "$source_root" ]]; then
    continue
  fi

  while IFS= read -r -d '' skill_dir; do
    install_skill_link "$skill_dir"
  done < <(find "$source_root" -mindepth 1 -maxdepth 1 -type d -print0 | sort -z)
done

while IFS= read -r -d '' installed_path; do
  installed_name="$(basename "$installed_path")"

  if [[ "$installed_name" == ".system" || -n "${managed_names[$installed_name]:-}" ]]; then
    continue
  fi

  if [[ ! -L "$installed_path" ]]; then
    continue
  fi

  resolved_target="$(readlink -f "$installed_path" 2>/dev/null || true)"
  case "$resolved_target" in
    "$repo_root/.local/skills/"*|"$repo_root/.agents/skills/"*)
      rm "$installed_path"
      ;;
  esac
done < <(find "$target_dir" -mindepth 1 -maxdepth 1 -print0 | sort -z)

printf "Synced %s repo-managed skills into %s\n" "${#managed_names[@]}" "$target_dir"
if ((skipped_count > 0)); then
  printf "Skipped %s invalid repo-managed skills\n" "$skipped_count" >&2
fi
