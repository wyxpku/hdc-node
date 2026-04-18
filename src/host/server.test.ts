/**
 * Tests for HDC Server module
 *
 * Uses real TCP connections to test the server end-to-end.
 * The test client connects via raw TCP sockets and performs
 * the ChannelHandShake protocol manually.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as net from 'net';
import { HdcServer } from './server.js';
import {
  encodeChannelHandShake,
  decodeChannelHandShake,
  ChannelHandShake,
} from '../common/channel.js';

/**
 * Helper: connect a raw TCP client to the server and complete handshake.
 * Returns the socket, the received server handshake, and a data collector.
 */
async function connectClient(
  port: number,
  host: string = '127.0.0.1',
): Promise<{
  socket: net.Socket;
  serverHandshake: ChannelHandShake;
  collectData: () => Promise<Buffer>;
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const receivedChunks: Buffer[] = [];

    socket.on('error', reject);

    socket.connect(port, host, () => {
      // Wait for server to send ChannelHandShake
      const onData = (data: Buffer) => {
        receivedChunks.push(data);
        const total = Buffer.concat(receivedChunks);

        // Need at least 44 bytes for a ChannelHandShake
        if (total.length >= 44) {
          socket.removeListener('data', onData);

          const serverHs = decodeChannelHandShake(total.subarray(0, 108));

          // Send client handshake response with a connectKey
          const clientHs: ChannelHandShake = {
            banner: 'OHOS HDC',
            channelId: serverHs.channelId,
            connectKey: 'test-device-key',
            version: '3.2.0',
          };
          const clientHsBuf = encodeChannelHandShake(clientHs, true, true);
          socket.write(clientHsBuf);

          resolve({
            socket,
            serverHandshake: serverHs,
            collectData: () => {
              return new Promise((res) => {
                const chunks: Buffer[] = [];
                const handler = (d: Buffer) => {
                  chunks.push(d);
                };
                socket.on('data', handler);
                // Give a small tick for data to arrive
                setTimeout(() => {
                  socket.removeListener('data', handler);
                  res(Buffer.concat(chunks));
                }, 100);
              });
            },
            close: () => {
              socket.destroy();
            },
          });
        }
      };

      socket.on('data', onData);
    });
  });
}

