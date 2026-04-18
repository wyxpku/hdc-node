/**
 * Tests for TAR Header Module
 *
 * Tests TarHeader encode/decode for file and directory entries.
 */

import { describe, it, expect } from 'vitest';
import {
  TarHeader,
  encodeTarHeader,
  decodeTarHeader,
  TAR_HEADER_SIZE,
  TAR_MAGIC,
} from './header.js';

// ============================================================================
// Constants
// ============================================================================

describe('TAR Constants', () => {
  it('TAR_HEADER_SIZE should be 512', () => {
    expect(TAR_HEADER_SIZE).toBe(512);
  });

  it('TAR_MAGIC should be ustar', () => {
    expect(TAR_MAGIC).toBe('ustar');
  });
});

// ============================================================================
// encodeTarHeader
// ============================================================================

describe('encodeTarHeader', () => {
  it('should produce exactly 512 bytes', () => {
    const hdr: TarHeader = {
      filename: 'test.txt',
      fileSize: 100,
      mtime: 1700000000,
      typeFlag: '0',
      prefix: '',
    };

    const buf = encodeTarHeader(hdr);
    expect(buf.length).toBe(512);
  });

  it('should encode filename at offset 0', () => {
    const hdr: TarHeader = {
      filename: 'hello.txt',
      fileSize: 0,
      mtime: 0,
      typeFlag: '0',
      prefix: '',
    };

    const buf = encodeTarHeader(hdr);
    const filename = buf.toString('utf-8', 0, 100).replace(/\0+$/, '');
    expect(filename).toBe('hello.txt');
  });

  it('should encode fileSize as octal at offset 124', () => {
    const hdr: TarHeader = {
      filename: 'test.txt',
      fileSize: 1024,
      mtime: 0,
      typeFlag: '0',
      prefix: '',
    };

    const buf = encodeTarHeader(hdr);
    const sizeStr = buf.toString('utf-8', 124, 136).replace(/\0+$/, '').trim();
    expect(parseInt(sizeStr, 8)).toBe(1024);
  });

  it('should encode mtime as octal at offset 136', () => {
    const hdr: TarHeader = {
      filename: 'test.txt',
      fileSize: 0,
      mtime: 1700000000,
      typeFlag: '0',
      prefix: '',
    };

    const buf = encodeTarHeader(hdr);
    const mtimeStr = buf.toString('utf-8', 136, 148).replace(/\0+$/, '').trim();
    expect(parseInt(mtimeStr, 8)).toBe(1700000000);
  });

  it('should encode typeFlag at offset 156', () => {
    const fileHdr: TarHeader = {
      filename: 'test.txt',
      fileSize: 0,
      mtime: 0,
      typeFlag: '0',
      prefix: '',
    };
    const fileBuf = encodeTarHeader(fileHdr);
    expect(fileBuf.toString('utf-8', 156, 157)).toBe('0');

    const dirHdr: TarHeader = {
      filename: 'mydir/',
      fileSize: 0,
      mtime: 0,
      typeFlag: '5',
      prefix: '',
    };
    const dirBuf = encodeTarHeader(dirHdr);
    expect(dirBuf.toString('utf-8', 156, 157)).toBe('5');
  });

  it('should encode magic at offset 257', () => {
    const hdr: TarHeader = {
      filename: 'test.txt',
      fileSize: 0,
      mtime: 0,
      typeFlag: '0',
      prefix: '',
    };

    const buf = encodeTarHeader(hdr);
    const magic = buf.toString('utf-8', 257, 262).replace(/\0+$/, '');
    expect(magic).toBe('ustar');
  });

  it('should encode prefix at offset 345', () => {
    const hdr: TarHeader = {
      filename: 'test.txt',
      fileSize: 0,
      mtime: 0,
      typeFlag: '0',
      prefix: 'some/prefix',
    };

    const buf = encodeTarHeader(hdr);
    const prefix = buf.toString('utf-8', 345, 345 + 155).replace(/\0+$/, '');
    expect(prefix).toBe('some/prefix');
  });

  it('should compute and write valid checksum at offset 148', () => {
    const hdr: TarHeader = {
      filename: 'test.txt',
      fileSize: 100,
      mtime: 1700000000,
      typeFlag: '0',
      prefix: '',
    };

    const buf = encodeTarHeader(hdr);
    const checksumStr = buf.toString('utf-8', 148, 156).replace(/\0+$/, '').trim();
    const storedChecksum = parseInt(checksumStr, 8);

    // Verify checksum by recalculating: sum of all bytes with checksum field as spaces
    const verifyBuf = Buffer.from(buf);
    verifyBuf.write('        ', 148, 8, 'utf-8'); // replace checksum field with spaces
    let computedChecksum = 0;
    for (let i = 0; i < TAR_HEADER_SIZE; i++) {
      computedChecksum += verifyBuf[i];
    }

    expect(storedChecksum).toBe(computedChecksum);
  });

  it('should truncate long filenames to 99 bytes', () => {
    const longName = 'a'.repeat(200);
    const hdr: TarHeader = {
      filename: longName,
      fileSize: 0,
      mtime: 0,
      typeFlag: '0',
      prefix: '',
    };

    const buf = encodeTarHeader(hdr);
    const filename = buf.toString('utf-8', 0, 100).replace(/\0+$/, '');
    expect(filename.length).toBeLessThanOrEqual(99);
    expect(filename).toBe(longName.substring(0, 99));
  });

  it('should handle zero fileSize', () => {
    const hdr: TarHeader = {
      filename: 'empty.txt',
      fileSize: 0,
      mtime: 0,
      typeFlag: '0',
      prefix: '',
    };

    const buf = encodeTarHeader(hdr);
    const sizeStr = buf.toString('utf-8', 124, 136).replace(/\0+$/, '').trim();
    const size = sizeStr ? parseInt(sizeStr, 8) : 0;
    expect(size).toBe(0);
  });
});

