/**
 * HDC Message/Packet Module
 *
 * Handles protocol packet encoding and decoding using the official
 * 11-byte PayloadHead + protobuf PayloadProtect wire format.
 *
 * PayloadHead (11 bytes, big-endian for multi-byte fields):
 *   Offset  Size  Field
 *   0       2     flag: "HW" (0x48, 0x57)
 *   2       2     reserve: uint16 BE (encrypt flags, usually 0)
 *   4       1     protocolVer: 0x01
 *   5       2     headSize: uint16 BE (size of serialized PayloadProtect)
 *   7       4     dataSize: uint32 BE (size of raw payload data)
 */

import { PACKET_FLAG } from './protocol.js';
import { PayloadProtect, encodePayloadProtect, decodePayloadProtect } from './serialization.js';

// Protocol constants
export const PROTOCOL_VERSION = 0x01;
export const PAYLOAD_PROTECT_VCODE = 0x09;

// Packet header size (11 bytes total)
export const PACKET_HEADER_SIZE = 11;

/**
 * PayloadHead structure (11 bytes)
 * Matches the official HDC wire format.
 */
export interface PacketHeader {
  flag: string;        // 2 bytes: "HW"
  reserve: number;     // 2 bytes: uint16 BE (encrypt flags)
  protocolVer: number; // 1 byte: protocol version (0x01)
  headSize: number;    // 2 bytes: uint16 BE (size of serialized PayloadProtect)
  dataSize: number;    // 4 bytes: uint32 BE (size of raw payload data)
}

/**
 * Default packet header values
 */
export const DEFAULT_HEADER: PacketHeader = {
  flag: PACKET_FLAG,
  reserve: 0,
  protocolVer: PROTOCOL_VERSION,
  headSize: 0,
  dataSize: 0,
};

/**
 * Result of parsing a packet
 */
export interface PacketParseResult {
  header: PacketHeader;
  protect: PayloadProtect;
  payload: Buffer;
}

/**
 * Encode a packet header into a Buffer (11 bytes)
 */
export function encodeHeader(header: PacketHeader): Buffer {
  const buf = Buffer.allocUnsafe(PACKET_HEADER_SIZE);

  // flag (2 bytes) - ASCII
  buf.write(header.flag, 0, 2, 'ascii');

  // reserve (2 bytes) - big-endian
  buf.writeUInt16BE(header.reserve, 2);

  // protocolVer (1 byte)
  buf.writeUInt8(header.protocolVer, 4);

  // headSize (2 bytes) - big-endian
  buf.writeUInt16BE(header.headSize, 5);

  // dataSize (4 bytes) - big-endian
  buf.writeUInt32BE(header.dataSize, 7);

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
    reserve: buf.readUInt16BE(2),
    protocolVer: buf.readUInt8(4),
    headSize: buf.readUInt16BE(5),
    dataSize: buf.readUInt32BE(7),
  };
}

/**
 * Create a complete packet with header, serialized PayloadProtect, and payload data.
 *
 * Wire format: [PayloadHead 11 bytes][PayloadProtect bytes][payload data bytes]
 */
export function createPacket(payload: Buffer, protect: PayloadProtect): Buffer {
  const protectBuf = encodePayloadProtect(protect);

  const header: PacketHeader = {
    flag: PACKET_FLAG,
    reserve: 0,
    protocolVer: PROTOCOL_VERSION,
    headSize: protectBuf.length,
    dataSize: payload.length,
  };

  return Buffer.concat([encodeHeader(header), protectBuf, payload]);
}

/**
 * Parse a packet buffer into header, decoded PayloadProtect, and payload data.
 *
 * Returns null if the buffer is too small, the flag is wrong, or vCode is invalid.
 */
export function parsePacket(buf: Buffer): PacketParseResult | null {
  const header = decodeHeader(buf);
  if (!header) {
    return null;
  }

  // Validate flag
  if (header.flag !== PACKET_FLAG) {
    return null;
  }

  // Check we have enough bytes for header + protect + payload
  const expectedSize = PACKET_HEADER_SIZE + header.headSize + header.dataSize;
  if (buf.length < expectedSize) {
    return null;
  }

  // Decode PayloadProtect
  const protectStart = PACKET_HEADER_SIZE;
  const protectEnd = protectStart + header.headSize;
  let protect: PayloadProtect;
  try {
    protect = decodePayloadProtect(buf.subarray(protectStart, protectEnd));
  } catch {
    return null;
  }

  // Validate vCode
  if (protect.vCode !== PAYLOAD_PROTECT_VCODE) {
    return null;
  }

  // Extract payload
  const payload = buf.subarray(protectEnd, protectEnd + header.dataSize);

  return { header, protect, payload };
}

/**
 * Validate packet header
 */
export function isValidHeader(header: PacketHeader): boolean {
  return header.flag === PACKET_FLAG &&
         header.protocolVer >= 1 &&
         header.dataSize >= 0;
}

/**
 * Calculate total packet size (header + protect + payload)
 */
export function getPacketSize(headSize: number, dataSize: number): number {
  return PACKET_HEADER_SIZE + headSize + dataSize;
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
 * Session handshake message (text-based)
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
