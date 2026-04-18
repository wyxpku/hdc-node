/**
 * Tests for HdcClient - Channel Protocol Client
 *
 * Uses real net.Server instances for mock servers.
 * Mock servers use 4-byte BE length-prefixed framing matching the official protocol.
 */

import * as net from 'net';
import { describe, it, expect, afterEach } from 'vitest';
import { HdcClient, HDC_VERSION } from './client.js';
import { encodeChannelHandShake, decodeChannelHandShake } from '../common/channel.js';

/**
 * Helper: wrap data in a 4-byte BE length prefix frame.
 */
function frame(data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  return Buffer.concat([len, data]);
}

/**
 * Helper: read a single length-prefixed frame from a buffer.
 * Returns { frame, rest } or null if not enough data.
 */
function readFrame(buf: Buffer): { frame: Buffer; rest: Buffer } | null {
  if (buf.length < 4) return null;
  const len = buf.readUInt32BE(0);
  if (buf.length < 4 + len) return null;
  return {
    frame: buf.subarray(4, 4 + len),
    rest: buf.subarray(4 + len),
  };
}

/**
 * Helper: start a mock HDC server that performs channel handshake.
 * Uses length-prefixed framing matching the official protocol.
 */
function startMockServer(opts?: {
  banner?: string;
  channelId?: number;
  onCommand?: (socket: net.Socket, data: Buffer) => void;
}): Promise<{ server: net.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      // Send channel handshake with length prefix (official format)
      const serverHS = encodeChannelHandShake({
        banner: opts?.banner ?? 'OHOS HDC',
        channelId: opts?.channelId ?? 0xDEADBEEF,
        connectKey: '',
        version: '',
      }, false);
      socket.write(frame(serverHS));

      // Buffer incoming data, read length-prefixed frames
      let serverBuf = Buffer.alloc(0);
      let handshakeConsumed = false;

      socket.on('data', (data: Buffer) => {
        serverBuf = Buffer.concat([serverBuf, data]);

        if (!handshakeConsumed) {
          const result = readFrame(serverBuf);
          if (!result) return;
          // Discard the handshake response frame
          serverBuf = result.rest;
          handshakeConsumed = true;

          // Any remaining frames are commands
          while (serverBuf.length >= 4) {
            const cmdFrame = readFrame(serverBuf);
            if (!cmdFrame) break;
            if (opts?.onCommand) {
              opts.onCommand(socket, cmdFrame.frame);
            }
            serverBuf = cmdFrame.rest;
          }
        } else {
          // After handshake, read command frames
          while (serverBuf.length >= 4) {
            const cmdFrame = readFrame(serverBuf);
            if (!cmdFrame) break;
            if (opts?.onCommand) {
              opts.onCommand(socket, cmdFrame.frame);
            }
            serverBuf = cmdFrame.rest;
          }
        }
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo;
      resolve({ server, port: addr.port });
    });

    server.on('error', reject);
  });
}

