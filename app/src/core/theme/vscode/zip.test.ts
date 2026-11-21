import { describe, expect, it } from 'vitest';
import { MAX_ENTRY_BYTES, ZipError, ZipReader } from './zip';
import { buildZip } from './zipFixture';

describe('ZipReader', () => {
  it('reads stored and deflated entries by name', () => {
    const zip = new ZipReader(buildZip([{ name: 'a.txt', data: 'alpha', method: 'store' }, { name: 'dir/b.txt', data: 'beta '.repeat(100) }]));
    expect(zip.names(), 'both names listed').toEqual(['a.txt', 'dir/b.txt']);
    expect(zip.read('a.txt').toString(), 'stored entry').toBe('alpha');
    expect(zip.read('dir/b.txt').toString(), 'deflated entry').toBe('beta '.repeat(100));
  });

  it('refuses bytes that are not a zip archive', () => {
    expect(() => new ZipReader(Buffer.from('not a zip file at all, just text')), 'plain text').toThrow(ZipError);
  });

  it('refuses an encrypted entry when the archive is opened', () => {
    expect(() => new ZipReader(buildZip([{ name: 'secret', data: 'x', encrypted: true }])), 'encrypted entry').toThrow(/encrypted/);
  });

  it('refuses an entry whose checksum does not match', () => {
    const zip = new ZipReader(buildZip([{ name: 'a.txt', data: 'alpha', badCrc: true }]));
    expect(() => zip.read('a.txt'), 'checksum').toThrow(/checksum/);
  });

  it('refuses to inflate an entry larger than the limit', () => {
    const zip = new ZipReader(buildZip([{ name: 'big.txt', data: Buffer.alloc(MAX_ENTRY_BYTES + 1, 97) }]));
    expect(() => zip.read('big.txt'), 'oversized entry').toThrow(/larger/);
  });

  it('reports a missing entry as an error', () => {
    expect(() => new ZipReader(buildZip([{ name: 'a', data: 'x' }])).read('b'), 'unknown name').toThrow(/no entry/);
  });
});
