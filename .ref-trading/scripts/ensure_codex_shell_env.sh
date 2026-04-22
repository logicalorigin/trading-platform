#!/usr/bin/env bash

set -euo pipefail

bash_env_path="${HOME}/.bash_env"
profile_path="${HOME}/.profile"

upsert_block() {
  local file_path="$1"
  local start_marker="$2"
  local end_marker="$3"
  local block_body="$4"
  local tmp_file
  tmp_file="$(mktemp)"

  if [[ -f "${file_path}" ]]; then
    awk -v start="${start_marker}" -v end="${end_marker}" '
      $0 == start { skip = 1; next }
      $0 == end { skip = 0; next }
      !skip { print }
    ' "${file_path}" > "${tmp_file}"
  fi

  if [[ -s "${tmp_file}" ]]; then
    printf "\n" >> "${tmp_file}"
  fi

  cat >> "${tmp_file}" <<EOF
${start_marker}
${block_body}
${end_marker}
EOF

  mv "${tmp_file}" "${file_path}"
}

upsert_block \
  "${bash_env_path}" \
  "# >>> codex shell snapshot extglob >>>" \
  "# <<< codex shell snapshot extglob <<<" \
  "# Required so clean bash shells used by Codex can parse bash-completion
# functions that rely on extglob patterns.
shopt -s extglob"

upsert_block \
  "${profile_path}" \
  "# >>> codex shell snapshot env >>>" \
  "# <<< codex shell snapshot env <<<" \
  "export BASH_ENV=\"\$HOME/.bash_env\""
