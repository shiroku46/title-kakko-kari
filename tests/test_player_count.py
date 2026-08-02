"""
Tests for player count validation logic (Issue #8).
Validates server-side and client-side player count rules without running server code.
"""
import json
import os
import re
import unittest


REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(path):
    with open(os.path.join(REPO_ROOT, path), encoding="utf-8") as f:
        return f.read()


def _server_min_players(node_env, allow_three):
    """Replicate server minPlayers logic from gameHandlers.js."""
    is_dev = node_env == "development"
    allow = allow_three == "true"
    return 3 if (is_dev and allow) else 4


def _client_min_players(is_dev, expo_allow):
    """Replicate client MIN_PLAYERS logic from LobbyScreen.js."""
    return 3 if (is_dev and expo_allow == "true") else 4


class TestServerPlayerCount(unittest.TestCase):

    def test_dev_with_opt_in_allows_three(self):
        self.assertEqual(_server_min_players("development", "true"), 3)

    def test_production_requires_four(self):
        self.assertEqual(_server_min_players("production", "true"), 4)

    def test_test_env_requires_four(self):
        self.assertEqual(_server_min_players("test", "true"), 4)

    def test_staging_requires_four(self):
        self.assertEqual(_server_min_players("staging", "true"), 4)

    def test_unset_env_requires_four(self):
        self.assertEqual(_server_min_players("", "true"), 4)

    def test_misspelled_env_requires_four(self):
        self.assertEqual(_server_min_players("developement", "true"), 4)

    def test_dev_without_opt_in_requires_four(self):
        self.assertEqual(_server_min_players("development", "false"), 4)

    def test_dev_opt_in_not_set_requires_four(self):
        self.assertEqual(_server_min_players("development", ""), 4)

    def test_two_players_always_denied_production(self):
        self.assertLess(2, _server_min_players("production", "false"))

    def test_two_players_always_denied_dev(self):
        # Even with opt-in, min is 3 not 2
        self.assertLess(2, _server_min_players("development", "true"))


class TestClientPlayerCount(unittest.TestCase):

    def test_dev_with_opt_in_allows_three(self):
        self.assertEqual(_client_min_players(True, "true"), 3)

    def test_production_build_requires_four(self):
        self.assertEqual(_client_min_players(False, "true"), 4)

    def test_dev_without_opt_in_requires_four(self):
        self.assertEqual(_client_min_players(True, "false"), 4)

    def test_dev_opt_in_empty_requires_four(self):
        self.assertEqual(_client_min_players(True, ""), 4)


class TestServerClientConsistency(unittest.TestCase):

    def test_production_consistent(self):
        server = _server_min_players("production", "false")
        client = _client_min_players(False, "false")
        self.assertEqual(server, client)

    def test_dev_opt_in_consistent(self):
        server = _server_min_players("development", "true")
        client = _client_min_players(True, "true")
        self.assertEqual(server, client)

    def test_dev_no_opt_in_consistent(self):
        server = _server_min_players("development", "false")
        client = _client_min_players(True, "false")
        self.assertEqual(server, client)


class TestServerSourceCode(unittest.TestCase):

    def setUp(self):
        self.src = _read("server/src/socket/gameHandlers.js")

    def test_checks_node_env_development(self):
        self.assertIn("NODE_ENV === 'development'", self.src)

    def test_checks_allow_three_player_dev(self):
        self.assertIn("ALLOW_THREE_PLAYER_DEV === 'true'", self.src)

    def test_min_players_variable_used(self):
        self.assertIn("minPlayers", self.src)

    def test_no_hardcoded_two_player_start(self):
        # The old "< 2" check must be replaced; connectedPlayers.length < 2 should not appear
        self.assertNotIn("connectedPlayers.length < 2", self.src)


class TestClientSourceCode(unittest.TestCase):

    def setUp(self):
        self.src = _read("client/src/screens/LobbyScreen.js")

    def test_min_players_constant_defined(self):
        self.assertIn("MIN_PLAYERS", self.src)

    def test_expo_public_env_var_used(self):
        self.assertIn("EXPO_PUBLIC_ALLOW_THREE_PLAYER_DEV", self.src)

    def test_dev_guard_used(self):
        self.assertIn("__DEV__", self.src)

    def test_no_hardcoded_two_player_check(self):
        self.assertNotIn("players.length < 2", self.src)


class TestVercelConfig(unittest.TestCase):

    def setUp(self):
        self.config = json.loads(_read("vercel.json"))

    def test_build_command_includes_npm_ci(self):
        self.assertIn("npm ci", self.config["buildCommand"])

    def test_build_command_includes_build_web(self):
        self.assertIn("build:web", self.config["buildCommand"])

    def test_output_directory_is_client_dist(self):
        self.assertEqual(self.config["outputDirectory"], "client/dist")

    def test_spa_fallback_rewrites(self):
        rewrites = self.config.get("rewrites", [])
        self.assertTrue(len(rewrites) > 0)
        destinations = [r["destination"] for r in rewrites]
        self.assertIn("/index.html", destinations)

    def test_no_secrets_in_config(self):
        raw = _read("vercel.json")
        lower = raw.lower()
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
