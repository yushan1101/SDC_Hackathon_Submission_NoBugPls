"""A local stand-in for Cloudflare R2 (S3 API) for end-to-end tests: PUT / GET / DELETE objects in memory, and every
request must carry a valid AWS SigV4 signature for the test key, exactly as R2 checks it. GET /_keys lists what is
stored, so a test can see that an old photo was really deleted.

Run alone for a browser test:  python tests/r2_stub.py 9911   (access key "test-key", secret "test-secret")"""
import hashlib
import hmac
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import quote, unquote

ACCESS, SECRET = "test-key", "test-secret"


def _sign(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()


class Handler(BaseHTTPRequestHandler):
    store: dict = {}

    def log_message(self, *a):  # quiet
        pass

    def _send(self, code: int, body: bytes = b"", ctype: str = "application/xml"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _valid(self, body: bytes) -> bool:
        auth, amz = self.headers.get("Authorization", ""), self.headers.get("x-amz-date", "")
        payload = self.headers.get("x-amz-content-sha256", "")
        if payload != hashlib.sha256(body).hexdigest() or not auth.startswith(f"AWS4-HMAC-SHA256 Credential={ACCESS}/"):
            return False
        fields = dict(p.strip().split("=", 1) for p in auth.split(" ", 1)[1].split(","))
        scope = fields["Credential"].split("/", 1)[1]
        day = scope.split("/")[0]
        signed = fields["SignedHeaders"]
        headers = "".join(f"{h}:{self.headers.get(h, '').strip()}\n" for h in signed.split(";"))
        canonical = f"{self.command}\n{quote(unquote(self.path))}\n\n{headers}\n{signed}\n{payload}"
        to_sign = f"AWS4-HMAC-SHA256\n{amz}\n{scope}\n{hashlib.sha256(canonical.encode()).hexdigest()}"
        k = _sign(("AWS4" + SECRET).encode(), day)
        for part in scope.split("/")[1:]:
            k = _sign(k, part)
        return hmac.compare_digest(hmac.new(k, to_sign.encode(), hashlib.sha256).hexdigest(), fields["Signature"])

    def _object(self, body: bytes = b""):
        if self.path == "/_keys":
            return self._send(200, json.dumps(sorted(self.store)).encode(), "application/json")
        if not self._valid(body):
            return self._send(403, b"<Error><Code>SignatureDoesNotMatch</Code></Error>")
        key = unquote(self.path)
        if self.command == "PUT":
            self.store[key] = (body, self.headers.get("Content-Type", "application/octet-stream"))
            return self._send(200)
        if self.command == "DELETE":
            self.store.pop(key, None)
            return self._send(204)
        if key not in self.store:
            return self._send(404, b"<Error><Code>NoSuchKey</Code></Error>")
        data, ctype = self.store[key]
        return self._send(200, data, ctype)

    def do_GET(self):
        self._object()

    def do_DELETE(self):
        self._object()

    def do_PUT(self):
        self._object(self.rfile.read(int(self.headers.get("Content-Length") or 0)))


def start(port: int = 0) -> ThreadingHTTPServer:
    Handler.store = {}
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


if __name__ == "__main__":
    srv = start(int(sys.argv[1]) if len(sys.argv) > 1 else 9911)
    print(f"R2 stand-in on http://127.0.0.1:{srv.server_port}", flush=True)
    threading.Event().wait()
