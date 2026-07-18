#!/usr/bin/python3
import ctypes
import hashlib
import hmac
import ipaddress
import json
import os
import re
import signal
import socket
import subprocess
import time
from typing import NamedTuple

ACK = b"PYRUS_IBKR_CAPSULE_LEASE_GRANTED_V1\n"
LEASE_DURATION_NS = 120_000_000_000
MAX_MONOTONIC_NS = (1 << 63) - 1
MAX_GRANT_NOT_AFTER_NS = MAX_MONOTONIC_NS - LEASE_DURATION_NS
MAX_MESSAGE_BYTES = 1024
NFT_BINARY = "/usr/sbin/nft"
PR_SET_DUMPABLE = 4
PR_CAPBSET_DROP = 24
PR_CAP_AMBIENT = 47
PR_CAP_AMBIENT_CLEAR_ALL = 4
TERMINATION_GRACE_SECONDS = 10
KILL_REAP_SECONDS = 5
LEASE_CONTROL_ADDRESS = "0.0.0.0"
LEASE_CONTROL_PORT = 17000
LEASE_CONTROL_KEY_ENV = "PYRUS_IBKR_CAPSULE_LEASE_CONTROL_KEY"
WORKLOAD = "/usr/local/bin/pyrus-capsule-entrypoint"
BOOT_ID_PATH = "/proc/sys/kernel/random/boot_id"
MARKER_FD_ENV = "PYRUS_IBKR_CAPSULE_MARKER_FD"
WORKLOAD_UID = 10001
WORKLOAD_GID = 10001
CAP_KILL = 5
CAP_SETGID = 6
CAP_SETUID = 7
CAP_SETPCAP = 8
CAP_NET_ADMIN = 12
CAPABILITY_VERSION_3 = 0x20080522
RETAINED_CAPABILITIES = frozenset((CAP_KILL, CAP_SETGID, CAP_SETUID))
ALLOWED_EGRESS_TCP_PORTS = frozenset((80, 443))
BLOCKED_IPV4_NETWORKS = tuple(
    ipaddress.ip_network(network)
    for network in (
        "0.0.0.0/8",
        "10.0.0.0/8",
        "100.64.0.0/10",
        "127.0.0.0/8",
        "169.254.0.0/16",
        "172.16.0.0/12",
        "192.0.0.0/24",
        "192.0.2.0/24",
        "192.31.196.0/24",
        "192.52.193.0/24",
        "192.88.99.0/24",
        "192.168.0.0/16",
        "192.175.48.0/24",
        "198.18.0.0/15",
        "198.51.100.0/24",
        "203.0.113.0/24",
        "224.0.0.0/4",
        "240.0.0.0/4",
    )
)

UUID_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-"
    r"[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)
FENCE_HASH_PATTERN = re.compile(r"^[0-9a-f]{24}$")
GRANT_NOT_AFTER_PATTERN = re.compile(r"^[1-9][0-9]{0,19}$")
CONTROL_KEY_PATTERN = re.compile(r"^[a-f0-9]{64}$")
GRANT_KEYS = {
    "version",
    "bootId",
    "fenceHash",
    "controlAttemptId",
    "grantNotAfterNs",
}
LEASE_ENV = {
    "version": "PYRUS_IBKR_CAPSULE_LEASE_VERSION",
    "bootId": "PYRUS_IBKR_CAPSULE_LEASE_BOOT_ID",
    "fenceHash": "PYRUS_IBKR_CAPSULE_LEASE_FENCE_HASH",
    "controlAttemptId": "PYRUS_IBKR_CAPSULE_LEASE_CONTROL_ATTEMPT_ID",
    "grantNotAfterNs": "PYRUS_IBKR_CAPSULE_LEASE_GRANT_NOT_AFTER_NS",
}


class GrantRejected(ValueError):
    pass


class _CapabilityHeader(ctypes.Structure):
    _fields_ = [
        ("version", ctypes.c_uint32),
        ("pid", ctypes.c_int),
    ]


class _CapabilityData(ctypes.Structure):
    _fields_ = [
        ("effective", ctypes.c_uint32),
        ("permitted", ctypes.c_uint32),
        ("inheritable", ctypes.c_uint32),
    ]


def egress_destination_allowed(
    address: str,
    port: int,
    protocol: str,
) -> bool:
    if (
        protocol != "tcp"
        or type(port) is not int
        or port not in ALLOWED_EGRESS_TCP_PORTS
    ):
        return False
    try:
        destination = ipaddress.ip_address(address)
    except ValueError:
        return False
    return isinstance(destination, ipaddress.IPv4Address) and not any(
        destination in network for network in BLOCKED_IPV4_NETWORKS
    )


