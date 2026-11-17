import { describe, expect, it } from 'vitest';
import { InMemoryTreeService } from '../tree/InMemoryTreeService';
import { InMemoryInboxService } from './InMemoryInboxService';
import { describeInboxServiceContract } from './inboxServiceContract';
import { cleanLine, cleanText } from './text';

describeInboxServiceContract('InMemoryInboxService', (now) => {
  const tree = new InMemoryTreeService();
  return { inbox: new InMemoryInboxService(tree, { now }), tree };
});

describe('untrusted text cleaning', () => {
  it('removes OSC sequences such as the TUI notifications', () => {
    expect(cleanText('a\u001b]9;Claude needs your permission\u0007b'), 'OSC 9 removed').toBe('ab');
  });

  it('normalizes carriage returns and keeps tabs in long text', () => {
    expect(cleanText('one\r\ntwo\rthree\tfour'), 'line endings and tab').toBe('one\ntwo\nthree\tfour');
    expect(cleanLine('  one\n\ttwo  '), 'single line').toBe('one two');
  });
});
