import { describe, expect, it } from 'vitest';
import { ageOf, isStructuredText, KIND_LABEL, needsAnswer, orderItems, payloadText, tomorrowMorning } from './format';

const NOW = Date.parse('2026-11-17T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;

describe('ageOf', () => {
  it('says just now below a minute and for a time in the future', () => {
    expect(ageOf(ago(30_000), NOW), 'half a minute').toBe('just now');
    expect(ageOf(ago(-5 * MIN), NOW), 'future time').toBe('just now');
  });

  it('counts minutes below an hour', () => {
    expect(ageOf(ago(5 * MIN), NOW), 'five minutes').toBe('5 min ago');
    expect(ageOf(ago(59 * MIN), NOW), 'fifty-nine minutes').toBe('59 min ago');
  });

  it('counts hours up to two days and days after that', () => {
    expect(ageOf(ago(3 * HOUR), NOW), 'three hours').toBe('3 h ago');
    expect(ageOf(ago(47 * HOUR), NOW), 'forty-seven hours').toBe('47 h ago');
    expect(ageOf(ago(72 * HOUR), NOW), 'three days').toBe('3 d ago');
  });
});

describe('KIND_LABEL', () => {
  it('labels every item kind the inbox shows', () => {
    expect(Object.keys(KIND_LABEL).sort(), 'kinds').toEqual(['alert', 'approval', 'failure', 'input', 'reminder', 'review', 'status']);
  });
});

describe('tomorrowMorning', () => {
  it('is 09:00 local time on the next day', () => {
    const next = tomorrowMorning(new Date(2026, 10, 17, 22, 15, 30, 500));
    expect([next.getFullYear(), next.getMonth(), next.getDate()], 'next calendar day').toEqual([2026, 10, 18]);
    expect([next.getHours(), next.getMinutes(), next.getSeconds(), next.getMilliseconds()], 'at nine').toEqual([9, 0, 0, 0]);
  });

  it('rolls over a month end and does not change its input', () => {
    const start = new Date(2026, 10, 30, 8, 0);
    expect(tomorrowMorning(start).getDate(), 'first of December').toBe(1);
    expect(start.getDate(), 'input unchanged').toBe(30);
  });
});

describe('payloadText', () => {
  it('returns a string tool input as is and formats an object as indented JSON', () => {
    expect(payloadText({ toolInput: 'ls -la' }), 'string input').toBe('ls -la');
    expect(payloadText({ toolInput: { path: 'a' } }), 'object input').toBe('{\n  "path": "a"\n}');
  });

  it('returns nothing for a payload without tool input', () => {
    for (const payload of [undefined, null, 'text', 4, {}]) expect(payloadText(payload), `payload ${JSON.stringify(payload)}`).toBeUndefined();
  });
});

describe('orderItems', () => {
  const entry = (id: string, over: Partial<{ kind: string; state: string; urgency: string; createdAt: string }> = {}) => ({ id, kind: 'status', state: 'new', urgency: 'normal', createdAt: ago(HOUR), ...over });

  it('puts open approvals first and then orders by urgency and creation time, newest first', () => {
    const list = [
      entry('old', { createdAt: ago(3 * HOUR) }),
      entry('high', { urgency: 'high', createdAt: ago(2 * HOUR) }),
      entry('new', { createdAt: ago(MIN) }),
      entry('approval', { kind: 'approval', createdAt: ago(5 * HOUR) }),
    ];
    expect(orderItems(list).map((row) => row.id), 'order').toEqual(['approval', 'high', 'new', 'old']);
  });

  it('does not move an item when it is read, and an approval stops needing an answer once it is done or snoozed', () => {
    const unread = [entry('a', { createdAt: ago(2 * MIN) }), entry('b', { createdAt: ago(MIN) })];
    const read = [{ ...unread[0]!, state: 'seen' }, unread[1]!];
    expect(orderItems(read).map((row) => row.id), 'read item keeps its place').toEqual(orderItems(unread).map((row) => row.id));
    expect(needsAnswer(entry('x', { kind: 'approval', state: 'seen' })), 'a seen approval still needs an answer').toBe(true);
    expect(needsAnswer(entry('x', { kind: 'approval', state: 'snoozed' })), 'a snoozed approval does not').toBe(false);
    expect(needsAnswer(entry('x', { kind: 'approval', state: 'done' })), 'a done approval does not').toBe(false);
  });
});

describe('isStructuredText', () => {
  it('recognises JSON objects and arrays and nothing else', () => {
    expect(isStructuredText('{\n  "command": "npm test"\n}'), 'an object').toBe(true);
    expect(isStructuredText('[1, 2]'), 'an array').toBe(true);
    expect(isStructuredText('{not json'), 'broken braces').toBe(false);
    expect(isStructuredText('Step one done.'), 'prose').toBe(false);
    expect(isStructuredText('42'), 'a bare number').toBe(false);
  });
});
