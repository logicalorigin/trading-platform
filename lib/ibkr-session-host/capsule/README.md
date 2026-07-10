# IBKR paper-session capsule

This directory defines the capacity-one, paper-only capsule consumed by
`@workspace/ibkr-session-host`. It packages IBKR Client Portal Gateway (CPG),
Java 17, Chromium, Xvfb, x11vnc, and noVNC/websockify. The entrypoint is the
minimal local supervisor/agent for this slice; it does not expose a control
API or persist credentials.

## Immutable inputs

- Base: official `debian:bookworm-slim`, Linux/amd64 manifest
  `sha256:1def178129dfb5f24db43afbf2fcac04530012e3264ba4ff81c71184e17a9ee4`.
  The official registry returned OCI index
  `sha256:60eac759739651111db372c07be67863818726f754804b8707c90979bda511df`
  and image config creation time `2026-06-23T00:00:00Z`.
- Java: Debian `openjdk-17-jre-headless=17.0.19+10-1~deb12u2`.
- Chromium: Debian `chromium=150.0.7871.100-1~deb12u1` and matching
  `chromium-sandbox=150.0.7871.100-1~deb12u1`.
- Chromium seccomp: Moby `seccomp/v0.2.3` default profile
  `sha256:536529b665dd0972c37bfb569f5d4ac8a53592e7b00752bc39ff063ca9864c74`,
  with Playwright's documented `clone`, `setns`, and `unshare` allowance
  prepended. A separate `chroot` syscall allowance lets Chromium finish its
  sandbox after entering the new user namespace while the container retains
  no capabilities. The resulting `src/chromium-seccomp.json` is pinned as
  `sha256:19f1c5b65ff8280092de391959775201004f2c58eae2983612c028c6256a5b54`.
- Desktop: `xvfb=2:21.1.7-3+deb12u12`, `x11vnc=0.9.16-9`,
  `novnc=1:1.3.0-1`, and `websockify=0.10.0+dfsg1-4+b1`.
- CPG source:
  `https://download2.interactivebrokers.com/portal/clientportal.gw.zip`.
  The 10,542,956-byte official-source artifact has SHA-256
  `2f2d380b2f9424520ff5f9c11fe45e82ef39459329ac056258a3274bea6f76f9`.
  A fresh download matched the independently provisioned July 3 copy
  byte-for-byte. Its embedded JAR reports implementation version
  `20230424154245` and build time `2023-04-24T15:42:44-0400`.

The CPG digest is our independently reproduced checksum of bytes delivered by
IBKR's official URL; it is **not an IBKR-published checksum**. Both Docker's
remote `ADD --checksum` and `sha256sum --check` fail the build if those bytes
change.

Primary sources:

- IBKR download/run instructions:
  https://www.interactivebrokers.com/campus/ibkr-api-page/cpapi-v1/#download-and-run
- Docker image digest pinning:
  https://docs.docker.com/build/building/best-practices/#pin-base-image-versions
- Dockerfile remote `ADD --checksum`:
  https://docs.docker.com/reference/dockerfile/#add---checksum
- Debian package indexes used for the pinned versions:
  https://deb.debian.org/debian/dists/bookworm/main/binary-amd64/Packages.xz
  and
  https://security.debian.org/debian-security/dists/bookworm-security/main/binary-amd64/Packages.xz
- Moby default seccomp source:
  https://raw.githubusercontent.com/moby/profiles/refs/tags/seccomp/v0.2.3/seccomp/default.json
- Playwright's Chromium sandbox profile guidance:
  https://playwright.dev/docs/docker
- Chromium's sandbox description and `CAP_SYS_CHROOT` lifecycle:
  https://chromium.googlesource.com/chromium/src/+/main/sandbox/linux/README.md
  and
  https://chromium.googlesource.com/chromium/src/+/b94f6817d3a0e20ec5c3393a4eb13dd360acbd4e/sandbox/linux/services/credentials.h

## Runtime contract

The session host supplies a read-only root filesystem, UID/GID `10001`, all
capabilities dropped, no-new-privileges, bounded memory/PIDs/CPU, and tmpfs at
`/run/pyrus` and `/tmp`. Browser state and CPG logs therefore remain in RAM.
The host loads the pinned Moby-derived Chromium seccomp profile described
above. The image declares no `VOLUME` or `EXPOSE` instruction.

CPG admits only `127.0.0.1`; X11 disables TCP; x11vnc and websockify bind only
to loopback. Docker must not publish CPG, RFB, or noVNC ports. x11vnc has no
password because it is loopback-only and the current slice has no inbound
container path. A later authenticated local-agent tunnel must preserve that
boundary.

Replit's current Docker daemon cannot execute container healthchecks, so the
image intentionally declares none. An internal watchdog runs the retained
`pyrus-capsule-health` binary every 10 seconds and exits on failure, which
causes the supervisor and its critical children to exit for host recovery.
The check covers all six processes, the X11 socket, and the expected listener
state for CPG `5000`, RFB `5900`, and noVNC `6080`. The entrypoint emits exactly one
nonsecret `PYRUS_IBKR_CAPSULE_READY_V1` marker after three consecutive initial
checks.
Unauthenticated/login-required CPG is healthy; brokerage authentication and
paper-account readiness remain separate host-level states.

The top-level package versions are pinned and fail closed if Debian removes
them, but their live Bookworm repositories are not an archival snapshot;
dependency resolution is therefore not fully reproducible across time.

## Verification status

An exact-flags smoke test in the Replit development environment proved that
Chromium starts with its namespace sandbox under UID `10001`, dropped
capabilities, no-new-privileges, a read-only root filesystem, and the pinned
Moby-derived seccomp profile. CPG, Xvfb, x11vnc, and noVNC/websockify were also
alive under the same container contract. Never bypass a future failure with
`--no-sandbox`, `SYS_ADMIN`, or an unconfined seccomp profile.

This development proof does not establish that Docker is available inside a
published Replit Reserved VM. Production Docker support and egress isolation
remain separate deployment gates.
