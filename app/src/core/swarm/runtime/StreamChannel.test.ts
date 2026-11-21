import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { StreamChannel } from './StreamChannel';
import type { NdjsonItem } from './ndjson';

function setup(controlTimeoutMs = 1000) {
  const stdin = new PassThrough();
  const written: Record<string, unknown>[] = [];
  stdin.on('data', (chunk: Buffer) =>
    written.push(
      ...chunk
        .toString()
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>),
    ),
  );
  const messages: Record<string, unknown>[] = [];
  const unreadable: NdjsonItem[] = [];
  const channel = new StreamChannel(stdin, {
    controlTimeoutMs,
    onMessage: (message) => messages.push(message),
    onUnreadable: (item) => unreadable.push(item),
  });
  return { stdin, channel, written, messages, unreadable };
}

const lastRequestId = (written: Record<string, unknown>[]) => written.at(-1)?.['request_id'] as string;

describe('StreamChannel', () => {
  it('writes a user message as one NDJSON line in the shape of the CLI input', () => {
    const { channel, written } = setup();
    channel.writeUser('hello\nsecond line');
    expect(written, 'user message').toEqual([
      {
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'hello\nsecond line' }],
        },
      },
    ]);
  });

  it('writes the answer to a can_use_tool request as a control response with the request id', () => {
    const { channel, written } = setup();
    channel.writePermissionAnswer('req-9', { behavior: 'deny', message: 'no' });
    expect(written, 'control response').toEqual([
      {
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: 'req-9',
          response: { behavior: 'deny', message: 'no' },
        },
      },
    ]);
  });

  it('resolves a control request with the response body that carries its request id', async () => {
    const { channel, written, messages } = setup();
    const pending = channel.request({ subtype: 'initialize' });
    channel.feed(`${JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: lastRequestId(written), response: { models: [] } } })}\n`);
    expect(await pending, 'response body').toEqual({ models: [] });
    expect(
      messages.map((message) => message['type']),
      'the response line is passed on too',
    ).toEqual(['control_response']);
  });

  it('keeps two open requests apart', async () => {
    const { channel, written } = setup();
    const first = channel.request({ subtype: 'a' });
    const firstId = lastRequestId(written);
    const second = channel.request({ subtype: 'b' });
    const secondId = lastRequestId(written);
    const answer = (id: string, body: object) =>
      channel.feed(`${JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: id, response: body } })}\n`);
    answer(secondId, { which: 'b' });
    answer(firstId, { which: 'a' });
    expect(await Promise.all([first, second]), 'each request gets its own answer').toEqual([{ which: 'a' }, { which: 'b' }]);
  });

  it('rejects a control request that the CLI answers with an error', async () => {
    const { channel, written } = setup();
    const pending = channel.request({ subtype: 'nonsense' });
    channel.feed(
      `${JSON.stringify({ type: 'control_response', response: { subtype: 'error', request_id: lastRequestId(written), error: 'Unsupported control request subtype: nonsense' } })}\n`,
    );
    await expect(pending, 'error response').rejects.toMatchObject({
      code: 'unsupported',
      message: 'Unsupported control request subtype: nonsense',
    });
  });

  it('rejects a control request without a response after the timeout', async () => {
    const { channel } = setup(30);
    await expect(channel.request({ subtype: 'initialize' }), 'timeout').rejects.toMatchObject({ code: 'timeout' });
  });

  it('ignores a control response for a request it does not know', () => {
    const { channel, messages } = setup();
    channel.feed(`${JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: 'nobody', response: {} } })}\n`);
    expect(messages, 'passed on, nothing settles').toHaveLength(1);
  });

  it('fails open control requests at once when the process ends', async () => {
    const { channel } = setup();
    const pending = channel.request({ subtype: 'initialize' });
    channel.rejectAll({ code: 'not_running', message: 'ended' } as never);
    await expect(pending, 'open request').rejects.toMatchObject({
      code: 'not_running',
    });
  });

  it('refuses to write after stdin is closed', async () => {
    const { channel } = setup();
    channel.closeStdin();
    expect(channel.writable, 'closed').toBe(false);
    expect(() => channel.writeUser('late'), 'user message').toThrow(expect.objectContaining({ code: 'not_running' }));
    await expect(channel.request({ subtype: 'initialize' }), 'control request').rejects.toMatchObject({ code: 'not_running' });
  });

  it('reports unreadable lines and flushes a last line at the end of the stream', () => {
    const { channel, messages, unreadable } = setup();
    channel.feed('garbage\n{"type":"result"}');
    channel.finish();
    expect(
      unreadable.map((item) => item.kind),
      'garbage reported',
    ).toEqual(['invalid']);
    expect(messages, 'last line delivered').toEqual([{ type: 'result' }]);
  });
});
