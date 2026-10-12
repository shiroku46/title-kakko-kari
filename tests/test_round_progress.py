"""Run the actual timer logic with controlled time and React effects."""
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HARNESS = r"""
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
// Rendered JSX is checked separately in the exported browser application.
const source = readFileSync('client/src/components/RoundProgress.js', 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace('export default function', 'function')
  .split('  return <View')[0] + '\nreturn { seconds, clock, urgent, warning, noticeText, advance, pending, error }; }\nRoundProgress;';
const slots = [], effects = [], timers = new Map(), requests = [];
let cursor = 0, time = 1000000, sequence = 0;
const props = { roundId: 'r', phase: 'submitting', deadlineAt: time + 181000, ready: false,
  consent: true, canAdvance: true, socket: { connected: true,
    timeout: milliseconds => ({ emit(event, data, reply) { requests.push({ milliseconds, event, data, reply }); } }) } };
const component = runInNewContext(source, { Date: { now: () => time },
  useResponsiveLayout: () => ({ isMobile: false }),
  setInterval(callback) { const id = ++sequence; timers.set(id, callback); return id; },
  clearInterval(id) { timers.delete(id); },
  useState(initial) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
    return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
  },
  useEffect(run, deps) {
    const index = cursor++, previous = effects[index];
    if (!previous || deps.some((value, i) => value !== previous.deps[i]))
      effects[index] = { deps, run, cleanup: previous?.cleanup, pending: true };
  },
});
function render() {
  cursor = 0; const result = component(props);
  for (const effect of effects) if (effect?.pending) {
    effect.pending = false; effect.cleanup?.(); effect.cleanup = effect.run();
  }
  return result;
}
function tick(milliseconds) { time += milliseconds; for (const callback of [...timers.values()]) callback(); return render(); }
function unmount() { for (const effect of effects) effect?.cleanup?.(); slots.length = 0; effects.length = 0; }
"""


