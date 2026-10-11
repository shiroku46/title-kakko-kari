"""Deployment-root configuration checks; seat counts are exercised over Socket.IO in game-e2e.cjs."""
import json
import os
import unittest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def _read(path):
    with open(os.path.join(REPO_ROOT, path), encoding="utf-8") as f:
        return f.read()


class TestVercelConfig(unittest.TestCase):

    def setUp(self):
        self.config_path = "client/vercel.json"
        self.config = json.loads(_read(self.config_path))

    def test_config_lives_under_connected_project_root(self):
        self.assertTrue(os.path.exists(os.path.join(REPO_ROOT, self.config_path)))
        self.assertFalse(os.path.exists(os.path.join(REPO_ROOT, "vercel.json")))

    def test_build_command_includes_npm_ci(self):
        self.assertIn("npm ci", self.config["buildCommand"])

    def test_build_command_includes_build_web(self):
        self.assertIn("build:web", self.config["buildCommand"])

    def test_output_directory_matches_client_root_project(self):
        self.assertEqual(self.config["outputDirectory"], "dist")

    def test_spa_fallback_rewrites(self):
        rewrites = self.config.get("rewrites", [])
        self.assertTrue(len(rewrites) > 0)
        destinations = [r["destination"] for r in rewrites]
        self.assertIn("/index.html", destinations)

    def test_no_secrets_in_config(self):
        lower = _read(self.config_path).lower()
        for word in ("secret", "password", "token", "key"):
            self.assertNotIn(word, lower)


class TestClientPackageJson(unittest.TestCase):

    def setUp(self):
        self.pkg = json.loads(_read("client/package.json"))

    def test_build_web_script_exists(self):
        self.assertIn("build:web", self.pkg["scripts"])

    def test_build_web_uses_expo_export(self):
        self.assertIn("expo export", self.pkg["scripts"]["build:web"])

    def test_build_web_targets_web_platform(self):
        self.assertIn("web", self.pkg["scripts"]["build:web"])


if __name__ == "__main__":
    unittest.main()