def egress_ruleset() -> str:
    blocked_networks = ", ".join(
        str(network) for network in BLOCKED_IPV4_NETWORKS
    )
    return f"""add table inet pyrus_egress
flush table inet pyrus_egress
add set inet pyrus_egress blocked_ipv4 {{ type ipv4_addr; flags interval; elements = {{ {blocked_networks} }}; }}
add chain inet pyrus_egress output {{ type filter hook output priority 0; policy drop; }}
add rule inet pyrus_egress output meta nfproto ipv6 drop
add rule inet pyrus_egress output meta skuid {WORKLOAD_UID} tcp dport {LEASE_CONTROL_PORT} drop
add rule inet pyrus_egress output oifname "lo" accept
add rule inet pyrus_egress output ct state established,related accept
add rule inet pyrus_egress output ip daddr @blocked_ipv4 drop
add rule inet pyrus_egress output meta nfproto ipv4 tcp dport {{ 80, 443 }} accept
"""


def install_egress_firewall() -> None:
    if os.geteuid() != 0:
        raise GrantRejected("capsule firewall setup requires root")
    ruleset = egress_ruleset()
    for arguments in (("--check", "--file", "-"), ("--file", "-")):
        result = subprocess.run(
            [NFT_BINARY, *arguments],
            input=ruleset,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
            timeout=5,
            check=False,
        )
        if result.returncode != 0:
            raise OSError("capsule egress policy installation failed")


def _raise_errno() -> None:
    error = ctypes.get_errno()
    raise OSError(error, os.strerror(error))


def _prctl(
    libc: ctypes.CDLL,
    operation: int,
    argument: int = 0,
) -> None:
    prctl = libc.prctl
    prctl.argtypes = [
        ctypes.c_int,
        ctypes.c_ulong,
        ctypes.c_ulong,
        ctypes.c_ulong,
        ctypes.c_ulong,
    ]
    prctl.restype = ctypes.c_int
    if prctl(operation, argument, 0, 0, 0) != 0:
        _raise_errno()


def _capability_mask(capabilities: frozenset[int]) -> int:
    return sum(1 << capability for capability in capabilities)


def _read_capability_status() -> dict[str, int]:
    status: dict[str, int] = {}
    with open("/proc/self/status", encoding="ascii") as status_file:
        for line in status_file:
            name, separator, raw_value = line.partition(":")
            if separator and name in {
                "CapInh",
                "CapPrm",
                "CapEff",
                "CapBnd",
                "CapAmb",
            }:
                status[name] = int(raw_value.strip(), 16)
    if len(status) != 5:
        raise OSError("capability status unavailable")
    return status


def drop_setup_capabilities() -> None:
    if os.geteuid() != 0:
        raise GrantRejected("capsule capability setup requires root")
    with open(
        "/proc/sys/kernel/cap_last_cap",
        encoding="ascii",
    ) as cap_last_cap_file:
        cap_last_cap = int(cap_last_cap_file.read().strip())
    if cap_last_cap < CAP_NET_ADMIN or cap_last_cap > 63:
        raise OSError("unsupported Linux capability range")

    libc = ctypes.CDLL(None, use_errno=True)
    for capability in range(cap_last_cap + 1):
        if capability not in RETAINED_CAPABILITIES and capability != CAP_SETPCAP:
            _prctl(libc, PR_CAPBSET_DROP, capability)
    _prctl(libc, PR_CAPBSET_DROP, CAP_SETPCAP)
    _prctl(libc, PR_CAP_AMBIENT, PR_CAP_AMBIENT_CLEAR_ALL)

    retained_mask = _capability_mask(RETAINED_CAPABILITIES)
    header = _CapabilityHeader(CAPABILITY_VERSION_3, 0)
    data = (_CapabilityData * 2)()
    data[0].effective = retained_mask & 0xFFFFFFFF
    data[0].permitted = retained_mask & 0xFFFFFFFF
    data[1].effective = retained_mask >> 32
    data[1].permitted = retained_mask >> 32
    capset = libc.capset
    capset.argtypes = [
        ctypes.POINTER(_CapabilityHeader),
        ctypes.POINTER(_CapabilityData),
    ]
    capset.restype = ctypes.c_int
    if capset(ctypes.byref(header), data) != 0:
        _raise_errno()

    expected_status = {
        "CapInh": 0,
        "CapPrm": retained_mask,
        "CapEff": retained_mask,
        "CapBnd": retained_mask,
        "CapAmb": 0,
    }
    if _read_capability_status() != expected_status:
        raise OSError("capsule capabilities were not irreversibly reduced")


