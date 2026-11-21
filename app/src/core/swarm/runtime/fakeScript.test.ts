import { describe, expect, it } from 'vitest';
import { parseFakeSteps } from './fakeScript';

describe('parseFakeSteps', () => {
  it('reads every step of the language, one per line', () => {
    const steps = parseFakeSteps(['/text all done', '/tool Write {"file_path":"a.txt"}', '/cost 0.25', '/sleep 40', '/fail max_turns', '/write a.txt hello world'].join('\n'));
    expect(steps, 'one step per line, in order').toEqual([
      { kind: 'text', text: 'all done' },
      { kind: 'tool', name: 'Write', input: { file_path: 'a.txt' } },
      { kind: 'cost', usd: 0.25 },
      { kind: 'sleep', ms: 40 },
      { kind: 'fail', reason: 'max_turns' },
      { kind: 'write', file: 'a.txt', text: 'hello world' },
    ]);
  });

  it('gives a tool step without input an empty input and a write step without text an empty text', () => {
    expect(parseFakeSteps('/tool Read'), 'tool without input').toEqual([{ kind: 'tool', name: 'Read', input: {} }]);
    expect(parseFakeSteps('/write empty.txt'), 'write without text').toEqual([{ kind: 'write', file: 'empty.txt', text: '' }]);
  });

  it('defaults the fail reason and the exit code', () => {
    expect(parseFakeSteps('/fail\n/exit'), 'defaults').toEqual([
      { kind: 'fail', reason: 'api_error' },
      { kind: 'exit', code: 0 },
    ]);
    expect(parseFakeSteps('/exit 3'), 'a given code').toEqual([{ kind: 'exit', code: 3 }]);
  });

  it('ignores lines that are not steps and echoes a message without any step', () => {
    expect(parseFakeSteps('hello\n/text kept\nmore'), 'plain lines are skipped between steps').toEqual([{ kind: 'text', text: 'kept' }]);
    expect(parseFakeSteps('hello there'), 'a plain message is echoed').toEqual([{ kind: 'text', text: 'echo: hello there' }]);
    expect(parseFakeSteps('/unknown step'), 'an unknown step counts as no step').toEqual([{ kind: 'text', text: 'echo: /unknown step' }]);
  });

  it('throws on a tool step whose input is not JSON, so a broken script does not pass silently', () => {
    expect(() => parseFakeSteps('/tool Write {not json'), 'invalid input').toThrow();
  });
});