function stopServer(server: net.Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

describe('HdcClient', () => {
  let activeServers: net.Server[] = [];

  afterEach(async () => {
    for (const s of activeServers) {
      await stopServer(s);
    }
    activeServers = [];
  });

  describe('connect + channel handshake', () => {
    it('should connect, receive ChannelHandShake, and respond correctly', async () => {
      let capturedClientHS: Buffer | null = null;

      const server = net.createServer((socket) => {
        // Send handshake with length prefix
        const serverHS = encodeChannelHandShake({
          banner: 'OHOS HDC',
          channelId: 0xDEADBEEF,
          connectKey: '',
          version: '',
        }, false);
        socket.write(frame(serverHS));

        // Read client's handshake response (length-prefixed)
        let buf = Buffer.alloc(0);
        socket.on('data', (data: Buffer) => {
          buf = Buffer.concat([buf, data]);
          const result = readFrame(buf);
          if (result && !capturedClientHS) {
            capturedClientHS = result.frame;
          }
        });
      });

      await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
      activeServers.push(server);

      const addr = server.address() as net.AddressInfo;
      const client = new HdcClient({ host: '127.0.0.1', port: addr.port, timeout: 3000 });
      await client.connect();

      await new Promise((r) => setTimeout(r, 100));

      expect(client.isHandshakeOK()).toBe(true);
      expect(client.getChannelId()).toBe(0xDEADBEEF);

      expect(capturedClientHS).not.toBeNull();
      const decoded = decodeChannelHandShake(capturedClientHS!);
      expect(decoded.banner).toBe('OHOS HDC');

      await client.disconnect();
    });

    it('should emit "handshake" event after successful handshake', async () => {
      const { server, port } = await startMockServer();
      activeServers.push(server);

      const client = new HdcClient({ host: '127.0.0.1', port, timeout: 3000 });
      let handshakeFired = false;
      client.on('handshake', () => { handshakeFired = true; });

      await client.connect();
      expect(handshakeFired).toBe(true);

      await client.disconnect();
    });

    it('should emit "connected" event on TCP connect', async () => {
      const { server, port } = await startMockServer();
      activeServers.push(server);

      const client = new HdcClient({ host: '127.0.0.1', port, timeout: 3000 });
      let connectedFired = false;
      client.on('connected', () => { connectedFired = true; });

      await client.connect();
      expect(connectedFired).toBe(true);

      await client.disconnect();
    });
  });

  describe('invalid banner', () => {
    it('should detect invalid channel handshake banner', async () => {
      const server = net.createServer((socket) => {
        const badHS = encodeChannelHandShake({
          banner: 'NOT HDC',
          channelId: 0x1234,
          connectKey: '',
          version: '',
        }, false);
        socket.write(frame(badHS));
      });

      await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
      activeServers.push(server);

      const addr = server.address() as net.AddressInfo;
      const client = new HdcClient({ host: '127.0.0.1', port: addr.port, timeout: 3000 });

      let errorReceived: Error | null = null;
      client.on('error', (err: Error) => { errorReceived = err; });

      await expect(client.connect()).rejects.toThrow();
      expect(errorReceived).not.toBeNull();
      expect(errorReceived!.message).toContain('Invalid channel handshake banner');
    });
  });

  describe('send commands', () => {
    it('should send null-terminated command string', async () => {
      let commandReceived: Buffer | null = null;

      const { server, port } = await startMockServer({
        onCommand: (socket, data) => {
          commandReceived = data;
          socket.write(frame(Buffer.from('OK')));
          socket.end();
        },
      });
      activeServers.push(server);

      const client = new HdcClient({ host: '127.0.0.1', port, timeout: 3000 });
      await client.connect();

      const result = await client.executeCommand('list targets');

      expect(commandReceived).not.toBeNull();
      expect(commandReceived!.toString('utf8')).toBe('list targets\0');

      await client.disconnect();
    });

    it('should receive response via executeCommand', async () => {
      const { server, port } = await startMockServer({
        onCommand: (socket, data) => {
          const cmd = data.toString('utf8').replace(/\0+$/, '');
          socket.write(frame(Buffer.from('response:' + cmd)));
          socket.end();
        },
      });
      activeServers.push(server);

      const client = new HdcClient({ host: '127.0.0.1', port, timeout: 3000 });
      await client.connect();

      const result = await client.executeCommand('test cmd');
      expect(result).toBe('response:test cmd');

      await client.disconnect();
    });

    it('should reject executeCommand when not connected', async () => {
      const client = new HdcClient({ host: '127.0.0.1', port: 9999 });
      await expect(client.executeCommand('test')).rejects.toThrow('Not connected');
    });

    it('should return false from send() when not connected', () => {
      const client = new HdcClient({ host: '127.0.0.1', port: 9999 });
      expect(client.send(Buffer.from('data'))).toBe(false);
    });

    it('should return false from sendPrefixedCommand() when not connected', () => {
      const client = new HdcClient({ host: '127.0.0.1', port: 9999 });
      expect(client.sendPrefixedCommand(42, Buffer.from('data'))).toBe(false);
    });
  });

  describe('sendPrefixedCommand', () => {
    it('should send data with 2-byte LE command prefix', async () => {
      let commandReceived: Buffer | null = null;

      const { server, port } = await startMockServer({
        onCommand: (socket, data) => {
          commandReceived = data;
          socket.end();
        },
      });
      activeServers.push(server);

      const client = new HdcClient({ host: '127.0.0.1', port, timeout: 3000 });
      await client.connect();

      const commandId = 0x1234;
      const payload = Buffer.from('payload data');
      const sent = client.sendPrefixedCommand(commandId, payload);
      expect(sent).toBe(true);

      await new Promise((r) => setTimeout(r, 100));

      expect(commandReceived).not.toBeNull();
      expect(commandReceived!.readUInt16LE(0)).toBe(commandId);
      expect(commandReceived!.subarray(2).toString('utf8')).toBe('payload data');

      await client.disconnect();
    });
  });

  describe('disconnect', () => {
    it('should disconnect cleanly', async () => {
      const { server, port } = await startMockServer();
      activeServers.push(server);

      const client = new HdcClient({ host: '127.0.0.1', port, timeout: 3000 });
      await client.connect();
      expect(client.isHandshakeOK()).toBe(true);

      await client.disconnect();
      expect(client.isHandshakeOK()).toBe(false);
    });

    it('should emit close event on disconnect', async () => {
      const { server, port } = await startMockServer();
      activeServers.push(server);

      const client = new HdcClient({ host: '127.0.0.1', port, timeout: 3000 });
      await client.connect();

      let closeFired = false;
      client.on('close', () => { closeFired = true; });

      await client.disconnect();
      await new Promise((r) => setTimeout(r, 50));
      expect(closeFired).toBe(true);
    });

    it('should be safe to call disconnect multiple times', async () => {
      const { server, port } = await startMockServer();
      activeServers.push(server);

      const client = new HdcClient({ host: '127.0.0.1', port, timeout: 3000 });
      await client.connect();

      await client.disconnect();
      await client.disconnect();
      await client.disconnect();

      expect(client.isHandshakeOK()).toBe(false);
    });
  });

  describe('connection timeout', () => {
    it('should timeout when server accepts but never sends handshake', async () => {
      const server = net.createServer(() => {});
      await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
      activeServers.push(server);

      const addr = server.address() as net.AddressInfo;
      const client = new HdcClient({ host: '127.0.0.1', port: addr.port, timeout: 500 });

      await expect(client.connect()).rejects.toThrow('Connection timeout');
      await client.disconnect();
    });
  });

  describe('HDC_VERSION constant', () => {
    it('should be defined', () => {
      expect(HDC_VERSION).toBe('Ver: 3.2.0');
    });
  });
});