def boottime_ns() -> int:
    try:
        return time.clock_gettime_ns(time.CLOCK_BOOTTIME)
    except (AttributeError, OSError):
        raise GrantRejected("boot-time clock unavailable") from None


class LeaseGrant(NamedTuple):
    version: int
    boot_id: str
    fence_hash: str
    control_attempt_id: str
    grant_not_after_ns: int


def _strict_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise GrantRejected("duplicate key")
        result[key] = value
    return result


def _reject_constant(_value: str) -> None:
    raise GrantRejected("invalid constant")


def parse_grant(payload: str) -> LeaseGrant:
    try:
        value = json.loads(
            payload,
            object_pairs_hook=_strict_object,
            parse_constant=_reject_constant,
        )
    except (TypeError, ValueError):
        raise GrantRejected("invalid JSON") from None
    if not isinstance(value, dict) or set(value) != GRANT_KEYS:
        raise GrantRejected("invalid keys")
    version = value["version"]
    boot_id = value["bootId"]
    fence_hash = value["fenceHash"]
    control_attempt_id = value["controlAttemptId"]
    raw_grant_not_after_ns = value["grantNotAfterNs"]
    if type(version) is not int or version != 1:
        raise GrantRejected("invalid version")
    if not isinstance(boot_id, str) or not UUID_PATTERN.fullmatch(boot_id):
        raise GrantRejected("invalid boot ID")
    if (
        not isinstance(fence_hash, str)
        or not FENCE_HASH_PATTERN.fullmatch(fence_hash)
    ):
        raise GrantRejected("invalid fence hash")
    if (
        not isinstance(control_attempt_id, str)
        or not UUID_PATTERN.fullmatch(control_attempt_id)
    ):
        raise GrantRejected("invalid control attempt ID")
    if (
        not isinstance(raw_grant_not_after_ns, str)
        or not GRANT_NOT_AFTER_PATTERN.fullmatch(raw_grant_not_after_ns)
    ):
        raise GrantRejected("invalid grant not-after")
    grant_not_after_ns = int(raw_grant_not_after_ns)
    if grant_not_after_ns > MAX_GRANT_NOT_AFTER_NS:
        raise GrantRejected("grant not-after overflow")
    return LeaseGrant(
        version,
        boot_id,
        fence_hash,
        control_attempt_id,
        grant_not_after_ns,
    )


def parse_control_key(value: str) -> bytes:
    if not isinstance(value, str) or not CONTROL_KEY_PATTERN.fullmatch(value):
        raise GrantRejected("invalid lease control key")
    return bytes.fromhex(value)


def parse_authenticated_grant(
    frame: bytes,
    control_key: bytes,
) -> LeaseGrant:
    if (
        not isinstance(frame, bytes)
        or not isinstance(control_key, bytes)
        or len(control_key) != 32
        or len(frame) > MAX_MESSAGE_BYTES
        or not frame.endswith(b"\n")
        or b"\n" in frame[:-1]
    ):
        raise GrantRejected("invalid framing")
    encoded_mac, separator, payload = frame[:-1].partition(b" ")
    if (
        separator != b" "
        or len(encoded_mac) != 64
        or not all(character in b"0123456789abcdef" for character in encoded_mac)
    ):
        raise GrantRejected("invalid authentication")
    expected_mac = hmac.new(
        control_key,
        payload,
        hashlib.sha256,
    ).hexdigest().encode("ascii")
    if not hmac.compare_digest(encoded_mac, expected_mac):
        raise GrantRejected("invalid authentication")
    try:
        encoded = payload.decode("utf-8")
    except UnicodeDecodeError:
        raise GrantRejected("invalid encoding") from None
    return parse_grant(encoded)


