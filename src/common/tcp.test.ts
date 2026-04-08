/**
 * Tests for TCP module
 */

import { describe, it, expect } from 'vitest';
import { TcpClient, TcpServer, TcpState } from './tcp.js';

describe('TcpClient', () => {
  describe('constructor', () => {
    it('should create client with default options', () => {
      const client = new TcpClient({
        host: 'localhost',
        port: 12345,
      });

      expect(client.getState()).toBe(TcpState.idle);
    });

    it('should accept custom options', () => {
      const client = new TcpClient({
        host: '192.168.1.1',
        port: 9999,
        timeout: 2000,
        keepAlive: false,
        noDelay: true,
      });

      expect(client['options'].host).toBe('192.168.1.1');
      expect(client['options'].port).toBe(9999);
    });
  });

  describe('disconnect', () => {
    it('should handle disconnect when idle', () => {
      const client = new TcpClient({ host: 'localhost', port: 12345 });
      client.disconnect();
      expect(client.getState()).toBe(TcpState.disconnected);
    });

    it('should be idempotent', () => {
      const client = new TcpClient({ host: 'localhost', port: 12345 });
      client.disconnect();
      client.disconnect();
      client.disconnect();
      expect(client.getState()).toBe(TcpState.disconnected);
    });
  });

  describe('getStats', () => {
    it('should return stats', () => {
      const client = new TcpClient({ host: 'localhost', port: 12345 });
      const stats = client.getStats();

      expect(stats).toHaveProperty('bytesReceived');
      expect(stats).toHaveProperty('bytesSent');
      expect(stats.connected).toBe(false);
    });
  });

  describe('getRemoteAddress', () => {
    it('should return remote address', () => {
      const client = new TcpClient({ host: 'localhost', port: 12345 });
      const addr = client.getRemoteAddress();

      expect(addr).toContain('localhost');
      expect(addr).toContain('12345');
    });
  });

  describe('send', () => {
    it('should return false when not connected', () => {
      const client = new TcpClient({ host: 'localhost', port: 12345 });
      const result = client.send(Buffer.from('test'));
      expect(result).toBe(false);
    });
  });
});

describe('TcpServer', () => {
  describe('constructor', () => {
    it('should create server', () => {
      const server = new TcpServer({ host: 'localhost', port: 0 });
      expect(server.getState()).toBe(TcpState.idle);
    });
  });

  describe('start/stop', () => {
    it('should start and stop server', async () => {
      const server = new TcpServer({ host: 'localhost', port: 0 });

      await server.start();
      expect(server.getState()).toBe(TcpState.listening);

      await server.stop();
      // State may vary depending on implementation
      expect([TcpState.disconnected, TcpState.disconnecting]).toContain(server.getState());
    });

    it('should handle multiple stop calls', async () => {
      const server = new TcpServer({ host: 'localhost', port: 0 });

      await server.start();
      await server.stop();
      // Second stop is idempotent
      await server.stop();
      // State may vary depending on implementation
      expect([TcpState.disconnected, TcpState.disconnecting]).toContain(server.getState());
    });
  });

  describe('connections', () => {
    it('should have no connections initially', async () => {
      const server = new TcpServer({ host: 'localhost', port: 0 });
      await server.start();

      expect(server.getConnections().length).toBe(0);
      expect(server.getConnectionCount()).toBe(0);

      await server.stop();
    });
  });

  describe('getConnection', () => {
    it('should return undefined for non-existent connection', async () => {
      const server = new TcpServer({ host: 'localhost', port: 0 });
      await server.start();

      const conn = server.getConnection('nonexistent');
      expect(conn).toBeUndefined();

      await server.stop();
    });
  });
});

describe('TcpState enum', () => {
  it('should have correct values', () => {
    expect(TcpState.idle).toBe('idle');
    expect(TcpState.connecting).toBe('connecting');
    expect(TcpState.connected).toBe('connected');
    expect(TcpState.disconnecting).toBe('disconnecting');
    expect(TcpState.disconnected).toBe('disconnected');
    expect(TcpState.error).toBe('error');
    expect(TcpState.listening).toBe('listening');
  });
});
