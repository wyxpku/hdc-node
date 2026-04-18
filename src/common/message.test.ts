/**
 * Message Module Tests
 *
 * Tests for packet encoding/decoding with the official 11-byte PayloadHead
 * + protobuf PayloadProtect wire format.
 */

import { describe, it, expect } from 'vitest';
import {
  PACKET_HEADER_SIZE,
  PROTOCOL_VERSION,
  PAYLOAD_PROTECT_VCODE,
  DEFAULT_HEADER,
  encodeHeader,
  decodeHeader,
  createPacket,
  parsePacket,
  isValidHeader,
  getPacketSize,
  encodeCtrlMessage,
  decodeCtrlMessage,
  encodeHandshake,
  decodeHandshake,
} from './message.js';
import { PACKET_FLAG } from './protocol.js';

describe('Packet Header Constants', () => {
  it('should have 11-byte header size', () => {
    expect(PACKET_HEADER_SIZE).toBe(11);
  });

  it('should have correct protocol version', () => {
    expect(PROTOCOL_VERSION).toBe(0x01);
  });

  it('should have correct vCode', () => {
    expect(PAYLOAD_PROTECT_VCODE).toBe(0x09);
  });

  it('should have correct default header', () => {
    expect(DEFAULT_HEADER.flag).toBe('HW');
    expect(DEFAULT_HEADER.protocolVer).toBe(1);
    expect(DEFAULT_HEADER.reserve).toBe(0);
    expect(DEFAULT_HEADER.headSize).toBe(0);
    expect(DEFAULT_HEADER.dataSize).toBe(0);
  });
});

describe('encodeHeader', () => {
  it('should encode 11-byte header correctly', () => {
    const header = {
      flag: 'HW',
      reserve: 0,
      protocolVer: 1,
      headSize: 5,
      dataSize: 100,
    };

    const buf = encodeHeader(header);
    expect(buf.length).toBe(PACKET_HEADER_SIZE);
    // flag at offset 0
    expect(buf.toString('ascii', 0, 2)).toBe('HW');
    // reserve at offset 2 (big-endian)
    expect(buf.readUInt16BE(2)).toBe(0);
    // protocolVer at offset 4
    expect(buf.readUInt8(4)).toBe(1);
    // headSize at offset 5 (big-endian)
    expect(buf.readUInt16BE(5)).toBe(5);
    // dataSize at offset 7 (big-endian)
    expect(buf.readUInt32BE(7)).toBe(100);
  });

  it('should encode dataSize as big-endian uint32', () => {
    const header = {
      flag: 'HW',
      reserve: 0,
      protocolVer: 1,
      headSize: 0,
      dataSize: 0x12345678,
    };

    const buf = encodeHeader(header);
    expect(buf.readUInt32BE(7)).toBe(0x12345678);
  });

  it('should encode reserve as big-endian uint16', () => {
    const header = {
      flag: 'HW',
      reserve: 0xABCD,
      protocolVer: 1,
      headSize: 0,
      dataSize: 0,
    };

    const buf = encodeHeader(header);
    expect(buf.readUInt16BE(2)).toBe(0xABCD);
  });

  it('should encode headSize as big-endian uint16', () => {
    const header = {
      flag: 'HW',
      reserve: 0,
      protocolVer: 1,
      headSize: 0x0102,
      dataSize: 0,
    };

    const buf = encodeHeader(header);
    expect(buf.readUInt16BE(5)).toBe(0x0102);
  });
});

describe('decodeHeader', () => {
  it('should decode valid 11-byte header', () => {
    const header = {
      flag: 'HW',
      reserve: 1,
      protocolVer: 1,
      headSize: 6,
      dataSize: 500,
    };

    const buf = encodeHeader(header);
    const decoded = decodeHeader(buf);

    expect(decoded).not.toBeNull();
    expect(decoded!.flag).toBe('HW');
    expect(decoded!.reserve).toBe(1);
    expect(decoded!.protocolVer).toBe(1);
    expect(decoded!.headSize).toBe(6);
    expect(decoded!.dataSize).toBe(500);
  });

  it('should return null for buffer too small', () => {
    const buf = Buffer.alloc(4);
    expect(decodeHeader(buf)).toBeNull();
  });

  it('should round-trip header encoding', () => {
    const header = {
      flag: 'HW',
      reserve: 0x1234,
      protocolVer: 0x01,
      headSize: 0x5678,
      dataSize: 0x9ABCDEF0,
    };

    const buf = encodeHeader(header);
    const decoded = decodeHeader(buf);

    expect(decoded).not.toBeNull();
    expect(decoded!.flag).toBe(header.flag);
    expect(decoded!.reserve).toBe(header.reserve);
    expect(decoded!.protocolVer).toBe(header.protocolVer);
    expect(decoded!.headSize).toBe(header.headSize);
    // Note: dataSize uses uint32, so 0x9ABCDEF0 is fine
    expect(decoded!.dataSize).toBe(header.dataSize);
  });
});

