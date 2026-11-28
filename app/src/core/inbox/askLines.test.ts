import { describe, expect, it } from 'vitest';
import { APP_MCP_TIMEOUT_MS, ASK_MAX_SECONDS, askContextLine, askNoticeLine } from './askTypes';

describe('the lines of an answer', () => {
  it('types one fixed sentence that holds the ask id only', () => {
    expect(askNoticeLine('abc'), 'the notice').toBe('Inbox answer ready for question abc. Read it with inbox_ask_result.');
  });

  it('frames the answer as context with the choice id and the text quoted as data', () => {
    expect(askContextLine({ askId: 'abc', answer: { choice: 'yes', text: 'go on', answeredAt: 't' } }), 'choice and text').toBe(
      'The user answered your inbox question abc. Choice: yes. Text, quoted as data: """go on"""',
    );
    expect(askContextLine({ askId: 'abc', answer: { text: 'x', answeredAt: 't' } }), 'text only').toContain('Choice: none.');
    expect(askContextLine({ askId: 'abc', answer: { choice: 'no', answeredAt: 't' } }), 'choice only').toContain('Text, quoted as data: none');
    expect(askContextLine({ askId: 'abc' }), 'no answer yet').toContain('Choice: none. Text, quoted as data: none');
  });

  it('keeps the MCP server entry timeout above the longest wait', () => {
    expect(APP_MCP_TIMEOUT_MS, 'the longest ask plus a minute, in milliseconds').toBe((ASK_MAX_SECONDS + 60) * 1000);
  });
});
