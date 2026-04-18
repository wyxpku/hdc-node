/**
 * Tests for Channel module
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HdcChannel, HdcChannelManager, ChannelState, MAX_CHANNEL_COUNT,
  encodeChannelHandShake, decodeChannelHandShake,
  BANNER_FEATURE_TAG_OFFSET, HUGE_BUF_TAG } from './channel.js';

describe('HdcChannel', () => {
  describe('constructor', () => {
    it('should create channel instance', () => {
      const channel = new HdcChannel({ sessionId: 12345 });

      expect(channel.channelId).toBeGreaterThan(0);
      expect(channel.sessionId).toBe(12345);
      expect(channel.getState()).toBe(ChannelState.IDLE);
    });

    it('should accept custom options', () => {
      const channel = new HdcChannel({
        channelId: 999,
        sessionId: 111,
        commandId: 222,
        bufferSize: 128 * 1024,
      });

      expect(channel.channelId).toBe(999);
      expect(channel.sessionId).toBe(111);
      expect(channel.commandId).toBe(222);
      expect(channel['bufferSize']).toBe(128 * 1024);
    });
  });

  describe('getInfo', () => {
    it('should return channel info', () => {
      const channel = new HdcChannel({ sessionId: 12345, commandId: 100 });
      const info = channel.getInfo();

      expect(info.channelId).toBe(channel.channelId);
      expect(info.sessionId).toBe(12345);
      expect(info.commandId).toBe(100);
      expect(info.state).toBe(ChannelState.IDLE);
      expect(info.bytesReceived).toBe(0);
      expect(info.bytesSent).toBe(0);
      expect(info.createTime).toBeDefined();
      expect(info.lastActivity).toBeDefined();
    });
  });

  describe('initialize', () => {
    it('should initialize channel', async () => {
      const channel = new HdcChannel({ sessionId: 12345 });
      await channel.initialize();

      expect(channel.getState()).toBe(ChannelState.READY);
    });

    it('should emit ready event', async () => {
      const channel = new HdcChannel({ sessionId: 12345 });
      let ready = false;
      channel.on('ready', () => {
        ready = true;
      });

      await channel.initialize();

      expect(ready).toBe(true);
    });

    it('should throw error if already initialized', async () => {
      const channel = new HdcChannel({ sessionId: 12345 });
      await channel.initialize();

      await expect(channel.initialize()).rejects.toThrow('already initialized');
    });
  });

  describe('isReady', () => {
    it('should return false when idle', () => {
      const channel = new HdcChannel({ sessionId: 12345 });
      expect(channel.isReady()).toBe(false);
    });

    it('should return true when ready', async () => {
      const channel = new HdcChannel({ sessionId: 12345 });
      await channel.initialize();
      expect(channel.isReady()).toBe(true);
    });
  });

  describe('write', () => {
    it('should throw error when not ready', async () => {
      const channel = new HdcChannel({ sessionId: 12345 });
      await expect(channel.write(Buffer.from('test'))).rejects.toThrow('not ready');
    });

    it('should write data when ready', async () => {
      const channel = new HdcChannel({ sessionId: 12345 });
      await channel.initialize();

      const bytes = await channel.write(Buffer.from('test data'));
      expect(bytes).toBe(9);
      expect(channel.getInfo().bytesSent).toBe(9);
    });

    it('should emit write event', async () => {
      const channel = new HdcChannel({ sessionId: 12345 });
      await channel.initialize();

      let writeData: Buffer | null = null;
      channel.on('write', (data: Buffer) => {
        writeData = data;
      });

      await channel.write(Buffer.from('hello'));
      expect(writeData?.toString()).toBe('hello');
    });
  });

  describe('read', () => {
    it('should throw error when not ready', async () => {
      const channel = new HdcChannel({ sessionId: 12345 });
      await expect(channel.read()).rejects.toThrow('not ready');
    });

    it('should read pushed data', async () => {
      const channel = new HdcChannel({ sessionId: 12345 });
      await channel.initialize();

      channel.pushData(Buffer.from('test data'));

      const data = await channel.read();
      expect(data.toString()).toBe('test data');
    });

    it('should emit read event', async () => {
      const channel = new HdcChannel({ sessionId: 12345 });
      await channel.initialize();

      let readData: Buffer | null = null;
      channel.on('read', (data: Buffer) => {
        readData = data;
      });

      channel.pushData(Buffer.from('hello'));
      await channel.read();

      expect(readData?.toString()).toBe('hello');
    });
  });

  describe('pushData', () => {
    it('should push data to buffer', async () => {
      const channel = new HdcChannel({ sessionId: 12345 });
      await channel.initialize();

      channel.pushData(Buffer.from('data1'));
      channel.pushData(Buffer.from('data2'));

      const data1 = await channel.read();
      const data2 = await channel.read();

      expect(data1.toString()).toBe('data1');
      expect(data2.toString()).toBe('data2');
    });

    it('should update bytes received', () => {
      const channel = new HdcChannel({ sessionId: 12345 });

      channel.pushData(Buffer.from('test'));
      expect(channel.getInfo().bytesReceived).toBe(4);
    });
  });

  describe('flush', () => {
    it('should flush write queue', async () => {
      const channel = new HdcChannel({ sessionId: 12345 });
      await channel.initialize();

      await channel.write(Buffer.from('data'));
      await channel.flush();

      expect(channel['writeQueue'].length).toBe(0);
    });
  });

  describe('close', () => {
    it('should close channel', async () => {
      const channel = new HdcChannel({ sessionId: 12345 });
      await channel.initialize();
      await channel.close();

      expect(channel.getState()).toBe(ChannelState.CLOSED);
    });

    it('should be idempotent', async () => {
      const channel = new HdcChannel({ sessionId: 12345 });
      await channel.close();
      await channel.close();
      await channel.close();

      expect(channel.getState()).toBe(ChannelState.CLOSED);
    });

    it('should emit close event', async () => {
      const channel = new HdcChannel({ sessionId: 12345 });
      let closed = false;
      channel.on('close', () => {
        closed = true;
      });

      await channel.close();

      expect(closed).toBe(true);
    });
  });

  describe('getStats', () => {
    it('should return bytes statistics', async () => {
      const channel = new HdcChannel({ sessionId: 12345 });
      await channel.initialize();

      await channel.write(Buffer.from('sent'));
      channel.pushData(Buffer.from('received'));

      const stats = channel.getStats();

      expect(stats.bytesSent).toBe(4);
      expect(stats.bytesReceived).toBe(8);
    });
  });
});

describe('HdcChannelManager', () => {
  let manager: HdcChannelManager;

  beforeEach(() => {
    manager = new HdcChannelManager();
  });

  afterEach(async () => {
    await manager.closeAll();
  });

  describe('constructor', () => {
    it('should create manager', () => {
      expect(manager.count).toBe(0);
    });

    it('should accept max channels', () => {
      const customManager = new HdcChannelManager(100);
      expect(customManager['maxChannels']).toBe(100);
    });
  });

  describe('createChannel', () => {
    it('should create channel', () => {
      const channel = manager.createChannel({ sessionId: 12345 });

      expect(channel).not.toBeNull();
      expect(manager.count).toBe(1);
    });

    it('should emit channel-create event', () => {
      let created = false;
      manager.on('channel-create', () => {
        created = true;
      });

      manager.createChannel({ sessionId: 12345 });

      expect(created).toBe(true);
    });
  });

  describe('getChannel', () => {
    it('should get channel by ID', () => {
      const channel = manager.createChannel({ sessionId: 12345 });
      const found = manager.getChannel(channel!.channelId);

      expect(found).toBe(channel);
    });

    it('should return undefined for non-existent ID', () => {
      const found = manager.getChannel(99999);
      expect(found).toBeUndefined();
    });
  });

  describe('getChannelsBySession', () => {
    it('should get channels by session ID', () => {
      manager.createChannel({ sessionId: 111 });
      manager.createChannel({ sessionId: 111 });
      manager.createChannel({ sessionId: 222 });

      const channels = manager.getChannelsBySession(111);

      expect(channels.length).toBe(2);
    });
  });

  describe('removeChannel', () => {
    it('should remove channel', async () => {
      const channel = manager.createChannel({ sessionId: 12345 });
      await channel!.initialize();
      const result = await manager.removeChannel(channel!.channelId);

      expect(result).toBe(true);
      expect(manager.count).toBe(0);
    });

    it('should return false for non-existent channel', async () => {
      const result = await manager.removeChannel(99999);
      expect(result).toBe(false);
    });
  });

  describe('removeSessionChannels', () => {
    it('should remove all channels for session', async () => {
      manager.createChannel({ sessionId: 111 });
      manager.createChannel({ sessionId: 111 });
      manager.createChannel({ sessionId: 222 });

      const removed = await manager.removeSessionChannels(111);

      expect(removed).toBe(2);
      expect(manager.getChannelsBySession(111).length).toBe(0);
    });
  });

  describe('listChannels', () => {
    it('should list all channels', () => {
      manager.createChannel({ sessionId: 111 });
      manager.createChannel({ sessionId: 222 });

      const channels = manager.listChannels();

      expect(channels.length).toBe(2);
    });
  });

  describe('getReadyChannels', () => {
    it('should get ready channels', async () => {
      const channel1 = manager.createChannel({ sessionId: 111 });
      const channel2 = manager.createChannel({ sessionId: 222 });

      await channel1!.initialize();

      const ready = manager.getReadyChannels();

      expect(ready.length).toBe(1);
      expect(ready).toContain(channel1);
    });
  });

  describe('closeAll', () => {
    it('should close all channels', async () => {
      manager.createChannel({ sessionId: 111 });
      manager.createChannel({ sessionId: 222 });

      await manager.closeAll();

      expect(manager.count).toBe(0);
    });
  });
});

describe('ChannelState enum', () => {
  it('should have correct values', () => {
    expect(ChannelState.IDLE).toBe('idle');
    expect(ChannelState.INITIALIZING).toBe('initializing');
    expect(ChannelState.READY).toBe('ready');
    expect(ChannelState.TRANSFERRING).toBe('transferring');
    expect(ChannelState.CLOSING).toBe('closing');
    expect(ChannelState.CLOSED).toBe('closed');
    expect(ChannelState.ERROR).toBe('error');
  });
});

describe('Constants', () => {
  it('should have correct max channel count', () => {
    expect(MAX_CHANNEL_COUNT).toBe(1024);
  });
});

describe('ChannelHandShake', () => {
  describe('encode short form', () => {
    it('should produce a 44-byte buffer', () => {
      const buf = encodeChannelHandShake(
        { banner: 'OHOS HDC', channelId: 0, connectKey: '', version: '' },
        false,
      );
      expect(buf.length).toBe(44);
    });

    it('should write banner into first 11 bytes padded with nulls', () => {
      const buf = encodeChannelHandShake(
        { banner: 'OHOS HDC', channelId: 0, connectKey: '', version: '' },
        false,
      );
      // Banner "OHOS HDC" is 8 chars, padded to 11 with nulls
      expect(buf.subarray(0, 11).toString('ascii')).toBe('OHOS HDC\0\0\0');
    });
  });

  describe('encode with channelId', () => {
    it('should write channelId as uint32 BE at offset 12', () => {
      const buf = encodeChannelHandShake(
        { banner: 'OHOS HDC', channelId: 0x12345678, connectKey: '', version: '' },
        false,
      );
      expect(buf.readUInt32BE(12)).toBe(0x12345678);
    });

    it('should encode channelId in network byte order', () => {
      const buf = encodeChannelHandShake(
        { banner: 'OHOS HDC', channelId: 1, connectKey: '', version: '' },
        false,
      );
      // channelId=1 should be 00 00 00 01 in big-endian
      expect(buf[12]).toBe(0);
      expect(buf[13]).toBe(0);
      expect(buf[14]).toBe(0);
      expect(buf[15]).toBe(1);
    });
  });

  describe('encode with connectKey', () => {
    it('should write connectKey at offset 12 instead of channelId', () => {
      const buf = encodeChannelHandShake(
        { banner: 'OHOS HDC', channelId: 0, connectKey: 'devicekey123', version: '' },
        false,
      );
      const key = buf.subarray(12, 44).toString('ascii').replace(/\0+$/, '');
      expect(key).toBe('devicekey123');
    });

    it('should truncate connectKey to 32 bytes', () => {
      const longKey = 'A'.repeat(64);
      const buf = encodeChannelHandShake(
        { banner: 'OHOS HDC', channelId: 0, connectKey: longKey, version: '' },
        false,
      );
      const key = buf.subarray(12, 44).toString('ascii').replace(/\0+$/, '');
      expect(key.length).toBe(32);
      expect(key).toBe('A'.repeat(32));
    });
  });

  describe('decode server handshake with channelId', () => {
    it('should decode channelId from server handshake', () => {
      // Simulate a server-sent handshake with channelId
      const buf = Buffer.alloc(44, 0);
      Buffer.from('OHOS HDC', 'ascii').copy(buf, 0);
      buf.writeUInt32BE(0xAABBCCDD, 12);
      const hs = decodeChannelHandShake(buf);
      expect(hs.channelId).toBe(0xAABBCCDD);
      expect(hs.banner).toBe('OHOS HDC');
      // connectKey is the raw ASCII of bytes 12-43, which includes the channelId bytes
      expect(hs.connectKey.length).toBeGreaterThan(0);
    });
  });

  describe('huge buffer feature tag', () => {
    it('should set feature tag byte to H by default', () => {
      const buf = encodeChannelHandShake(
        { banner: 'OHOS HDC', channelId: 0, connectKey: '', version: '' },
        false,
      );
      expect(buf[BANNER_FEATURE_TAG_OFFSET]).toBe(0x48); // 'H'
    });

    it('should not set feature tag when hugeBuffer is false', () => {
      const buf = encodeChannelHandShake(
        { banner: 'OHOS HDC', channelId: 0, connectKey: '', version: '' },
        false,
        false,
      );
      expect(buf[BANNER_FEATURE_TAG_OFFSET]).toBe(0x00);
    });

    it('should expose HUGE_BUF_TAG constant', () => {
      expect(HUGE_BUF_TAG).toBe(0x48);
    });

    it('should expose BANNER_FEATURE_TAG_OFFSET constant', () => {
      expect(BANNER_FEATURE_TAG_OFFSET).toBe(11);
    });
  });

  describe('long form with version', () => {
    it('should produce a 108-byte buffer', () => {
      const buf = encodeChannelHandShake(
        { banner: 'OHOS HDC', channelId: 0, connectKey: '', version: '1.0.0' },
        true,
      );
      expect(buf.length).toBe(108);
    });

    it('should write version at offset 44', () => {
      const buf = encodeChannelHandShake(
        { banner: 'OHOS HDC', channelId: 0, connectKey: '', version: 'Ver 1.2.3' },
        true,
      );
      expect(buf.subarray(44, 108).toString('ascii').replace(/\0+$/, '')).toBe('Ver 1.2.3');
    });

    it('should decode version from long form buffer', () => {
      const buf = encodeChannelHandShake(
        { banner: 'OHOS HDC', channelId: 42, connectKey: '', version: '2.0.0-beta' },
        true,
      );
      const hs = decodeChannelHandShake(buf);
      expect(hs.version).toBe('2.0.0-beta');
    });

    it('should truncate version to 64 bytes', () => {
      const longVersion = 'x'.repeat(100);
      const buf = encodeChannelHandShake(
        { banner: 'OHOS HDC', channelId: 0, connectKey: '', version: longVersion },
        true,
      );
      const ver = buf.subarray(44, 108).toString('ascii').replace(/\0+$/, '');
      expect(ver.length).toBe(64);
    });
  });

  describe('round-trip encoding', () => {
    it('should round-trip short form with channelId', () => {
      const original = { banner: 'OHOS HDC', channelId: 999, connectKey: '', version: '' };
      const buf = encodeChannelHandShake(original, false);
      const decoded = decodeChannelHandShake(buf);
      expect(decoded.banner).toBe(original.banner);
      expect(decoded.channelId).toBe(original.channelId);
    });

    it('should round-trip short form with connectKey', () => {
      const original = { banner: 'OHOS HDC', channelId: 0, connectKey: 'my-device-key', version: '' };
      const buf = encodeChannelHandShake(original, false);
      const decoded = decodeChannelHandShake(buf);
      expect(decoded.banner).toBe(original.banner);
      expect(decoded.connectKey).toBe(original.connectKey);
    });

    it('should round-trip long form with all fields', () => {
      const original = { banner: 'OHOS HDC', channelId: 42, connectKey: '', version: '3.1.0' };
      const buf = encodeChannelHandShake(original, true);
      const decoded = decodeChannelHandShake(buf);
      expect(decoded.banner).toBe(original.banner);
      expect(decoded.channelId).toBe(original.channelId);
      expect(decoded.version).toBe(original.version);
    });

    it('should round-trip with connectKey and version', () => {
      const original = { banner: 'OHOS HDC', channelId: 0, connectKey: 'abc123', version: '1.0.0' };
      const buf = encodeChannelHandShake(original, true);
      const decoded = decodeChannelHandShake(buf);
      expect(decoded.connectKey).toBe('abc123');
      expect(decoded.version).toBe('1.0.0');
    });
  });
});
