#!/usr/bin/python3
import selectors
import socket
import sys


def main() -> int:
    listen_port = int(sys.argv[1])
    target_port = int(sys.argv[2])
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind(("0.0.0.0", listen_port))
    listener.listen(64)
    while True:
        client, _address = listener.accept()
        target = socket.create_connection(("127.0.0.1", target_port))
        relay(client, target)


def relay(client: socket.socket, target: socket.socket) -> None:
    client.setblocking(False)
    target.setblocking(False)
    selector = selectors.DefaultSelector()
    selector.register(client, selectors.EVENT_READ, target)
    selector.register(target, selectors.EVENT_READ, client)
    try:
        while selector.get_map():
            for key, _events in selector.select():
                source = key.fileobj
                sink = key.data
                data = source.recv(65536)
                if not data:
                    return
                sink.sendall(data)
    finally:
        selector.close()
        client.close()
        target.close()


if __name__ == "__main__":
    raise SystemExit(main())
