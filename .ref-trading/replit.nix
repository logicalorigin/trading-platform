{ pkgs ? import <nixpkgs> {} }:
let
  playwrightRuntimeDeps = [
    pkgs.glib
    pkgs.nspr
    pkgs.nss
    pkgs.atk
    pkgs.at-spi2-atk
    pkgs.dbus
    pkgs.libxkbcommon
    pkgs.cairo
    pkgs.pango
    pkgs.alsa-lib
    pkgs.cups
    pkgs.libdrm
    pkgs.gtk3
    pkgs.xorg.libxcb
    pkgs.xorg.libX11
    pkgs.xorg.libXcomposite
    pkgs.xorg.libXdamage
    pkgs.xorg.libXext
    pkgs.xorg.libXfixes
    pkgs.xorg.libXrandr
    pkgs.xorg.libxshmfence
    pkgs.libgbm
    pkgs.systemd
    pkgs.expat
  ];
in {
  deps = playwrightRuntimeDeps ++ [
    pkgs.python3
  ];
  env = {
    LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath playwrightRuntimeDeps;
  };
}
