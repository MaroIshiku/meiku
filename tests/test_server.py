import http.client
import json
import tempfile
import threading
import unittest
from pathlib import Path

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
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        (self.root / "index.html").write_text("<!doctype html><title>Meiku</title>", encoding="utf-8")
        (self.root / "save.php").write_text("server implementation", encoding="utf-8")
        self.data_file = self.root / "data.json"
        config = meiku_server.AppConfig(self.root, self.data_file, VALID_TEST_VALUE, False)
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

    def test_legacy_post_path_cannot_disclose_server_source(self):
        status, _, payload = self.request_json("GET", "/save.php")
        self.assertEqual(status, 405)
        self.assertEqual(payload["code"], "METHOD_NOT_ALLOWED")

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

    def test_encoded_path_traversal_is_rejected(self):
        status, _, _ = self.request("GET", "/..%2Foutside.txt")
        self.assertEqual(status, 403)


if __name__ == "__main__":
    unittest.main()
