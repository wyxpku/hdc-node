/**
 * Tests for Transfer Protocol Structures
 *
 * Tests TransferConfig (protobuf encode/decode) and TransferPayload
 * (16-byte little-endian header encode/decode).
 */

import { describe, it, expect } from 'vitest';
import {
  TransferConfig,
  TransferPayload,
  encodeTransferConfig,
  decodeTransferConfig,
  encodeTransferPayload,
  decodeTransferPayload,
  TRANSFER_PAYLOAD_SIZE,
} from './transfer.js';

// ============================================================================
// TransferConfig
// ============================================================================

describe('TransferConfig', () => {
  describe('encodeTransferConfig', () => {
    it('should encode a full TransferConfig with all fields', () => {
      const cfg: TransferConfig = {
        fileSize: 1024,
        atime: 1700000000,
        mtime: 1700000100,
        options: 'rw',
        path: '/data/local/tmp/test.txt',
        optionalName: 'test.txt',
        updateIfNew: true,
        compressType: 1,
        holdTimestamp: true,
        functionName: 'send',
        clientCwd: '/home/user',
        reserve1: '',
        reserve2: '',
      };

      const buf = encodeTransferConfig(cfg);
      expect(buf).toBeInstanceOf(Buffer);
      expect(buf.length).toBeGreaterThan(0);
    });

    it('should produce deterministic output for same input', () => {
      const cfg: TransferConfig = {
        fileSize: 500,
        atime: 100,
        mtime: 200,
        options: '',
        path: '/test',
        optionalName: '',
        updateIfNew: false,
        compressType: 0,
        holdTimestamp: false,
        functionName: '',
        clientCwd: '',
        reserve1: '',
        reserve2: '',
      };

      const buf1 = encodeTransferConfig(cfg);
      const buf2 = encodeTransferConfig(cfg);
      expect(buf1).toEqual(buf2);
    });

    it('should produce minimal output for default values', () => {
      const cfg: TransferConfig = {
        fileSize: 0,
        atime: 0,
        mtime: 0,
        options: '',
        path: '',
        optionalName: '',
        updateIfNew: false,
        compressType: 0,
        holdTimestamp: false,
        functionName: '',
        clientCwd: '',
        reserve1: '',
        reserve2: '',
      };

      const buf = encodeTransferConfig(cfg);
      // All default values should result in empty buffer (protobuf omits defaults)
      expect(buf.length).toBe(0);
    });
  });

  describe('decodeTransferConfig', () => {
    it('should round-trip encode/decode with all fields', () => {
      const original: TransferConfig = {
        fileSize: 65536,
        atime: 1700000000,
        mtime: 1700000500,
        options: 'rw-r--r--',
        path: '/data/local/tmp/bigfile.bin',
        optionalName: 'bigfile.bin',
        updateIfNew: true,
        compressType: 1,
        holdTimestamp: true,
        functionName: 'send',
        clientCwd: '/home/user/projects',
        reserve1: 'r1',
        reserve2: 'r2',
      };

      const encoded = encodeTransferConfig(original);
      const decoded = decodeTransferConfig(encoded);

      expect(decoded.fileSize).toBe(original.fileSize);
      expect(decoded.atime).toBe(original.atime);
      expect(decoded.mtime).toBe(original.mtime);
      expect(decoded.options).toBe(original.options);
      expect(decoded.path).toBe(original.path);
      expect(decoded.optionalName).toBe(original.optionalName);
      expect(decoded.updateIfNew).toBe(original.updateIfNew);
      expect(decoded.compressType).toBe(original.compressType);
      expect(decoded.holdTimestamp).toBe(original.holdTimestamp);
      expect(decoded.functionName).toBe(original.functionName);
      expect(decoded.clientCwd).toBe(original.clientCwd);
      expect(decoded.reserve1).toBe(original.reserve1);
      expect(decoded.reserve2).toBe(original.reserve2);
    });

    it('should round-trip with minimal fields', () => {
      const original: TransferConfig = {
        fileSize: 100,
        atime: 0,
        mtime: 0,
        options: '',
        path: '/test.txt',
        optionalName: '',
        updateIfNew: false,
        compressType: 0,
        holdTimestamp: false,
        functionName: '',
        clientCwd: '',
        reserve1: '',
        reserve2: '',
      };

      const encoded = encodeTransferConfig(original);
      const decoded = decodeTransferConfig(encoded);

      expect(decoded.fileSize).toBe(100);
      expect(decoded.path).toBe('/test.txt');
      expect(decoded.atime).toBe(0);
      expect(decoded.mtime).toBe(0);
      expect(decoded.options).toBe('');
      expect(decoded.updateIfNew).toBe(false);
      expect(decoded.compressType).toBe(0);
      expect(decoded.holdTimestamp).toBe(false);
    });

    it('should decode empty buffer to defaults', () => {
      const buf = Buffer.alloc(0);
      const decoded = decodeTransferConfig(buf);

      expect(decoded.fileSize).toBe(0);
      expect(decoded.atime).toBe(0);
      expect(decoded.mtime).toBe(0);
      expect(decoded.options).toBe('');
      expect(decoded.path).toBe('');
      expect(decoded.optionalName).toBe('');
      expect(decoded.updateIfNew).toBe(false);
      expect(decoded.compressType).toBe(0);
      expect(decoded.holdTimestamp).toBe(false);
      expect(decoded.functionName).toBe('');
      expect(decoded.clientCwd).toBe('');
      expect(decoded.reserve1).toBe('');
      expect(decoded.reserve2).toBe('');
    });

    it('should handle large file sizes', () => {
      const original: TransferConfig = {
        fileSize: 1073741824, // 1GB
        atime: 0,
        mtime: 1700000000,
        options: '',
        path: '/large.iso',
        optionalName: 'large.iso',
        updateIfNew: false,
        compressType: 1,
        holdTimestamp: false,
        functionName: 'send',
        clientCwd: '',
        reserve1: '',
        reserve2: '',
      };

      const encoded = encodeTransferConfig(original);
      const decoded = decodeTransferConfig(encoded);

      expect(decoded.fileSize).toBe(1073741824);
      expect(decoded.mtime).toBe(1700000000);
      expect(decoded.path).toBe('/large.iso');
    });
  });
});

