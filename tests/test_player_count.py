"""
Tests for player count validation rules.

Server logic (gameHandlers.js):
  minPlayers = 3 if NODE_ENV != 'production' AND ALLOW_THREE_PLAYER_DEV == 'true' else 4
  Reject if connectedPlayers.length < minPlayers
  Room cap: max 6 players (existing)

Client logic (LobbyScreen.js):
  MIN_PLAYERS = 3 if __DEV__ AND EXPO_PUBLIC_ALLOW_THREE_PLAYER_DEV == 'true' else 4
"""

import unittest


def server_min_players(node_env: str, allow_three_player_dev: str) -> int:
    """Mirror the server-side minPlayers logic from gameHandlers.js."""
    allow_three = node_env != 'production' and allow_three_player_dev == 'true'
    return 3 if allow_three else 4


def client_min_players(is_dev: bool, expo_allow_three: str) -> int:
    """Mirror the client-side MIN_PLAYERS logic from LobbyScreen.js."""
    allow_three = is_dev and expo_allow_three == 'true'
    return 3 if allow_three else 4


class TestServerPlayerCount(unittest.TestCase):

    def test_production_requires_4_even_with_flag(self):
        self.assertEqual(server_min_players('production', 'true'), 4)

    def test_production_requires_4_without_flag(self):
        self.assertEqual(server_min_players('production', 'false'), 4)

    def test_production_rejects_3_players(self):
        min_p = server_min_players('production', 'true')
        self.assertGreater(min_p, 3, "Production must reject 3-player start")

    def test_production_accepts_4_players(self):
        min_p = server_min_players('production', 'true')
        self.assertLessEqual(min_p, 4)

    def test_dev_without_opt_in_requires_4(self):
        self.assertEqual(server_min_players('development', 'false'), 4)

    def test_dev_with_opt_in_allows_3(self):
        self.assertEqual(server_min_players('development', 'true'), 3)

    def test_2_players_always_rejected(self):
        for env in ('production', 'development', 'test'):
            for flag in ('true', 'false'):
                min_p = server_min_players(env, flag)
                self.assertGreater(min_p, 2,
                    f"2-player start must be rejected in env={env} flag={flag}")

    def test_max_6_players_always_accepted(self):
        for env in ('production', 'development'):
            for flag in ('true', 'false'):
                min_p = server_min_players(env, flag)
                self.assertLessEqual(min_p, 6)

    def test_production_5_players_accepted(self):
        min_p = server_min_players('production', 'false')
        self.assertLessEqual(min_p, 5)

    def test_production_6_players_accepted(self):
        min_p = server_min_players('production', 'false')
        self.assertLessEqual(min_p, 6)


class TestClientPlayerCount(unittest.TestCase):

    def test_prod_build_requires_4(self):
        self.assertEqual(client_min_players(False, 'false'), 4)

    def test_prod_build_requires_4_even_with_flag(self):
        # is_dev=False (production build) ignores the flag
        self.assertEqual(client_min_players(False, 'true'), 4)

    def test_dev_build_without_opt_in_requires_4(self):
        self.assertEqual(client_min_players(True, 'false'), 4)

    def test_dev_build_with_opt_in_allows_3(self):
        self.assertEqual(client_min_players(True, 'true'), 3)

    def test_2_players_always_rejected(self):
        for is_dev in (True, False):
            for flag in ('true', 'false'):
                min_p = client_min_players(is_dev, flag)
                self.assertGreater(min_p, 2,
                    f"2-player start must be rejected is_dev={is_dev} flag={flag}")


class TestClientServerConsistency(unittest.TestCase):
    """Server and client must agree on the minimum player count for all scenarios."""

    def test_production_consistent(self):
        server = server_min_players('production', 'true')
        client = client_min_players(False, 'true')
        self.assertEqual(server, client,
            "Server and client must agree on min players in production")

    def test_dev_no_opt_in_consistent(self):
        server = server_min_players('development', 'false')
        client = client_min_players(True, 'false')
        self.assertEqual(server, client,
            "Server and client must agree when dev opt-in is absent")

    def test_dev_with_opt_in_consistent(self):
        server = server_min_players('development', 'true')
        client = client_min_players(True, 'true')
        self.assertEqual(server, client,
            "Server and client must agree when dev opt-in is active")


class TestVercelConfig(unittest.TestCase):
    """Validate vercel.json structure."""

    def setUp(self):
        import json
        import os
        root = os.path.join(os.path.dirname(__file__), '..')
        with open(os.path.join(root, 'vercel.json')) as f:
            self.config = json.load(f)

    def test_build_command_present(self):
        self.assertIn('buildCommand', self.config)

    def test_output_directory_is_client_dist(self):
        self.assertEqual(self.config.get('outputDirectory'), 'client/dist')

    def test_build_command_references_client(self):
        cmd = self.config.get('buildCommand', '')
        self.assertIn('client', cmd)

    def test_build_command_includes_npm_ci(self):
        cmd = self.config.get('buildCommand', '')
        self.assertIn('npm ci', cmd)

    def test_build_command_includes_build_web(self):
        cmd = self.config.get('buildCommand', '')
        self.assertIn('build:web', cmd)

    def test_spa_fallback_rewrite_present(self):
        rewrites = self.config.get('rewrites', [])
        self.assertTrue(
            any(r.get('destination') == '/index.html' for r in rewrites),
            "SPA fallback rewrite to /index.html must exist"
        )


if __name__ == '__main__':
    unittest.main()
