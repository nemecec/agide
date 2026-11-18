import { describe, expect, it } from 'vitest';
import { hostAllowed, originAllowed } from './hosts';

describe('host allowlist', () => {
  it('matches exact hosts without regard to case', () => {
    expect(hostAllowed('GitHub.com', ['github.com']), 'case of the host').toBe(true);
    expect(hostAllowed('api.github.com', ['github.com']), 'a subdomain needs a wildcard').toBe(false);
  });

  it('covers subdomains with a wildcard entry and not the bare domain or a lookalike', () => {
    expect(hostAllowed('a.b.example.com', ['*.example.com']), 'nested subdomain').toBe(true);
    expect(hostAllowed('example.com', ['*.example.com']), 'bare domain').toBe(false);
    expect(hostAllowed('badexample.com', ['*.example.com']), 'lookalike suffix').toBe(false);
  });

  it('covers https origins only', () => {
    expect(originAllowed('https://github.com', ['github.com']), 'https origin on the list').toBe(true);
    expect(originAllowed('http://github.com', ['github.com']), 'plain http').toBe(false);
    expect(originAllowed('not a url', ['github.com']), 'unparsable origin').toBe(false);
  });
});
