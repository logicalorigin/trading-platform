#!/usr/bin/python3
import hashlib
import hmac
import selectors
import socket
import ssl
import sys
import threading

MAX_CONNECTIONS = 64
SOCKET_TIMEOUT_SECONDS = 90


def main() -> int:
    listen_port = int(sys.argv[1])
    target_port = int(sys.argv[2])
    target_cert_sha256 = None
    tls_context = None
    if len(sys.argv) == 4:
        target_cert_sha256 = bytes.fromhex(sys.argv[3])
        if len(target_cert_sha256) != 32:
            return 2
        # ponytail: the exact bundled CPG certificate pin scopes the local TLS
        # exception; rotate it with the already-pinned CPG artifact.
        tls_context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        tls_context.check_hostname = False
        tls_context.verify_mode = ssl.CERT_NONE
    elif len(sys.argv) != 3:
        return 2
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind(("0.0.0.0", listen_port))
    listener.listen(64)
    slots = threading.BoundedSemaphore(MAX_CONNECTIONS)
    while True:
        client, _address = listener.accept()
        if not slots.acquire(blocking=False):
            client.close()
            continue
        threading.Thread(
            target=relay,
            args=(client, target_port, slots, tls_context, target_cert_sha256),
            daemon=True,
        ).start()


def relay(
    client: socket.socket,
    target_port: int,
    slots: threading.BoundedSemaphore,
    tls_context: ssl.SSLContext | None,
    target_cert_sha256: bytes | None,
) -> None:
    target = None
    selector = selectors.DefaultSelector()
    try:
        target = socket.create_connection(
            ("127.0.0.1", target_port),
            timeout=10,
        )
        if tls_context is not None and target_cert_sha256 is not None:
            target = tls_context.wrap_socket(target, server_hostname="localhost")
            certificate = target.getpeercert(binary_form=True)
            if not hmac.compare_digest(
                hashlib.sha256(certificate).digest(),
                target_cert_sha256,
            ):
                return
        client.settimeout(SOCKET_TIMEOUT_SECONDS)
        target.settimeout(SOCKET_TIMEOUT_SECONDS)
        selector.register(client, selectors.EVENT_READ, target)
        selector.register(target, selectors.EVENT_READ, client)
        while selector.get_map():
            events = selector.select(SOCKET_TIMEOUT_SECONDS)
            if not events:
                return
            for key, _events in events:
                source = key.fileobj
                sink = key.data
                data = source.recv(65536)
                if not data:
                    return
                sink.sendall(data)
    except OSError:
        return
    finally:
        selector.close()
        client.close()
        if target is not None:
            target.close()
        slots.release()


if __name__ == "__main__":
    raise SystemExit(main())