// ============================================================================
// decodeTarHeader
// ============================================================================

describe('decodeTarHeader', () => {
  it('should round-trip a file entry', () => {
    const original: TarHeader = {
      filename: 'myfile.txt',
      fileSize: 2048,
      mtime: 1700000500,
      typeFlag: '0',
      prefix: '',
    };

    const encoded = encodeTarHeader(original);
    const decoded = decodeTarHeader(encoded);

    expect(decoded).not.toBeNull();
    expect(decoded!.filename).toBe('myfile.txt');
    expect(decoded!.fileSize).toBe(2048);
    expect(decoded!.mtime).toBe(1700000500);
    expect(decoded!.typeFlag).toBe('0');
    expect(decoded!.prefix).toBe('');
  });

  it('should round-trip a directory entry', () => {
    const original: TarHeader = {
      filename: 'mydir/',
      fileSize: 0,
      mtime: 1700000000,
      typeFlag: '5',
      prefix: '',
    };

    const encoded = encodeTarHeader(original);
    const decoded = decodeTarHeader(encoded);

    expect(decoded).not.toBeNull();
    expect(decoded!.filename).toBe('mydir/');
    expect(decoded!.fileSize).toBe(0);
    expect(decoded!.typeFlag).toBe('5');
  });

  it('should round-trip with prefix', () => {
    const original: TarHeader = {
      filename: 'test.txt',
      fileSize: 100,
      mtime: 1700000000,
      typeFlag: '0',
      prefix: 'sub/dir',
    };

    const encoded = encodeTarHeader(original);
    const decoded = decodeTarHeader(encoded);

    expect(decoded).not.toBeNull();
    expect(decoded!.prefix).toBe('sub/dir');
  });

  it('should return null for buffer too small', () => {
    const buf = Buffer.alloc(511);
    const decoded = decodeTarHeader(buf);
    expect(decoded).toBeNull();
  });

  it('should return null for empty buffer with no filename', () => {
    const buf = Buffer.alloc(512, 0);
    const decoded = decodeTarHeader(buf);
    // All zeros means no filename, so should return null
    expect(decoded).toBeNull();
  });

  it('should decode a manually crafted header', () => {
    const buf = Buffer.alloc(512, 0);

    // Write filename
    buf.write('manual.txt', 0, 10, 'utf-8');

    // Write fileSize in octal (100 decimal = 0144 octal)
    buf.write('00000000144\0', 124, 12, 'utf-8');

    // Write mtime in octal
    buf.write('00000000000\0', 136, 12, 'utf-8');

    // Write typeFlag
    buf.write('0', 156, 1, 'utf-8');

    // Write magic
    buf.write('ustar', 257, 5, 'utf-8');

    const decoded = decodeTarHeader(buf);

    expect(decoded).not.toBeNull();
    expect(decoded!.filename).toBe('manual.txt');
    expect(decoded!.fileSize).toBe(100);
    expect(decoded!.typeFlag).toBe('0');
  });

  it('should handle large file sizes', () => {
    const original: TarHeader = {
      filename: 'bigfile.iso',
      fileSize: 1073741824, // 1GB
      mtime: 1700000000,
      typeFlag: '0',
      prefix: '',
    };

    const encoded = encodeTarHeader(original);
    const decoded = decodeTarHeader(encoded);

    expect(decoded).not.toBeNull();
    expect(decoded!.fileSize).toBe(1073741824);
  });
});
