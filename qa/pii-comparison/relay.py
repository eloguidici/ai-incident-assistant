"""Temporary QA TCP relay: loopback publication to the isolated internal service."""

import selectors
import socket
import socketserver


class Relay(socketserver.BaseRequestHandler):
    """Forward bytes only to the fixed local service, without access/content logging."""

    def handle(self) -> None:
        """Relay one connection in memory; close sockets on transport failures/timeouts."""
        try:
            with socket.create_connection(("pii-t22-service", 8000), timeout=5) as upstream:
                upstream.settimeout(180)
                self.request.settimeout(180)
                with selectors.DefaultSelector() as selector:
                    selector.register(self.request, selectors.EVENT_READ, upstream)
                    selector.register(upstream, selectors.EVENT_READ, self.request)
                    while True:
                        ready = selector.select(timeout=180)
                        if not ready:
                            return
                        for key, _ in ready:
                            chunk = key.fileobj.recv(65536)
                            if not chunk:
                                return
                            key.data.sendall(chunk)
        except OSError:
            return


class Server(socketserver.ThreadingTCPServer):
    """Non-model QA forwarding process, not part of production Compose."""

    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    with Server(("0.0.0.0", 8000), Relay) as server:
        server.serve_forever()
