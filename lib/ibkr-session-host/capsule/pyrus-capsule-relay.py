#!/usr/bin/python3
import selectors
import socket
import sys
import threading

MAX_CONNECTIONS = 64
SOCKET_TIMEOUT_SECONDS = 90


def main() -> int:
    listen_port = int(sys.argv[1])
    target_port = int(sys.argv[2])
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
            args=(client, target_port, slots),
            daemon=True,
        ).start()


def relay(
    client: socket.socket,
    target_port: int,
    slots: threading.BoundedSemaphore,
) -> None:
    target = None
    selector = selectors.DefaultSelector()
    try:
        target = socket.create_connection(
            ("127.0.0.1", target_port),
            timeout=10,
        )
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
