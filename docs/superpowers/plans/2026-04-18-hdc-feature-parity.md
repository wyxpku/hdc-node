# HDC Feature Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Node.js hdc CLI functionally identical to the official C++ hdc tool, capable of communicating with real HarmonyOS devices via the official server/daemon.

**Architecture:** Three-tier client-server-daemon model. The Node.js CLI (client) connects to the local HDC server via TCP on port 8710 using the **channel protocol** (raw bytes + ChannelHandShake struct). The server communicates with device daemons using the **session protocol** (PayloadHead + protobuf-serialized PayloadProtect). We must match the official wire format exactly.

**Tech Stack:** TypeScript, Node.js (net, tls, crypto, fs, path), Vitest for testing. No runtime dependencies.

---

## Gap Analysis Summary

| Area | Official C++ | Current Node.js | Gap |
|------|-------------|-----------------|-----|
| **Wire protocol** | 11-byte PayloadHead + protobuf PayloadProtect | 10-byte header, no PayloadProtect | **Critical** - incompatible |
| **Serialization** | Protobuf-compatible SerialStruct | Custom TLV (different format) | **Critical** - can't talk to server |
| **Channel handshake** | Raw 44-108 byte packed struct | None | **Critical** - can't connect to server |
| **Session handshake** | Protobuf-serialized SessionHandShake with auth flow | Custom pipe-delimited string | **Critical** - can't auth with daemon |
| **Client architecture** | Connects to local server, auto-pull-up | Direct TCP to device | **Major** - wrong architecture |
| **Server architecture** | Accepts clients, routes to daemons | Basic TCP listener only | **Major** - no routing |
| **CLI commands** | 30+ commands | ~10 commands, many are stubs | **Major** - missing features |
| **File transfer** | TAR headers, LZ4, options (-a/-sync/-z/-m) | Basic chunk streaming only | **Major** - limited features |
| **Auth** | RSA-3072 with UI confirmation | Key generation only, no flow | **Medium** |
| **Flashd** | update/flash/erase/format | Not implemented | **Low** (device-specific) |

---

## File Structure

```
src/
  common/
    serialization.ts        # NEW - Protobuf-compatible encoder/decoder
    message.ts              # MODIFY - Rewrite to use PayloadHead(11B) + PayloadProtect
    protocol.ts             # MODIFY - Update command enums, add missing constants
    session.ts              # MODIFY - Rewrite handshake with protobuf serialization
    channel.ts              # MODIFY - Add ChannelHandShake raw struct handling
    auth.ts                 # MODIFY - Implement full auth handshake flow
    transfer.ts             # NEW - TransferConfig, TransferPayload, TAR headers
    header.ts               # NEW - TAR header for directory transfer
    compress.ts             # MODIFY - Add LZ4 support
    heartbeat.ts            # MODIFY - Use protobuf HeartbeatMsg
    task.ts                 # Minor updates
    tcp.ts                  # MODIFY - Add UDS support
    tlv.ts                  # Keep as-is (used for feature negotiation, different from protocol)
    ssl.ts                  # MODIFY - PSK support
    uart.ts                 # Keep as-is (stub)
    usb.ts                  # Keep as-is (stub)
    jdwp.ts                 # Keep as-is
    forward.ts              # MODIFY - Add reverse forward, 7 forward types
  host/
    cli.ts                  # MODIFY - Rewrite with proper client architecture
    parser.ts               # MODIFY - Add all missing commands/options
    translate.ts             # MODIFY - Complete command mapping
    client.ts               # MODIFY - Rewrite with channel protocol
    server.ts               # MODIFY - Rewrite with server-for-client + daemon routing
    shell.ts                # MODIFY - Interactive + extended shell support
    file.ts                 # MODIFY - Full transfer protocol with options
    app.ts                  # MODIFY - Multi-package, directory, sideload
    hilog.ts                # Keep as-is (good)
    host_updater.ts          # NEW - Flashd commands (update/flash/erase/format)
    host_forward.ts          # NEW - Host-side forward with all node types
```

---

## Phase 1: Protocol Foundation

These tasks are the foundation. Without them, nothing can communicate with the official server or daemon.

### Task 1: Implement Protobuf-Compatible Serialization

**Files:**
- Create: `src/common/serialization.ts`
- Test: `src/common/serialization.test.ts`

This implements the protobuf-compatible wire format used by the official HDC for PayloadProtect, SessionHandShake, TransferConfig, and HeartbeatMsg.

- [ ] **Step 1: Write the failing test for varint encoding**

```typescript
// src/common/serialization.test.ts
import { describe, it, expect } from 'vitest';
import { WireType, encodeVarint, decodeVarint, Serializer, Deserializer } from './serialization.js';

describe('Varint encoding', () => {
  it('encodes single-byte values (0-127)', () => {
    expect(encodeVarint(0)).toEqual(Buffer.from([0x00]));
    expect(encodeVarint(1)).toEqual(Buffer.from([0x01]));
    expect(encodeVarint(127)).toEqual(Buffer.from([0x7f]));
  });

  it('encodes multi-byte values', () => {
    expect(encodeVarint(128)).toEqual(Buffer.from([0x80, 0x01]));
    expect(encodeVarint(300)).toEqual(Buffer.from([0xac, 0x02]));
    expect(encodeVarint(0xFFFFFFFF)).toEqual(Buffer.from([0xff, 0xff, 0xff, 0xff, 0x0f]));
  });

  it('decodes varints', () => {
    const buf = Buffer.from([0xac, 0x02]);
    const { value, bytesRead } = decodeVarint(buf, 0);
    expect(value).toBe(300);
    expect(bytesRead).toBe(2);
  });

  it('round-trips large values', () => {
    const values = [0, 1, 127, 128, 255, 256, 16384, 0x7FFFFFFF, 0xFFFFFFFF];
    for (const v of values) {
      const encoded = encodeVarint(v);
      const { value } = decodeVarint(encoded, 0);
      expect(value).toBe(v);
    }
  });
});

describe('Serializer', () => {
  it('encodes uint32 field as VARINT', () => {
    const s = new Serializer();
    s.writeUint32(1, 42); // field 1, value 42
    // Tag: (1 << 3) | 0 = 8, varint(42) = 42
    expect(s.toBuffer()).toEqual(Buffer.from([0x08, 0x2a]));
  });

  it('encodes string field as LENGTH_DELIMITED', () => {
    const s = new Serializer();
    s.writeString(1, 'hello');
    // Tag: (1 << 3) | 2 = 10, len=5, "hello"
    const expected = Buffer.from([0x0a, 0x05, 0x68, 0x65, 0x6c, 0x6c, 0x6f]);
    expect(s.toBuffer()).toEqual(expected);
  });

  it('encodes multiple fields', () => {
    const s = new Serializer();
    s.writeUint32(1, 42);
    s.writeUint32(2, 100);
    s.writeString(3, 'test');
    const buf = s.toBuffer();
    const d = new Deserializer(buf);
    const f1 = d.readUint32(1);
    const f2 = d.readUint32(2);
    const f3 = d.readString(3);
    expect(f1).toBe(42);
    expect(f2).toBe(100);
    expect(f3).toBe('test');
  });
});

describe('Deserializer', () => {
  it('decodes PayloadProtect', () => {
    // Encode channelId=0, commandFlag=1, checkSum=0, vCode=9
    const s = new Serializer();
    s.writeUint32(1, 0);    // channelId
    s.writeUint32(2, 1);    // commandFlag = CMD_KERNEL_HANDSHAKE
    s.writeUint32(3, 0);    // checkSum
    s.writeUint32(4, 0x09); // vCode
    const buf = s.toBuffer();

    const d = new Deserializer(buf);
    expect(d.readUint32(1)).toBe(0);
    expect(d.readUint32(2)).toBe(1);
    expect(d.readUint32(3)).toBe(0);
    expect(d.readUint32(4)).toBe(0x09);
  });

  it('handles empty buffer', () => {
    const d = new Deserializer(Buffer.alloc(0));
    expect(d.readUint32(1)).toBe(0);
    expect(d.readString(2)).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/common/serialization.test.ts -v`
