"""Verify that server CORS and client socket connection config are correct."""
import unittest
import subprocess
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

    def test_websocket_upgrade_uses_allow_request(self):
        self.assertIn("allowRequest:", self.server_index,
                      "Engine.IO must enforce the origin policy during upgrades")
        self.assertIn("isAllowedOrigin(req.headers.origin)", self.server_index,
                      "allowRequest must validate the request Origin")

    def test_originless_native_clients_are_preserved(self):
        self.assertIn("if (!origin) return true", self.server_index,
                      "originless Expo/native clients must remain supported")

    def test_configured_origins_are_checked_exactly(self):
        self.assertIn("allowedOrigins.includes(origin)", self.server_index,
                      "configured browser origins must be matched against the allowlist")


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
    def run_connection_check(self, check):
        # Exercise the helpers that Home actually uses. They have no JSX or
        # React dependency; keep their original timers and event behavior.
        harness = r"""
const assert = require('node:assert/strict');
const { EventEmitter, getEventListeners } = require('node:events');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const timers = new Set();
const source = readFileSync('client/src/hooks/useRoomEntry.js', 'utf8')
  .split('export default function')[0]
  .replace(/^import .*;\r?\n/gm, '');
const waitForConnection = runInNewContext(source + '\nwaitForConnection;', {
  setTimeout(callback, delay) {
    const timer = setTimeout(callback, delay);
    timers.add(timer);
    return timer;
  },
  clearTimeout(timer) { timers.delete(timer); clearTimeout(timer); },
});
(async () => {
""" + check + r"""
})().catch(error => { console.error(error); process.exitCode = 1; });
"""
        result = subprocess.run(
            ["node", "-e", harness], cwd=ROOT, capture_output=True,
            text=True, timeout=5,
        )
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)

    def test_connect_error_rejects_without_waiting_for_timeout(self):
        self.run_connection_check(r"""
  const socket = new EventEmitter();
  socket.connected = false;
  const controller = new AbortController();
  const started = Date.now();
  const pending = waitForConnection(socket, controller.signal);
  socket.emit('connect_error', new Error('test handshake failure'));
  await assert.rejects(pending);
  assert.ok(Date.now() - started < 1000,
    'A failed handshake must reject promptly instead of waiting ten seconds');
""")

    def test_connection_completion_cleans_up_timer_and_listeners(self):
        self.run_connection_check(r"""
  for (const outcome of ['error', 'connected', 'cancelled']) {
    const socket = new EventEmitter();
    socket.connected = false;
    const controller = new AbortController();
    const pending = waitForConnection(socket, controller.signal);
    if (outcome === 'error') socket.emit('connect_error', new Error('failure'));
    else if (outcome === 'connected') socket.emit('connect');
    else controller.abort();
    if (outcome === 'connected') await pending;
    else await assert.rejects(pending);
    assert.equal(timers.size, 0, outcome + ' leaked a connection timer');
    assert.equal(socket.listenerCount('connect'), 0, outcome + ' leaked a connect listener');
    assert.equal(socket.listenerCount('connect_error'), 0, outcome + ' leaked an error listener');
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0,
      outcome + ' leaked a cancellation listener');
  }
""")


class TestEnvExample(unittest.TestCase):
    def test_allowed_origins_documented(self):
        env_example = read("server/.env.example")
        self.assertIn("ALLOWED_ORIGINS", env_example,
                      "ALLOWED_ORIGINS must be documented in .env.example")


if __name__ == "__main__":
    unittest.main()
