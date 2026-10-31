import http.client
import json
import os
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

import server as meiku_server


VALID_TEST_VALUE = "x" * 40


class AppConfigTests(unittest.TestCase):
    def test_rejects_short_and_documented_placeholder_secrets(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            for secret in ("short", "CHANGE_ME", "replace-with-at-least-32-random-characters"):
                with self.subTest(secret=secret):
                    config = meiku_server.AppConfig(root, root / "data.json", secret, False)
                    with self.assertRaises(SystemExit):
                        config.validate()

    def test_accepts_a_non_placeholder_32_character_secret(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            config = meiku_server.AppConfig(root, root / "data.json", VALID_TEST_VALUE, False)
            config.validate()
            self.assertTrue((root / "data.json").is_file())


class ServerSecurityTests(unittest.TestCase):
    trust_proxy = False

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        (self.root / "index.html").write_text("<!doctype html><title>Meiku</title>", encoding="utf-8")
        (self.root / "server.py").write_text("server implementation", encoding="utf-8")
        (self.root / "js").mkdir()
        (self.root / "js" / "app.js").write_text("console.log('ok');", encoding="utf-8")
        (self.root / "tests").mkdir()
        (self.root / "tests" / "secret.txt").write_text("not public", encoding="utf-8")
        self.data_dir = self.root / "data"
        self.data_file = self.data_dir / "data.json"
        config = meiku_server.AppConfig(self.root, self.data_file, VALID_TEST_VALUE, False, trust_proxy=self.trust_proxy)
        config.validate()
        meiku_server.AUTH_LIMITER.clear("127.0.0.1")
        self.server = meiku_server.ContactCardServer(("127.0.0.1", 0), config)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.server.server_address[1]

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        meiku_server.AUTH_LIMITER.clear("127.0.0.1")
        self.temp_dir.cleanup()

    def request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=3)
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        payload = response.read()
        response_headers = dict(response.getheaders())
        connection.close()
        return response.status, response_headers, payload

    def request_json(self, method, path, body=None, headers=None):
        status, response_headers, payload = self.request(method, path, body, headers)
        return status, response_headers, json.loads(payload)

    def test_security_headers_are_present(self):
        status, headers, _ = self.request("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn("default-src 'self'", headers["Content-Security-Policy"])
        self.assertEqual(headers["X-Frame-Options"], "DENY")

    def test_readiness_does_not_expose_secret_or_filesystem_path(self):
        status, headers, payload = self.request_json("GET", "/readyz")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertEqual(payload, {"ok": True, "dataWritable": True})

    @unittest.skipIf(hasattr(os, "geteuid") and os.geteuid() == 0, "root ignores directory permissions")
    def test_readiness_fails_when_data_is_not_writable(self):
        self.data_dir.chmod(0o500)
        try:
            status, _, payload = self.request_json("GET", "/readyz")
        finally:
            self.data_dir.chmod(0o700)
        self.assertEqual(status, 503)
        self.assertEqual(payload, {"ok": False, "dataWritable": False})

    def test_removed_legacy_endpoints_are_not_served(self):
        for method, path in (("GET", "/save.php"), ("GET", "/data.json"), ("POST", "/save.php"), ("POST", "/data.json")):
            with self.subTest(method=method, path=path):
                status, _, _ = self.request(method, path, body="{}" if method == "POST" else None)
                self.assertEqual(status, 404)

    def test_only_pwa_files_are_public(self):
        self.assertEqual(self.request("GET", "/js/app.js")[0], 200)
        self.assertEqual(self.request("GET", "/")[0], 200)
        for path in ("/server.py", "/tests/secret.txt", "/data/data.json", "/js", "/.git/config"):
            with self.subTest(path=path):
                self.assertEqual(self.request("GET", path)[0], 404)

    def test_invalid_secret_returns_generic_error_and_request_id(self):
        status, _, payload = self.request_json(
            "POST",
            "/api/token",
            body=json.dumps({"token": "A" * 64}),
            headers={"Content-Type": "application/json", "X-Auth-Token": "wrong"},
        )
        self.assertEqual(status, 403)
        self.assertEqual(payload["code"], "AUTHORIZATION_FAILED")
        self.assertEqual(payload["error"], "Request could not be authorized.")
        self.assertEqual(len(payload["requestId"]), 32)

    def test_repeated_invalid_secrets_are_rate_limited(self):
        headers = {"Content-Type": "application/json", "X-Auth-Token": "wrong"}
        body = json.dumps({"token": "A" * 64})
        for _ in range(meiku_server.AUTH_FAILURE_LIMIT):
            status, _, _ = self.request_json("POST", "/api/token", body, headers)
            self.assertEqual(status, 403)
        status, response_headers, payload = self.request_json("POST", "/api/token", body, headers)
        self.assertEqual(status, 429)
        self.assertEqual(payload["code"], "RATE_LIMITED")
        self.assertEqual(response_headers["Retry-After"], str(meiku_server.AUTH_FAILURE_WINDOW_SECONDS))

    def test_valid_write_does_not_echo_encrypted_token(self):
        token = "A" * 64
        status, headers, payload = self.request_json(
            "POST",
            "/api/token",
            body=json.dumps({"token": token}),
            headers={"Content-Type": "application/json", "X-Auth-Token": VALID_TEST_VALUE},
        )
        self.assertEqual(status, 200)
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertTrue(payload["ok"])
        self.assertNotIn("token", payload)
        self.assertEqual(json.loads(self.data_file.read_text(encoding="utf-8"))["token"], token)

    def test_write_requires_json_content_type(self):
        status, _, payload = self.request_json(
            "POST",
            "/api/token",
            body=json.dumps({"token": "A" * 64}),
            headers={"Content-Type": "text/plain", "X-Auth-Token": VALID_TEST_VALUE},
        )
        self.assertEqual(status, 400)
        self.assertEqual(payload["code"], "INVALID_REQUEST")

    def test_versioned_assets_are_immutable_and_others_revalidate(self):
        _, headers, _ = self.request("GET", "/js/app.js?v=0.4.2")
        self.assertEqual(headers["Cache-Control"], "public, max-age=31536000, immutable")
        _, headers, _ = self.request("GET", "/js/app.js")
        self.assertEqual(headers["Cache-Control"], "no-cache")
        _, headers, _ = self.request("GET", "/js/app.js?v=meiku-20260821")
        self.assertEqual(headers["Cache-Control"], "no-cache")
        _, headers, _ = self.request("GET", "/?v=0.4.2")
        self.assertEqual(headers["Cache-Control"], "no-cache")

    def write(self, token, **extra):
        body = {"token": token, **extra}
        return self.request_json(
            "POST",
            "/api/token",
            body=json.dumps(body),
            headers={"Content-Type": "application/json", "X-Auth-Token": VALID_TEST_VALUE},
        )

    def test_revision_starts_at_zero_and_increments(self):
        status, _, record = self.request_json("GET", "/api/data")
        self.assertEqual(status, 200)
        self.assertEqual(record, {"token": "", "updated": None, "revision": 0})
        status, _, payload = self.write("A" * 64, expectedRevision=0)
        self.assertEqual((status, payload["revision"]), (200, 1))
        status, _, payload = self.write("B" * 64, expectedRevision=1)
        self.assertEqual((status, payload["revision"]), (200, 2))
        self.assertEqual(self.request_json("GET", "/api/data")[2]["token"], "B" * 64)

    def test_stale_revision_is_rejected_without_overwriting(self):
        self.write("A" * 64, expectedRevision=0)
        status, _, payload = self.write("B" * 64, expectedRevision=0)
        self.assertEqual(status, 409)
        self.assertEqual(payload["code"], "VERSION_CONFLICT")
        self.assertEqual(payload["revision"], 1)
        self.assertNotIn("token", payload)
        self.assertEqual(json.loads(self.data_file.read_text(encoding="utf-8"))["token"], "A" * 64)

    def test_null_expectation_only_creates_a_new_vault(self):
        status, _, _ = self.write("A" * 64, expectedRevision=None)
        self.assertEqual(status, 200)
        status, _, payload = self.write("B" * 64, expectedRevision=None)
        self.assertEqual(status, 409)
        self.assertEqual(payload["code"], "VERSION_CONFLICT")

    def test_writes_without_expectation_remain_compatible(self):
        self.assertEqual(self.write("A" * 64)[0], 200)
        self.assertEqual(self.write("B" * 64)[0], 200)

    def test_invalid_expected_revision_is_rejected(self):
        for value in ("1", -1, True, 1.5):
            with self.subTest(value=value):
                self.assertEqual(self.write("A" * 64, expectedRevision=value)[0], 400)

    def test_legacy_data_file_without_revision_is_read_as_zero(self):
        self.data_file.write_text(json.dumps({"token": "L" * 64, "updated": "2026-01-01T00:00:00Z"}), encoding="utf-8")
        record = self.request_json("GET", "/api/data")[2]
        self.assertEqual(record, {"token": "L" * 64, "updated": "2026-01-01T00:00:00Z", "revision": 0})
        self.assertEqual(self.write("A" * 64, expectedRevision=0)[0], 200)

    def test_previous_tokens_are_kept_in_bounded_history(self):
        for index in range(meiku_server.HISTORY_LIMIT + 3):
            self.assertEqual(self.write(chr(ord("A") + index) * 64)[0], 200)
        history = sorted((self.data_dir / "history").glob("data-r*.json"))
        self.assertEqual(len(history), meiku_server.HISTORY_LIMIT)
        latest_backup = json.loads(history[-1].read_text(encoding="utf-8"))
        self.assertEqual(latest_backup["token"], chr(ord("A") + meiku_server.HISTORY_LIMIT + 1) * 64)

    def test_encoded_path_traversal_is_rejected(self):
        status, _, _ = self.request("GET", "/..%2Foutside.txt")
        self.assertEqual(status, 403)


class TrustedProxyTests(ServerSecurityTests):
    trust_proxy = True

    def test_rate_limit_uses_forwarded_client_behind_trusted_proxy(self):
        body = json.dumps({"token": "A" * 64})
        attacker = {"Content-Type": "application/json", "X-Auth-Token": "wrong", "X-Forwarded-For": "203.0.113.9"}
        for _ in range(meiku_server.AUTH_FAILURE_LIMIT + 1):
            self.request_json("POST", "/api/token", body, attacker)
        self.assertEqual(self.request_json("POST", "/api/token", body, attacker)[0], 429)
        owner = {"Content-Type": "application/json", "X-Auth-Token": VALID_TEST_VALUE, "X-Forwarded-For": "198.51.100.7"}
        self.assertEqual(self.request_json("POST", "/api/token", body, owner)[0], 200)
        meiku_server.AUTH_LIMITER.clear("203.0.113.9")


class LimiterTests(unittest.TestCase):
    def test_expired_entries_are_removed_and_memory_is_bounded(self):
        limiter = meiku_server.FailedAuthLimiter()
        with mock.patch.object(meiku_server, "AUTH_LIMITER_MAX_KEYS", 8):
            for index in range(50):
                limiter.record_failure(f"client-{index}")
            self.assertLessEqual(limiter.tracked_keys(), 8)
        with mock.patch.object(meiku_server.time, "monotonic", return_value=10**9):
            self.assertFalse(limiter.limited("client-49"))
        self.assertLessEqual(limiter.tracked_keys(), 7)


class RemovedEnvironmentTests(unittest.TestCase):
    def run_check(self, env):
        with mock.patch.dict(os.environ, env, clear=True), mock.patch.object(meiku_server, "DEFAULT_SETUP_SECRET_FILE", Path("/nonexistent/secret")):
            meiku_server.reject_removed_environment()

    def test_default_legacy_values_are_ignored(self):
        self.run_check({"DV2_PORT": "8080", "DV2_DATA_FILE": str(meiku_server.DEFAULT_DATA_DIR / "data.json"), "DV2_ACCESS_LOG": "false", "DV2_SHARED_SECRET": ""})

    def test_legacy_secret_alone_is_accepted_with_a_warning(self):
        self.run_check({"DV2_SHARED_SECRET": VALID_TEST_VALUE})
        with mock.patch.dict(os.environ, {"DV2_SHARED_SECRET": VALID_TEST_VALUE}, clear=True), mock.patch.object(meiku_server, "DEFAULT_SETUP_SECRET_FILE", Path("/nonexistent/secret")):
            self.assertEqual(meiku_server.configured_secret(), VALID_TEST_VALUE)

    def test_new_secret_wins_over_legacy_secret(self):
        with mock.patch.dict(os.environ, {"DV2_SHARED_SECRET": "x" * 40, "ISHIKU_SETUP_SECRET": "y" * 40}, clear=True), mock.patch.object(meiku_server, "DEFAULT_SETUP_SECRET_FILE", Path("/nonexistent/secret")):
            self.assertEqual(meiku_server.configured_secret(), "y" * 40)

    def test_legacy_secret_next_to_new_secret_is_accepted(self):
        self.run_check({"DV2_SHARED_SECRET": VALID_TEST_VALUE, "ISHIKU_SETUP_SECRET": VALID_TEST_VALUE})

    def test_non_default_legacy_data_file_stops(self):
        with self.assertRaisesRegex(SystemExit, "MEIKU_DATA_FILE"):
            self.run_check({"DV2_DATA_FILE": "/elsewhere/data.json"})


class ShutdownTests(unittest.TestCase):
    def test_sigterm_stops_the_server_quickly(self):
        import signal
        import subprocess
        import sys
        import time as _time
        with tempfile.TemporaryDirectory() as temp_dir:
            env = {**os.environ, "ISHIKU_SETUP_SECRET": VALID_TEST_VALUE, "PYTHONDONTWRITEBYTECODE": "1"}
            proc = subprocess.Popen(
                [sys.executable, str(Path(meiku_server.__file__)), "--host", "127.0.0.1", "--port", "0", "--data-file", str(Path(temp_dir) / "data.json")],
                env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
            )
            try:
                self.assertIn("listening", proc.stdout.readline())
                started = _time.monotonic()
                proc.send_signal(signal.SIGTERM)
                proc.wait(timeout=5)
                self.assertLess(_time.monotonic() - started, 3)
                self.assertEqual(proc.returncode, 0)
            finally:
                if proc.poll() is None:
                    proc.kill()


if __name__ == "__main__":
    unittest.main()