describe('createPacket', () => {
  it('should create packet with header, protect, and payload', () => {
    const payload = Buffer.from('hello world');
    const protect = { channelId: 0, commandFlag: 0, checkSum: 0, vCode: PAYLOAD_PROTECT_VCODE };

    const packet = createPacket(payload, protect);

    // Flag is "HW" at start
    expect(packet.toString('ascii', 0, 2)).toBe('HW');
    // headerSize should be > 0 (protobuf-encoded protect)
    const headSize = packet.readUInt16BE(5);
    expect(headSize).toBeGreaterThan(0);
    // dataSize should equal payload length
    const dataSize = packet.readUInt32BE(7);
    expect(dataSize).toBe(payload.length);
  });

  it('should preserve payload data', () => {
    const payload = Buffer.from('test data 123');
    const protect = { channelId: 0, commandFlag: 0, checkSum: 0, vCode: PAYLOAD_PROTECT_VCODE };

    const packet = createPacket(payload, protect);
    const headSize = packet.readUInt16BE(5);
    const payloadStart = PACKET_HEADER_SIZE + headSize;
    const payloadPart = packet.subarray(payloadStart);
    expect(payloadPart.equals(payload)).toBe(true);
  });

  it('should include protobuf-encoded PayloadProtect', () => {
    const payload = Buffer.from('data');
    const protect = { channelId: 42, commandFlag: 100, checkSum: 7, vCode: PAYLOAD_PROTECT_VCODE };

    const packet = createPacket(payload, protect);
    const headSize = packet.readUInt16BE(5);
    expect(headSize).toBeGreaterThan(0);

    // The protect bytes should be between header and payload
    const protectBuf = packet.subarray(PACKET_HEADER_SIZE, PACKET_HEADER_SIZE + headSize);
    expect(protectBuf.length).toBe(headSize);
  });
});

