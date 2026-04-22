#!/usr/bin/env bash
set -euo pipefail

if ! command -v nix >/dev/null 2>&1; then
  echo "nix is required for Playwright runtime dependencies in this environment." >&2
  exit 1
fi

attrs=(
  glib.out
  nss
  nspr
  atk.out
  at-spi2-atk
  dbus.lib
  at-spi2-core
  xorg.libX11
  xorg.libXcomposite
  xorg.libXdamage
  xorg.libXext
  xorg.libXfixes
  xorg.libXrandr
  xorg.libxcb
  libxkbcommon
  alsa-lib
  libgbm
)

libs=""
for attr in "${attrs[@]}"; do
  out_path="$(nix eval --raw --extra-experimental-features 'nix-command flakes' "nixpkgs#${attr}.outPath" 2>/dev/null || true)"
  if [[ -n "${out_path}" && -d "${out_path}/lib" ]]; then
    libs="${libs}:${out_path}/lib"
  fi
done

if [[ -z "${libs}" ]]; then
  echo "Failed to resolve runtime libraries for Playwright." >&2
  exit 1
fi

export LD_LIBRARY_PATH="${libs#:}${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"
exec "$@"
