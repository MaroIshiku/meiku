#!/usr/bin/env python3
"""Small production-minded server for the encrypted Meiku PWA.

The browser still performs all encryption and decryption. This server only
serves static files and stores the encrypted token atomically.
"""

from __future__ import annotations

import argparse
from collections import deque
import datetime as dt
import hmac
import json
import mimetypes
import os
import re
import tempfile
import threading
import time
import uuid
from http import HTTPStatus
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import unquote


ROOT = Path(__file__).resolve().parent
DEFAULT_STATIC_DIR = ROOT
DEFAULT_DATA_DIR = Path(os.environ.get("ISHIKU_DATA_DIR", "/data"))
DEFAULT_DATA_FILE = Path(os.environ.get("DV2_DATA_FILE", DEFAULT_DATA_DIR / "data.json"))
DEFAULT_SETUP_SECRET_FILE = Path("/run/secrets/ishiku_setup_secret")
MAX_BODY_BYTES = 1024 * 1024
MIN_SETUP_SECRET_LENGTH = 32
MIN_TOKEN_LENGTH = 64
TOKEN_RE = re.compile(r"^[A-Za-z0-9+/=._:-]+$")
NETWORK_ONLY_PATHS = {"/api/data", "/api/token", "/data.json", "/save.php"}
WEAK_SETUP_SECRETS = {
    "change_me",
    "changeme",
    "replace-with-a-long-random-secret",
    "replace-with-at-least-32-random-characters",
}
AUTH_FAILURE_LIMIT = 5
AUTH_FAILURE_WINDOW_SECONDS = 60
REQUEST_TIMEOUT_SECONDS = 15
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Cross-Origin-Opener-Policy": "same-origin",
    "X-Frame-Options": "DENY",
    "X-Permitted-Cross-Domain-Policies": "none",
    "Content-Security-Policy": (
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self'; "
        "img-src 'self' data: blob:; "
        "connect-src 'self'; "
        "manifest-src 'self'; "
        "worker-src 'self'; "
        "object-src 'none'; "
        "base-uri 'none'; "
        "form-action 'self'; "
        "frame-ancestors 'none'"
    ),
}


class AppConfig:
    def __init__(self, static_dir: Path, data_file: Path, secret: str, dev_allow_weak_secret: bool) -> None:
        self.static_dir = static_dir.resolve()
        self.data_file = data_file.resolve()
        self.secret = secret
        self.dev_allow_weak_secret = dev_allow_weak_secret

    def validate(self) -> None:
        if not self.static_dir.exists():
            raise SystemExit(f"Static directory does not exist: {self.static_dir}")
        if not self.dev_allow_weak_secret:
            if not self.secret:
                raise SystemExit("ISHIKU_SETUP_SECRET, ISHIKU_SETUP_SECRET_FILE, or DV2_SHARED_SECRET must be set.")
            if len(self.secret) < MIN_SETUP_SECRET_LENGTH or self.secret.lower() in WEAK_SETUP_SECRETS:
                raise SystemExit(
                    f"Configured setup secret must contain at least {MIN_SETUP_SECRET_LENGTH} characters "
                    "and must not be a documented placeholder."
                )
        self.data_file.parent.mkdir(parents=True, exist_ok=True)
        if not self.data_file.exists():
            try:
                atomic_write_json(self.data_file, {"token": "", "updated": None})
            except PermissionError as exc:
                raise SystemExit(
                    f"Data directory is not writable by the Meiku process: {self.data_file.parent}. "
                    "Fix the host bind-mount permissions or use the provided Docker entrypoint."
                ) from exc


def utc_now_iso() -> str:
    return dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def atomic_write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, path)
    except Exception:
        try:
            os.unlink(tmp_name)
        except FileNotFoundError:
            pass
        raise


def read_token_file(path: Path) -> dict:
    if not path.exists():
        return {"token": "", "updated": None}
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    return {"token": str(data.get("token") or ""), "updated": data.get("updated")}


