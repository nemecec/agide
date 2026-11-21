import { describe, expect, it } from 'vitest';
import { rowDetail } from './format';

describe('row detail', () => {
  it('shows the last tool of a working agent and the queue state of a waiting one', () => {
    expect(rowDetail({ state: 'running', lastTool: 'Read' }), 'tool of a running agent').toBe('Read');
    expect(rowDetail({ state: 'waiting', queued: true, lastTool: 'Read' }), 'queued wins over the tool').toBe('queued');
    expect(rowDetail({ state: 'running' }), 'nothing to add beside the chip').toBe('');
  });

  it('leaves out an outcome that the status chip already says', () => {
    expect(rowDetail({ state: 'done', outcome: 'completed' }), 'completed beside a done chip').toBe('');
    expect(rowDetail({ state: 'failed', outcome: 'failed' }), 'failed beside a failed chip').toBe('');
  });

  it('names an outcome that differs from the chip', () => {
    expect(rowDetail({ state: 'failed', outcome: 'denied' }), 'denied failure').toBe('denied');
    expect(rowDetail({ state: 'done', outcome: 'stopped' }), 'stopped agent').toBe('stopped');
  });
});
