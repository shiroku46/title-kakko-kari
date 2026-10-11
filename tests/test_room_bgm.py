"""Exercise the actual room audio hook without a browser or npm installation."""
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HARNESS = r"""
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const source = readFileSync('client/src/hooks/useRoomBgm.js', 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace('export default function', 'function');
const players = [], contexts = [], slots = [], effects = [];
let cursor = 0, active = false, stored = null, denied = false, storageDenied = false;
class Events extends EventEmitter {
  addEventListener(name, listener) { this.on(name, listener); }
  removeEventListener(name, listener) { this.off(name, listener); }
}
class Audio extends Events {
  constructor(uri) { super(); this.uri = uri; this.paused = true; this.loads = 0; players.push(this); }
  play() {
    if (denied) return Promise.reject(Object.assign(new Error('autoplay'), { name: 'NotAllowedError' }));
    this.paused = false; this.emit('playing'); return Promise.resolve();
  }
  pause() { this.paused = true; this.emit('pause'); }
  load() { this.loads++; this.error = null; }
  removeAttribute(name) { if (name === 'src') this.uri = ''; }
}
class AudioContext extends Events {
  constructor() { super(); this.state = 'suspended'; this.gain = { gain: { value: 1 }, connect() {} }; contexts.push(this); }
  createGain() { return this.gain; }
  createMediaElementSource() { return { connect() {} }; }
  resume() { this.state = 'running'; this.emit('statechange'); return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
}
const document = new Events(); document.hidden = false;
const sandbox = { Audio, AudioContext, document, Asset: { fromModule: () => ({ uri: '/local-bgm.mp3' }) },
  require: () => 'bundled-track',
  localStorage: {
    getItem() { if (storageDenied) throw Error('storage'); return stored; },
    setItem(_, value) { if (storageDenied) throw Error('storage'); stored = value; },
  },
  useState(initial) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
    return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
  },
  useRef(initial) { const index = cursor++; return slots[index] ||= { current: initial }; },
  useEffect(run, deps) {
    const index = cursor++, previous = effects[index];
    if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
      effects[index] = { deps, run, cleanup: previous?.cleanup, pending: true };
    }
  },
};
const hook = runInNewContext(source + '\nuseRoomBgm;', sandbox);
function render(next = active) {
  active = next; cursor = 0;
  const value = hook(active);
  for (const effect of effects) if (effect?.pending) {
    effect.pending = false; effect.cleanup?.(); effect.cleanup = effect.run();
  }
  return value;
}
const flush = () => new Promise(resolve => setImmediate(resolve));
"""


class TestRoomBgm(unittest.TestCase):
    def check(self, scenario):
        result = subprocess.run(
            ["node", "-e", HARNESS + "\n(async () => {\n" + scenario +
             "\n})().catch(error => { console.error(error); process.exitCode = 1; });"],
            cwd=ROOT, capture_output=True, text=True, timeout=5,
        )
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)

    def test_room_lifecycle_preferences_and_hidden_page(self):
        self.check(r"""
render(false); assert.equal(players.length, 0, 'Home has no player');
render(true); let bgm = render();
assert.equal(players.length, 1); assert.equal(players[0].loop, true);
assert.equal(bgm.playing, true); assert.equal(contexts[0].gain.gain.value, 0.3);
for (let i = 0; i < 5; i++) render(true);
assert.equal(players.length, 1, 'Room rerenders and transitions share one player');
bgm.changeVolume(10); bgm = render();
assert.equal(contexts[0].gain.gain.value, 0.4);
assert.equal(JSON.parse(stored).volume, 40);
document.hidden = true; document.emit('visibilitychange');
assert.equal(render().playing, false);
document.hidden = false; document.emit('visibilitychange');
bgm = render(); assert.equal(bgm.playing, true);
bgm.toggle(); bgm = render();
assert.equal(bgm.muted, true); assert.equal(players[0].paused, true);
document.emit('visibilitychange'); assert.equal(players[0].paused, true, 'Hidden-page return preserves mute');
render(false);
assert.equal(contexts[0].state, 'closed'); assert.equal(players[0].uri, '');
assert.equal(players[0].eventNames().length, 0); assert.equal(document.eventNames().length, 0);
render(true); bgm = render();
assert.equal(players.length, 2); assert.equal(players[1].paused, true);
assert.equal(bgm.volume, 40, 'Next entry retains volume');
bgm.toggle(); assert.equal(render().playing, true);
render(false);
""")

    def test_autoplay_denial_load_failure_and_retry(self):
        self.check(r"""
denied = true; render(true); await flush(); let bgm = render();
assert.equal(bgm.playing, false); assert.match(bgm.error, /再生ボタン/);
denied = false; bgm.toggle(); await flush(); bgm = render();
assert.equal(bgm.playing, true); assert.equal(bgm.error, '');
players[0].pause(); players[0].error = {}; players[0].emit('error'); bgm = render();
assert.equal(bgm.playing, false); assert.match(bgm.error, /読み込めません/);
bgm.toggle(); bgm = render();
assert.equal(players[0].loads, 1); assert.equal(bgm.playing, true);
denied = true; players[0].pause(); render().toggle(); render(false); await flush();
assert.equal(render(false).error, '', 'Late rejection after exit cannot change the next screen');
""")

    def test_storage_validation_bounds_and_unavailable_audio(self):
        self.check(r"""
stored = '{"volume":999,"muted":"yes"}'; render(); let bgm = render();
assert.equal(bgm.volume, 30); assert.equal(bgm.muted, false);
bgm.changeVolume(-1000); bgm = render(); assert.equal(bgm.volume, 10);
bgm.changeVolume(1000); bgm = render(); assert.equal(bgm.volume, 100);
storageDenied = true; bgm.changeVolume(-10); render();
sandbox.AudioContext = undefined; render(true); bgm = render();
assert.equal(bgm.playing, false); assert.match(bgm.error, /再生できません/);
assert.equal(players.length, 0); bgm.toggle(); render(); render(false);
""")


if __name__ == "__main__":
    unittest.main()
