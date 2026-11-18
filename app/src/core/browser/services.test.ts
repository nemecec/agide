import { describe, expect, it } from 'vitest';
import { isChatService } from './services';
import type { ServiceId } from './types';

describe('isChatService', () => {
  it('is true for Slack and Discord and false for every other service', () => {
    const others: ServiceId[] = ['jira', 'github', 'notion', 'web'];
    expect(isChatService('slack'), 'slack').toBe(true);
    expect(isChatService('discord'), 'discord').toBe(true);
    for (const service of others) expect(isChatService(service), service).toBe(false);
  });
});
