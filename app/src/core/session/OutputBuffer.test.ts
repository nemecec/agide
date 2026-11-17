import { describe, expect, it } from 'vitest';
import { OutputBuffer } from './OutputBuffer';

describe('OutputBuffer', () => {
  it('returns appended output in order', () => {
    const buffer = new OutputBuffer(100);
    buffer.append('one ');
    buffer.append('two');
    expect(buffer.read(), 'output below the limit').toBe('one two');
  });

  it('drops the oldest chunks past the limit and keeps the newest', () => {
    const buffer = new OutputBuffer(10);
    buffer.append('aaaa');
    buffer.append('bbbb');
    buffer.append('cccc');
    expect(buffer.read(), 'output after trimming').toBe('bbbbcccc');
  });

  it('keeps the latest chunk even when it alone exceeds the limit', () => {
    const buffer = new OutputBuffer(3);
    buffer.append('old');
    buffer.append('a long newest chunk');
    expect(buffer.read(), 'only the newest chunk').toBe('a long newest chunk');
  });
});
