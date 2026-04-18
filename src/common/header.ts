/**
 * HDC TAR Header Module
 *
 * Simplified TAR header implementation for directory transfers.
 * Standard TAR headers are 512 bytes. This module implements just the fields
 * needed for HDC file transfer protocol.
 *
 * Ported from: hdc-source/src/common/transfer.cpp (directory transfer support)
 */

// ============================================================================
// Constants
// ============================================================================

/** Standard TAR header block size in bytes */
export const TAR_HEADER_SIZE = 512;

/** TAR magic string identifying POSIX format */
export const TAR_MAGIC = 'ustar';

/** TAR version for POSIX format */
export const TAR_VERSION = '00';

// ============================================================================
// Types
// ============================================================================

/**
 * Simplified TAR header structure for directory transfers.
 * Field offsets and sizes follow the POSIX tar specification.
 */
export interface TarHeader {
  filename: string;    // offset 0,   100 bytes (null-terminated)
  fileSize: number;    // offset 124, 12 bytes  (octal string)
  mtime: number;       // offset 136, 12 bytes  (octal string)
  typeFlag: string;    // offset 156, 1 byte    ('0'=file, '5'=directory)
  prefix: string;      // offset 345, 155 bytes (null-terminated)
}

// ============================================================================
// Encode / Decode
// ============================================================================

/**
 * Encode a TarHeader into a 512-byte Buffer.
 * Fields are written at their standard TAR offsets with proper null-padding.
 */
export function encodeTarHeader(hdr: TarHeader): Buffer {
  const buf = Buffer.alloc(TAR_HEADER_SIZE, 0); // zero-filled

  // filename: offset 0, 100 bytes
  buf.write(hdr.filename, 0, Math.min(hdr.filename.length, 99), 'utf-8');

  // file mode: offset 100, 8 bytes - default "0000644\0"
  buf.write('0000644\0', 100, 8, 'utf-8');

  // owner ID: offset 108, 8 bytes - default "0001750\0"
  buf.write('0001750\0', 108, 8, 'utf-8');

  // group ID: offset 116, 8 bytes - default "0001750\0"
  buf.write('0001750\0', 116, 8, 'utf-8');

  // fileSize: offset 124, 12 bytes (octal string, null-terminated)
  const sizeOctal = hdr.fileSize.toString(8).padStart(11, '0') + '\0';
  buf.write(sizeOctal, 124, 12, 'utf-8');

  // mtime: offset 136, 12 bytes (octal string, null-terminated)
  const mtimeOctal = hdr.mtime.toString(8).padStart(11, '0') + '\0';
  buf.write(mtimeOctal, 136, 12, 'utf-8');

  // checksum placeholder: offset 148, 8 bytes - spaces for checksum calculation
  buf.write('        ', 148, 8, 'utf-8');

  // typeFlag: offset 156, 1 byte
  const flag = hdr.typeFlag || '0';
  buf.write(flag, 156, 1, 'utf-8');

  // magic: offset 257, 6 bytes
  buf.write(TAR_MAGIC, 257, 5, 'utf-8');

  // version: offset 263, 2 bytes
  buf.write(TAR_VERSION, 263, 2, 'utf-8');

  // prefix: offset 345, 155 bytes
  if (hdr.prefix) {
    buf.write(hdr.prefix, 345, Math.min(hdr.prefix.length, 154), 'utf-8');
  }

  // Calculate and write checksum (offset 148, 8 bytes)
  // The checksum is the sum of all bytes in the header, treating the checksum
  // field itself as spaces (which we already wrote above).
  let checksum = 0;
  for (let i = 0; i < TAR_HEADER_SIZE; i++) {
    checksum += buf[i];
  }
  const checksumOctal = checksum.toString(8).padStart(6, '0') + '\0 ';
  buf.write(checksumOctal, 148, 8, 'utf-8');

  return buf;
}

/**
 * Decode a TarHeader from a 512-byte Buffer.
 * Returns null if the buffer is too small or does not contain a valid TAR header.
 */
export function decodeTarHeader(buf: Buffer): TarHeader | null {
  if (buf.length < TAR_HEADER_SIZE) {
    return null;
  }

  // Verify magic at offset 257
  const magic = buf.toString('utf-8', 257, 262).replace(/\0+$/, '');
  if (magic !== TAR_MAGIC) {
    // Also try without magic check for simplified headers
    // Check if filename field has any content
    const filenameTest = buf.toString('utf-8', 0, 100).replace(/\0+$/, '');
    if (!filenameTest) {
      return null;
    }
  }

  // filename: offset 0, 100 bytes (null-terminated)
  const filename = buf.toString('utf-8', 0, 100).replace(/\0+$/, '');

  // fileSize: offset 124, 12 bytes (octal string)
  const sizeStr = buf.toString('utf-8', 124, 136).replace(/\0+$/, '').trim();
  const fileSize = sizeStr ? parseInt(sizeStr, 8) : 0;
  if (isNaN(fileSize)) {
    return null;
  }

  // mtime: offset 136, 12 bytes (octal string)
  const mtimeStr = buf.toString('utf-8', 136, 148).replace(/\0+$/, '').trim();
  const mtime = mtimeStr ? parseInt(mtimeStr, 8) : 0;
  if (isNaN(mtime)) {
    return null;
  }

  // typeFlag: offset 156, 1 byte
  const typeFlag = buf.toString('utf-8', 156, 157) || '0';

  // prefix: offset 345, 155 bytes (null-terminated)
  const prefix = buf.toString('utf-8', 345, 345 + 155).replace(/\0+$/, '');

  return {
    filename,
    fileSize,
    mtime,
    typeFlag,
    prefix,
  };
}
