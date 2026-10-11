const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const http = require('node:http');
const { Server } = require('../server/node_modules/socket.io');
const { io } = require('../client/node_modules/socket.io-client');
const session = { code: '123456', playerId: 'test-seat', token: 'synthetic-seat-token' };

function harness(socket, timers = {}) {
  const states = [], shown = [], destinations = [];
  let cleanup, saved = { ...session }, disconnects = 0;
  const leaving = { current: false };
  const source = fs.readFileSync(require.resolve('../client/src/hooks/useRoomRecovery.js'), 'utf8')
    .replace(/^import .*;\n/gm, '').replace('export default function', 'function');
  const context = {
    useState: () => [false, (state) => states.push(state)],
    useEffect: (effect) => { cleanup = effect(); },
    getSocket: () => socket, disconnectSocket: () => disconnects++,
    getRoomSession: () => saved, clearRoomSession: () => { saved = null; },
    showRoom: (_, result) => shown.push(result), Alert: { alert() {} },
    setTimeout: timers.setTimeout || setTimeout, clearTimeout: timers.clearTimeout || clearTimeout,
  };
  vm.runInNewContext(source + '\nuseRoomRecovery(navigation, leaving);', {
    ...context, navigation: { replace: (name) => destinations.push(name) }, leaving,
  });
  return { states, shown, destinations, leaving, cleanup: () => cleanup(),
    get saved() { return saved; }, get disconnects() { return disconnects; } };
}

function fakeSocket() {
  const listeners = new Map(), callbacks = [];
  return { connected: true, active: true, id: 'connection-1', callbacks,
    on: (name, fn) => listeners.set(name, fn), off: (name) => listeners.delete(name),
    fire: (name) => listeners.get(name)?.(),
    timeout: () => ({ emit: (_, __, callback) => callbacks.push(callback) }),
  };
}

test('slow ACK on a live transport retries in this screen with the same seat', async () => {
  const server = http.createServer();
  const sockets = new Server(server);
  let attempts = 0;
  const delays = [];
  sockets.on('connection', (socket) => socket.on('room:resume', (payload, ack) => {
    assert.deepEqual(payload, session);
    attempts++;
    if (attempts === 1) delays.push(setTimeout(() => ack({ ok: true, stale: true }), 13000));
    else ack({ ok: true, restored: true });
  }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const socket = io(`http://127.0.0.1:${server.address().port}`, { autoConnect: false, transports: ['websocket'] });
  const h = harness(socket);
  try {
    socket.connect();
    const started = Date.now();
    while (!h.shown.length && Date.now() - started < 15000) await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(attempts, 2);
    assert.equal(socket.connected, true);
    assert.equal(h.disconnects, 0);
    assert.equal(h.destinations.length, 0);
    assert.deepEqual(h.saved, session);
    assert.equal(h.shown[0].restored, true);
    assert.deepEqual(h.states, [true, true, false]);
  } finally {
    h.cleanup(); socket.disconnect(); delays.forEach(clearTimeout);
    await new Promise((resolve) => sockets.close(resolve));
  }
});

test('temporary save error retries; authorization expiry clears the bookmark', () => {
  const socket = fakeSocket(); const pending = [];
  const h = harness(socket, { setTimeout: (fn) => { pending.push(fn); return fn; }, clearTimeout() {} });
  socket.fire('connect');
  socket.callbacks[0](null, { ok: false, error: 'temporary save failure' });
  assert.equal(h.disconnects, 0); assert.deepEqual(h.saved, session);
  pending.shift()();
  socket.callbacks[1](null, { ok: false, error: 'expired', rejoinUnavailable: true });
  assert.equal(h.saved, null); assert.equal(h.disconnects, 1);
  assert.deepEqual(h.destinations, ['Home']); h.cleanup();
});

test('old ACK cannot overwrite a newer connection and unmounted screens never retry', () => {
  const socket = fakeSocket(); const h = harness(socket);
  socket.fire('connect');
  socket.connected = false; socket.fire('disconnect');
  socket.id = 'connection-2'; socket.connected = true; socket.fire('connect');
  socket.callbacks[0](null, { ok: true, stale: true });
  assert.equal(h.shown.length, 0);
  socket.callbacks[1](null, { ok: true, current: true });
  assert.equal(h.shown[0].current, true);
  h.cleanup(); socket.callbacks[1](new Error('timeout'));
  assert.equal(h.disconnects, 0);
});

test('explicit leave and server takeover cannot automatically reclaim a seat', () => {
  const socket = fakeSocket(); const h = harness(socket);
  socket.fire('connect'); h.leaving.current = true;
  socket.callbacks[0](null, { ok: true }); socket.fire('connect');
  assert.equal(h.shown.length, 0); assert.equal(socket.callbacks.length, 1); h.cleanup();
  const other = fakeSocket(); const transferred = harness(other);
  other.active = false; other.connected = false; other.fire('disconnect');
  assert.deepEqual(transferred.destinations, ['Home']);
  assert.deepEqual(transferred.saved, session);
  other.connected = true; other.fire('connect');
  assert.equal(other.callbacks.length, 0); transferred.cleanup();
});
