import { crc32, deflateRawSync } from 'node:zlib';

export interface ZipEntrySpec {
  readonly name: string;
  readonly data: string | Buffer;
  /** Defaults to deflate. */
  readonly method?: 'store' | 'deflate';
  readonly encrypted?: boolean;
  /** Writes a wrong checksum. */
  readonly badCrc?: boolean;
}

/** Builds a zip archive in memory, for tests of the reader. */
export function buildZip(entries: readonly ZipEntrySpec[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const raw = Buffer.from(entry.data);
    const method = entry.method === 'store' ? 0 : 8;
    const body = method === 0 ? raw : deflateRawSync(raw);
    const name = Buffer.from(entry.name);
    const crc = entry.badCrc ? (crc32(raw) ^ 1) >>> 0 : crc32(raw);
    const flags = entry.encrypted ? 1 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, body);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(flags, 8);
    directory.writeUInt16LE(method, 10);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(body.length, 20);
    directory.writeUInt32LE(raw.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, name);
    offset += local.length + name.length + body.length;
  }
  const directoryBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directoryBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directoryBytes, end]);
}