class LeaseState:
    def __init__(self, boot_id: str, fence_hash: str) -> None:
        if not UUID_PATTERN.fullmatch(boot_id):
            raise GrantRejected("invalid expected boot ID")
        if not FENCE_HASH_PATTERN.fullmatch(fence_hash):
            raise GrantRejected("invalid expected fence hash")
        self.boot_id = boot_id
        self.fence_hash = fence_hash
        self.deadline_ns: int | None = None
        self.last_control_attempt_id: str | None = None
        self.last_grant_not_after_ns: int | None = None

    def apply(self, grant: LeaseGrant, now_ns: int) -> int:
        if type(now_ns) is not int or now_ns < 0 or now_ns > MAX_MONOTONIC_NS:
            raise GrantRejected("invalid current time")
        if self.deadline_ns is not None and now_ns >= self.deadline_ns:
            raise GrantRejected("lease expired")
        if now_ns >= grant.grant_not_after_ns:
            raise GrantRejected("grant expired")
        if grant.boot_id != self.boot_id or grant.fence_hash != self.fence_hash:
            raise GrantRejected("wrong capsule")
        if grant.control_attempt_id == self.last_control_attempt_id:
            if grant.grant_not_after_ns != self.last_grant_not_after_ns:
                raise GrantRejected("control attempt changed")
            assert self.deadline_ns is not None
            return self.deadline_ns
        if (
            self.last_grant_not_after_ns is not None
            and grant.grant_not_after_ns < self.last_grant_not_after_ns
        ):
            raise GrantRejected("stale grant")
        self.last_control_attempt_id = grant.control_attempt_id
        self.last_grant_not_after_ns = grant.grant_not_after_ns
        self.deadline_ns = grant.grant_not_after_ns + LEASE_DURATION_NS
        return self.deadline_ns

    def expired(self, now_ns: int) -> bool:
        return self.deadline_ns is not None and now_ns >= self.deadline_ns


def disable_dumping() -> None:
    libc = ctypes.CDLL(None, use_errno=True)
    prctl = libc.prctl
    prctl.argtypes = [
        ctypes.c_int,
        ctypes.c_ulong,
        ctypes.c_ulong,
        ctypes.c_ulong,
        ctypes.c_ulong,
    ]
    prctl.restype = ctypes.c_int
    if prctl(PR_SET_DUMPABLE, 0, 0, 0, 0) != 0:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error))


def read_boot_id() -> str:
    with open(BOOT_ID_PATH, encoding="ascii") as boot_id_file:
        boot_id = boot_id_file.read(64).strip()
    if not UUID_PATTERN.fullmatch(boot_id):
        raise GrantRejected("invalid kernel boot ID")
    return boot_id


def load_initial_state(now_ns: int) -> LeaseState | None:
    raw = {key: os.environ.get(name) for key, name in LEASE_ENV.items()}
    if all(value is None for value in raw.values()):
        return None
    if any(value is None for value in raw.values()) or raw["version"] != "1":
        raise GrantRejected("incomplete lease environment")
    grant = parse_grant(
        json.dumps(
            {
                "version": 1,
                "bootId": raw["bootId"],
                "fenceHash": raw["fenceHash"],
                "controlAttemptId": raw["controlAttemptId"],
                "grantNotAfterNs": raw["grantNotAfterNs"],
            },
            separators=(",", ":"),
        )
    )
    if grant.boot_id != read_boot_id():
        raise GrantRejected("wrong kernel boot ID")
    state = LeaseState(grant.boot_id, grant.fence_hash)
    state.apply(grant, now_ns)
    return state


def load_control_key(state: LeaseState | None) -> bytes | None:
    raw_key = os.environ.pop(LEASE_CONTROL_KEY_ENV, None)
    if state is None:
        if raw_key is not None:
            raise GrantRejected("unexpected lease control key")
        return None
    if raw_key is None:
        raise GrantRejected("missing lease control key")
    return parse_control_key(raw_key)


def open_lease_listener() -> socket.socket:
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind((LEASE_CONTROL_ADDRESS, LEASE_CONTROL_PORT))
    listener.listen(4)
    return listener


def receive_grant(
    connection: socket.socket,
    lease_deadline_ns: int,
    control_key: bytes,
) -> LeaseGrant:
    payload = bytearray()
    while True:
        now_ns = boottime_ns()
        if now_ns >= lease_deadline_ns:
            raise GrantRejected("lease expired")
        connection.settimeout(
            min(1.0, (lease_deadline_ns - now_ns) / 1_000_000_000)
        )
        chunk = connection.recv(MAX_MESSAGE_BYTES + 1 - len(payload))
        if not chunk:
            break
        payload.extend(chunk)
        if len(payload) > MAX_MESSAGE_BYTES:
            raise GrantRejected("message too large")
    return parse_authenticated_grant(bytes(payload), control_key)


