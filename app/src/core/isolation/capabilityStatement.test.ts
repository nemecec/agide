import { describe, expect, it } from 'vitest';
import { describeProvider } from './capabilityStatement';
import { ContainerProvider } from './ContainerProvider';
import { LocalProvider } from './LocalProvider';
import { SrtProvider } from './SrtProvider';

const local = new LocalProvider({ sessionFilesDir: '/nonexistent/s', claudeBinary: '/bin/sh' });
const srt = new SrtProvider({ sessionFilesDir: '/nonexistent/s', srtBinary: 'srt', settingsDir: '/nonexistent/t' });
const container = new ContainerProvider({ sessionFilesDir: '/nonexistent/s', dockerBinary: 'docker', image: 'i', claudeConfigDir: '/nonexistent/c', user: '1:1' });

describe('describeProvider', () => {
  it('says that srt limits writes and the network, leaves reads, loopback and the login open, and allows bypass', () => {
    const statement = describeProvider('srt', srt.capabilities);
    expect(statement.isolated.join(' '), 'what srt limits').toMatch(/Writes.*Network/s);
    const open = statement.notIsolated.join(' ');
    expect(open, 'reads stay open').toContain('Reads');
    expect(open, 'loopback stays open').toContain('Loopback');
    expect(open, 'the login stays readable').toContain('Login');
    expect(statement.bypass.allowed, 'bypass allowed for a limited filesystem and a process-wide allowlist').toBe(true);
    expect(statement.verifiedWithClaude, 'srt ran a real claude (I1)').toBe(true);
  });

  it('says that the container has no network limit, refuses bypass and is not verified with Claude', () => {
    const statement = describeProvider('container', container.capabilities);
    expect(statement.notIsolated.join(' '), 'network is open').toContain('Network');
    expect(statement.bypass, 'bypass refused with the reason').toMatchObject({ allowed: false, reason: expect.stringContaining('limits the network') });
    expect(statement.verifiedWithClaude, 'no real claude ran in a container').toBe(false);
  });

  it('says that the local provider isolates nothing and refuses bypass', () => {
    const statement = describeProvider('local', local.capabilities);
    expect(statement.isolated, 'nothing isolated').toEqual([]);
    expect(statement.bypass.allowed, 'bypass refused').toBe(false);
  });

  it('describes an id without text from its capabilities alone', () => {
    const statement = describeProvider('openshell', container.capabilities);
    expect(statement.label, 'label falls back to the id').toBe('openshell');
    expect(statement.verifiedWithClaude, 'unknown providers are unverified').toBe(false);
  });
});
