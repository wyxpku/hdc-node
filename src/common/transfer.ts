/**
 * HDC File Transfer Protocol Structures
 *
 * Implements TransferConfig (protobuf-serialized file metadata) and
 * TransferPayload (16-byte little-endian chunk header) matching the
 * official C++ HDC wire format.
 *
 * Ported from: hdc-source/src/common/transfer.cpp
 */

import { Serializer, Deserializer } from './serialization.js';

// ============================================================================
// TransferConfig
// ============================================================================

/**
 * TransferConfig structure - sent before file data to negotiate transfer parameters.
 * Field numbers match the protobuf schema used by the official C++ implementation.
 */
export interface TransferConfig {
  fileSize: number;       // field 1
  atime: number;          // field 2
  mtime: number;          // field 3
  options: string;        // field 4
  path: string;           // field 5
  optionalName: string;   // field 6
  updateIfNew: boolean;   // field 7
  compressType: number;   // field 8
  holdTimestamp: boolean;  // field 9
  functionName: string;   // field 10
  clientCwd: string;      // field 11
  reserve1: string;       // field 12
  reserve2: string;       // field 13
}

/**
 * Encode a TransferConfig to protobuf wire format.
 */
export function encodeTransferConfig(cfg: TransferConfig): Buffer {
  const s = new Serializer();
  s.writeUint64(1, cfg.fileSize);
  s.writeUint64(2, cfg.atime);
  s.writeUint64(3, cfg.mtime);
  s.writeString(4, cfg.options);
  s.writeString(5, cfg.path);
  s.writeString(6, cfg.optionalName);
  s.writeBool(7, cfg.updateIfNew);
  s.writeUint32(8, cfg.compressType);
  s.writeBool(9, cfg.holdTimestamp);
  s.writeString(10, cfg.functionName);
  s.writeString(11, cfg.clientCwd);
  s.writeString(12, cfg.reserve1);
  s.writeString(13, cfg.reserve2);
  return s.toBuffer();
}

/**
 * Decode a TransferConfig from protobuf wire format.
 */
export function decodeTransferConfig(buf: Buffer): TransferConfig {
  const d = new Deserializer(buf);
  return {
    fileSize: d.readUint32(1),
    atime: d.readUint32(2),
    mtime: d.readUint32(3),
    options: d.readString(4),
    path: d.readString(5),
    optionalName: d.readString(6),
    updateIfNew: d.readBool(7),
    compressType: d.readUint32(8),
    holdTimestamp: d.readBool(9),
    functionName: d.readString(10),
    clientCwd: d.readString(11),
    reserve1: d.readString(12),
    reserve2: d.readString(13),
  };
}

// ============================================================================
// TransferPayload
// ============================================================================

/**
 * TransferPayload header size in bytes.
 * Each data chunk is prefixed with this 16-byte header.
 */
export const TRANSFER_PAYLOAD_SIZE = 16;

/**
 * TransferPayload header - prepended to each data chunk during transfer.
 * Wire format: 4 x uint32 little-endian fields (16 bytes total).
 */
export interface TransferPayload {
  index: number;          // uint32 LE at offset 0
  compressType: number;   // uint32 LE at offset 4
  compressSize: number;   // uint32 LE at offset 8
  uncompressSize: number; // uint32 LE at offset 12
}

/**
 * Encode a TransferPayload header to a 16-byte Buffer (little-endian).
 */
export function encodeTransferPayload(tp: TransferPayload): Buffer {
  const buf = Buffer.alloc(TRANSFER_PAYLOAD_SIZE);
  buf.writeUInt32LE(tp.index, 0);
  buf.writeUInt32LE(tp.compressType, 4);
  buf.writeUInt32LE(tp.compressSize, 8);
  buf.writeUInt32LE(tp.uncompressSize, 12);
  return buf;
}

/**
 * Decode a TransferPayload header from a 16-byte Buffer.
 * Returns null if the buffer is too small.
 */
export function decodeTransferPayload(buf: Buffer): TransferPayload | null {
  if (buf.length < TRANSFER_PAYLOAD_SIZE) {
    return null;
  }
  return {
    index: buf.readUInt32LE(0),
    compressType: buf.readUInt32LE(4),
    compressSize: buf.readUInt32LE(8),
    uncompressSize: buf.readUInt32LE(12),
  };
}
