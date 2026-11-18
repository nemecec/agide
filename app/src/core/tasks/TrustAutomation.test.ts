import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HIGHLIGHT_WAIT_MS, START_WAIT_MS, TrustAutomation } from './TrustAutomation';
import type { TrustState } from './types';

const frame = (JSON.parse(readFileSync(new URL('./fixtures/trust-dialog.json', import.meta.url), 'utf8')) as { frame: string }).frame;
const yesFrame = '\u001b[2G❯\u001b[4GYes,\u001b[9GI\u001b[11Gtrust\u001b[17Gthis\u001b[22Gfolder\r\n';
const noFrame = '\u001b[2G❯\u001b[4GNo,\u001b[8Gexit\r\n';

function setup() {
  const written: string[] = [];
  const states: TrustState[] = [];
  const timers: { work: () => void; ms: number; live: boolean }[] = [];
  const automation = new TrustAutomation({
    write: (_id, data) => written.push(data),
    setTimer: (work, ms) => {
      const timer = { work, ms, live: true };
      timers.push(timer);
      return timer;
    },
    clearTimer: (handle) => {
      (handle as { live: boolean }).live = false;
    },
    onState: (_id, state) => states.push(state),
  });
  const fire = () => timers.filter((t) => t.live).forEach((t) => t.work());
  return { automation, written, states, timers, fire };
}

describe('folder-trust automation', () => {
  it('answers for a folder the app created: Down, the Yes frame, Enter, then SessionStart', () => {
    const { automation, written, states } = setup();
    automation.watch('s', { answer: true });
    automation.output('s', frame);
    expect(written, 'Down sent first').toEqual(['\u001b[B']);
    automation.output('s', yesFrame);
    expect(written, 'Enter after the Yes frame').toEqual(['\u001b[B', '\r']);
    automation.started('s');
    expect(states, 'banner shown then cleared').toEqual(['answering', 'none']);
  });

  it('sends no Enter while the frame still highlights No, exit, and hands over after the wait', () => {
    const { automation, written, states, timers, fire } = setup();
    automation.watch('s', { answer: true });
    automation.output('s', frame);
    automation.output('s', noFrame);
    expect(written, 'no Enter').toEqual(['\u001b[B']);
    expect(timers[0]?.ms, 'highlight wait').toBe(HIGHLIGHT_WAIT_MS);
    fire();
    expect(states, 'user takes over').toEqual(['answering', 'needs_user']);
  });

  it('hands over when SessionStart does not follow Enter', () => {
    const { automation, states, timers, fire } = setup();
    automation.watch('s', { answer: true });
    automation.output('s', frame);
    automation.output('s', yesFrame);
    expect(timers.filter((t) => t.live).map((t) => t.ms), 'start wait').toEqual([START_WAIT_MS]);
    fire();
    expect(states.at(-1), 'needs the user').toBe('needs_user');
  });

  it('only shows the banner when the app may not answer', () => {
    const { automation, written, states } = setup();
    automation.watch('s', { answer: false });
    automation.output('s', frame);
    expect(written, 'no keys sent').toEqual([]);
    expect(states, 'user is asked').toEqual(['user_input']);
    automation.started('s');
    expect(states, 'cleared once the session starts').toEqual(['user_input', 'none']);
  });

  it('stays silent for a session that starts without the dialog', () => {
    const { automation, states } = setup();
    automation.watch('s', { answer: true });
    automation.output('s', 'hello');
    automation.started('s');
    expect(states, 'no state change').toEqual([]);
    expect(automation.watching('s'), 'watch ended').toBe(false);
  });

  it('finds the dialog when its words arrive in separate chunks', () => {
    const { automation, states } = setup();
    automation.watch('s', { answer: false });
    for (const part of [frame.slice(0, 300), frame.slice(300, 700), frame.slice(700)]) automation.output('s', part);
    expect(states, 'detected across chunks').toEqual(['user_input']);
  });

  it('clears every timer on dispose', () => {
    const { automation, timers } = setup();
    automation.watch('s', { answer: true });
    automation.output('s', frame);
    expect(timers.some((timer) => timer.live), 'a timer runs while answering').toBe(true);
    automation.dispose();
    expect(timers.some((timer) => timer.live), 'no timer runs after dispose').toBe(false);
    expect(automation.watching('s'), 'no watch is left').toBe(false);
  });
});
