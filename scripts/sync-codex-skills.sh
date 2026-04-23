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

install_skill_link() {
  local skill_dir="$1"
  local skill_name
  skill_name="$(basename "$skill_dir")"

  if [[ ! -f "$skill_dir/SKILL.md" ]]; then
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
