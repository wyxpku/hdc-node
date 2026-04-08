/**
 * Tests for Compress module
 */

import { describe, it, expect } from 'vitest';
import {
  HdcCompress,
  CompressType,
  gzip,
  gunzip,
  deflate,
  inflate,
  brotliCompress,
  brotliDecompress,
  calcCompressionRatio,
  DEFAULT_COMPRESS_LEVEL,
} from './compress.js';

describe('HdcCompress', () => {
  describe('constructor', () => {
    it('should create compress instance with defaults', () => {
      const compress = new HdcCompress();

      expect(compress.getType()).toBe(CompressType.GZIP);
    });

    it('should accept custom options', () => {
      const compress = new HdcCompress({
        type: CompressType.DEFLATE,
        level: 9,
        threshold: 2048,
      });

      expect(compress.getType()).toBe(CompressType.DEFLATE);
      expect(compress['level']).toBe(9);
      expect(compress['threshold']).toBe(2048);
    });
  });

  describe('getType/setType', () => {
    it('should get and set compression type', () => {
      const compress = new HdcCompress();

      compress.setType(CompressType.BROTLI);
      expect(compress.getType()).toBe(CompressType.BROTLI);
    });
  });

  describe('shouldCompress', () => {
    it('should return false for small data', () => {
      const compress = new HdcCompress({ threshold: 100 });
      const smallData = Buffer.from('small');

      expect(compress.shouldCompress(smallData)).toBe(false);
    });

    it('should return true for large data', () => {
      const compress = new HdcCompress({ threshold: 100 });
      const largeData = Buffer.alloc(200, 'x');

      expect(compress.shouldCompress(largeData)).toBe(true);
    });

    it('should return false for NONE type', () => {
      const compress = new HdcCompress({ type: CompressType.NONE });
      const data = Buffer.alloc(1000, 'x');

      expect(compress.shouldCompress(data)).toBe(false);
    });
  });

  describe('compress', () => {
    it('should compress data with gzip', async () => {
      const compress = new HdcCompress({ type: CompressType.GZIP, threshold: 0 });
      const data = Buffer.alloc(1000, 'x');

      const result = await compress.compress(data);

      expect(result.originalSize).toBe(1000);
      expect(result.compressedSize).toBeLessThan(result.originalSize);
      expect(result.ratio).toBeLessThan(1);
      expect(result.type).toBe(CompressType.GZIP);
    });

    it('should not compress small data', async () => {
      const compress = new HdcCompress({ threshold: 10000 });
      const data = Buffer.from('small data');

      const result = await compress.compress(data);

      expect(result.type).toBe(CompressType.NONE);
      expect(result.ratio).toBe(1);
    });

    it('should compress with deflate', async () => {
      const compress = new HdcCompress({ type: CompressType.DEFLATE, threshold: 0 });
      const data = Buffer.alloc(1000, 'abc');

      const result = await compress.compress(data);

      expect(result.compressedSize).toBeLessThan(result.originalSize);
    });

    it('should compress with brotli', async () => {
      const compress = new HdcCompress({ type: CompressType.BROTLI, threshold: 0 });
      const data = Buffer.alloc(1000, 'xyz');

      const result = await compress.compress(data);

      expect(result.compressedSize).toBeLessThan(result.originalSize);
    });
  });

  describe('decompress', () => {
    it('should decompress gzip data', async () => {
      const compress = new HdcCompress({ type: CompressType.GZIP, threshold: 0 });
      const original = Buffer.from('Hello, World! This is a test message.'.repeat(10));

      const compressed = await compress.compress(original);
      const decompressed = await compress.decompress(compressed.data, compressed.type);

      expect(decompressed.equals(original)).toBe(true);
    });

    it('should decompress deflate data', async () => {
      const compress = new HdcCompress({ type: CompressType.DEFLATE, threshold: 0 });
      const original = Buffer.from('Test data for deflate compression.'.repeat(10));

      const compressed = await compress.compress(original);
      const decompressed = await compress.decompress(compressed.data, compressed.type);

      expect(decompressed.equals(original)).toBe(true);
    });

    it('should decompress brotli data', async () => {
      const compress = new HdcCompress({ type: CompressType.BROTLI, threshold: 0 });
      const original = Buffer.from('Brotli compression test data.'.repeat(10));

      const compressed = await compress.compress(original);
      const decompressed = await compress.decompress(compressed.data, compressed.type);

      expect(decompressed.equals(original)).toBe(true);
    });

    it('should return original data for NONE type', async () => {
      const compress = new HdcCompress({ type: CompressType.NONE });
      const data = Buffer.from('no compression');

      const result = await compress.decompress(data);

      expect(result.equals(data)).toBe(true);
    });
  });
});

describe('Helper functions', () => {
  describe('gzip/gunzip', () => {
    it('should compress and decompress with gzip', async () => {
      const original = Buffer.from('Hello, GZIP!'.repeat(100));

      const compressed = await gzip(original);
      expect(compressed.length).toBeLessThan(original.length);

      const decompressed = await gunzip(compressed);
      expect(decompressed.equals(original)).toBe(true);
    });
  });

  describe('deflate/inflate', () => {
    it('should compress and decompress with deflate', async () => {
      const original = Buffer.from('Hello, DEFLATE!'.repeat(100));

      const compressed = await deflate(original);
      expect(compressed.length).toBeLessThan(original.length);

      const decompressed = await inflate(compressed);
      expect(decompressed.equals(original)).toBe(true);
    });
  });

  describe('brotliCompress/brotliDecompress', () => {
    it('should compress and decompress with brotli', async () => {
      const original = Buffer.from('Hello, BROTLI!'.repeat(100));

      const compressed = await brotliCompress(original);
      expect(compressed.length).toBeLessThan(original.length);

      const decompressed = await brotliDecompress(compressed);
      expect(decompressed.equals(original)).toBe(true);
    });
  });

  describe('calcCompressionRatio', () => {
    it('should calculate ratio correctly', () => {
      expect(calcCompressionRatio(1000, 500)).toBe(0.5);
      expect(calcCompressionRatio(1000, 1000)).toBe(1);
      expect(calcCompressionRatio(1000, 100)).toBe(0.1);
    });

    it('should handle zero original size', () => {
      expect(calcCompressionRatio(0, 0)).toBe(1);
    });
  });
});

describe('CompressType enum', () => {
  it('should have correct values', () => {
    expect(CompressType.NONE).toBe(0);
    expect(CompressType.LZ4).toBe(1);
    expect(CompressType.LZ77).toBe(2);
    expect(CompressType.LZMA).toBe(3);
    expect(CompressType.BROTLI).toBe(4);
    expect(CompressType.DEFLATE).toBe(5);
    expect(CompressType.GZIP).toBe(6);
  });
});

describe('Constants', () => {
  it('should have correct default level', () => {
    expect(DEFAULT_COMPRESS_LEVEL).toBe(6);
  });
});
