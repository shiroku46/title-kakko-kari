"""Verify that server CORS and client socket connection config are correct."""
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


class TestServerCorsConfig(unittest.TestCase):
    def setUp(self):
        self.server_index = read("server/src/index.js")

    def test_cors_package_imported(self):
        self.assertIn("require('cors')", self.server_index,
                      "cors package must be imported in server/src/index.js")

    def test_cors_middleware_applied(self):
        self.assertIn("app.use(cors(", self.server_index,
                      "CORS middleware must be applied to the Express app")

    def test_socket_io_uses_shared_cors_origin(self):
        self.assertIn("corsOrigin", self.server_index,
                      "Socket.IO and Express should share the corsOrigin variable")

    def test_cors_origin_env_var_supported(self):
        self.assertIn("ALLOWED_ORIGINS", self.server_index,
                      "CORS origin must be configurable via ALLOWED_ORIGINS env var")


class TestClientSocketConfig(unittest.TestCase):
    def setUp(self):
        self.use_socket = read("client/src/hooks/useSocket.js")

    def test_polling_before_websocket(self):
        self.assertIn("'polling', 'websocket'", self.use_socket,
                      "polling must come before websocket for reliable handshake")

    def test_websocket_first_not_used(self):
        self.assertNotIn("'websocket', 'polling'", self.use_socket,
                         "websocket-first transport order must not be used")


class TestHomeScreenErrorHandling(unittest.TestCase):
    def setUp(self):
        self.home_screen = read("client/src/screens/HomeScreen.js")

    def test_connect_error_handler_registered(self):
        self.assertIn("connect_error", self.home_screen,
                      "connect_error event must be handled for fast failure feedback")

    def test_connect_error_clears_timer(self):
        self.assertIn("onConnectError", self.home_screen,
                      "onConnectError handler must be defined and referenced")


class TestEnvExample(unittest.TestCase):
    def test_allowed_origins_documented(self):
        env_example = read("server/.env.example")
        self.assertIn("ALLOWED_ORIGINS", env_example,
                      "ALLOWED_ORIGINS must be documented in .env.example")


if __name__ == "__main__":
    unittest.main()
