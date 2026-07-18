# IBKR session capsule

This directory defines the capacity-one IBKR capsule consumed by
`@workspace/ibkr-session-host`. It packages IBKR Client Portal Gateway (CPG),
Java 17, Chromium, Xvfb, x11vnc, and noVNC/websockify. Leased capsules run the
Python PID 1 as root with narrowly bounded setup capabilities. PID 1 installs
the fail-closed egress policy, irreversibly drops its setup capabilities, then
starts the existing Bash workload supervisor as UID/GID 10001 in a separate
process group. The workload exposes no network control API, and neither process
persists credentials. The root supervisor exposes one authenticated lease
listener only on the private capsule bridge; Docker never publishes or relays
that port.

## Immutable inputs

- Base: official `debian:bookworm-slim`, Linux/amd64 manifest
  `sha256:1def178129dfb5f24db43afbf2fcac04530012e3264ba4ff81c71184e17a9ee4`.
  The official registry returned OCI index
  `sha256:60eac759739651111db372c07be67863818726f754804b8707c90979bda511df`
  and image config creation time `2026-06-23T00:00:00Z`.
- Java: Debian `openjdk-17-jre-headless=17.0.19+10-1~deb12u2`.
- Chromium: Debian `chromium=150.0.7871.100-1~deb12u1`, matching
  `chromium-common=150.0.7871.100-1~deb12u1`, and
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
- CPG TLS: the stock listener remains enabled. The bundled certificate has
  SHA-256 `13daf89a0712b962c3ecaa5ede344100aee0d3b5dec5a79abd7602a812eda3be`
  and SPKI SHA-256 `QoH2+wIocE83ZkR4/oyn5ru2JtE+/ZrYS9brNjujldU=`. Its 2019 validity window
  has expired, so Chromium bypasses certificate errors only for that exact
  public key; the API relay accepts only that exact certificate. No global TLS
  verification bypass is used.

The CPG digest is our independently reproduced checksum of bytes delivered by
IBKR's official URL; it is **not an IBKR-published checksum**. Both Docker's
remote `ADD --checksum` and `sha256sum --check` fail the build if those bytes
change.

Primary sources:

- IBKR download/run instructions:
  https://www.interactivebrokers.com/campus/ibkr-api-page/cpapi-v1/#download-and-run
- Docker image digest pinning:
  https://docs.docker.com/build/building/best-practices/#pin-base-image-versions
- Docker port-publishing and pre-28 localhost caveat:
  https://docs.docker.com/engine/network/port-publishing/
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
- Chromium's supported GPU, renderer-limit, crash-reporting, and feature
  switches:
  https://chromium.googlesource.com/chromium/src/+/main/content/public/common/content_switches.cc,
  https://chromium.googlesource.com/chromium/src/+/main/base/base_switches.h,
  and
  https://chromium.googlesource.com/chromium/src/+/main/components/optimization_guide/core/optimization_guide_features.cc
- Java 17's serial collector guidance:
  https://docs.oracle.com/en/java/javase/17/docs/specs/man/java.html

## Runtime contract

The session host supplies a read-only root filesystem, no-new-privileges,
bounded memory/PIDs/CPU, and tmpfs at `/run/pyrus` and `/tmp`. Leased PID 1
starts with exactly `KILL`, `NET_ADMIN`, `SETGID`, `SETPCAP`, and `SETUID`.
Before starting the workload it installs the nftables policy and reduces its
inheritable, permitted, effective, bounding, and ambient capability sets to
only `KILL`, `SETGID`, and `SETUID`. The workload runs as UID/GID `10001` with
no supplemental groups or effective capabilities. Browser state and CPG logs
therefore remain in RAM. The host loads the pinned Moby-derived Chromium
seccomp profile described above. The image declares no `VOLUME` or `EXPOSE`
instruction.

The nftables output chain defaults to drop. It permits loopback and
established replies, drops every IPv6 packet, rejects non-global/private/link-
local/metadata/test/multicast IPv4 destinations, and permits new traffic only
to public IPv4 TCP ports 80 and 443. Direct DNS and non-web ports are denied.
UID 10001 is explicitly blocked from opening the root supervisor's lease port,
including through loopback.
The Docker bridge separately requires `EnableIPv6=false`. Failure to install
the policy or shed `NET_ADMIN`/`SETPCAP` aborts before the workload starts.