describe('parsePacket', () => {
  it('should parse valid packet with PayloadProtect round-trip', () => {
    const payload = Buffer.from('test payload');
    const protect = { channelId: 5, commandFlag: 2000, checkSum: 0, vCode: PAYLOAD_PROTECT_VCODE };

    const packet = createPacket(payload, protect);
    const parsed = parsePacket(packet);

    expect(parsed).not.toBeNull();
    expect(parsed!.header.flag).toBe('HW');
    expect(parsed!.header.protocolVer).toBe(1);
    expect(parsed!.protect.vCode).toBe(PAYLOAD_PROTECT_VCODE);
    expect(parsed!.protect.channelId).toBe(5);
    expect(parsed!.protect.commandFlag).toBe(2000);
    expect(parsed!.payload.equals(payload)).toBe(true);
  });

  it('should round-trip with all PayloadProtect fields', () => {
    const payload = Buffer.from([0x01, 0x02, 0x03]);
    const protect = { channelId: 0x1234, commandFlag: 0x5678, checkSum: 0xABCDEF01, vCode: PAYLOAD_PROTECT_VCODE };

    const packet = createPacket(payload, protect);
    const parsed = parsePacket(packet);

    expect(parsed).not.toBeNull();
    expect(parsed!.protect.channelId).toBe(protect.channelId);
    expect(parsed!.protect.commandFlag).toBe(protect.commandFlag);
    expect(parsed!.protect.checkSum).toBe(protect.checkSum);
    expect(parsed!.protect.vCode).toBe(protect.vCode);
    expect(Buffer.from(parsed!.payload).equals(payload)).toBe(true);
  });

  it('should return null for buffer too small for header', () => {
    const buf = Buffer.alloc(5);
    expect(parsePacket(buf)).toBeNull();
  });

  it('should return null for wrong flag', () => {
    const buf = Buffer.alloc(11);
    buf.write('XX', 0, 2, 'ascii');
    buf.writeUInt8(1, 4);
    buf.writeUInt16BE(0, 5);
    buf.writeUInt32BE(0, 7);
    expect(parsePacket(buf)).toBeNull();
  });

  it('should return null for wrong vCode', () => {
    const payload = Buffer.from('test');
    const protect = { channelId: 0, commandFlag: 0, checkSum: 0, vCode: 0xFF }; // wrong vCode

    const packet = createPacket(payload, protect);
    expect(parsePacket(packet)).toBeNull();
  });

  it('should return null for truncated payload', () => {
    const payload = Buffer.from('test payload data');
    const protect = { channelId: 0, commandFlag: 0, checkSum: 0, vCode: PAYLOAD_PROTECT_VCODE };

    const packet = createPacket(payload, protect);
    // Truncate to header + protect only (remove payload)
    const headSize = packet.readUInt16BE(5);
    const truncated = packet.subarray(0, PACKET_HEADER_SIZE + headSize);
    expect(parsePacket(truncated)).toBeNull();
  });

  it('should handle empty payload', () => {
    const payload = Buffer.alloc(0);
    const protect = { channelId: 0, commandFlag: 0, checkSum: 0, vCode: PAYLOAD_PROTECT_VCODE };

    const packet = createPacket(payload, protect);
    const parsed = parsePacket(packet);

    expect(parsed).not.toBeNull();
    expect(parsed!.payload.length).toBe(0);
    expect(parsed!.protect.vCode).toBe(PAYLOAD_PROTECT_VCODE);
  });
});

describe('isValidHeader', () => {
  it('should return true for valid header', () => {
    expect(isValidHeader(DEFAULT_HEADER)).toBe(true);
  });

  it('should return false for invalid flag', () => {
    expect(isValidHeader({ ...DEFAULT_HEADER, flag: 'XX' })).toBe(false);
  });

  it('should return false for invalid protocolVer', () => {
    expect(isValidHeader({ ...DEFAULT_HEADER, protocolVer: 0 })).toBe(false);
  });

  it('should accept zero dataSize', () => {
    expect(isValidHeader({ ...DEFAULT_HEADER, dataSize: 0 })).toBe(true);
  });
});

describe('getPacketSize', () => {
  it('should calculate correct packet size', () => {
    expect(getPacketSize(5, 100)).toBe(PACKET_HEADER_SIZE + 5 + 100);
    expect(getPacketSize(0, 0)).toBe(PACKET_HEADER_SIZE);
  });
});

describe('Control Message', () => {
  it('should encode and decode control message', () => {
    const msg = {
      command: 1,
      channelId: 12345,
      data: Buffer.from('test'),
    };

    const encoded = encodeCtrlMessage(msg);
    const decoded = decodeCtrlMessage(encoded);

    expect(decoded).not.toBeNull();
    expect(decoded!.command).toBe(1);
    expect(decoded!.channelId).toBe(12345);
    expect(decoded!.data.equals(msg.data)).toBe(true);
  });

  it('should return null for buffer too small', () => {
    expect(decodeCtrlMessage(Buffer.alloc(4))).toBeNull();
  });
});

describe('Handshake Message', () => {
  it('should encode and decode handshake', () => {
    const msg = {
      banner: 'OHOS HDC',
      authType: 1,
      sessionId: 0x12345678,
      connectKey: 'test-key',
      version: '3.2.0',
    };

    const encoded = encodeHandshake(msg);
    const decoded = decodeHandshake(encoded);

    expect(decoded).not.toBeNull();
    expect(decoded!.banner).toBe('OHOS HDC');
    expect(decoded!.authType).toBe(1);
    expect(decoded!.sessionId).toBe(0x12345678);
    expect(decoded!.connectKey).toBe('test-key');
    expect(decoded!.version).toBe('3.2.0');
  });

  it('should handle invalid handshake format', () => {
    const buf = Buffer.from('invalid');
    expect(decodeHandshake(buf)).toBeNull();
  });
});
