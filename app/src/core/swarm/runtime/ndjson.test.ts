import { describe, expect, it } from 'vitest';
import { NdjsonReader, type NdjsonItem } from './ndjson';

const messages = (items: NdjsonItem[]) => items.flatMap((item) => (item.kind === 'message' ? [item.value] : []));

describe('NdjsonReader', () => {
  it('joins a line that arrives in several chunks and keeps the lines around it apart', () => {
    const reader = new NdjsonReader();
    expect(reader.push('{"a":1}\n{"b"'), 'only the complete line is returned').toEqual([{ kind: 'message', value: { a: 1 } }]);
    expect(reader.push(':2}'), 'the rest of the line is still held').toEqual([]);
    expect(messages(reader.push('\n{"c":3}\n')), 'the held line completes, the next one follows').toEqual([{ b: 2 }, { c: 3 }]);
  });

  it('reads a multi-byte character that is cut between two chunks', () => {
    const reader = new NdjsonReader();
    const bytes = Buffer.from('{"text":"ä€"}\n', 'utf8');
    const cut = bytes.indexOf(0xe2) + 1;
    expect(reader.push(bytes.subarray(0, cut)), 'nothing before the newline').toEqual([]);
    expect(messages(reader.push(bytes.subarray(cut))), 'the character is whole').toEqual([{ text: 'ä€' }]);
  });

  it('skips blank lines and accepts CRLF line ends', () => {
    expect(messages(new NdjsonReader().push('\n  \r\n{"a":1}\r\n')), 'one message').toEqual([{ a: 1 }]);
  });

  it('reports a line that is not a JSON object and goes on with the next line', () => {
    const items = new NdjsonReader().push('not json\n[1,2]\n42\n{"ok":true}\n');
    expect(
      items.map((item) => item.kind),
      'three unreadable lines and one message',
    ).toEqual(['invalid', 'invalid', 'invalid', 'message']);
    expect(items[0], 'the text of the bad line is kept for the log').toEqual({
      kind: 'invalid',
      text: 'not json',
    });
  });

  it('cuts the logged text of a long bad line', () => {
    const [item] = new NdjsonReader().push(`${'x'.repeat(1000)}\n`);
    expect(item?.kind === 'invalid' && item.text.length, 'log text is short').toBeLessThan(300);
  });

  it('drops a line over the limit, also when it arrives in pieces, and reads the next line', () => {
    const reader = new NdjsonReader(16);
    expect(reader.push('{"long":"0123'), 'still within the limit').toEqual([]);
    expect(reader.push('456789012345"'), 'over the limit now').toEqual([]);
    const items = reader.push('}\n{"after":1}\n');
    expect(items[0], 'the long line is reported with its size').toMatchObject({
      kind: 'dropped',
      bytes: 27,
    });
    expect(items[1], 'the next line is read').toEqual({
      kind: 'message',
      value: { after: 1 },
    });
  });

  it('drops a line over the limit that comes in one chunk with its newline', () => {
    const items = new NdjsonReader(8).push('{"x":"yyyyyyyyyy"}\n{"a":1}\n');
    expect(
      items.map((item) => item.kind),
      'dropped, then message',
    ).toEqual(['dropped', 'message']);
  });

  it('returns the last line at the end of the stream even without a newline', () => {
    const reader = new NdjsonReader();
    expect(reader.push('{"last":true}'), 'held').toEqual([]);
    expect(reader.end(), 'flushed at the end').toEqual([{ kind: 'message', value: { last: true } }]);
    expect(reader.end(), 'nothing is left afterwards').toEqual([]);
  });

  it('passes unknown keys and types through untouched', () => {
    const [item] = new NdjsonReader().push('{"type":"from_the_future","nested":{"deep":[1,{"x":null}]}}\n');
    expect(item, 'the whole object').toEqual({
      kind: 'message',
      value: { type: 'from_the_future', nested: { deep: [1, { x: null }] } },
    });
  });
});