Leased capsules configure all five
`PYRUS_IBKR_CAPSULE_LEASE_{VERSION,BOOT_ID,FENCE_HASH,CONTROL_ATTEMPT_ID,GRANT_NOT_AFTER_NS}`
environment values. PID 1 sets `PR_SET_DUMPABLE=0` before parsing them and
fails closed if that hardening or the initial grant fails. Grants use the
session host's suspend-aware Linux `CLOCK_BOOTTIME` nanoseconds and expire 120
seconds after the grant-not-after value, not 120 seconds after receipt. The
session host mints each 20-second grant only after authenticating the API's
control attempt; the API never substitutes its own kernel clock. A different
attempt with the same horizon is accepted without extending the deadline, and
an exact replay is idempotent. Older horizons, a changed replay, late,
wrong-boot, wrong-fence, or post-expiry grants cannot revive a capsule.

Renewal uses a fixed TCP listener at port `17000` on the private Docker bridge.
The session host generates a random 256-bit key for each leased capsule and
passes it only to root PID 1. Every strict fixed JSON grant is framed with
HMAC-SHA-256, compared in constant time, and acknowledged with only
`PYRUS_IBKR_CAPSULE_LEASE_GRANTED_V1`. PID 1 removes the key before spawning
the workload. Docker publishes no port, the host relay does not route this
listener, bridge inter-container communication is disabled, and the nftables
policy blocks UID 10001 from connecting to it. This avoids `docker exec`,
which Replit's runc cannot perform after PID 1 becomes non-dumpable. Root PID 1
cannot be signaled or frozen by the UID/GID `10001` workload. At the exact
boot-time lease deadline PID 1 terminates the workload process group and exits
successfully. Images started with none of the lease grant variables and no
control key retain the legacy nonroot workload behavior; partial lease
configuration fails closed.

PID 1 also passes the Bash workload one inherited marker descriptor
through `PYRUS_IBKR_CAPSULE_MARKER_FD`. This preserves the fixed readiness and
login markers without reopening PID 1's `/proc` descriptors after
`PR_SET_DUMPABLE=0`; PID 1 closes its duplicate immediately after spawning the
workload. Startup failure and critical-child exit reporting likewise use only
fixed, bounded stage/name/status markers. Service-log content is never copied
to Docker output.

Chromium opens CPG's loopback login page directly and does not load the bundled
`paper-only-extension`; that legacy asset remains dormant in the immutable
image. The current application policy allows any IBKR account to authenticate
and applies account capabilities after the session is verified. The one-CPU
capsule uses Java's serial collector and bounds Chromium to one renderer while
disabling GPU acceleration, crash reporting, and unrelated optimization/on-
device-model services. These controls retain the Chromium sandbox and the
interactive CPG/noVNC login path; never replace them with `--single-process`,
`--no-sandbox`, or disabled site isolation.

CPG admits only `127.0.0.1`; X11 disables TCP; x11vnc binds only to loopback.
Chromium opens the stock HTTPS listener directly with the exact SPKI exception
above. The capsule exposes two fixed relay ports for the session host: `15000`
for CPG and `16080` for noVNC. The CPG relay verifies the exact bundled server
certificate before translating the host's private HTTP connection to CPG TLS.
Docker publishes no capsule ports. Instead, the trusted session-host process
binds raw TCP relays at host loopback ports `15000` and `16080` and forwards
them only to the capsule's validated private IPv4 address. Lease port `17000`
is never included in those relays.

The host requires an IPv4-only `pyrus-ibkr-capsule-net` bridge with NAT gateway
mode and inter-container communication disabled. It validates the network ID,
the capsule's sole attachment, private address, and absence of Docker port
bindings before provisioning or adopting a capsule. This blocks direct peer
access and avoids Docker Engine versions before 28.0.0 leaking localhost-
published ports to same-L2 hosts. x11vnc has no password because its RFB
listener is not directly exposed outside the capsule; it is reachable only
through the noVNC relay. The authenticated host tunnel must preserve that
boundary.

Replit's current Docker daemon cannot execute container healthchecks, so the
image intentionally declares none. An internal watchdog runs the retained
`pyrus-capsule-health` binary every 10 seconds and exits on failure, which
causes the supervisor and its critical children to exit for host recovery.
The check covers all critical processes, the X11 socket, and the expected
listener state for CPG `5000`, the CPG relay `15000`, RFB `5900`, and noVNC
relay `16080`. The entrypoint emits exactly one
nonsecret `PYRUS_IBKR_CAPSULE_READY_V1` marker after three consecutive initial
checks.
The supervised login observer follows only the stable active primary CPG log
and emits a fixed `PYRUS_IBKR_CAPSULE_LOGIN_COMPLETE_V1` marker for each exact
`GatewayHttpProxy` Client-login success. It never copies the matched log line
to Docker output. The host exposes only the marker count from a bounded
1,000-line Docker-log window; CPG authentication and account discovery still
decide whether the brokerage session is connected.
Unauthenticated/login-required CPG is healthy; brokerage authentication and
paper-account readiness remain separate host-level states.