// ============================================================================
// TransferPayload
// ============================================================================

describe('TransferPayload', () => {
  describe('encodeTransferPayload', () => {
    it('should encode to exactly 16 bytes', () => {
      const tp: TransferPayload = {
        index: 0,
        compressType: 0,
        compressSize: 1024,
        uncompressSize: 1024,
      };

      const buf = encodeTransferPayload(tp);
      expect(buf.length).toBe(TRANSFER_PAYLOAD_SIZE);
      expect(buf.length).toBe(16);
    });

    it('should encode all fields as uint32 LE', () => {
      const tp: TransferPayload = {
        index: 42,
        compressType: 1,
        compressSize: 65536,
        uncompressSize: 131072,
      };

      const buf = encodeTransferPayload(tp);

      expect(buf.readUInt32LE(0)).toBe(42);
      expect(buf.readUInt32LE(4)).toBe(1);
      expect(buf.readUInt32LE(8)).toBe(65536);
      expect(buf.readUInt32LE(12)).toBe(131072);
    });

    it('should encode zero values', () => {
      const tp: TransferPayload = {
        index: 0,
        compressType: 0,
        compressSize: 0,
        uncompressSize: 0,
      };

      const buf = encodeTransferPayload(tp);

      // All zeros
      for (let i = 0; i < 16; i++) {
        expect(buf[i]).toBe(0);
      }
    });

    it('should encode max uint32 values', () => {
      const tp: TransferPayload = {
        index: 0xFFFFFFFF,
        compressType: 0xFFFFFFFF,
        compressSize: 0xFFFFFFFF,
        uncompressSize: 0xFFFFFFFF,
      };

      const buf = encodeTransferPayload(tp);

      expect(buf.readUInt32LE(0)).toBe(0xFFFFFFFF);
      expect(buf.readUInt32LE(4)).toBe(0xFFFFFFFF);
      expect(buf.readUInt32LE(8)).toBe(0xFFFFFFFF);
      expect(buf.readUInt32LE(12)).toBe(0xFFFFFFFF);
    });
  });

  describe('decodeTransferPayload', () => {
    it('should decode a valid 16-byte buffer', () => {
      const buf = Buffer.alloc(16);
      buf.writeUInt32LE(10, 0);   // index
      buf.writeUInt32LE(0, 4);    // compressType
      buf.writeUInt32LE(4096, 8); // compressSize
      buf.writeUInt32LE(4096, 12); // uncompressSize

      const decoded = decodeTransferPayload(buf);

      expect(decoded).not.toBeNull();
      expect(decoded!.index).toBe(10);
      expect(decoded!.compressType).toBe(0);
      expect(decoded!.compressSize).toBe(4096);
      expect(decoded!.uncompressSize).toBe(4096);
    });

    it('should return null for buffer too small', () => {
      const buf = Buffer.alloc(15);
      const decoded = decodeTransferPayload(buf);
      expect(decoded).toBeNull();
    });

    it('should return null for empty buffer', () => {
      const buf = Buffer.alloc(0);
      const decoded = decodeTransferPayload(buf);
      expect(decoded).toBeNull();
    });

    it('should round-trip encode/decode', () => {
      const original: TransferPayload = {
        index: 123,
        compressType: 1,
        compressSize: 32768,
        uncompressSize: 65536,
      };

      const encoded = encodeTransferPayload(original);
      const decoded = decodeTransferPayload(encoded);

      expect(decoded).not.toBeNull();
      expect(decoded!.index).toBe(original.index);
      expect(decoded!.compressType).toBe(original.compressType);
      expect(decoded!.compressSize).toBe(original.compressSize);
      expect(decoded!.uncompressSize).toBe(original.uncompressSize);
    });

    it('should ignore extra bytes beyond 16', () => {
      const buf = Buffer.alloc(32);
      buf.writeUInt32LE(5, 0);
      buf.writeUInt32LE(0, 4);
      buf.writeUInt32LE(100, 8);
      buf.writeUInt32LE(100, 12);
      // Fill remaining bytes with non-zero
      buf.fill(0xFF, 16);

      const decoded = decodeTransferPayload(buf);
      expect(decoded).not.toBeNull();
      expect(decoded!.index).toBe(5);
      expect(decoded!.compressSize).toBe(100);
    });
  });

  describe('TRANSFER_PAYLOAD_SIZE constant', () => {
    it('should be 16', () => {
      expect(TRANSFER_PAYLOAD_SIZE).toBe(16);
    });
  });
});