def read_secret_file(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise SystemExit(f"Configured setup secret file is not readable: {path}") from exc


def configured_secret() -> str:
    explicit_secret_file = os.environ.get("ISHIKU_SETUP_SECRET_FILE")
    if explicit_secret_file:
        return read_secret_file(Path(explicit_secret_file))

    if DEFAULT_SETUP_SECRET_FILE.exists():
        return read_secret_file(DEFAULT_SETUP_SECRET_FILE)

    return (
        os.environ.get("ISHIKU_SETUP_SECRET", "").strip()
        or os.environ.get("DV2_SHARED_SECRET", "").strip()
    )


class FailedAuthLimiter:
    def __init__(self) -> None:
        self._failures: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def _active(self, key: str, now: float) -> deque[float]:
        attempts = self._failures.setdefault(key, deque())
        cutoff = now - AUTH_FAILURE_WINDOW_SECONDS
        while attempts and attempts[0] <= cutoff:
            attempts.popleft()
        return attempts

    def limited(self, key: str) -> bool:
        with self._lock:
            return len(self._active(key, time.monotonic())) >= AUTH_FAILURE_LIMIT

    def record_failure(self, key: str) -> None:
        with self._lock:
            self._active(key, time.monotonic()).append(time.monotonic())

    def clear(self, key: str) -> None:
        with self._lock:
            self._failures.pop(key, None)


AUTH_LIMITER = FailedAuthLimiter()


class ContactCardHandler(BaseHTTPRequestHandler):
    server_version = "Meiku"
    sys_version = ""

    @property
    def config(self) -> AppConfig:
        return self.server.config  # type: ignore[attr-defined]

    @property
    def request_id(self) -> str:
        if not hasattr(self, "_request_id"):
            self._request_id = uuid.uuid4().hex
        return self._request_id

    @property
    def client_key(self) -> str:
        return str(self.client_address[0])

    def log_message(self, fmt: str, *args: object) -> None:
        if os.environ.get("DV2_ACCESS_LOG", "").lower() in {"1", "true", "yes"}:
            super().log_message(fmt, *args)

    def end_headers(self) -> None:
        for name, value in SECURITY_HEADERS.items():
            self.send_header(name, value)
        super().end_headers()

    def do_GET(self) -> None:
        if self.path_no_query == "/healthz":
            self.respond_json({"ok": True})
            return
        if self.path_no_query == "/readyz":
            self.respond_json({
                "ok": True,
                "dataWritable": os.access(self.config.data_file.parent, os.W_OK),
            }, no_store=True)
            return
        if self.path_no_query in {"/api/data", "/data.json"}:
            self.respond_json(read_token_file(self.config.data_file), no_store=True)
            return
        if self.path_no_query in {"/api/token", "/save.php"}:
            self.respond_error("METHOD_NOT_ALLOWED", "Request could not be processed.", HTTPStatus.METHOD_NOT_ALLOWED)
            return
        self.serve_static()

    def do_HEAD(self) -> None:
        if self.path_no_query in {"/healthz", "/readyz"}:
            self.send_response(HTTPStatus.NO_CONTENT)
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            return
        if self.path_no_query in {"/api/token", "/save.php"}:
            self.send_response(HTTPStatus.METHOD_NOT_ALLOWED)
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            return
        self.serve_static(head_only=True)

    def do_POST(self) -> None:
        if self.path_no_query not in {"/api/token", "/save.php"}:
            self.respond_error("NOT_FOUND", "Request could not be processed.", HTTPStatus.NOT_FOUND)
            return
        if AUTH_LIMITER.limited(self.client_key):
            self.audit_auth("rate_limited")
            self.respond_error(
                "RATE_LIMITED",
                "Request could not be authorized.",
                HTTPStatus.TOO_MANY_REQUESTS,
                {"Retry-After": str(AUTH_FAILURE_WINDOW_SECONDS)},
            )
            return
        if not self.authorized():
            AUTH_LIMITER.record_failure(self.client_key)
            self.audit_auth("denied")
            self.respond_error("AUTHORIZATION_FAILED", "Request could not be authorized.", HTTPStatus.FORBIDDEN)
            return
        AUTH_LIMITER.clear(self.client_key)
        try:
            payload = self.read_json_body()
            token = payload.get("token", "")
            if not isinstance(token, str) or len(token) < MIN_TOKEN_LENGTH or not TOKEN_RE.fullmatch(token):
                self.respond_error("INVALID_TOKEN", "Token is missing or invalid.", HTTPStatus.UNPROCESSABLE_ENTITY)
                return
            updated = utc_now_iso()
            atomic_write_json(self.config.data_file, {"token": token, "updated": updated})
            self.audit_auth("stored")
            self.respond_json({"ok": True, "updated": updated}, no_store=True)
        except ValueError:
            self.respond_error("INVALID_REQUEST", "Request could not be processed.", HTTPStatus.BAD_REQUEST)
        except OSError:
            self.respond_error("WRITE_FAILED", "Token could not be written.", HTTPStatus.INTERNAL_SERVER_ERROR)

    @property
    def path_no_query(self) -> str:
        return self.path.split("?", 1)[0]

    def authorized(self) -> bool:
        provided = self.headers.get("X-Auth-Token", "")
        return bool(self.config.secret) and hmac.compare_digest(provided, self.config.secret)

    def audit_auth(self, result: str) -> None:
        event = {
            "time": utc_now_iso(),
            "event": "token.write",
            "result": result,
            "requestId": self.request_id,
            "client": self.client_key,
        }
        print(json.dumps(event, separators=(",", ":")), flush=True)

    def read_json_body(self) -> dict:
        if self.headers.get_content_type() != "application/json":
            raise ValueError("JSON content type required.")
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ValueError("Invalid Content-Length.") from exc
        if length <= 0 or length > MAX_BODY_BYTES:
            raise ValueError("Invalid request.")
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("JSON could not be read.") from exc
        if not isinstance(data, dict):
            raise ValueError("JSON object expected.")
        return data

    def respond_error(
        self,
        code: str,
        message: str,
        status: HTTPStatus,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.respond_json(
            {"ok": False, "code": code, "error": message, "requestId": self.request_id},
            status,
            no_store=True,
            headers=headers,
        )

    def respond_json(
        self,
        payload: dict,
        status: HTTPStatus = HTTPStatus.OK,
        no_store: bool = False,
        headers: dict[str, str] | None = None,
    ) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store" if no_store else "private, max-age=0")
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def serve_static(self, head_only: bool = False) -> None:
        requested = unquote(self.path_no_query)
        rel = "index.html" if requested in {"", "/"} else requested.lstrip("/")
        target = (self.config.static_dir / rel).resolve()
        if self.config.static_dir not in target.parents and target != self.config.static_dir:
            self.send_error(HTTPStatus.FORBIDDEN)
            return
        if target.is_dir():
            target = target / "index.html"
        if not target.exists() or not target.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(target.stat().st_size))
        if self.path_no_query in NETWORK_ONLY_PATHS:
            self.send_header("Cache-Control", "no-store")
        elif target.name == "sw.js":
            self.send_header("Cache-Control", "no-store")
        elif target.name == "index.html" or target.suffix in {".html", ".json", ".js", ".css"}:
            self.send_header("Cache-Control", "no-cache")
        else:
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        self.end_headers()
        if not head_only:
            with target.open("rb") as handle:
                self.wfile.write(handle.read())


class ContactCardServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, server_address: tuple[str, int], config: AppConfig) -> None:
        super().__init__(server_address, ContactCardHandler)
        self.config = config

    def get_request(self):
        request, client_address = super().get_request()
        request.settimeout(REQUEST_TIMEOUT_SECONDS)
        return request, client_address


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Serve the encrypted Meiku PWA.")
    parser.add_argument("--host", default=os.environ.get("DV2_HOST", "0.0.0.0"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("DV2_PORT", "8080")))
    parser.add_argument("--static-dir", type=Path, default=Path(os.environ.get("DV2_STATIC_DIR", DEFAULT_STATIC_DIR)))
    parser.add_argument("--data-file", type=Path, default=DEFAULT_DATA_FILE)
    parser.add_argument("--dev-allow-weak-secret", action="store_true", default=os.environ.get("DV2_DEV_ALLOW_WEAK_SECRET") == "1")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    config = AppConfig(
        static_dir=args.static_dir,
        data_file=args.data_file,
        secret=configured_secret(),
        dev_allow_weak_secret=args.dev_allow_weak_secret,
    )
    config.validate()
    httpd = ContactCardServer((args.host, args.port), config)
    print(f"Meiku listening on http://{args.host}:{args.port}", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
