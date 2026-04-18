/**
 * HDC Protobuf-Compatible Serialization Module
 *
 * Implements a protobuf-compatible serializer/deserializer matching the
 * official C++ SerialStruct wire format used by OpenHarmony HDC protocol.
 *
 * Wire format follows standard protobuf encoding:
 * - Varint: variable-length integer encoding (7 bits data per byte, MSB=continuation)
 * - Tag: (fieldNumber << 3) | wireType encoded as varint
 * - Length-delimited: varint length prefix followed by payload bytes
 */

/**
 * Protobuf wire types
 */
export enum WireType {
  VARINT = 0,
  FIXED64 = 1,
  LENGTH_DELIMITED = 2,
  FIXED32 = 5,
}

/**
 * Encode a non-negative integer as a protobuf varint.
 * Standard protobuf varint: 7 bits of data per byte, MSB is continuation flag,
 * little-endian byte order within the varint.
 */
export function encodeVarint(value: number): Buffer {
  if (value < 0) {
    // For negative values in 32-bit context, treat as unsigned 32-bit
    value = value >>> 0;
  }
  const bytes: number[] = [];
  while (value > 0x7f) {
    bytes.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  bytes.push(value & 0x7f);
  return Buffer.from(bytes);
}

/**
 * Decode a varint from a buffer at the given offset.
 * Returns the decoded value and number of bytes consumed.
 */
export function decodeVarint(buf: Buffer, offset: number): { value: number; bytesRead: number } {
  let value = 0;
  let shift = 0;
  let bytesRead = 0;
  let byte: number;

  do {
    if (offset + bytesRead >= buf.length) {
      throw new Error('Unexpected end of buffer while decoding varint');
    }
    byte = buf[offset + bytesRead];
    value |= (byte & 0x7f) << shift;
    shift += 7;
    bytesRead++;
  } while ((byte & 0x80) !== 0);

  // Ensure unsigned 32-bit result
  value = value >>> 0;
  return { value, bytesRead };
}

/**
 * Encode a field tag (field number + wire type) as a varint.
 */
function encodeTag(fieldNumber: number, wireType: WireType): Buffer {
  return encodeVarint((fieldNumber << 3) | wireType);
}

/**
 * Protobuf-compatible serializer.
 * Writes fields in protobuf wire format and collects them into a buffer.
 * Fields with default values (0, empty string, false, empty buffer) are omitted.
 */
export class Serializer {
  private parts: Buffer[] = [];

  /**
   * Write a uint32 field (VARINT wire type).
   * Omitted if value is 0 (proto default).
   */
  writeUint32(field: number, value: number): void {
    if (value === 0) return;
    this.parts.push(encodeTag(field, WireType.VARINT));
    this.parts.push(encodeVarint(value));
  }

  /**
   * Write a uint64 field (VARINT wire type).
   * Omitted if both high and low parts are 0.
   * For simplicity, accepts a number and encodes as varint (supports up to ~2^53 safely).
   */
  writeUint64(field: number, value: number): void {
    if (value === 0) return;
    this.parts.push(encodeTag(field, WireType.VARINT));
    this.parts.push(encodeVarint(value));
  }

  /**
   * Write a bool field (VARINT wire type).
   * Omitted if value is false (proto default).
   */
  writeBool(field: number, value: boolean): void {
    if (!value) return;
    this.parts.push(encodeTag(field, WireType.VARINT));
    this.parts.push(encodeVarint(1));
  }

  /**
   * Write a string field (LENGTH_DELIMITED wire type).
   * Omitted if string is empty (proto default).
   */
  writeString(field: number, value: string): void {
    if (!value || value.length === 0) return;
    const utf8 = Buffer.from(value, 'utf-8');
    this.parts.push(encodeTag(field, WireType.LENGTH_DELIMITED));
    this.parts.push(encodeVarint(utf8.length));
    this.parts.push(utf8);
  }

  /**
   * Write a bytes field (LENGTH_DELIMITED wire type).
   * Omitted if buffer is empty (proto default).
   */
  writeBytes(field: number, value: Buffer): void {
    if (!value || value.length === 0) return;
    this.parts.push(encodeTag(field, WireType.LENGTH_DELIMITED));
    this.parts.push(encodeVarint(value.length));
    this.parts.push(value);
  }

  /**
   * Concatenate all written fields into a single Buffer.
   */
  toBuffer(): Buffer {
    return Buffer.concat(this.parts);
  }
}

/**
 * Parsed field from protobuf wire format.
 */
interface ParsedField {
  fieldNumber: number;
  wireType: WireType;
  value: number;
  data: Buffer;
}

/**
 * Protobuf-compatible deserializer.
 * Pre-parses all fields in the constructor for efficient lookup by field number.
 * Returns default values (0, '', false, empty Buffer) when reading missing fields.
 */
export class Deserializer {
  private fields: Map<number, ParsedField> = new Map();

  constructor(buf: Buffer) {
    this.parse(buf);
  }

  /**
   * Parse all fields from the buffer during construction.
   */
  private parse(buf: Buffer): void {
    let offset = 0;

    while (offset < buf.length) {
      // Decode tag
      const tag = decodeVarint(buf, offset);
      offset += tag.bytesRead;

      const fieldNumber = tag.value >>> 3;
      const wireType: WireType = tag.value & 0x07;

      let value = 0;
      let data = Buffer.alloc(0);

      switch (wireType) {
        case WireType.VARINT: {
          const varint = decodeVarint(buf, offset);
          offset += varint.bytesRead;
          value = varint.value;
          break;
        }
        case WireType.LENGTH_DELIMITED: {
          const length = decodeVarint(buf, offset);
          offset += length.bytesRead;
          data = Buffer.from(buf.subarray(offset, offset + length.value));
          offset += length.value;
          break;
        }
        case WireType.FIXED32: {
          if (offset + 4 > buf.length) {
            throw new Error('Unexpected end of buffer while reading FIXED32');
          }
          value = buf.readUInt32LE(offset);
          data = Buffer.from(buf.subarray(offset, offset + 4));
          offset += 4;
          break;
        }
        case WireType.FIXED64: {
          if (offset + 8 > buf.length) {
            throw new Error('Unexpected end of buffer while reading FIXED64');
          }
          // Read as two 32-bit values for safety; store low part in value
          value = buf.readUInt32LE(offset);
          data = Buffer.from(buf.subarray(offset, offset + 8));
          offset += 8;
          break;
        }
        default:
          throw new Error(`Unknown wire type: ${wireType}`);
      }

      this.fields.set(fieldNumber, { fieldNumber, wireType, value, data });
    }
  }

  /**
   * Check whether a field with the given field number was present in the encoded data.
   */
  hasField(field: number): boolean {
    return this.fields.has(field);
  }

  /**
   * Read a uint32 field (VARINT wire type).
   * Returns 0 if the field was not present.
   */
  readUint32(field: number): number {
    const parsed = this.fields.get(field);
    if (!parsed) return 0;
    return parsed.value;
  }

  /**
   * Read a string field (LENGTH_DELIMITED wire type).
   * Returns empty string if the field was not present.
   */
  readString(field: number): string {
    const parsed = this.fields.get(field);
    if (!parsed) return '';
    return parsed.data.toString('utf-8');
  }

  /**
   * Read a bytes field (LENGTH_DELIMITED wire type).
   * Returns empty Buffer if the field was not present.
   */
  readBytes(field: number): Buffer {
    const parsed = this.fields.get(field);
    if (!parsed) return Buffer.alloc(0);
    return parsed.data;
  }

  /**
   * Read a bool field (VARINT wire type).
   * Returns false if the field was not present.
   */
  readBool(field: number): boolean {
    const parsed = this.fields.get(field);
    if (!parsed) return false;
    return parsed.value !== 0;
  }
}

/**
 * PayloadProtect structure (matches C++ PayloadProtect used in channel message framing).
 * Field numbers match the protobuf schema: 1=channelId, 2=commandFlag, 3=checkSum, 4=vCode
 */
export interface PayloadProtect {
  channelId: number;
  commandFlag: number;
  checkSum: number;
  vCode: number;
}

/**
 * Encode a PayloadProtect struct to protobuf wire format.
 */
export function encodePayloadProtect(p: PayloadProtect): Buffer {
  const s = new Serializer();
  s.writeUint32(1, p.channelId);
  s.writeUint32(2, p.commandFlag);
  s.writeUint32(3, p.checkSum);
  s.writeUint32(4, p.vCode);
  return s.toBuffer();
}

/**
 * Decode a PayloadProtect struct from protobuf wire format.
 */
export function decodePayloadProtect(buf: Buffer): PayloadProtect {
  const d = new Deserializer(buf);
  return {
    channelId: d.readUint32(1),
    commandFlag: d.readUint32(2),
    checkSum: d.readUint32(3),
    vCode: d.readUint32(4),
  };
}

/**
 * SessionHandShake structure (matches C++ SessionHandShake used in connection establishment).
 * Field numbers: 1=banner, 2=authType, 3=sessionId, 4=connectKey, 5=buf, 6=version
 */
export interface SessionHandShake {
  banner: string;
  authType: number;
  sessionId: number;
  connectKey: string;
  buf: string;
  version: string;
}

/**
 * Encode a SessionHandShake struct to protobuf wire format.
 */
export function encodeSessionHandShake(hs: SessionHandShake): Buffer {
  const s = new Serializer();
  s.writeString(1, hs.banner);
  s.writeUint32(2, hs.authType);
  s.writeUint32(3, hs.sessionId);
  s.writeString(4, hs.connectKey);
  s.writeString(5, hs.buf);
  s.writeString(6, hs.version);
  return s.toBuffer();
}

/**
 * Decode a SessionHandShake struct from protobuf wire format.
 */
export function decodeSessionHandShake(buf: Buffer): SessionHandShake {
  const d = new Deserializer(buf);
  return {
    banner: d.readString(1),
    authType: d.readUint32(2),
    sessionId: d.readUint32(3),
    connectKey: d.readString(4),
    buf: d.readString(5),
    version: d.readString(6),
  };
}