Expected: FAIL - module not found

- [ ] **Step 3: Implement protobuf-compatible serialization**

```typescript
// src/common/serialization.ts
/**
 * Protobuf-compatible serialization for HDC protocol.
 * Matches the SerialStruct wire format from the C++ implementation.
 *
 * Wire types:
 *   0 = VARINT (uint32, uint64, bool, enum)
 *   2 = LENGTH_DELIMITED (string, bytes, sub-message)
 */

export enum WireType {
  VARINT = 0,
  FIXED64 = 1,
  LENGTH_DELIMITED = 2,
  FIXED32 = 5,
}

// ---- Varint ----

export function encodeVarint(value: number): Buffer {
  const bytes: number[] = [];
  let v = value >>> 0; // ensure unsigned 32-bit
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v > 0) byte |= 0x80;
    bytes.push(byte);
  } while (v > 0);
  return Buffer.from(bytes);
}

export function decodeVarint(buf: Buffer, offset: number): { value: number; bytesRead: number } {
  let result = 0;
  let shift = 0;
  let bytesRead = 0;
  while (offset + bytesRead < buf.length) {
    const byte = buf[offset + bytesRead];
    result |= (byte & 0x7f) << shift;
    bytesRead++;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  return { value: result >>> 0, bytesRead };
}

// ---- Tag key ----

function encodeTag(fieldNumber: number, wireType: WireType): Buffer {
  return encodeVarint((fieldNumber << 3) | wireType);
}

// ---- Serializer ----

export class Serializer {
  private parts: Buffer[] = [];

  writeTag(fieldNumber: number, wireType: WireType): void {
    this.parts.push(encodeTag(fieldNumber, wireType));
  }

  writeUint32(fieldNumber: number, value: number): void {
    if (value === 0) return; // proto default, omit
    this.writeTag(fieldNumber, WireType.VARINT);
    this.parts.push(encodeVarint(value));
  }

  writeUint64(fieldNumber: number, value: number): void {
    if (value === 0) return;
    this.writeTag(fieldNumber, WireType.VARINT);
    // Encode as two varints for values > 32 bits (simplified)
    this.parts.push(encodeVarint(value & 0xFFFFFFFF));
    if (value > 0xFFFFFFFF) {
      this.parts.push(encodeVarint(Math.floor(value / 0x100000000)));
    }
  }

  writeBool(fieldNumber: number, value: boolean): void {
    if (!value) return;
    this.writeTag(fieldNumber, WireType.VARINT);
    this.parts.push(Buffer.from([1]));
  }

  writeString(fieldNumber: number, value: string): void {
    if (!value) return;
    const data = Buffer.from(value, 'utf8');
    this.writeTag(fieldNumber, WireType.LENGTH_DELIMITED);
    this.parts.push(encodeVarint(data.length));
    this.parts.push(data);
  }

  writeBytes(fieldNumber: number, value: Buffer): void {
    if (value.length === 0) return;
    this.writeTag(fieldNumber, WireType.LENGTH_DELIMITED);
    this.parts.push(encodeVarint(value.length));
    this.parts.push(value);
  }

  writeRaw(buf: Buffer): void {
    this.parts.push(buf);
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.parts);
  }
}

// ---- Deserializer ----

export class Deserializer {
  private buf: Buffer;
  private fields: Map<number, { wireType: WireType; offset: number; length: number }[]> = new Map();

  constructor(buf: Buffer) {
    this.buf = buf;
    this.parse();
  }

  private parse(): void {
    let offset = 0;
    while (offset < this.buf.length) {
      const { value: tag, bytesRead: tagBytes } = decodeVarint(this.buf, offset);
      offset += tagBytes;
      const fieldNumber = tag >>> 3;
      const wireType: WireType = tag & 0x07;

      let fieldLength = 0;
      if (wireType === WireType.VARINT) {
        // Skip varint value
        while (offset < this.buf.length && (this.buf[offset] & 0x80) !== 0) {
          offset++;
          fieldLength++;
        }
        if (offset < this.buf.length) {
          offset++;
          fieldLength++;
        }
      } else if (wireType === WireType.LENGTH_DELIMITED) {
        const { value: len, bytesRead: lenBytes } = decodeVarint(this.buf, offset);
        offset += lenBytes;
        fieldLength = len;
        offset += len;
      } else if (wireType === WireType.FIXED32) {
        fieldLength = 4;
        offset += 4;
      } else if (wireType === WireType.FIXED64) {
        fieldLength = 8;
        offset += 8;
      } else {
        break; // unknown wire type, stop
      }

      const fieldStart = offset - fieldLength;
      if (!this.fields.has(fieldNumber)) {
        this.fields.set(fieldNumber, []);
      }
      this.fields.get(fieldNumber)!.push({ wireType, offset: fieldStart, length: fieldLength });
    }
  }

  readUint32(fieldNumber: number): number {
    const entries = this.fields.get(fieldNumber);
    if (!entries || entries.length === 0) return 0;
    const entry = entries[entries.length - 1];
    if (entry.wireType === WireType.VARINT) {
      const { value } = decodeVarint(this.buf, entry.offset);
      return value;
    }
    return 0;
  }

  readString(fieldNumber: number): string {
    const entries = this.fields.get(fieldNumber);
    if (!entries || entries.length === 0) return '';
    const entry = entries[entries.length - 1];
    if (entry.wireType === WireType.LENGTH_DELIMITED) {
      // The value includes the length-prefix varint already stripped during parse
      // We stored offset pointing to start of actual data
      return this.buf.toString('utf8', entry.offset, entry.offset + entry.length);
    }
    return '';
  }

  readBytes(fieldNumber: number): Buffer {
    const entries = this.fields.get(fieldNumber);
    if (!entries || entries.length === 0) return Buffer.alloc(0);
    const entry = entries[entries.length - 1];
    if (entry.wireType === WireType.LENGTH_DELIMITED) {
      return this.buf.subarray(entry.offset, entry.offset + entry.length);
    }
    return Buffer.alloc(0);
  }

  readBool(fieldNumber: number): boolean {
    return this.readUint32(fieldNumber) !== 0;
  }

  hasField(fieldNumber: number): boolean {
    return (this.fields.get(fieldNumber)?.length ?? 0) > 0;
  }
}

// ---- Convenience: encode/decode PayloadProtect ----

export interface PayloadProtect {
  channelId: number;
  commandFlag: number;
  checkSum: number;
  vCode: number;
}

export function encodePayloadProtect(p: PayloadProtect): Buffer {
  const s = new Serializer();
  s.writeUint32(1, p.channelId);
  s.writeUint32(2, p.commandFlag);
  s.writeUint32(3, p.checkSum);
  s.writeUint32(4, p.vCode);
  return s.toBuffer();
}

export function decodePayloadProtect(buf: Buffer): PayloadProtect {
  const d = new Deserializer(buf);
  return {
    channelId: d.readUint32(1),
    commandFlag: d.readUint32(2),
    checkSum: d.readUint32(3),
    vCode: d.readUint32(4),
  };
}

// ---- Convenience: encode/decode SessionHandShake ----

export interface SessionHandShake {
  banner: string;
  authType: number;
  sessionId: number;
  connectKey: string;
  buf: string;
  version: string;
}

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/common/serialization.test.ts -v`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/common/serialization.ts src/common/serialization.test.ts
git commit -m "feat: add protobuf-compatible serialization for HDC protocol"
```

---

### Task 2: Rewrite Wire Protocol (PayloadHead + PayloadProtect)

**Files:**
- Modify: `src/common/message.ts`
- Test: `src/common/message.test.ts`

Rewrite the packet encoder/decoder to use the official 11-byte PayloadHead + protobuf PayloadProtect format.

- [ ] **Step 1: Write the failing test**

```typescript
// In src/common/message.test.ts - add these tests

