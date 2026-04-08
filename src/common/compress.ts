/**
 * HDC Compress Module
 *
 * Data compression/decompression utilities.
 * Ported from: hdc-source/src/common/compress.cpp
 */

import * as zlib from 'zlib';

// ============================================================================
// Constants
// ============================================================================

export enum CompressType {
  NONE = 0,
  LZ4 = 1,
  LZ77 = 2,
  LZMA = 3,
  BROTLI = 4,
  DEFLATE = 5,
  GZIP = 6,
}

export const DEFAULT_COMPRESS_LEVEL = 6;
export const MAX_COMPRESS_LEVEL = 9;
export const MIN_COMPRESS_LEVEL = 1;

// ============================================================================
// Types
// ============================================================================

export interface CompressOptions {
  type?: CompressType;
  level?: number;
  threshold?: number; // Minimum size to compress (bytes)
}

export interface CompressResult {
  data: Buffer;
  originalSize: number;
  compressedSize: number;
  ratio: number;
  type: CompressType;
}

// ============================================================================
// HdcCompress - Compression Manager
// ============================================================================

export class HdcCompress {
  private type: CompressType;
  private level: number;
  private threshold: number;

  constructor(options: CompressOptions = {}) {
    this.type = options.type ?? CompressType.GZIP;
    this.level = options.level ?? DEFAULT_COMPRESS_LEVEL;
    this.threshold = options.threshold ?? 1024; // 1KB default
  }

  /**
   * Get compression type
   */
  getType(): CompressType {
    return this.type;
  }

  /**
   * Set compression type
   */
  setType(type: CompressType): void {
    this.type = type;
  }

  /**
   * Check if data should be compressed
   */
  shouldCompress(data: Buffer): boolean {
    return data.length >= this.threshold && this.type !== CompressType.NONE;
  }

  /**
   * Compress data
   */
  async compress(data: Buffer): Promise<CompressResult> {
    if (!this.shouldCompress(data)) {
      return {
        data,
        originalSize: data.length,
        compressedSize: data.length,
        ratio: 1,
        type: CompressType.NONE,
      };
    }

    const compressed = await this.compressData(data);
    const ratio = compressed.length / data.length;

    // Only use compressed data if it's smaller
    if (ratio >= 1) {
      return {
        data,
        originalSize: data.length,
        compressedSize: data.length,
        ratio: 1,
        type: CompressType.NONE,
      };
    }

    return {
      data: compressed,
      originalSize: data.length,
      compressedSize: compressed.length,
      ratio,
      type: this.type,
    };
  }

  /**
   * Decompress data
   */
  async decompress(data: Buffer, type?: CompressType): Promise<Buffer> {
    const compressType = type ?? this.type;

    if (compressType === CompressType.NONE) {
      return data;
    }

    return this.decompressData(data, compressType);
  }

  /**
   * Compress data based on type
   */
  private async compressData(data: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      switch (this.type) {
        case CompressType.GZIP:
          zlib.gzip(data, { level: this.level }, (err, result) => {
            if (err) reject(err);
            else resolve(result);
          });
          break;

        case CompressType.DEFLATE:
          zlib.deflate(data, { level: this.level }, (err, result) => {
            if (err) reject(err);
            else resolve(result);
          });
          break;

        case CompressType.BROTLI:
          zlib.brotliCompress(data, { quality: this.level }, (err, result) => {
            if (err) reject(err);
            else resolve(result);
          });
          break;

        default:
          // Fallback to gzip
          zlib.gzip(data, { level: this.level }, (err, result) => {
            if (err) reject(err);
            else resolve(result);
          });
      }
    });
  }

  /**
   * Decompress data based on type
   */
  private async decompressData(data: Buffer, type: CompressType): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      switch (type) {
        case CompressType.GZIP:
          zlib.gunzip(data, (err, result) => {
            if (err) reject(err);
            else resolve(result);
          });
          break;

        case CompressType.DEFLATE:
          zlib.inflate(data, (err, result) => {
            if (err) reject(err);
            else resolve(result);
          });
          break;

        case CompressType.BROTLI:
          zlib.brotliDecompress(data, (err, result) => {
            if (err) reject(err);
            else resolve(result);
          });
          break;

        default:
          // Try gunzip first, then inflate
          zlib.gunzip(data, (err, result) => {
            if (err) {
              zlib.inflate(data, (err2, result2) => {
                if (err2) reject(err2);
                else resolve(result2);
              });
            } else {
              resolve(result);
            }
          });
      }
    });
  }
}

// ============================================================================
// Helper functions
// ============================================================================

/**
 * Compress data with gzip
 */
export async function gzip(data: Buffer, level: number = DEFAULT_COMPRESS_LEVEL): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zlib.gzip(data, { level }, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

/**
 * Decompress gzip data
 */
export async function gunzip(data: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zlib.gunzip(data, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

/**
 * Compress data with deflate
 */
export async function deflate(data: Buffer, level: number = DEFAULT_COMPRESS_LEVEL): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zlib.deflate(data, { level }, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

/**
 * Decompress deflate data
 */
export async function inflate(data: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zlib.inflate(data, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

/**
 * Compress data with brotli
 */
export async function brotliCompress(data: Buffer, quality: number = DEFAULT_COMPRESS_LEVEL): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zlib.brotliCompress(data, { quality }, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

/**
 * Decompress brotli data
 */
export async function brotliDecompress(data: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zlib.brotliDecompress(data, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

/**
 * Calculate compression ratio
 */
export function calcCompressionRatio(originalSize: number, compressedSize: number): number {
  if (originalSize === 0) return 1;
  return compressedSize / originalSize;
}
