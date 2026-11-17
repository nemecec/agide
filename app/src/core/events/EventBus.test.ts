import { describe, expect, it } from 'vitest';
import { EventBus } from './EventBus';

type TestEvent = { type: 'a'; n: number } | { type: 'b'; s: string };

describe('EventBus', () => {
  it('delivers events to handlers of their type and to onAny handlers', () => {
    const bus = new EventBus<TestEvent>();
    const seen: string[] = [];
    bus.on('a', (e) => seen.push(`a:${e.n}`));
    bus.onAny((e) => seen.push(`any:${e.type}`));
    bus.emit({ type: 'a', n: 1 });
    bus.emit({ type: 'b', s: 'x' });
    expect(seen, 'typed handler sees only a, onAny sees both').toEqual(['a:1', 'any:a', 'any:b']);
  });

  it('keeps delivering when a handler throws and stops after unsubscribe', () => {
    const errors: unknown[] = [];
    const bus = new EventBus<TestEvent>((error) => errors.push(error));
    const seen: number[] = [];
    bus.on('a', () => {
      throw new Error('handler failure');
    });
    const off = bus.on('a', (e) => seen.push(e.n));
    bus.emit({ type: 'a', n: 1 });
    off();
    bus.emit({ type: 'a', n: 2 });
    expect(seen, 'second handler ran once, before unsubscribe').toEqual([1]);
    expect(errors, 'both throws reported').toHaveLength(2);
  });
});