describe('Official protocol PayloadHead', () => {
  it('encodes 11-byte PayloadHead correctly', () => {
    const payload = Buffer.from('hello');
    const protect = { channelId: 0, commandFlag: 1, checkSum: 0, vCode: 0x09 };
    const packet = createPacket(payload, protect);

    // Check PayloadHead
    expect(packet[0]).toBe(0x48); // 'H'
    expect(packet[1]).toBe(0x57); // 'W'
    expect(packet[2]).toBe(0x00); // reserve
    expect(packet[3]).toBe(0x00); // reserve
    expect(packet[4]).toBe(0x01); // protocolVer

    // headSize (big-endian uint16) at offset 5
    const headSize = packet.readUInt16BE(5);
    expect(headSize).toBeGreaterThan(0);

    // dataSize (big-endian uint32) at offset 7
    const dataSize = packet.readUInt32BE(7);
    expect(dataSize).toBe(5); // "hello".length
  });

  it('round-trips packet with PayloadProtect', () => {
    const payload = Buffer.from('test data');
    const protect = { channelId: 42, commandFlag: 2001, checkSum: 0, vCode: 0x09 };
    const packet = createPacket(payload, protect);

    const parsed = parsePacket(packet);
    expect(parsed).not.toBeNull();
    expect(parsed!.payload.toString()).toBe('test data');
    expect(parsed!.protect.channelId).toBe(42);
    expect(parsed!.protect.commandFlag).toBe(2001);
    expect(parsed!.protect.vCode).toBe(0x09);
  });

  it('rejects packet with wrong magic', () => {
    const buf = Buffer.alloc(20);
    buf.write('XX', 0, 'ascii'); // wrong flag
    expect(parsePacket(buf)).toBeNull();
  });

  it('rejects packet with wrong vCode', () => {
    const payload = Buffer.from('test');
    const protect = { channelId: 0, commandFlag: 1, checkSum: 0, vCode: 0xFF }; // bad vCode
    const packet = createPacket(payload, protect);
    // vCode validation should fail - but we still parse since ENABLE_IO_CHECKSUM is false
    // Official behavior: always check vCode
    const parsed = parsePacket(packet);
    // With bad vCode, should return null
    expect(parsed).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/common/message.test.ts -v`
Expected: FAIL - createPacket signature mismatch

- [ ] **Step 3: Rewrite message.ts with official protocol**

The full rewrite of `src/common/message.ts` - replace the entire file content. Key changes:
- PayloadHead is 11 bytes (not 10)
- Added `protocolVer` field (1 byte), replaced one reserve byte
- `headSize` (uint16 BE) replaces version field
- `dataSize` (uint32 BE) replaces dataLength
- PayloadProtect is protobuf-serialized (not raw)
- `parsePacket` returns `{ header, protect, payload }`

```typescript
// src/common/message.ts - Key exports to change:

export const PACKET_FLAG = 'HW';
export const PACKET_HEADER_SIZE = 11; // was 10
export const PROTOCOL_VERSION = 0x01;
export const PAYLOAD_PROTECT_VCODE = 0x09;

export interface PacketHeader {
  flag: string;         // 2 bytes: "HW"
  reserve: number;      // 2 bytes: reserved/encrypt flags
  protocolVer: number;  // 1 byte: 0x01
  headSize: number;     // 2 bytes BE: size of serialized PayloadProtect
  dataSize: number;     // 4 bytes BE: size of raw payload
}

export interface PacketParseResult {
  header: PacketHeader;
  protect: PayloadProtect;
  payload: Buffer;
}

export function encodeHeader(header: PacketHeader): Buffer {
  const buf = Buffer.allocUnsafe(PACKET_HEADER_SIZE);
  buf.write(header.flag, 0, 2, 'ascii');
  buf.writeUInt16BE(header.reserve, 2);
  buf.writeUInt8(header.protocolVer, 4);
  buf.writeUInt16BE(header.headSize, 5);
  buf.writeUInt32BE(header.dataSize, 7);
  return buf;
}

export function decodeHeader(buf: Buffer): PacketHeader | null {
  if (buf.length < PACKET_HEADER_SIZE) return null;
  return {
    flag: buf.toString('ascii', 0, 2),
    reserve: buf.readUInt16BE(2),
    protocolVer: buf.readUInt8(4),
    headSize: buf.readUInt16BE(5),
    dataSize: buf.readUInt32BE(7),
  };
}

export function createPacket(payload: Buffer, protect: PayloadProtect): Buffer {
  const serializedProtect = encodePayloadProtect(protect);
  const header: PacketHeader = {
    flag: PACKET_FLAG,
    reserve: 0,
    protocolVer: PROTOCOL_VERSION,
    headSize: serializedProtect.length,
    dataSize: payload.length,
  };
  return Buffer.concat([encodeHeader(header), serializedProtect, payload]);
}

export function parsePacket(buf: Buffer): PacketParseResult | null {
  const header = decodeHeader(buf);
  if (!header) return null;
  if (header.flag !== PACKET_FLAG) return null;

  const totalSize = PACKET_HEADER_SIZE + header.headSize + header.dataSize;
  if (buf.length < totalSize) return null;

  const protectBuf = buf.subarray(PACKET_HEADER_SIZE, PACKET_HEADER_SIZE + header.headSize);
  const protect = decodePayloadProtect(protectBuf);

  // Validate vCode (always check, matching official behavior)
  if (protect.vCode !== PAYLOAD_PROTECT_VCODE) return null;

  const payload = buf.subarray(PACKET_HEADER_SIZE + header.headSize, totalSize);
  return { header, protect, payload };
}
```

Import `encodePayloadProtect`, `decodePayloadProtect`, `PayloadProtect` from `./serialization.js`.

Keep existing `CtrlMessage`, `HandshakeMessage`, `HeartbeatMessage` interfaces and their encode/decode functions as-is (they are used by existing code and tests). Add the new `createPacket`/`parsePacket` as the primary API.

- [ ] **Step 4: Run tests to verify**

Run: `npx vitest run src/common/message.test.ts -v`
Expected: ALL PASS

- [ ] **Step 5: Update all call sites**

Update imports in `session.ts`, `shell.ts`, `file.ts`, `app.ts`, `cli.ts` to use the new `createPacket(payload, protect)` signature instead of the old `createPacket(payload, option)`. For each call site, create appropriate `PayloadProtect` with correct channelId and commandFlag.

Run: `npx vitest run -v`
Expected: ALL PASS (521+ tests)

- [ ] **Step 6: Commit**

```bash
git add src/common/message.ts src/common/message.test.ts src/common/serialization.ts src/common/session.ts src/host/shell.ts src/host/file.ts src/host/app.ts src/cli.ts
git commit -m "feat: rewrite wire protocol with 11-byte PayloadHead + protobuf PayloadProtect"
```

---

### Task 3: Implement Channel Handshake Protocol

**Files:**
- Modify: `src/common/channel.ts`
- Test: `src/common/channel.test.ts`

Implement the raw ChannelHandShake struct exchange between client and server.

- [ ] **Step 1: Write the failing test**

```typescript
// Add to src/common/channel.test.ts

import { encodeChannelHandShake, decodeChannelHandShake, ChannelHandShake } from './channel.js';

describe('ChannelHandShake', () => {
  it('encodes and decodes channel handshake (short form, 44 bytes)', () => {
    const hs: ChannelHandShake = {
      banner: 'OHOS HDC',
      channelId: 0,
      connectKey: '',
      version: 'Ver: 3.2.0',
    };
    const buf = encodeChannelHandShake(hs, false); // short form
    expect(buf.length).toBe(44);

    const decoded = decodeChannelHandShake(buf);
    expect(decoded.banner).toBe('OHOS HDC');
    expect(decoded.channelId).toBe(0);
    expect(decoded.connectKey).toBe('');
  });

  it('encodes with channelId in network byte order', () => {
    const hs: ChannelHandShake = {
      banner: 'OHOS HDC',
      channelId: 256,
      connectKey: '',
      version: 'Ver: 3.2.0',
    };
    const buf = encodeChannelHandShake(hs, false);
    // channelId at offset 12, big-endian
    expect(buf.readUInt32BE(12)).toBe(256);
  });

  it('encodes with connectKey', () => {
    const hs: ChannelHandShake = {
      banner: 'OHOS HDC',
      channelId: 0,
      connectKey: '192.168.1.100:5555',
      version: 'Ver: 3.2.0',
    };
    const buf = encodeChannelHandShake(hs, false);
    const decoded = decodeChannelHandShake(buf);
    expect(decoded.connectKey).toBe('192.168.1.100:5555');
  });

  it('sets huge-buffer feature tag', () => {
    const hs: ChannelHandShake = {
      banner: 'OHOS HDC',
      channelId: 0,
      connectKey: '',
      version: 'Ver: 3.2.0',
    };
    const buf = encodeChannelHandShake(hs, false, true); // hugeBuffer
    expect(buf[11]).toBe(0x48); // 'H' = HUGE_BUF_TAG
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/common/channel.test.ts -v`
Expected: FAIL

- [ ] **Step 3: Implement ChannelHandShake in channel.ts**

Add these to `src/common/channel.ts`:

```typescript
export const BANNER_FEATURE_TAG_OFFSET = 11;
export const HUGE_BUF_TAG = 0x48; // 'H'

export interface ChannelHandShake {
  banner: string;       // 12 bytes (null-padded)
  channelId: number;    // 4 bytes BE (or connectKey fills 32 bytes)
  connectKey: string;   // Up to 32 bytes (shares space with channelId)
  version: string;      // 64 bytes (only in long form)
}

export function encodeChannelHandShake(
  hs: ChannelHandShake,
  longForm: boolean,
  hugeBuffer: boolean = true,
): Buffer {
  const size = longForm ? 108 : 44; // 12 + 32 + (64 if long)
  const buf = Buffer.alloc(size);

  // banner (12 bytes)
  buf.write(hs.banner, 0, 11, 'ascii');
  if (hugeBuffer) {
    buf[BANNER_FEATURE_TAG_OFFSET] = HUGE_BUF_TAG;
  }

  // connectKey fills the union space (32 bytes at offset 12)
  // channelId is encoded as big-endian uint32 at offset 12 if no connectKey
  if (hs.connectKey) {
    buf.write(hs.connectKey, 12, 32, 'ascii');
  } else {
    buf.writeUInt32BE(hs.channelId, 12);
  }

  // version (64 bytes at offset 44, only in long form)
  if (longForm && hs.version) {
    buf.write(hs.version, 44, 64, 'ascii');
  }

  return buf;
}

export function decodeChannelHandShake(buf: Buffer): ChannelHandShake {
  const banner = buf.toString('ascii', 0, 11).replace(/\0/g, '');

  // Try to read as connectKey first (check if it looks like text)
  const rawKey = buf.toString('ascii', 12, 44).replace(/\0/g, '');
  const channelId = buf.readUInt32BE(12);
  const connectKey = rawKey.length > 0 ? rawKey : '';

  const version = buf.length >= 108
    ? buf.toString('ascii', 44, 108).replace(/\0/g, '')
    : '';

  return { banner, channelId, connectKey, version };
}
```

- [ ] **Step 4: Run tests to verify**

Run: `npx vitest run src/common/channel.test.ts -v`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/common/channel.ts src/common/channel.test.ts
git commit -m "feat: implement ChannelHandShake raw struct protocol"
```

---

### Task 4: Rewrite Session Handshake with Protobuf

**Files:**
- Modify: `src/common/session.ts`
- Test: `src/common/session.test.ts`

Replace the custom pipe-delimited handshake with protobuf-serialized SessionHandShake, matching the official auth flow.

- [ ] **Step 1: Write the failing test**

```typescript
// Add to src/common/session.test.ts

describe('Session handshake with protobuf', () => {
  it('encodes/decodes SessionHandShake via protobuf', () => {
    const hs: SessionHandShake = {
      banner: 'OHOS HDC',
      authType: AuthType.AUTH_NONE,
      sessionId: 12345,
      connectKey: 'device123',
      buf: '',
      version: 'Ver: 3.2.0',
    };
    const encoded = encodeSessionHandShake(hs);
    const decoded = decodeSessionHandShake(encoded);
    expect(decoded.banner).toBe('OHOS HDC');
    expect(decoded.authType).toBe(AuthType.AUTH_NONE);
    expect(decoded.sessionId).toBe(12345);
    expect(decoded.connectKey).toBe('device123');
    expect(decoded.version).toBe('Ver: 3.2.0');
  });

  it('sends handshake as CMD_KERNEL_HANDSHAKE packet', () => {
    const session = new HdcSession({
      serverOrDaemon: false,
      connType: ConnType.CONN_TCP,
      sessionId: 42,
    });
    // The handshake should send a properly formatted packet
    const sentData: Buffer[] = [];
    const mockSocket = {
      write: (data: Buffer) => { sentData.push(data); },
      on: () => {},
      end: () => {},
    } as any;
    session.attachSocket(mockSocket);

    // Verify sent packet has correct protocol format
    expect(sentData.length).toBeGreaterThan(0);
    const packet = sentData[0];
    expect(packet.toString('ascii', 0, 2)).toBe('HW');
    expect(packet.readUInt8(4)).toBe(0x01); // protocolVer

    // Parse and verify the handshake payload
    const parsed = parsePacket(packet);
    expect(parsed).not.toBeNull();
    expect(parsed!.protect.commandFlag).toBe(1); // CMD_KERNEL_HANDSHAKE
    const handshake = decodeSessionHandShake(parsed!.payload);
    expect(handshake.banner).toBe('OHOS HDC');
    expect(handshake.authType).toBe(AuthType.AUTH_NONE);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/common/session.test.ts -v`
Expected: FAIL

- [ ] **Step 3: Rewrite session handshake in session.ts**

Replace `buildHandshakePayload()` and `parseHandshakePayload()` to use protobuf serialization. Replace `buildPacket()` with the new `createPacket()` that includes PayloadProtect. Update `sendHandshake()` to send via CMD_KERNEL_HANDSHAKE command flag. Update `handleHandshakeResponse()` to decode protobuf SessionHandShake.

Key changes in `src/common/session.ts`:
- Import `encodeSessionHandShake`, `decodeSessionHandShake`, `SessionHandShake` from `./serialization.js`
- Import `createPacket`, `parsePacket`, `PacketParseResult`, `PayloadProtect` from `./message.js`
- `sendHandshake()`: encode SessionHandShake as protobuf, wrap in packet with commandFlag=CMD_KERNEL_HANDSHAKE
- `processBuffer()`: parse using new 11-byte header format
- `handleHandshakeResponse()`: decode protobuf SessionHandShake from payload

- [ ] **Step 4: Run tests to verify**

Run: `npx vitest run src/common/session.test.ts -v`
Expected: ALL PASS

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run -v`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/common/session.ts src/common/session.test.ts
git commit -m "feat: rewrite session handshake with protobuf serialization"
```

---

## Phase 2: Client-Server Architecture

### Task 5: Rewrite HdcClient with Channel Protocol

**Files:**
- Modify: `src/host/client.ts`
- Test: `src/host/client.test.ts` (new)

Implement proper client that connects to the local HDC server via channel protocol.

- [ ] **Step 1: Write the failing test**

```typescript
// src/host/client.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HdcClient } from './client.js';
import * as net from 'net';

describe('HdcClient', () => {
  it('connects to server and performs channel handshake', async () => {
    // Create a mock server
    const server = net.createServer((socket) => {
      // Server sends ChannelHandShake to client
      const hs = Buffer.alloc(44);
      hs.write('OHOS HDC', 0, 11, 'ascii');
      hs[11] = 0x48; // HUGE_BUF_TAG
      hs.writeUInt32BE(htonl(1), 12); // channelId = 1
      socket.write(hs);

      // Expect client to respond with its handshake
      socket.once('data', (data) => {
        expect(data.toString('ascii', 0, 8)).toBe('OHOS HDC');
        socket.end();
      });
    });

    await new Promise<void>((resolve) => server.listen(18710, resolve));
    const client = new HdcClient({ host: '127.0.0.1', port: 18710 });
    await client.connect();
    expect(client.isHandshakeOK()).toBe(true);
    await client.disconnect();
    server.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/host/client.test.ts -v`

- [ ] **Step 3: Implement HdcClient**

Rewrite `src/host/client.ts`:

```typescript
import * as net from 'net';
import { EventEmitter } from 'events';
import {
  encodeChannelHandShake,
  decodeChannelHandShake,
  ChannelHandShake,
} from '../common/channel.js';
import { createPacket, parsePacket, PayloadProtect } from '../common/message.js';
import { CommandId } from '../common/protocol.js';

const HDC_VERSION = 'Ver: 3.2.0';

export interface ClientOptions {
  host: string;
  port: number;
  connectKey?: string;
  timeout?: number;
}

export class HdcClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private options: ClientOptions;
  private channelId: number = 0;
  private handshakeOK: boolean = false;
  private buffer: Buffer = Buffer.alloc(0);

  constructor(options: ClientOptions) {
    super();
    this.options = { timeout: 10000, ...options };
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection(
        { host: this.options.host, port: this.options.port },
        () => {
          this.socket!.on('data', (data) => this.onData(data));
          this.socket!.on('error', (err) => this.emit('error', err));
          this.socket!.on('close', () => this.emit('close'));
        },
      );

      const timer = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, this.options.timeout);

      this.once('handshake', () => {
        clearTimeout(timer);
        resolve();
      });

      this.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  private onData(data: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, data]);

    if (!this.handshakeOK) {
      if (this.buffer.length >= 44) {
        this.processChannelHandshake();
      }
      return;
    }

    // After handshake, data is raw command stream
    this.emit('data', this.buffer);
    this.buffer = Buffer.alloc(0);
  }

  private processChannelHandshake(): void {
    const hs = decodeChannelHandShake(this.buffer.subarray(0, 44));
    if (!hs.banner.startsWith('OHOS HDC')) {
      this.emit('error', new Error('Invalid channel handshake banner'));
      return;
    }

    this.channelId = hs.channelId;

    // Respond with our handshake
    const response = encodeChannelHandShake({
      banner: 'OHOS HDC',
      channelId: 0,
      connectKey: this.options.connectKey || '',
      version: HDC_VERSION,
    }, false);

    this.socket!.write(response);
    this.handshakeOK = true;
    this.buffer = this.buffer.subarray(44);
    this.emit('handshake');
  }

  isHandshakeOK(): boolean { return this.handshakeOK; }
  getChannelId(): number { return this.channelId; }

  /** Send raw command string to server (channel-level, no wrapping) */
  sendCommand(command: string): boolean {
    if (!this.socket || !this.handshakeOK) return false;
    this.socket.write(Buffer.from(command + '\0')); // null-terminated
    return true;
  }

  /** Send command with 2-byte command prefix (for file/app/remote ops) */
  sendPrefixedCommand(commandId: number, data: Buffer): boolean {
    if (!this.socket || !this.handshakeOK) return false;
    const prefix = Buffer.alloc(2);
    prefix.writeUInt16LE(commandId, 0);
    this.socket.write(Buffer.concat([prefix, data]));
    return true;
  }

  async disconnect(): Promise<void> {
    if (this.socket) {
      this.socket.end();
      this.socket = null;
    }
    this.handshakeOK = false;
  }
}
```

- [ ] **Step 4: Run tests to verify**

Run: `npx vitest run src/host/client.test.ts -v`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/host/client.ts src/host/client.test.ts
git commit -m "feat: implement HdcClient with channel protocol handshake"
```

---

### Task 6: Implement Server-For-Client

**Files:**
- Modify: `src/host/server.ts`
- Test: `src/host/server.test.ts` (new)

Implement the server that accepts local client connections and routes commands to daemon sessions.

- [ ] **Step 1: Write the failing test**

```typescript
// src/host/server.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HdcServer } from './server.js';
import { HdcClient } from './client.js';

describe('HdcServer', () => {
  let server: HdcServer;

  beforeEach(async () => {
    server = new HdcServer({ host: '127.0.0.1', port: 18711 });
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  it('accepts client connections and performs channel handshake', async () => {
    const client = new HdcClient({ host: '127.0.0.1', port: 18711 });
    await client.connect();
    expect(client.isHandshakeOK()).toBe(true);
    await client.disconnect();
  });

  it('handles list targets command', async () => {
    const client = new HdcClient({ host: '127.0.0.1', port: 18711 });
    await client.connect();
    const response = await client.executeCommand('list targets');
    // No devices connected initially
    expect(response).toBeDefined();
    await client.disconnect();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement HdcServer**

Rewrite `src/host/server.ts` to:
1. Accept TCP connections on configured port
2. Send ChannelHandShake to each new client
3. Receive client's ChannelHandShake response with connectKey
4. Route commands: local (list targets, tconn, fport ls/rm) vs remote (shell, file, app, forward)
5. Track connected daemon sessions

- [ ] **Step 4: Run tests to verify**

- [ ] **Step 5: Commit**

```bash
git add src/host/server.ts src/host/server.test.ts
git commit -m "feat: implement HdcServer with client routing"
```

---

### Task 7: Rewrite CLI Entry Point

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/host/parser.ts`
- Test: `src/cli.test.ts`, `src/host/parser.test.ts`

Rewrite the CLI to use proper client architecture with auto server pull-up.

- [ ] **Step 1: Add missing CLI options to parser**

Add to `src/host/parser.ts`:
- `-e <ip>` - Forward listen IP
- `-m` - Server mode
- `-p` - Skip server auto-pull-up
- `-n`/`-c` - Container options
- `-S` - External command mode

Add missing commands:
- `discover`, `checkserver`, `checkdevice`, `wait`, `any`
- `tconn`, `tmode`, `smode`
- `jpid`, `track-jpid`
- `target mount`, `target boot`
- `hilog`, `bugreport`
- `sideload`
- `rport`
- `keygen`
- `update`, `flash`, `erase`, `format`
- `start`

- [ ] **Step 2: Update tests for new parser options**

- [ ] **Step 3: Rewrite main() in cli.ts**

New flow:
1. Parse args
2. If server mode (`-m`): start HdcServer
3. Else (client mode):
   a. Check if server is running on 127.0.0.1:8710
   b. If not, auto-pull-up: spawn `hdc -m` in background
   c. Connect to server via HdcClient
   d. Perform channel handshake
   e. Send command
   f. Stream response to stdout
   g. Disconnect and exit

```typescript
// Key structure of new cli.ts main():

async function runClient(parsed: ParsedCommand): Promise<void> {
  const serverAddr = parsed.serverAddr || '127.0.0.1:8710';
  const [host, portStr] = serverAddr.split(':');
  const port = parseInt(portStr || '8710');

  // Auto pull-up server if needed
  if (!parsed.spawnedServer && !await checkServerAlive(host, port)) {
    await pullupServer();
  }

  const client = new HdcClient({
    host,
    port,
    connectKey: parsed.targetKey,
    timeout: 5000,
  });

  await client.connect();

  // Pipe response data to stdout
  client.on('data', (data: Buffer) => {
    process.stdout.write(data);
  });

  const result = await handleCommand(client, parsed);
  if (result) console.log(result);

  await client.disconnect();
}
```

- [ ] **Step 4: Run full test suite**

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts src/host/parser.ts src/cli.test.ts src/host/parser.test.ts
git commit -m "feat: rewrite CLI with auto server pull-up and channel protocol"
```

---

## Phase 3: Core Commands

### Task 8: Complete Shell Command Support

**Files:**
- Modify: `src/host/shell.ts`
- Modify: `src/host/translate.ts`
- Test: `src/host/shell.test.ts`, `src/host/translate.test.ts`

Add support for:
- Interactive shell (PTY-like streaming)
- Extended shell with TLV parameters (`shell -b bundle`)
- Proper stdout/stderr/exit parsing

- [ ] **Step 1: Write tests for extended shell options**

- [ ] **Step 2: Implement extended shell in translate.ts**

Parse `shell -b <bundle> [-t <type>] [-e <ability>] [-c <cmd>] [-n <name>]` and encode as TLV parameters.

- [ ] **Step 3: Implement interactive shell mode**

When `shell` is given with no command, enter interactive mode:
- Pipe stdin to shell channel
- Stream stdout/stderr back
- Handle signals (SIGINT, SIGTERM)

- [ ] **Step 4: Run tests**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: implement interactive and extended shell support"
```

---

### Task 9: Complete File Transfer Protocol

**Files:**
- Create: `src/common/transfer.ts`
- Create: `src/common/header.ts`
- Modify: `src/host/file.ts`
- Modify: `src/host/translate.ts`
- Test: `src/common/transfer.test.ts`, `src/common/header.test.ts`, `src/host/file.test.ts`

Implement the full transfer protocol matching the C++ `HdcTransferBase` and `HdcFile`.

- [ ] **Step 1: Create transfer.ts with TransferConfig**

```typescript
// src/common/transfer.ts
import { Serializer, Deserializer } from './serialization.js';

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

// TransferPayload header for each data chunk
export const TRANSFER_PAYLOAD_HEADER_SIZE = 16; // index(4) + compressType(4) + compressSize(4) + uncompressSize(4)

export interface TransferPayload {
  index: number;
  compressType: number;
  compressSize: number;
  uncompressSize: number;
}

export function encodeTransferPayloadHeader(tp: TransferPayload): Buffer {
  const buf = Buffer.alloc(TRANSFER_PAYLOAD_HEADER_SIZE);
  buf.writeUInt32LE(tp.index, 0);
  buf.writeUInt32LE(tp.compressType, 4);
  buf.writeUInt32LE(tp.compressSize, 8);
  buf.writeUInt32LE(tp.uncompressSize, 12);
  return buf;
}

export function decodeTransferPayloadHeader(buf: Buffer): TransferPayload | null {
  if (buf.length < TRANSFER_PAYLOAD_HEADER_SIZE) return null;
  return {
    index: buf.readUInt32LE(0),
    compressType: buf.readUInt32LE(4),
    compressSize: buf.readUInt32LE(8),
    uncompressSize: buf.readUInt32LE(12),
  };
}
```

- [ ] **Step 2: Create header.ts for TAR directory transfer**

Implement a simplified TAR header for directory transfers.

- [ ] **Step 3: Rewrite file.ts with full protocol**

Implement:
- `CMD_FILE_INIT` -> `CMD_FILE_CHECK` -> `CMD_FILE_BEGIN` -> `CMD_FILE_DATA` (with TransferPayload headers) -> `CMD_FILE_FINISH`
- Options: `-a` (preserve timestamps), `-z` (compress), `-sync` (update only newer), `-m` (mode sync)
- Directory transfer with TAR headers

- [ ] **Step 4: Update translate.ts for file options**

Parse `file send [-a] [-z] [-sync] [-m] local remote` and `file recv remote local`.

- [ ] **Step 5: Run tests**

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: implement full file transfer protocol with options"
```

---

### Task 10: Complete Port Forwarding

**Files:**
- Modify: `src/common/forward.ts`
- Create: `src/host/host_forward.ts`
- Modify: `src/host/translate.ts`
- Test: `src/host/host_forward.test.ts`

- [ ] **Step 1: Implement all 7 forward node types**

Parse and handle: `tcp:<port>`, `localabstract:<name>`, `jdwp:<pid>`, `ark:<pid>@<tid>`, `dev:<name>`, `localfilesystem:<path>`, plus reserved types.

- [ ] **Step 2: Implement reverse port forward (`rport`)**

- [ ] **Step 3: Update translate.ts for fport/rport commands**

Parse: `fport ls`, `fport rm <task>`, `fport <local> <remote>`, `rport <remote> <local>`.

- [ ] **Step 4: Run tests**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: implement full port forward/reverse with all node types"
```

---

### Task 11: Complete App Management

**Files:**
- Modify: `src/host/app.ts`
- Modify: `src/host/translate.ts`
- Test: `src/host/app.test.ts`

- [ ] **Step 1: Add multi-package install support**

Parse `install [-r] [-g] [-d] <path>` where path can be:
- Single .hap/.hsp file
- .app bundle
- Directory (auto-tar)

- [ ] **Step 2: Add uninstall with options**

Parse `uninstall [-k] [-n <name>] [-m <module>] <package>`

- [ ] **Step 3: Add sideload command**

Parse `sideload <path>` for OTA package delivery.

- [ ] **Step 4: Run tests**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: implement multi-package install, uninstall options, and sideload"
```

---

## Phase 4: System Commands

### Task 12: Implement System/Unity Commands

**Files:**
- Modify: `src/host/translate.ts`
- Modify: `src/host/shell.ts`
- Modify: `src/cli.ts`
- Test: `src/host/translate.test.ts`

Wire up all unity commands through the CLI.

- [ ] **Step 1: Implement target mount (CMD_UNITY_REMOUNT)**

- [ ] **Step 2: Implement target boot (CMD_UNITY_REBOOT)**

Parse `target boot [-bootloader|-recovery|MODE]`

- [ ] **Step 3: Implement tmode (CMD_UNITY_RUNMODE)**

Parse `tmode usb`, `tmode port [port]`, `tmode port close`

- [ ] **Step 4: Implement smode (CMD_UNITY_ROOTRUN)**

Parse `smode [-r]`

- [ ] **Step 5: Implement hilog (CMD_UNITY_HILOG)**

Wire existing `HdcHilog` module to CLI with proper command routing.

- [ ] **Step 6: Implement bugreport (CMD_UNITY_BUGREPORT_INIT)**

- [ ] **Step 7: Implement jpid / track-jpid (CMD_JDWP_LIST / CMD_JDWP_TRACK)**

- [ ] **Step 8: Implement device management commands**

- `tconn <key> [-remove]` (CMD_KERNEL_TARGET_CONNECT/DISCONNECT)
- `list targets [-v]` (CMD_KERNEL_TARGET_LIST)
- `discover` (CMD_KERNEL_TARGET_DISCOVER)
- `wait` (CMD_WAIT_FOR)
- `any` (CMD_KERNEL_TARGET_ANY)
- `checkserver` (CMD_CHECK_SERVER)
- `checkdevice <key>` (CMD_CHECK_DEVICE)
- `start [-r]` (CMD_SERVICE_START)
- `kill [-r]` (CMD_SERVER_KILL)

- [ ] **Step 9: Implement keygen (local RSA keypair generation)**

- [ ] **Step 10: Run all tests**

- [ ] **Step 11: Commit**

```bash
git commit -m "feat: implement all system and device management commands"
```

---

### Task 13: Implement Flashd Commands

**Files:**
- Create: `src/host/host_updater.ts`
- Modify: `src/host/translate.ts`
- Test: `src/host/host_updater.test.ts`

- [ ] **Step 1: Implement HostUpdater**

Commands: `update <pkg>`, `flash [-f] <partition> <image>`, `erase [-f] <partition>`, `format [-f] <partition>`.

Uses CMD_FLASHD_UPDATE_INIT/FLASH_INIT/ERASE/FORMAT + CMD_FLASHD_CHECK/BEGIN/DATA/FINISH protocol.

- [ ] **Step 2: Update translate.ts for flashd commands**

- [ ] **Step 3: Run tests**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: implement flashd update/flash/erase/format commands"
```

---

## Phase 5: Integration Testing

### Task 14: End-to-End Test with Official Server

**Files:**
- Test: `tests/e2e/` directory (new)

Test the Node.js client against the running official HDC server.

- [ ] **Step 1: Create E2E test for list targets**

```typescript
// tests/e2e/e2e.test.ts
import { describe, it, expect } from 'vitest';
import { HdcClient } from '../../src/host/client.js';

describe('E2E: Connect to official HDC server', () => {
  it('connects and lists targets', async () => {
    const client = new HdcClient({ host: '127.0.0.1', port: 8710 });
    await client.connect();
    expect(client.isHandshakeOK()).toBe(true);

    const response = await client.executeCommand('list targets');
    expect(response).toContain('device');
    await client.disconnect();
  });
});
```

- [ ] **Step 2: Create E2E test for shell command**

- [ ] **Step 3: Create E2E test for file send/recv**

- [ ] **Step 4: Run E2E tests against real device**

- [ ] **Step 5: Commit**

```bash
git commit -m "test: add E2E tests against official HDC server"
```

---

### Task 15: Update Protocol Version and Final Compatibility

**Files:**
- Modify: `src/common/protocol.ts`
- Modify: `src/index.ts`
- Test: all tests

- [ ] **Step 1: Update protocol constants**

Update `HDC_VERSION_NUMBER` to `0x30200300` (3.2.0d), align all enum values with official `define_enum.h`.

- [ ] **Step 2: Verify all command IDs match official**

Cross-reference every `CommandId` with the official `HdcCommand` enum.

- [ ] **Step 3: Run full test suite**

- [ ] **Step 4: Build and test CLI**

```bash
npm run build && node dist/cli.js version
node dist/cli.js list targets
```

- [ ] **Step 5: Commit**

```bash
git commit -m "chore: align protocol version and constants with official"
```

---

## Dependency Graph

```
Task 1 (serialization) ─┐
                         ├─► Task 2 (wire protocol) ─┐
                         │                            ├─► Task 4 (session handshake)
                         │                            │
Task 3 (channel HS) ────┼─► Task 5 (client) ─────────┤
                         │                            │
                         └─► Task 6 (server) ─────────┤
                                                      │
                         Task 7 (CLI rewrite) ◄───────┘
                               │
                  ┌────────────┼────────────┐
                  ▼            ▼            ▼
            Task 8        Task 9       Task 10
           (shell)       (file)      (forward)
                  │            │            │
                  └────────────┼────────────┘
                               ▼
                         Task 11 (app)
                               │
                  ┌────────────┼────────────┐
                  ▼                         ▼
            Task 12                    Task 13
         (system cmds)               (flashd)
                  │                         │
                  └────────────┬────────────┘
                               ▼
                         Task 14 (E2E)
                               │
                               ▼
                         Task 15 (final)
```

## Estimated Scope

| Phase | Tasks | New Files | Modified Files |
|-------|-------|-----------|----------------|
| Phase 1: Protocol | 4 | 1 | 4 |
| Phase 2: Architecture | 3 | 1 | 4 |
| Phase 3: Commands | 4 | 2 | 5 |
| Phase 4: System | 2 | 1 | 3 |
| Phase 5: Integration | 2 | 0 | 2 |
| **Total** | **15** | **5** | **18** |