describe('HdcServer', () => {
  let server: HdcServer;
  let port: number;

  beforeEach(async () => {
    // Use port 0 to get a random available port
    server = new HdcServer({ port: 0, host: '127.0.0.1' });
    await server.start();
    const addr = server.address() as net.AddressInfo;
    port = addr.port;
  });

  afterEach(async () => {
    await server.stop();
  });

  // ==========================================================================
  // Start / Stop
  // ==========================================================================

  describe('start/stop', () => {
    it('should start and listen on the configured address', () => {
      expect(server.isRunning()).toBe(true);
      const addr = server.address() as net.AddressInfo;
      expect(addr).toBeDefined();
      expect(addr.port).toBeGreaterThan(0);
      expect(addr.address).toBe('127.0.0.1');
    });

    it('should stop cleanly', async () => {
      expect(server.isRunning()).toBe(true);
      await server.stop();
      expect(server.isRunning()).toBe(false);
    });

    it('should handle double stop', async () => {
      await server.stop();
      await server.stop();
      expect(server.isRunning()).toBe(false);
    });

    it('should emit started event', async () => {
      const localServer = new HdcServer({ port: 0 });
      let started = false;
      localServer.on('started', () => { started = true; });
      await localServer.start();
      expect(started).toBe(true);
      await localServer.stop();
    });

    it('should emit stopped event', async () => {
      const localServer = new HdcServer({ port: 0 });
      await localServer.start();
      let stopped = false;
      localServer.on('stopped', () => { stopped = true; });
      await localServer.stop();
      expect(stopped).toBe(true);
    });
  });

  // ==========================================================================
  // Client Connections & Handshake
  // ==========================================================================

  describe('client connections', () => {
    it('should accept a client connection and send ChannelHandShake', async () => {
      expect(server.clientCount).toBe(0);

      const client = await connectClient(port);

      // Server should have assigned a channelId via the handshake
      expect(client.serverHandshake.channelId).toBeGreaterThan(0);
      expect(client.serverHandshake.banner).toBe('OHOS HDC');

      // Server should track the client
      expect(server.clientCount).toBe(1);

      client.close();
    });

    it('should complete handshake with client', async () => {
      const client = await connectClient(port);

      // The server handshake should have a valid version
      expect(client.serverHandshake.version).toBeTruthy();

      client.close();
    });

    it('should handle multiple clients', async () => {
      expect(server.clientCount).toBe(0);

      const client1 = await connectClient(port);
      expect(server.clientCount).toBe(1);

      const client2 = await connectClient(port);
      expect(server.clientCount).toBe(2);

      const client3 = await connectClient(port);
      expect(server.clientCount).toBe(3);

      // Each client should get a unique channelId
      expect(client1.serverHandshake.channelId).not.toBe(client2.serverHandshake.channelId);
      expect(client2.serverHandshake.channelId).not.toBe(client3.serverHandshake.channelId);

      client1.close();
      client2.close();
      client3.close();
    });

    it('should detect client disconnection', async () => {
      const client = await connectClient(port);
      expect(server.clientCount).toBe(1);

      client.close();

      // Wait a tick for the server to process the disconnect
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(server.clientCount).toBe(0);
    });

    it('should emit client-connected event', async () => {
      let eventFired = false;
      server.on('client-connected', () => { eventFired = true; });

      const client = await connectClient(port);
      expect(eventFired).toBe(true);

      client.close();
    });

    it('should emit client-handshake event', async () => {
      let handshakeFired = false;
      server.on('client-handshake', () => { handshakeFired = true; });

      const client = await connectClient(port);
      // Give the server a tick to process the handshake
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(handshakeFired).toBe(true);

      client.close();
    });
  });

  // ==========================================================================
  // Local Commands
  // ==========================================================================

  describe('local commands', () => {
    async function sendCommand(
      clientSocket: net.Socket,
      command: string,
    ): Promise<string> {
      return new Promise((resolve) => {
        const chunks: Buffer[] = [];
        const handler = (data: Buffer) => {
          chunks.push(data);
        };
        clientSocket.on('data', handler);
        clientSocket.write(command + '\n');

        setTimeout(() => {
          clientSocket.removeListener('data', handler);
          resolve(Buffer.concat(chunks).toString('utf-8'));
        }, 100);
      });
    }

    it('should handle "list targets" with empty list', async () => {
      const client = await connectClient(port);
      // Give server time to process handshake
      await new Promise((resolve) => setTimeout(resolve, 50));

      const response = await sendCommand(client.socket, 'list targets');
      expect(response).toContain('[Empty]');

      client.close();
    });

    it('should handle "version" command', async () => {
      const client = await connectClient(port);
      await new Promise((resolve) => setTimeout(resolve, 50));
      const response = await sendCommand(client.socket, 'version');
      expect(response).toContain('HDC');

      client.close();
    });

    it('should handle "start" command', async () => {
      const client = await connectClient(port);
      await new Promise((resolve) => setTimeout(resolve, 50));
      const response = await sendCommand(client.socket, 'start');
      expect(response).toContain('already running');

      client.close();
    });

    it('should handle "kill" command', async () => {
      const client = await connectClient(port);
      await new Promise((resolve) => setTimeout(resolve, 50));
      const response = await sendCommand(client.socket, 'kill');
      expect(response).toContain('shutting down');

      // Wait for shutdown to complete
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(server.isRunning()).toBe(false);
    });
  });

  // ==========================================================================
  // Daemon Session Management
  // ==========================================================================

  describe('daemon session management', () => {
    it('should register and remove daemon sessions', () => {
      expect(server.daemonSessionCount).toBe(0);
      expect(server.listDaemonKeys()).toEqual([]);

      // Create a minimal mock session
      const mockSession = {
        close: () => {},
        getSocket: () => null,
      } as any;

      server.registerDaemonSession('device-1', mockSession);
      expect(server.daemonSessionCount).toBe(1);
      expect(server.listDaemonKeys()).toContain('device-1');

      server.removeDaemonSession('device-1');
      expect(server.daemonSessionCount).toBe(0);
      expect(server.listDaemonKeys()).toEqual([]);
    });

    it('should return daemon session by connectKey', () => {
      const mockSession = {
        close: () => {},
        getSocket: () => null,
      } as any;

      server.registerDaemonSession('device-abc', mockSession);
      const found = server.getDaemonSession('device-abc');
      expect(found).toBe(mockSession);

      const notFound = server.getDaemonSession('nonexistent');
      expect(notFound).toBeUndefined();

      server.removeDaemonSession('device-abc');
    });

    it('should emit daemon-registered event', () => {
      let eventKey = '';
      server.on('daemon-registered', (key: string) => { eventKey = key; });

      const mockSession = { close: () => {}, getSocket: () => null } as any;
      server.registerDaemonSession('device-x', mockSession);

      expect(eventKey).toBe('device-x');
      server.removeDaemonSession('device-x');
    });

    it('should emit daemon-removed event', () => {
      let eventKey = '';
      server.on('daemon-removed', (key: string) => { eventKey = key; });

      const mockSession = { close: () => {}, getSocket: () => null } as any;
      server.registerDaemonSession('device-y', mockSession);
      server.removeDaemonSession('device-y');

      expect(eventKey).toBe('device-y');
    });
  });

  // ==========================================================================
  // Graceful Shutdown
  // ==========================================================================

  describe('graceful shutdown', () => {
    it('should close all client connections on stop', async () => {
      const client1 = await connectClient(port);
      const client2 = await connectClient(port);
      expect(server.clientCount).toBe(2);

      await server.stop();

      // Give a tick for sockets to be destroyed
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(server.clientCount).toBe(0);

      client1.close();
      client2.close();
    });

    it('should close all daemon sessions on stop', async () => {
      let sessionClosed = false;
      const mockSession = {
        close: () => { sessionClosed = true; },
        getSocket: () => null,
      } as any;

      server.registerDaemonSession('device-shutdown', mockSession);
      await server.stop();

      expect(sessionClosed).toBe(true);
      expect(server.daemonSessionCount).toBe(0);
    });
  });
});
