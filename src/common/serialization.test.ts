/**
 * HDC Serialization Module Tests
 *
 * Comprehensive tests for protobuf-compatible serializer/deserializer
 */

import { describe, it, expect } from 'vitest';
import {
  WireType,
  encodeVarint,
  decodeVarint,
  Serializer,
  Deserializer,
  encodePayloadProtect,
  decodePayloadProtect,
  encodeSessionHandShake,
  decodeSessionHandShake,
} from './serialization.js';
import type { PayloadProtect, SessionHandShake } from './serialization.js';

// ---------------------------------------------------------------------------
// Varint encoding / decoding
// ---------------------------------------------------------------------------

describe('encodeVarint', () => {
  it('should encode 0 as single byte 0x00', () => {
    const buf = encodeVarint(0);
    expect(buf.length).toBe(1);
    expect(buf[0]).toBe(0x00);
  });

  it('should encode 1 as single byte 0x01', () => {
    const buf = encodeVarint(1);
    expect(buf.length).toBe(1);
    expect(buf[0]).toBe(0x01);
  });

  it('should encode 127 as single byte 0x7f', () => {
    const buf = encodeVarint(127);
    expect(buf.length).toBe(1);
    expect(buf[0]).toBe(0x7f);
  });

  it('should encode 128 as two bytes [0x80, 0x01]', () => {
    const buf = encodeVarint(128);
    expect(buf.length).toBe(2);
    expect(buf[0]).toBe(0x80);
    expect(buf[1]).toBe(0x01);
  });

  it('should encode 300 as two bytes', () => {
    // 300 = 0b100101100 => varint: 0b10101100 0b00000010 => 0xAC 0x02
    const buf = encodeVarint(300);
    expect(buf.length).toBe(2);
    expect(buf[0]).toBe(0xac);
    expect(buf[1]).toBe(0x02);
  });

  it('should encode 0xFFFFFFFF (max uint32) correctly', () => {
    const buf = encodeVarint(0xffffffff);
    // 0xFFFFFFFF = 4294967295 => 5 bytes varint
    // Each byte carries 7 bits: need ceil(32/7) = 5 bytes
    expect(buf.length).toBe(5);

    // Verify round-trip
    const { value } = decodeVarint(buf, 0);
    expect(value).toBe(0xffffffff);
  });

  it('should encode 16383 (two-byte boundary) correctly', () => {
    // 16383 = 0x3FFF = 0b11111111111111 => two bytes, all 7-bit groups set
    const buf = encodeVarint(16383);
    expect(buf.length).toBe(2);
    expect(buf[0]).toBe(0xff);
    expect(buf[1]).toBe(0x7f);
  });

  it('should encode 16384 (three-byte start) correctly', () => {
    const buf = encodeVarint(16384);
    expect(buf.length).toBe(3);
  });
});

describe('decodeVarint', () => {
  it('should decode single-byte varint 0', () => {
    const buf = Buffer.from([0x00]);
    const result = decodeVarint(buf, 0);
    expect(result.value).toBe(0);
    expect(result.bytesRead).toBe(1);
  });

  it('should decode single-byte varint 1', () => {
    const buf = Buffer.from([0x01]);
    const result = decodeVarint(buf, 0);
    expect(result.value).toBe(1);
    expect(result.bytesRead).toBe(1);
  });

  it('should decode two-byte varint 128', () => {
    const buf = Buffer.from([0x80, 0x01]);
    const result = decodeVarint(buf, 0);
    expect(result.value).toBe(128);
    expect(result.bytesRead).toBe(2);
  });

  it('should decode two-byte varint 300', () => {
    const buf = Buffer.from([0xac, 0x02]);
    const result = decodeVarint(buf, 0);
    expect(result.value).toBe(300);
    expect(result.bytesRead).toBe(2);
  });

  it('should respect offset parameter', () => {
    const buf = Buffer.from([0xff, 0xac, 0x02]);
    const result = decodeVarint(buf, 1);
    expect(result.value).toBe(300);
    expect(result.bytesRead).toBe(2);
  });

  it('should throw on unexpected end of buffer', () => {
    const buf = Buffer.from([0x80]); // continuation set but no next byte
    expect(() => decodeVarint(buf, 0)).toThrow('Unexpected end of buffer');
  });
});

describe('Varint round-trip', () => {
  const testValues = [0, 1, 127, 128, 300, 16383, 16384, 0x7fffffff, 0xffffffff];

  for (const val of testValues) {
    it(`should round-trip value ${val}`, () => {
      const encoded = encodeVarint(val);
      const { value } = decodeVarint(encoded, 0);
      expect(value).toBe(val);
    });
  }
});

