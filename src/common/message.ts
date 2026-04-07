/**
 * HDC Message/Packet Module
 *
 * Handles protocol packet encoding and decoding.
 * Translated from: src/common/session.h (PayloadHead structure)
 */

import { PACKET_FLAG, HDC_VERSION_NUMBER } from './protocol.js';

// Packet header size (10 bytes total)
// flag[2] + reserve[2] + version[1] + option[1] + dataLength[4] = 10 bytes
export const PACKET_HEADER_SIZE = 10;

/**
 * PayloadHead structure (matches C++ struct)
 * - flag[2]: "HW"
 * - reserve[2]: reserved bytes
 * - version: 1 byte: protocol version
 * - option: 1 byte: options
 * - dataLength: 4 bytes: payload length
 */
export interface PacketHeader {
  flag: string;       // 2 bytes: "HW"
  reserve: number;   // 2 bytes: reserved
  version: number;   // 1 byte: protocol version
  option: number;    // 1 byte: options
  dataLength: number; // 4 bytes: payload length
}

/**
 * Default packet header values
 */
export const DEFAULT_HEADER: PacketHeader = {
  flag: PACKET_FLAG,
  reserve: 0,
  version: 1,
  option: 0,
  dataLength: 0,
};

/**
 * Encode a packet header into a Buffer
 */
export function encodeHeader(header: PacketHeader): Buffer {
  const buf = Buffer.allocUnsafe(PACKET_HEADER_SIZE);
  
  // flag (2 bytes)
  buf.write(header.flag, 0, 2, 'ascii');
  
  // reserve (2 bytes) - little endian
  buf.writeUInt16LE(header.reserve, 2);
  
  // version (1 byte)
  buf.writeUInt8(header.version, 4);
  
  // option (1 byte)
  buf.writeUInt8(header.option, 5);
  
  // dataLength (4 bytes) - little endian
  buf.writeUInt32LE(header.dataLength, 6);
  
  return buf;
}

/**
 * Decode a Buffer into a PacketHeader
 */
export function decodeHeader(buf: Buffer): PacketHeader | null {
  if (buf.length < PACKET_HEADER_SIZE) {
    return null;
  }
  
  return {
    flag: buf.toString('ascii', 0, 2),
    reserve: buf.readUInt16LE(2),
    version: buf.readUInt8(4),
    option: buf.readUInt8(5),
    dataLength: buf.readUInt32LE(6),
  };
}

/**
 * Create a complete packet with header and payload
 */
export function createPacket(payload: Buffer, option: number = 0): Buffer {
  const header: PacketHeader = {
    flag: PACKET_FLAG,
    reserve: 0,
    version: 1,
    option,
    dataLength: payload.length,
  };
  
  return Buffer.concat([encodeHeader(header), payload]);
}

/**
 * Parse a packet buffer into header and payload
 */
export function parsePacket(buf: Buffer): { header: PacketHeader; payload: Buffer } | null {
  const header = decodeHeader(buf);
  if (!header) {
    return null;
  }
  
  const payload = buf.subarray(PACKET_HEADER_SIZE);
  
  if (payload.length !== header.dataLength) {
    // Length mismatch - could be partial packet
    return null;
  }
  
  return { header, payload };
}

/**
 * Validate packet header
 */
export function isValidHeader(header: PacketHeader): boolean {
  return header.flag === PACKET_FLAG &&
         header.version >= 1 &&
         header.dataLength >= 0;
}

/**
 * Calculate total packet size (header + payload)
 */
export function getPacketSize(dataLength: number): number {
  return PACKET_HEADER_SIZE + dataLength;
}

/**
 * Control message structure
 */
export interface CtrlMessage {
  command: number;      // InnerCtrlCommand
  channelId: number;
  data: Buffer;
}

/**
 * Encode a control message
 */
export function encodeCtrlMessage(msg: CtrlMessage): Buffer {
  const buf = Buffer.allocUnsafe(9 + msg.data.length);
  buf.writeUInt8(msg.command, 0);
  buf.writeUInt32LE(msg.channelId, 1);
  buf.writeUInt32LE(msg.data.length, 5);
  msg.data.copy(buf, 9);
  return buf;
}

/**
 * Decode a control message
 */
export function decodeCtrlMessage(buf: Buffer): CtrlMessage | null {
  if (buf.length < 9) {
    return null;
  }
  
  const command = buf.readUInt8(0);
  const channelId = buf.readUInt32LE(1);
  const dataLen = buf.readUInt32LE(5);
  
  if (buf.length < 9 + dataLen) {
    return null;
  }
  
  return {
    command,
    channelId,
    data: buf.subarray(9, 9 + dataLen),
  };
}

/**
 * Session handshake message
 */
export interface HandshakeMessage {
  banner: string;       // "OHOS HDC"
  authType: number;
  sessionId: number;
  connectKey: string;
  version: string;
}

/**
 * Encode a handshake message
 */
export function encodeHandshake(msg: HandshakeMessage): Buffer {
  const parts = [
    msg.banner,
    msg.authType.toString(),
    msg.sessionId.toString(16),
    msg.connectKey,
    msg.version,
  ];
  return Buffer.from(parts.join('|'), 'utf-8');
}

/**
 * Decode a handshake message
 */
export function decodeHandshake(buf: Buffer): HandshakeMessage | null {
  try {
    const str = buf.toString('utf-8');
    const parts = str.split('|');
    
    if (parts.length < 5) {
      return null;
    }
    
    return {
      banner: parts[0],
      authType: parseInt(parts[1], 10),
      sessionId: parseInt(parts[2], 16),
      connectKey: parts[3],
      version: parts[4],
    };
  } catch {
    return null;
  }
}

/**
 * Heartbeat message structure
 */
export interface HeartbeatMessage {
  count: number;
  timestamp: number;
}

/**
 * Encode a heartbeat message
 */
export function encodeHeartbeat(msg: HeartbeatMessage): Buffer {
  const buf = Buffer.allocUnsafe(16);
  buf.writeBigUInt64LE(BigInt(msg.count), 0);
  buf.writeBigUInt64LE(BigInt(msg.timestamp), 9);
  return buf;
}

/**
 * Decode a heartbeat message
 */
export function decodeHeartbeat(buf: Buffer): HeartbeatMessage | null {
  if (buf.length < 16) {
    return null;
  }
  
  return {
    count: Number(buf.readBigUInt64LE(1)),
    timestamp: Number(buf.readBigUInt64LE(9)),
  };
}