class TestRoundProgress(unittest.TestCase):
    def check(self, scenario):
        result = subprocess.run(["node", "-e", HARNESS + scenario], cwd=ROOT,
                                capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)

    def test_minute_notice_expires_and_throttled_tick_uses_current_deadline(self):
        self.check(r"""
let timer = render(); assert.equal(timer.clock, '3:01'); assert.equal(timer.noticeText, '');
timer = tick(1000); assert.equal(timer.clock, '3:00'); assert.equal(timer.noticeText, '残り3分です。');
timer = tick(5000); assert.equal(timer.noticeText, '');
timer = tick(116000); assert.equal(timer.clock, '0:59'); assert.equal(timer.noticeText, '残り1分です。');
timer = tick(1000); assert.equal(timer.clock, '0:58'); assert.equal(timer.noticeText, '残り1分です。');
assert.equal(timers.size, 1); unmount(); assert.equal(timers.size, 0);
""")

    def test_warning_countdown_zero_and_clock_rounding(self):
        self.check(r"""
props.deadlineAt = time + 31001; let timer = render(); assert.equal(timer.seconds, 32);
timer = tick(1001); assert.equal(timer.clock, '0:30'); assert.equal(timer.warning, true);
assert.equal(timer.urgent, false); assert.match(timer.noticeText, /残り30秒/);
timer = tick(20000); assert.equal(timer.clock, '0:10'); assert.equal(timer.urgent, true);
assert.equal(timer.noticeText, 'あと10秒で締め切りです。');
timer = tick(1000); assert.equal(timer.noticeText, 'あと9秒で締め切りです。');
timer = tick(20000); assert.equal(timer.clock, '0:00'); assert.equal(timer.seconds, 0);
assert.match(timer.noticeText, /時間になりました/); assert.equal(timers.size, 0);
unmount(); props.deadlineAt = time - 1000; timer = render();
assert.equal(timer.clock, '0:00'); assert.equal(timers.size, 0);
""")

    def test_untimed_inactive_and_completed_phases_do_not_alert(self):
        self.check(r"""
props.deadlineAt = null; let timer = render(); assert.equal(timers.size, 0);
assert.equal(timer.noticeText, ''); assert.equal(timer.urgent, false);
props.consent = false; assert.equal(render(), null);
props.phase = 'revealed'; props.deadlineAt = time + 5000;
assert.equal(render(), null); assert.equal(timers.size, 0);
unmount(); props.phase = 'submitting'; props.consent = true; props.ready = false;
render(); assert.equal(timers.size, 1);
props.ready = true; render(); timer = render();
assert.equal(timers.size, 0); assert.equal(timer.noticeText, ''); assert.equal(timer.urgent, false);
""")

    def test_keyed_phase_reset_and_consent_controls_keep_existing_contract(self):
        self.check(r"""
render(); tick(1000); let timer = render(); assert.match(timer.noticeText, /3分/);
timer.advance(); assert.equal(render().pending, true);
assert.equal(requests[0].event, 'round:advance_phase'); assert.equal(requests[0].data.roundId, 'r');
assert.equal(requests[0].milliseconds, 10000);
requests[0].reply(null, { ok: false, error: '待ってください' });
timer = render(); assert.equal(timer.pending, false); assert.equal(timer.error, '待ってください');
unmount(); props.phase = 'voting'; props.roundId = 'next'; props.deadlineAt = time + 5000;
timer = render(); assert.equal(timers.size, 0); assert.equal(timer.noticeText, ''); assert.equal(timer.error, null);
assert.equal(timer.urgent, false); assert.equal(timer.warning, false);
tick(60000); timer = render(); assert.equal(timer.noticeText, ''); assert.equal(timers.size, 0);
props.socket.connected = false; timer.advance(); assert.equal(requests.length, 1);
props.socket.connected = true; timer.advance(); requests[1].reply(null, { ok: true });
assert.equal(render().error, null); unmount(); assert.equal(timers.size, 0);
props.consent = false; assert.equal(render(), null); assert.equal(timers.size, 0);
""")

    @unittest.skipUnless((ROOT / "client/node_modules/@babel/core").exists(),
                         "Rendered component check requires npm ci in client")
    def test_rendered_voting_has_no_timer_and_keeps_consent_controls(self):
        result = subprocess.run(["node", "-e", r"""
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const React = require('./client/node_modules/react');
const { renderToStaticMarkup } = require('./client/node_modules/react-dom/server');
const { transformSync } = require('./client/node_modules/@babel/core');
const source = transformSync(readFileSync('client/src/components/RoundProgress.js', 'utf8'), {
  configFile: false, babelrc: false, plugins: [
    require.resolve('./client/node_modules/@babel/plugin-transform-react-jsx'),
    require.resolve('./client/node_modules/@babel/plugin-transform-modules-commonjs'),
  ],
}).code;
const module = { exports: {} };
runInNewContext(source, { module, exports: module.exports, Date, require(name) {
  if (name === 'react') return React;
  if (name === 'react-native') return { View: 'div', StyleSheet: { create: value => value } };
  if (name === './ui/GameText') return { Text: ({ children }) => React.createElement('span', null, children) };
  if (name === './ui') return { StationeryButton: ({ children, disabled }) => React.createElement('button', { disabled }, children) };
  if (name === '../theme') return { colors: {} };
  if (name === '../hooks/useResponsiveLayout') return { useResponsiveLayout: () => ({ isMobile: false }) };
  throw new Error(name);
} });
const props = { phase: 'voting', deadlineAt: Date.now() + 5000, ready: false, consent: false, canAdvance: true };
const render = () => renderToStaticMarkup(React.createElement(module.exports.default, props));
assert.equal(render(), '');
props.consent = true;
let html = render();
assert.doesNotMatch(html, /残り時間|制限時間|時間制限|受付終了|締め切り|0:05/);
assert.match(html, /投票が揃うまで待っています。/);
assert.match(html, /<button disabled="">正解を発表する<\/button>/);
props.ready = true; html = render();
assert.match(html, /出題者の同意を待っています。/);
assert.match(html, /<button>正解を発表する<\/button>/);
props.canAdvance = false; assert.doesNotMatch(render(), /<button/);
props.phase = 'submitting'; props.ready = false;
assert.match(render(), /回答の残り時間/); assert.match(render(), /あと5秒で締め切りです。/);
"""], cwd=ROOT, capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)


if __name__ == "__main__":
    unittest.main()