// ---------------------------------------------------------------------------
// WireType enum
// ---------------------------------------------------------------------------

describe('WireType', () => {
  it('should have correct enum values', () => {
    expect(WireType.VARINT).toBe(0);
    expect(WireType.FIXED64).toBe(1);
    expect(WireType.LENGTH_DELIMITED).toBe(2);
    expect(WireType.FIXED32).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

describe('Serializer', () => {
  it('should produce empty buffer when no fields are written', () => {
    const s = new Serializer();
    expect(s.toBuffer().length).toBe(0);
  });

  it('should omit uint32 field with value 0', () => {
    const s = new Serializer();
    s.writeUint32(1, 0);
    expect(s.toBuffer().length).toBe(0);
  });

  it('should encode uint32 field with non-zero value', () => {
    const s = new Serializer();
    s.writeUint32(1, 42);
    const buf = s.toBuffer();

    // Tag for field 1, VARINT wire type = (1 << 3) | 0 = 0x08
    // Value 42 as varint = 0x2A
    expect(buf.length).toBe(2);
    expect(buf[0]).toBe(0x08);
    expect(buf[1]).toBe(42);
  });

  it('should encode string field', () => {
    const s = new Serializer();
    s.writeString(1, 'hello');
    const buf = s.toBuffer();

    // Tag for field 1, LENGTH_DELIMITED = (1 << 3) | 2 = 0x0A
    expect(buf[0]).toBe(0x0a);
    // Length varint = 5
    expect(buf[1]).toBe(5);
    // UTF-8 content
    expect(buf.subarray(2).toString('utf-8')).toBe('hello');
  });

  it('should omit empty string field', () => {
    const s = new Serializer();
    s.writeString(1, '');
    expect(s.toBuffer().length).toBe(0);
  });

  it('should encode bool field (true)', () => {
    const s = new Serializer();
    s.writeBool(1, true);
    const buf = s.toBuffer();

    // Tag for field 1, VARINT = 0x08
    expect(buf[0]).toBe(0x08);
    // Value 1
    expect(buf[1]).toBe(1);
  });

  it('should omit bool field (false)', () => {
    const s = new Serializer();
    s.writeBool(1, false);
    expect(s.toBuffer().length).toBe(0);
  });

  it('should encode bytes field', () => {
    const s = new Serializer();
    s.writeBytes(2, Buffer.from([0xde, 0xad, 0xbe, 0xef]));
    const buf = s.toBuffer();

    // Tag for field 2, LENGTH_DELIMITED = (2 << 3) | 2 = 0x12
    expect(buf[0]).toBe(0x12);
    // Length = 4
    expect(buf[1]).toBe(4);
    // Data
    expect(buf[2]).toBe(0xde);
    expect(buf[3]).toBe(0xad);
    expect(buf[4]).toBe(0xbe);
    expect(buf[5]).toBe(0xef);
  });

  it('should omit empty bytes field', () => {
    const s = new Serializer();
    s.writeBytes(1, Buffer.alloc(0));
    expect(s.toBuffer().length).toBe(0);
  });

  it('should encode multiple fields in sequence', () => {
    const s = new Serializer();
    s.writeUint32(1, 100);
    s.writeString(2, 'test');
    s.writeUint32(3, 200);
    const buf = s.toBuffer();
    expect(buf.length).toBeGreaterThan(0);

    // Verify we can deserialize it
    const d = new Deserializer(buf);
    expect(d.readUint32(1)).toBe(100);
    expect(d.readString(2)).toBe('test');
    expect(d.readUint32(3)).toBe(200);
  });

  it('should encode uint64 field', () => {
    const s = new Serializer();
    s.writeUint64(1, 100000);
    const buf = s.toBuffer();
    expect(buf.length).toBeGreaterThan(0);

    const d = new Deserializer(buf);
    expect(d.readUint32(1)).toBe(100000);
  });

  it('should omit uint64 field with value 0', () => {
    const s = new Serializer();
    s.writeUint64(1, 0);
    expect(s.toBuffer().length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Deserializer
// ---------------------------------------------------------------------------

describe('Deserializer', () => {
  it('should parse all fields from a buffer with multiple fields', () => {
    const s = new Serializer();
    s.writeUint32(1, 42);
    s.writeString(2, 'hello');
    s.writeBool(3, true);
    const buf = s.toBuffer();

    const d = new Deserializer(buf);
    expect(d.readUint32(1)).toBe(42);
    expect(d.readString(2)).toBe('hello');
    expect(d.readBool(3)).toBe(true);
  });

  it('should return defaults for missing fields', () => {
    const s = new Serializer();
    s.writeUint32(1, 42);
    const buf = s.toBuffer();

    const d = new Deserializer(buf);
    expect(d.readUint32(99)).toBe(0);
    expect(d.readString(99)).toBe('');
    expect(d.readBool(99)).toBe(false);
    expect(d.readBytes(99).length).toBe(0);
  });

  it('should report hasField correctly', () => {
    const s = new Serializer();
    s.writeUint32(1, 42);
    const buf = s.toBuffer();

    const d = new Deserializer(buf);
    expect(d.hasField(1)).toBe(true);
    expect(d.hasField(2)).toBe(false);
  });

  it('should handle empty buffer', () => {
    const d = new Deserializer(Buffer.alloc(0));
    expect(d.readUint32(1)).toBe(0);
    expect(d.readString(1)).toBe('');
    expect(d.readBool(1)).toBe(false);
    expect(d.hasField(1)).toBe(false);
  });

  it('should read bytes field', () => {
    const data = Buffer.from([0x01, 0x02, 0x03]);
    const s = new Serializer();
    s.writeBytes(5, data);
    const buf = s.toBuffer();

    const d = new Deserializer(buf);
    const result = d.readBytes(5);
    expect(result.equals(data)).toBe(true);
  });

  it('should decode PayloadProtect', () => {
    const pp: PayloadProtect = {
      channelId: 100,
      commandFlag: 5,
      checkSum: 0xdeadbeef >>> 0,
      vCode: 42,
    };
    const buf = encodePayloadProtect(pp);
    const decoded = decodePayloadProtect(buf);

    expect(decoded.channelId).toBe(pp.channelId);
    expect(decoded.commandFlag).toBe(pp.commandFlag);
    expect(decoded.checkSum).toBe(pp.checkSum);
    expect(decoded.vCode).toBe(pp.vCode);
  });

  it('should decode SessionHandShake', () => {
    const hs: SessionHandShake = {
      banner: 'OHOS HDC',
      authType: 1,
      sessionId: 0x12345678,
      connectKey: 'test-key-123',
      buf: 'some-buf-data',
      version: '3.2.0',
    };
    const buf = encodeSessionHandShake(hs);
    const decoded = decodeSessionHandShake(buf);

    expect(decoded.banner).toBe(hs.banner);
    expect(decoded.authType).toBe(hs.authType);
    expect(decoded.sessionId).toBe(hs.sessionId);
    expect(decoded.connectKey).toBe(hs.connectKey);
    expect(decoded.buf).toBe(hs.buf);
    expect(decoded.version).toBe(hs.version);
  });
});

// ---------------------------------------------------------------------------
// PayloadProtect round-trip
// ---------------------------------------------------------------------------

describe('PayloadProtect round-trip', () => {
  it('should round-trip with all non-zero fields', () => {
    const original: PayloadProtect = {
      channelId: 42,
      commandFlag: 7,
      checkSum: 0xabcdef12 >>> 0,
      vCode: 99,
    };
    const buf = encodePayloadProtect(original);
    const decoded = decodePayloadProtect(buf);

    expect(decoded).toEqual(original);
  });

  it('should round-trip with all-zero fields', () => {
    const original: PayloadProtect = {
      channelId: 0,
      commandFlag: 0,
      checkSum: 0,
      vCode: 0,
    };
    const buf = encodePayloadProtect(original);
    const decoded = decodePayloadProtect(buf);

    // All zeros -> empty buffer -> defaults all 0
    expect(decoded).toEqual(original);
    expect(buf.length).toBe(0);
  });

  it('should round-trip with partial zero fields', () => {
    const original: PayloadProtect = {
      channelId: 100,
      commandFlag: 0,
      checkSum: 0,
      vCode: 200,
    };
    const buf = encodePayloadProtect(original);
    const decoded = decodePayloadProtect(buf);

    expect(decoded).toEqual(original);
  });

  it('should produce compact encoding (no zero fields)', () => {
    const pp: PayloadProtect = {
      channelId: 0,
      commandFlag: 0,
      checkSum: 1,
      vCode: 0,
    };
    const buf = encodePayloadProtect(pp);

    // Only field 3 (checkSum=1) should be encoded
    // Tag: (3 << 3) | 0 = 0x18, value: 0x01
    expect(buf.length).toBe(2);
    expect(buf[0]).toBe(0x18);
    expect(buf[1]).toBe(0x01);
  });

  it('should handle max uint32 values', () => {
    const original: PayloadProtect = {
      channelId: 0xffffffff,
      commandFlag: 0xffffffff,
      checkSum: 0xffffffff,
      vCode: 0xffffffff,
    };
    const buf = encodePayloadProtect(original);
    const decoded = decodePayloadProtect(buf);

    expect(decoded).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// SessionHandShake round-trip
// ---------------------------------------------------------------------------

describe('SessionHandShake round-trip', () => {
  it('should round-trip with all fields populated', () => {
    const original: SessionHandShake = {
      banner: 'OHOS HDC',
      authType: 1,
      sessionId: 0xaabbccdd,
      connectKey: 'my-secret-key',
      buf: 'handshake-buf',
      version: '4.0.1',
    };
    const buf = encodeSessionHandShake(original);
    const decoded = decodeSessionHandShake(buf);

    expect(decoded).toEqual(original);
  });

  it('should round-trip with all-default fields', () => {
    const original: SessionHandShake = {
      banner: '',
      authType: 0,
      sessionId: 0,
      connectKey: '',
      buf: '',
      version: '',
    };
    const buf = encodeSessionHandShake(original);
    const decoded = decodeSessionHandShake(buf);

    expect(decoded).toEqual(original);
    expect(buf.length).toBe(0);
  });

  it('should round-trip with only banner set', () => {
    const original: SessionHandShake = {
      banner: 'OHOS HDC',
      authType: 0,
      sessionId: 0,
      connectKey: '',
      buf: '',
      version: '',
    };
    const buf = encodeSessionHandShake(original);
    const decoded = decodeSessionHandShake(buf);

    expect(decoded).toEqual(original);
  });

  it('should handle UTF-8 strings correctly', () => {
    const original: SessionHandShake = {
      banner: 'OHOS HDC \u4e2d\u6587', // Chinese characters
      authType: 2,
      sessionId: 12345,
      connectKey: 'key-\u00e9-\u00fc', // accented chars
      buf: 'buf',
      version: '1.0.0',
    };
    const buf = encodeSessionHandShake(original);
    const decoded = decodeSessionHandShake(buf);

    expect(decoded).toEqual(original);
  });

  it('should handle special characters in connectKey', () => {
    const original: SessionHandShake = {
      banner: 'test',
      authType: 0,
      sessionId: 0,
      connectKey: 'key=with&special?chars#here',
      buf: '',
      version: '',
    };
    const buf = encodeSessionHandShake(original);
    const decoded = decodeSessionHandShake(buf);

    expect(decoded.connectKey).toBe(original.connectKey);
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting: encode + decode consistency
// ---------------------------------------------------------------------------

describe('Encode/Decode consistency', () => {
  it('should preserve data through nested serialize/deserialize', () => {
    // Build a complex payload manually and verify each layer
    const inner: PayloadProtect = {
      channelId: 255,
      commandFlag: 128,
      checkSum: 0xcafebabe >>> 0,
      vCode: 1,
    };

    // Encode inner
    const innerBuf = encodePayloadProtect(inner);
    expect(innerBuf.length).toBeGreaterThan(0);

    // Wrap in an outer structure
    const s = new Serializer();
    s.writeBytes(1, innerBuf);
    s.writeString(2, 'wrapper');
    const outerBuf = s.toBuffer();

    // Decode outer
    const d = new Deserializer(outerBuf);
    expect(d.readString(2)).toBe('wrapper');

    // Decode inner from outer's bytes field
    const extractedInner = d.readBytes(1);
    const decodedInner = decodePayloadProtect(extractedInner);
    expect(decodedInner).toEqual(inner);
  });

  it('should handle interleaved field numbers', () => {
    // Write fields out of typical order
    const s = new Serializer();
    s.writeUint32(5, 100);
    s.writeString(2, 'middle');
    s.writeUint32(10, 999);
    const buf = s.toBuffer();

    const d = new Deserializer(buf);
    expect(d.readUint32(5)).toBe(100);
    expect(d.readString(2)).toBe('middle');
    expect(d.readUint32(10)).toBe(999);
    // Fields not written
    expect(d.readUint32(1)).toBe(0);
    expect(d.readString(3)).toBe('');
  });
});
