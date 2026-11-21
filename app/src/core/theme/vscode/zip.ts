import { crc32, inflateRawSync } from 'node:zlib';

export const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
export const MAX_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_ENTRIES = 20_000;

export class ZipError extends Error {}

interface Entry {
  readonly name: string;
  readonly method: number;
  readonly compressedSize: number;
  readonly size: number;
  readonly crc: number;
  readonly offset: number;
}

/**
 * A reader for the central directory of a zip file held in memory. It lists names and inflates single entries on
 * request; nothing is written to disk and no entry is run. Encrypted entries, zip64 archives and methods other
 * than stored and deflate are refused.
 */
export class ZipReader {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly bytes: Buffer) {
    if (bytes.length > MAX_ARCHIVE_BYTES) throw new ZipError('the archive is larger than the importer reads');
    this.readDirectory();
  }

  names(): string[] {
    return [...this.entries.keys()];
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  /** The inflated bytes of one entry, checked against the size and checksum the archive states. */
  read(name: string): Buffer {
    const entry = this.entries.get(name);
    if (!entry) throw new ZipError(`the archive has no entry ${name}`);
    if (entry.size > MAX_ENTRY_BYTES) throw new ZipError(`entry ${name} is larger than the importer reads`);
    const local = entry.offset;
    if (local + 30 > this.bytes.length || this.bytes.readUInt32LE(local) !== 0x04034b50) throw new ZipError(`entry ${name} has a bad local header`);
    const start = local + 30 + this.bytes.readUInt16LE(local + 26) + this.bytes.readUInt16LE(local + 28);
    const raw = this.bytes.subarray(start, start + entry.compressedSize);
    if (raw.length !== entry.compressedSize) throw new ZipError(`entry ${name} is cut short`);
    let data: Buffer;
    try {
      data = entry.method === 0 ? Buffer.from(raw) : inflateRawSync(raw, { maxOutputLength: MAX_ENTRY_BYTES });
    } catch {
      throw new ZipError(`entry ${name} does not inflate`);
    }
    if (data.length !== entry.size || crc32(data) !== entry.crc) throw new ZipError(`entry ${name} fails its checksum`);
    return data;
  }

  private readDirectory(): void {
    const { bytes } = this;
    const searchFrom = Math.max(0, bytes.length - 22 - 0xffff);
    let end = -1;
    for (let at = bytes.length - 22; at >= searchFrom; at--) {
      if (bytes.readUInt32LE(at) === 0x06054b50) {
        end = at;
        break;
      }
    }
    if (end < 0) throw new ZipError('the file is not a zip archive');
    const count = bytes.readUInt16LE(end + 10);
    const size = bytes.readUInt32LE(end + 12);
    let at = bytes.readUInt32LE(end + 16);
    if (count === 0xffff || size === 0xffffffff || at === 0xffffffff) throw new ZipError('zip64 archives are not read');
    if (count > MAX_ENTRIES) throw new ZipError('the archive has too many entries');
    for (let index = 0; index < count; index++) {
      if (at + 46 > bytes.length || bytes.readUInt32LE(at) !== 0x02014b50) throw new ZipError('the central directory is damaged');
      const flags = bytes.readUInt16LE(at + 8);
      const nameLength = bytes.readUInt16LE(at + 28);
      const name = bytes.toString('utf8', at + 46, at + 46 + nameLength);
      const entry: Entry = {
        name,
        method: bytes.readUInt16LE(at + 10),
        crc: bytes.readUInt32LE(at + 16),
        compressedSize: bytes.readUInt32LE(at + 20),
        size: bytes.readUInt32LE(at + 24),
        offset: bytes.readUInt32LE(at + 42),
      };
      if (entry.compressedSize === 0xffffffff || entry.size === 0xffffffff || entry.offset === 0xffffffff) throw new ZipError('zip64 archives are not read');
      if ((flags & 1) !== 0) throw new ZipError(`entry ${name} is encrypted`);
      if (entry.method !== 0 && entry.method !== 8) throw new ZipError(`entry ${name} uses a compression method the importer does not read`);
      this.entries.set(name, entry);
      at += 46 + nameLength + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32);
    }
  }
}
