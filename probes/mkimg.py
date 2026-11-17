# README: python3 mkimg.py  -> writes fixtures/halves.png (128x64, left half blue, right half red) using only the standard library.
import struct, zlib, pathlib
w, h = 128, 64
rows = b''.join(b'\x00' + (b'\x00\x00\xff' * (w // 2) + b'\xff\x00\x00' * (w // 2)) for _ in range(h))
def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b'')
p = pathlib.Path(__file__).parent / 'fixtures' / 'halves.png'
p.write_bytes(png); print(p, len(png))
