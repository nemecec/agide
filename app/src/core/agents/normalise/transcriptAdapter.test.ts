import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { outcomeFromTail, readTailLines } from './outcomeCheck';
import { isApiErrorLine, isInterruptLine, parseCostState, parseMeta, parseUsageLine } from './transcriptAdapter';

const assistant = (id: string, usage: object, extra: object = {}) =>
  JSON.stringify({ type: 'assistant', timestamp: '2026-11-17T10:00:00.000Z', message: { id, model: 'claude-haiku-5-5', content: [], usage }, ...extra });

describe('parseUsageLine', () => {
  it('reads the message id, model and token classes with the cache write split', () => {
    const line = assistant('msg_1', { input_tokens: 4, output_tokens: 3, cache_creation_input_tokens: 1024, cache_read_input_tokens: 48991, cache_creation: { ephemeral_5m_input_tokens: 24, ephemeral_1h_input_tokens: 1000 } });
    expect(parseUsageLine(line), 'usage').toEqual({
      messageId: 'msg_1',
      model: 'claude-haiku-5-5',
      at: '2026-11-17T10:00:00.000Z',
      usage: { input: 4, output: 3, cacheWrite5m: 24, cacheWrite1h: 1000, cacheRead: 48991 },
    });
  });

  it('counts a cache write without a split as the 5-minute class', () => {
    const usage = parseUsageLine(assistant('m', { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 500 }))?.usage;
    expect(usage, 'whole write in 5m').toMatchObject({ cacheWrite5m: 500, cacheWrite1h: 0 });
  });

  it('skips lines that are not assistant lines with a message id and usage', () => {
    expect(parseUsageLine('{"type":"user","message":{"role":"user"}}'), 'user line').toBeUndefined();
    expect(parseUsageLine('{"type":"assistant","message":{"usage":{}}}'), 'no id').toBeUndefined();
    expect(parseUsageLine('not json'), 'not json').toBeUndefined();
  });
});

describe('transcript markers', () => {
  it('finds the cost at exit in a cost-state row, also when nested', () => {
    expect(parseCostState('{"type":"cost-state","totalCostUSD":0.0142}'), 'top level').toBe(0.0142);
    expect(parseCostState('{"type":"cost-state","state":{"totalCostUSD":0.5,"modelUsage":{}}}'), 'nested').toBe(0.5);
    expect(parseCostState('{"type":"assistant"}'), 'other row').toBeUndefined();
  });

  it('recognises the interrupt line and an API error line', () => {
    const interrupt = JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } });
    expect(isInterruptLine(interrupt), 'interrupt').toBe(true);
    expect(isInterruptLine(assistant('m', {})), 'assistant line is no interrupt').toBe(false);
    expect(isApiErrorLine(assistant('m', {}, { isApiErrorMessage: true })), 'api error').toBe(true);
  });

  it('reads agent metadata and the finished flag', () => {
    expect(parseMeta('{"agentType":"general-purpose","description":"d","toolUseId":"t","finished":true}'), 'meta').toEqual({ agentType: 'general-purpose', description: 'd', toolUseId: 't', finished: true });
    expect(parseMeta('oops'), 'bad json').toBeUndefined();
  });
});

describe('outcome check on the end of a transcript', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });
  const write = (lines: string[]): string => {
    dir = mkdtempSync(join(tmpdir(), 'agents-tail-'));
    const path = join(dir, 'agent.jsonl');
    writeFileSync(path, `${lines.join('\n')}\n`);
    return path;
  };

  it('reports stopped after an interrupt line, failed after an API error line and completed otherwise', () => {
    const interrupt = JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] } });
    expect(outcomeFromTail(readTailLines(write([assistant('a', {}), interrupt]))), 'interrupt').toBe('stopped');
    expect(outcomeFromTail(readTailLines(write([assistant('a', {}, { isApiErrorMessage: true })]))), 'api error').toBe('failed');
    expect(outcomeFromTail(readTailLines(write([assistant('a', {})]))), 'normal end').toBe('completed');
    expect(outcomeFromTail(readTailLines('/nonexistent/file.jsonl')), 'missing file stays completed').toBe('completed');
  });

  it('reads at most the tail and drops the line it starts inside', () => {
    const lines = Array.from({ length: 200 }, (_, i) => assistant(`m${i}`, {}));
    const tail = readTailLines(write(lines), 2000) ?? [];
    expect(tail.length, 'fewer lines than the file').toBeLessThan(200);
    expect(() => tail.forEach((line) => JSON.parse(line)), 'every returned line is whole').not.toThrow();
  });
});