The top-level package versions are pinned and fail closed if Debian removes
them, but their live Bookworm repositories are not an archival snapshot;
dependency resolution is therefore not fully reproducible across time.

The capsule directory's deny-by-default `.dockerignore` admits only the
reviewed Dockerfile and copied workload inputs. The clean-tree release tool at
`scripts/ibkr-capsule-release.mjs` hashes those inputs, hashes the host runtime
spec separately, publishes a single Linux/amd64 image with BuildKit provenance
and SBOM attestations, and emits an exact-digest release manifest. Registry
selection and execution of that external publish remain owner-approved
operations.

## Verification status

An exact-flags smoke test in the Replit development environment proved that
Chromium starts with its namespace sandbox under UID `10001`, dropped
capabilities, no-new-privileges, a read-only root filesystem, and the pinned
Moby-derived seccomp profile. CPG, Xvfb, x11vnc, and noVNC/websockify were also
alive under the same container contract. Never bypass a future failure with
`--no-sandbox`, `SYS_ADMIN`, or an unconfined seccomp profile.

The updated image also built locally as
`sha256:2e3ce5f057fecfa45c1747f971e334a834f4ebe15d938c429a6431c2df789ad4`.
Disposable runtime probes proved policy reapplication is idempotent, firewall
tampering is denied after capability drop, the retained supervisor capability
mask is exactly `0xe0`, public-looking IPv4 TCP 443 is allowed, public TCP 53
and private IPv4 TCP 443 are denied, and IPv6 is denied.

The later release-labeled local image
`sha256:a0a50c7bcc916c15b9414a5fc19533e57c62a1c975bb60baabe34b08e799b944`
passed the production preload contract and a real lease-v1
`CapsuleManager.ensure` boot. The ready marker arrived in 24.283 seconds and
the fenced release removed the slot container. That real Docker inspection
also established that Docker 27 expands a path-backed seccomp option to inline
JSON and omits empty `HostConfig.Mounts`; reconciliation now accepts only the
semantically exact pinned profile and treats the omitted field as empty.

The current authenticated-renewal development image
`sha256:c26b40e6e9d454b00bfd8ffdae62207647403cf1ac23b3e4b2d6643aefcb3ba9`
passed a real disposable slot-2 preflight and 60-second renewal hold on
2026-07-17. It reached the ready marker in 23.799 seconds with zero login
completions; its CPG relay returned HTTP 302 and its console returned HTTP 200.
PID 1 rejected an invalid HMAC frame, then accepted fresh host-local 20-second
lease grants over the private TCP renewal bridge. The renewed capsule remained
ready with zero restarts or OOM kills, and normal fenced release removed its
container and network without fallback. The live API, supervisor, and unrelated
slot-1 capsule were unchanged.

The same-host before/after probe observed the no-login capsule's sampled
steady-state maximum fall from 122 to 107 PIDs after the bounded Java/Chromium
controls. This development workspace's parent cgroup is capped at 1,024 tasks;
it has reached exactly 1,024 and recorded 469 limit events. With the unrelated
live slot 1 and shared development processes preserved, the post-cleanup
baseline was 572 tasks, so five additional 107-task capsules cannot fit
(`572 + 5 × 107 = 1,107`). This is observed development-host evidence, not a
Reserved VM measurement. A production density claim must include the target
VM's parent-cgroup task ceiling, baseline, peak per-capsule tasks, and reviewed
headroom.

The final staged five-new-capsule acceptance confirmed that boundary. Slots
2–5 each reached ready with zero login completions and were renewed before the
next slot started. Slot 6 began provisioning when the parent cgroup was at
1,014 of 1,024 tasks and its Docker operation failed; the task-limit event
counter increased from 469 to 545. The run therefore never reached the
five-capsule endpoint checks or two-minute hold and is a **capacity failure**,
not five-session evidence. Scoped cleanup removed every test container and
network without fallback, preserved the exact unrelated slot-1 container, and
left the same application supervisor and API health 200.

These development proofs do not establish that Docker is available inside the
selected published Replit Reserved VM. Exact image publication, target
preload, and execution of the guarded Reserved VM density runner remain
deployment gates.
