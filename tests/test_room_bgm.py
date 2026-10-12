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
  .replace(/^import .*;\r?\n/gm, '').replace('export default function', 'function').replace('export const', 'const');
const players = [], contexts = [], slots = [], effects = [];
const created = [], revoked = [];
let cursor = 0, active = false, stored = null, legacy = null, denied = false, storageDenied = false;
class Events extends EventEmitter {
  addEventListener(name, listener) { this.on(name, listener); }
  removeEventListener(name, listener) { this.off(name, listener); }
}
class Audio extends Events {
  constructor(uri) { super(); this.uri = uri; this.paused = true; this.loads = 0; players.push(this); }
  set src(value) { this.uri = value; }
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
const sandbox = { Audio, AudioContext, document, Asset: { fromModule: source => ({ uri: source }) },
  require: source => source,
  URL: { createObjectURL(file) { const uri = 'blob:' + created.length; created.push(uri); return uri; },
    revokeObjectURL(uri) { revoked.push(uri); } },
  localStorage: {
    getItem(key) { if (storageDenied) throw Error('storage'); return key.endsWith('v1') ? legacy : stored; },
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
assert.equal(bgm.playing, false); assert.equal(bgm.muted, true);
assert.equal(contexts[0].state, 'suspended'); assert.equal(contexts[0].gain.gain.value, 0.05);
bgm.selectTrack('pop-rocks'); bgm = render();
document.emit('visibilitychange'); assert.equal(players[0].paused, true, 'Default stays silent on track selection and tab return');
bgm.toggle(); bgm = render(); assert.equal(bgm.playing, true);
for (let i = 0; i < 5; i++) render(true);
assert.equal(players.length, 1, 'Room rerenders and transitions share one player');
bgm.changeVolume(10); bgm = render();
assert.equal(contexts[0].gain.gain.value, 0.075);
assert.equal(JSON.parse(stored).volume, 30);
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
assert.equal(bgm.volume, 30, 'Next entry retains volume');
bgm.toggle(); assert.equal(render().playing, true);
render(false);
""")

    def test_autoplay_denial_load_failure_and_retry(self):
        self.check(r"""
denied = true; render(true); render().toggle(); await flush(); let bgm = render();
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
assert.equal(bgm.volume, 20); assert.equal(bgm.muted, true);
bgm.changeVolume(-1000); bgm = render(); assert.equal(bgm.volume, 10);
bgm.changeVolume(1000); bgm = render(); assert.equal(bgm.volume, 100);
storageDenied = true; bgm.changeVolume(-10); render();
sandbox.AudioContext = undefined; render(true); bgm = render();
assert.equal(bgm.playing, false); assert.match(bgm.error, /再生できません/);
assert.equal(players.length, 0); bgm.toggle(); render(); render(false);
""")

    def test_track_selection_local_files_and_cleanup(self):
        self.check(r"""
stored = '{"volume":20,"muted":true,"trackId":"not-a-track"}';
render(true); let bgm = render();
assert.equal(bgm.trackId, 'swing-along'); assert.equal(bgm.muted, true);
bgm.selectTrack('pop-rocks'); bgm = render();
assert.match(players[0].uri, /pop-rocks.mp3/); assert.equal(players[0].paused, true);
assert.equal(players.length, 1); assert.equal(contexts.length, 1);
assert.equal(JSON.parse(stored).trackId, 'pop-rocks');
bgm.selectTrack('unknown'); assert.equal(render().trackId, 'pop-rocks');
bgm.loadMp3(null); assert.equal(created.length, 0);
bgm.loadMp3({name: 'not-music.txt', size: 10}); bgm = render();
assert.match(bgm.error, /MP3/); assert.equal(created.length, 0);
bgm.loadMp3({name: 'empty.mp3', size: 0}); assert.equal(created.length, 0);
bgm.loadMp3({name: '好きな曲.MP3', size: 50}); bgm = render();
assert.equal(bgm.localFile.name, '好きな曲.MP3'); assert.equal(bgm.muted, false);
assert.equal(players[0].uri, 'blob:0'); assert.equal(bgm.playing, true);
assert.equal(contexts[0].gain.gain.value, 0.05, 'Local MP3 uses the reduced output');
assert.equal(JSON.parse(stored).trackId, 'pop-rocks');
assert(!stored.includes('blob:') && !stored.includes('好きな曲'), 'No file bytes or name persisted');
bgm.loadMp3({name: 'next.mp3', size: 50}); bgm = render();
assert.deepEqual(revoked, ['blob:0']); assert.equal(players[0].uri, 'blob:1');
bgm.selectTrack('bumbumbum'); bgm = render();
assert.deepEqual(revoked, ['blob:0', 'blob:1']); assert.equal(bgm.localFile, null);
assert.equal(players.length, 1); assert.equal(contexts.length, 1);
bgm.loadMp3({name: 'exit.mp3', size: 50}); render(); render(false);
assert.deepEqual(revoked, ['blob:0', 'blob:1', 'blob:2']);
assert.equal(render(false).localFile, null); assert.equal(contexts[0].state, 'closed');
render(true); assert.match(players[1].uri, /bumbumbum.mp3/); render(false);
""")

    def test_preferences_file_failure_and_old_play_rejection(self):
        self.check(r"""
stored = '{"volume":50,"muted":false}';
render(true); let bgm = render();
assert.equal(bgm.volume, 50); assert.equal(bgm.trackId, 'swing-along');
let rejectOld;
players[0].play = () => new Promise((_, reject) => { rejectOld = reject; });
bgm.toggle(); bgm = render(); bgm.toggle(); render();
players[0].play = Audio.prototype.play;
render().selectTrack('pop-rocks'); render();
rejectOld(Object.assign(Error('old source failed'), { name: 'NotSupportedError' }));
await flush(); bgm = render(); assert.equal(bgm.error, ''); assert.equal(bgm.playing, true);
sandbox.URL.createObjectURL = () => { throw Error('file access'); };
bgm.loadMp3({name: 'broken.mp3', size: 10}); bgm = render();
assert.match(bgm.error, /読み込めません/); assert.match(players[0].uri, /pop-rocks.mp3/);
render(false); render().loadMp3({name: 'exit.mp3', size: 10});
assert.equal(created.length, 0);
""")

    def test_legacy_migration_starts_muted_and_new_choice_survives_reload(self):
        self.check(r"""
legacy = '{"volume":100,"muted":false,"trackId":"pop-rocks"}';
render(true); let bgm = render();
assert.equal(bgm.volume, 100); assert.equal(bgm.trackId, 'pop-rocks');
assert.equal(bgm.muted, true); assert.equal(players[0].paused, true);
assert.equal(contexts[0].gain.gain.value, 0.25, 'Even maximum volume is one quarter of the old output');
assert.equal(JSON.parse(stored).muted, true, 'Migration persists the silent default');
bgm.changeVolume(-10); render(); document.emit('visibilitychange');
assert.equal(players[0].paused, true, 'Volume changes cannot start playback');
render().toggle(); bgm = render(); assert.equal(bgm.playing, true);
assert.equal(contexts[0].gain.gain.value, 0.225);
render(false); slots.length = 0; effects.length = 0;
legacy = 'invalid old setting'; render(true); bgm = render();
assert.equal(bgm.volume, 90); assert.equal(bgm.trackId, 'pop-rocks');
assert.equal(bgm.muted, false); assert.equal(bgm.playing, true, 'Explicit v2 playback choice survives reload');
render(false);
""")


if __name__ == "__main__":
    unittest.main()
