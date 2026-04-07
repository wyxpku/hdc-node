/**
 * Message Module Tests
 *
 * Tests for packet encoding/decoding
 */

import { describe, it, expect } from 'vitest';
import {
  PACKET_HEADER_SIZE,
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
  it('should have correct header size', () => {
    expect(PACKET_HEADER_SIZE).toBe(10);
  });

  it('should have correct default header', () => {
    expect(DEFAULT_HEADER.flag).toBe('HW');
    expect(DEFAULT_HEADER.version).toBe(1);
  });
});

describe('encodeHeader', () => {
  it('should encode header correctly', () => {
    const header = {
      flag: 'HW',
      reserve: 0,
      version: 1,
      option: 0,
      dataLength: 100,
    };
    
    const buf = encodeHeader(header);
    expect(buf.length).toBe(PACKET_HEADER_SIZE);
    expect(buf.toString('ascii', 0, 2)).toBe('HW');  // flag is 2 bytes
  });

  it('should encode dataLength correctly', () => {
    const header = {
      flag: 'HW',
      reserve: 0,
      version: 1,
      option: 0,
      dataLength: 0x12345678,
    };
    
    const buf = encodeHeader(header);
    expect(buf.readUInt32LE(6)).toBe(0x12345678);
  });
});

describe('decodeHeader', () => {
  it('should decode valid header', () => {
    const header = {
      flag: 'HW',
      reserve: 1,
      version: 2,
      option: 3,
      dataLength: 500,
    };
    
    const buf = encodeHeader(header);
    const decoded = decodeHeader(buf);
    
    expect(decoded).not.toBeNull();
    expect(decoded!.flag).toBe('HW');
    expect(decoded!.reserve).toBe(1);
    expect(decoded!.version).toBe(2);
    expect(decoded!.option).toBe(3);
    expect(decoded!.dataLength).toBe(500);
  });

  it('should return null for buffer too small', () => {
    const buf = Buffer.alloc(4);
    expect(decodeHeader(buf)).toBeNull();
  });
});

describe('createPacket', () => {
  it('should create packet with header and payload', () => {
    const payload = Buffer.from('hello world');
    const packet = createPacket(payload);
    
    expect(packet.length).toBe(PACKET_HEADER_SIZE + payload.length);
    expect(packet.toString('ascii', 0, 2)).toBe('HW');  // flag is 2 bytes
  });

  it('should preserve payload data', () => {
    const payload = Buffer.from('test data 123');
    const packet = createPacket(payload);
    const payloadPart = packet.subarray(PACKET_HEADER_SIZE);
    expect(payloadPart.equals(payload)).toBe(true);
  });
});

describe('parsePacket', () => {
  it('should parse valid packet', () => {
    const payload = Buffer.from('test payload');
    const packet = createPacket(payload);
    const parsed = parsePacket(packet);
    
    expect(parsed).not.toBeNull();
    expect(parsed!.header.flag).toBe('HW');
    expect(parsed!.payload.equals(payload)).toBe(true);
  });

  it('should return null for invalid header', () => {
    const buf = Buffer.from('invalid data');
    expect(parsePacket(buf)).toBeNull();
  });

  it('should return null if length mismatch', () => {
    const payload = Buffer.from('test');
    const packet = createPacket(payload);
    // Truncate packet to simulate length mismatch
    const truncated = packet.subarray(1, 8);
    expect(parsePacket(truncated)).toBeNull();
  });
});

describe('isValidHeader', () => {
  it('should return true for valid header', () => {
    expect(isValidHeader(DEFAULT_HEADER)).toBe(true);
  });

  it('should return false for invalid flag', () => {
    expect(isValidHeader({ ...DEFAULT_HEADER, flag: 'XX' })).toBe(false);
  });

  it('should return false for invalid version', () => {
    expect(isValidHeader({ ...DEFAULT_HEADER, version: 0 })).toBe(false);
  });

  it('should accept zero data length', () => {
    expect(isValidHeader({ ...DEFAULT_HEADER, dataLength: 0 })).toBe(true);
  });
});

describe('getPacketSize', () => {
  it('should calculate correct packet size', () => {
    expect(getPacketSize(100)).toBe(PACKET_HEADER_SIZE + 100);
    expect(getPacketSize(0)).toBe(PACKET_HEADER_SIZE);
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
