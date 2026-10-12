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
    def test_named_entry_without_password_and_authenticated_resume(self):
        harness = r"""
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const source = readFileSync('client/src/hooks/useRoomEntry.js', 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace('export default function', 'function');
const messages = [], requests = [], shown = [];
let saved = null, connections = 0;
const socket = { connected: true, id: 'connection-1', emit(event, payload, ack) {
  requests.push({ event, payload });
  ack({ ok: true, room: { code: '123456' }, token: 'seat-token',
    player: { id: 'seat-1', nickname: payload.nickname || saved.nickname, profile_ready: true } });
} };
const entry = runInNewContext(source + '\nuseRoomEntry({});', {
  useState: value => [value, next => messages.push(next)], useRef: value => ({ current: value }),
  useEffect() {}, AbortController, setTimeout, clearTimeout,
  DEFAULT_SERVER_URL: 'http://localhost:3000',
  fetch: async () => ({ ok: true, json: async () => ({ status: 'ok' }) }),
  connectSocket: () => { connections++; return socket; }, disconnectSocket() {},
  getRoomSession: () => saved, saveRoomSession: value => { saved = value; },
  clearRoomSession: () => { saved = null; }, showRoom: (_, result) => shown.push(result),
});
(async () => {
  const options = { serverUrl: 'http://localhost:3000' };
  await entry.enterRoom({ ...options, joining: true, resuming: true });
  assert.equal(messages.at(-1), 'このブラウザーに復帰情報がありません。参加した端末・ブラウザーで開いてください。');
  assert.equal(connections, 0, 'Missing recovery information must fail before connecting');
  assert.equal(requests.length, 0, 'Recovery must not create or join another seat');
  for (const nickname of ['', '   ']) {
    await entry.enterRoom({ ...options, nickname });
    assert.equal(messages.at(-1), '名前を入れてね。');
  }
  assert.equal(connections, 0, 'Blank names must fail before opening a connection');
  await entry.enterRoom({ ...options, nickname: ' ホスト ' });
  assert.equal(requests[0].event, 'room:create');
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0].payload)), { nickname: 'ホスト' });
  assert.equal(saved.nickname, 'ホスト');
  await entry.enterRoom({ ...options, nickname: '参加者', joining: true, code: '123' });
  assert.equal(messages.at(-1), '6けたの部屋のコードを入れてね。');
  assert.equal(requests.length, 1);
  await entry.enterRoom({ ...options, nickname: ' 参加者 ', joining: true, code: '123456' });
  assert.equal(requests[1].event, 'room:join');
  assert.deepEqual(JSON.parse(JSON.stringify(requests[1].payload)), { nickname: '参加者', code: '123456' });
  await entry.enterRoom({ ...options, code: '123456', joining: true, resuming: true });
  assert.equal(requests[2].event, 'room:resume');
  assert.deepEqual(JSON.parse(JSON.stringify(requests[2].payload)),
    { code: '123456', playerId: 'seat-1', token: 'seat-token' });
  assert.equal(shown.length, 3);
})().catch(error => { console.error(error); process.exitCode = 1; });
"""
        result = subprocess.run(
            ["node", "-e", harness], cwd=ROOT, capture_output=True,
            text=True, timeout=5,
        )
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)

    def run_connection_check(self, check):
        # Exercise the helpers that Home actually uses. They have no JSX or
        # React dependency; keep their original timers and event behavior.
        harness = r"""
const assert = require('node:assert/strict');
const { EventEmitter, getEventListeners } = require('node:events');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const timers = new Set();
const deadlines = [];
const source = readFileSync('client/src/hooks/useRoomEntry.js', 'utf8')
  .split('export default function')[0]
  .replace(/^import .*;\r?\n/gm, '');
const waitForConnection = runInNewContext(source + '\nwaitForConnection;', {
  setTimeout(callback, delay) {
    deadlines.push({ callback, delay });
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
  socket.active = false;
  const controller = new AbortController();
  const started = Date.now();
  const pending = waitForConnection(socket, controller.signal);
  socket.emit('connect_error', new Error('test handshake failure'));
  await assert.rejects(pending);
  assert.ok(Date.now() - started < 1000,
    'A rejected handshake must fail promptly');
""")

    def test_transient_connect_errors_keep_waiting_for_automatic_reconnection(self):
        self.run_connection_check(r"""
  const socket = new EventEmitter();
  socket.connected = false;
  socket.active = true;
  const controller = new AbortController();
  let settled = false;
  const pending = waitForConnection(socket, controller.signal).then(() => { settled = true; });
  socket.emit('connect_error', new Error('temporary failure'));
  socket.emit('connect_error', new Error('another temporary failure'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  assert.equal(socket.listenerCount('connect_error'), 1);
  socket.connected = true;
  socket.emit('connect');
  await pending;
  assert.equal(timers.size, 0);
  assert.equal(socket.listenerCount('connect_error'), 0);
""")

    def test_transient_errors_still_have_a_finite_connection_deadline(self):
        self.run_connection_check(r"""
  const socket = new EventEmitter();
  socket.connected = false;
  socket.active = true;
  const controller = new AbortController();
  const pending = waitForConnection(socket, controller.signal);
  socket.emit('connect_error', new Error('temporary failure'));
  assert.equal(deadlines[0].delay, 30000);
  deadlines[0].callback();
  await assert.rejects(pending);
  assert.equal(timers.size, 0);
  assert.equal(socket.listenerCount('connect_error'), 0);
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
