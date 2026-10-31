"""Keeps the two delivery files (docker-compose.yml and the ZimaOS direct-import
file) aligned on everything that matters for security and data compatibility."""

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COMPOSE = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
ZIMAOS = (ROOT / "Meiku - Profile Share.yaml").read_text(encoding="utf-8")


def image_reference(text: str) -> str:
    match = re.search(r"ghcr\.io/maroishiku/meiku:v\d+\.\d+\.\d+@sha256:[0-9a-f]{64}", text)
    assert match, "pinned release image missing"
    return match.group(0)


class ComposeConsistencyTests(unittest.TestCase):
    def test_both_files_pin_the_same_immutable_release(self):
        self.assertEqual(image_reference(COMPOSE), image_reference(ZIMAOS))

    def test_hardening_is_identical(self):
        for snippet in (
            "read_only: true",
            "- ALL",
            "- CHOWN",
            "- SETGID",
            "- SETUID",
            "no-new-privileges:true",
            "pids_limit: 128",
            "mem_limit: 128m",
            "/tmp:size=16m,mode=1777",
            "target: /data",
            "target: 8080",
            "/readyz",
        ):
            with self.subTest(snippet=snippet):
                self.assertIn(snippet, COMPOSE)
                self.assertIn(snippet, ZIMAOS)

    def test_default_host_port_and_data_path(self):
        self.assertIn("${WEBUI_PORT:-65003}", COMPOSE)
        self.assertIn('published: "65003"', ZIMAOS)
        self.assertIn("/DATA/AppData/meiku/data", COMPOSE)
        self.assertIn("source: /DATA/AppData/meiku/data", ZIMAOS)

    def test_removed_legacy_variables_are_not_configured(self):
        for text in (COMPOSE, ZIMAOS, (ROOT / ".env.example").read_text(encoding="utf-8"), (ROOT / "Dockerfile").read_text(encoding="utf-8")):
            self.assertNotRegex(text, r"\bDV2_|DATELLO_|pull_policy")

    def test_secret_is_configured_once_without_legacy_alias(self):
        self.assertEqual(COMPOSE.count("ISHIKU_SETUP_SECRET: ${ISHIKU_SETUP_SECRET:-}"), 1)
        self.assertIn("- ISHIKU_SETUP_SECRET=", ZIMAOS)

class BuildInfoTests(unittest.TestCase):
    """Release images must carry real build information (shown under Settings -> About)."""

    def test_dockerfile_accepts_the_build_arguments_the_workflows_pass(self):
        dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
        workflows = ROOT / ".github" / "workflows"
        for name in ("ishiku-release-release.yml", "publish-ghcr.yml"):
            body = (workflows / name).read_text(encoding="utf-8")
            block = body[body.index("build-args: |"):body.index("provenance:", body.index("build-args: |"))]
            for arg in re.findall(r"^\s+([A-Z_]+)=", block, flags=re.M):
                with self.subTest(workflow=name, arg=arg):
                    self.assertRegex(dockerfile, rf"(?m)^ARG {arg}=", msg=f"{name} passes {arg} but the Dockerfile ignores it")
        self.assertIn("/app/build-info.json", dockerfile)


if __name__ == "__main__":
    unittest.main()