def handle_lease_connection(
    connection: socket.socket,
    state: LeaseState,
    control_key: bytes,
) -> None:
    assert state.deadline_ns is not None
    grant = receive_grant(connection, state.deadline_ns, control_key)
    state.apply(grant, boottime_ns())
    connection.settimeout(1.0)
    connection.sendall(ACK)


def poll_and_reap(workload: subprocess.Popen[bytes]) -> int | None:
    status = workload.poll()
    while True:
        try:
            child = os.waitid(
                os.P_ALL,
                0,
                os.WEXITED | os.WNOHANG | os.WNOWAIT,
            )
        except ChildProcessError:
            break
        if child is None:
            break
        if child.si_pid == workload.pid:
            status = workload.poll()
        else:
            os.waitpid(child.si_pid, os.WNOHANG)
    return status if status is not None else workload.poll()


def process_group_exists(process_group_id: int) -> bool:
    try:
        os.killpg(process_group_id, 0)
        return True
    except ProcessLookupError:
        return False


def terminate_workload(workload: subprocess.Popen[bytes]) -> None:
    process_group_id = workload.pid
    if process_group_exists(process_group_id):
        try:
            os.killpg(process_group_id, signal.SIGTERM)
        except ProcessLookupError:
            pass
        stop_deadline = time.monotonic() + TERMINATION_GRACE_SECONDS
        while (
            process_group_exists(process_group_id)
            and time.monotonic() < stop_deadline
        ):
            poll_and_reap(workload)
            time.sleep(0.05)
    if process_group_exists(process_group_id):
        try:
            os.killpg(process_group_id, signal.SIGKILL)
        except ProcessLookupError:
            pass
        reap_deadline = time.monotonic() + KILL_REAP_SECONDS
        while (
            process_group_exists(process_group_id)
            and time.monotonic() < reap_deadline
        ):
            poll_and_reap(workload)
            time.sleep(0.05)
    poll_and_reap(workload)


def exit_status(returncode: int) -> int:
    return min(255, 128 - returncode) if returncode < 0 else min(255, returncode)


stop_requested = False


def request_stop(_signal_number: int, _frame: object) -> None:
    global stop_requested
    stop_requested = True


def workload_identity(effective_uid: int) -> dict[str, object]:
    if effective_uid != 0:
        raise GrantRejected("capsule supervisor must run as root")
    return {
        "user": WORKLOAD_UID,
        "group": WORKLOAD_GID,
        "extra_groups": (),
    }


def run_supervisor(
    state: LeaseState | None,
    control_key: bytes | None,
) -> int:
    if (state is None) != (control_key is None):
        raise GrantRejected("incomplete lease control state")
    listener = open_lease_listener() if state is not None else None
    workload_environment = os.environ.copy()
    for name in LEASE_ENV.values():
        workload_environment.pop(name, None)
    try:
        marker_fd = os.dup(1)
    except BaseException:
        if listener is not None:
            listener.close()
        raise
    workload_environment[MARKER_FD_ENV] = str(marker_fd)
    try:
        workload = subprocess.Popen(
            [WORKLOAD],
            env=workload_environment,
            pass_fds=(marker_fd,),
            start_new_session=True,
            **workload_identity(os.geteuid()),
        )
    except BaseException:
        if listener is not None:
            listener.close()
        raise
    finally:
        os.close(marker_fd)
    try:
        while True:
            if stop_requested:
                terminate_workload(workload)
                return 0
            returncode = poll_and_reap(workload)
            if returncode is not None:
                return exit_status(returncode)
            now_ns = boottime_ns()
            if state is not None and state.expired(now_ns):
                terminate_workload(workload)
                return 0
            if listener is None:
                time.sleep(0.2)
                continue
            assert state is not None and state.deadline_ns is not None
            listener.settimeout(
                min(0.5, (state.deadline_ns - now_ns) / 1_000_000_000)
            )
            try:
                connection, _address = listener.accept()
            except socket.timeout:
                continue
            with connection:
                try:
                    assert control_key is not None
                    handle_lease_connection(connection, state, control_key)
                except (GrantRejected, OSError):
                    pass
    finally:
        if listener is not None:
            listener.close()
        if poll_and_reap(workload) is None:
            terminate_workload(workload)


def main() -> int:
    try:
        os.umask(0o077)
        disable_dumping()
        state = load_initial_state(boottime_ns())
        control_key = load_control_key(state)
        install_egress_firewall()
        drop_setup_capabilities()
        signal.signal(signal.SIGINT, request_stop)
        signal.signal(signal.SIGTERM, request_stop)
        return run_supervisor(state, control_key)
    except Exception:
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
