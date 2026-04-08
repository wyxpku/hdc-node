/**
 * HDC TCP Module
 *
 * TCP connection management for host and daemon.
 * Ported from: hdc-source/src/common/tcp.cpp
 */

import { EventEmitter } from 'events';
import * as net from 'net';
import { GetRuntimeMSec } from './base.js';

// ============================================================================
// Types
// ============================================================================

export interface TcpOptions {
  host?: string;
  port?: number;
  timeout?: number;
  keepAlive?: boolean;
  noDelay?: boolean;
}

export interface TcpConnection {
  id: string;
  socket: net.Socket;
  remoteAddress: string;
  remotePort: number;
  connectedAt: number;
  lastActivity: number;
  bytesReceived: number;
  bytesSent: number;
}

export enum TcpState {
  idle = 'idle',
  connecting = 'connecting',
  connected = 'connected',
  disconnecting = 'disconnecting',
  disconnected = 'disconnected',
  error = 'error',
  listening = 'listening',
}

// ============================================================================
// TcpClient
// ============================================================================

export class TcpClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private options: Required<TcpOptions>;
  private state: TcpState = TcpState.idle;
  private buffer: Buffer = Buffer.alloc(0);
  private bytesReceived: number = 0;
  private bytesSent: number = 0;
  private lastActivity: number = 0;
  private connectTimer: NodeJS.Timeout | null = null;
  private keepAliveTimer: NodeJS.Timeout | null = null;

  constructor(options: TcpOptions) {
    super();
    this.options = {
      host: options.host || '127.0.0.1',
      port: options.port || 8710,
      timeout: options.timeout || 10000,
      keepAlive: options.keepAlive ?? true,
      noDelay: options.noDelay ?? false,
    };
  }

  getState(): TcpState {
    return this.state;
  }

  async connect(): Promise<void> {
    if (this.state === TcpState.connected) {
      return;
    }

    this.state = TcpState.connecting;
    this.lastActivity = GetRuntimeMSec();

    return new Promise((resolve, reject) => {
      this.socket = net.createConnection(
        { host: this.options.host, port: this.options.port },
        () => {
          this.state = TcpState.connected;
          this.setupSocket();
          this.emit('connect');
          resolve();
        }
      );

      this.socket.on('error', (err: Error) => {
        this.state = TcpState.error;
        this.emit('error', err);
        reject(err);
      });

      this.connectTimer = setTimeout(() => {
        if (this.state === TcpState.connecting) {
          this.socket?.destroy();
          this.state = TcpState.error;
          reject(new Error('Connection timeout'));
        }
      }, this.options.timeout);
    });
  }

  private setupSocket(): void {
    if (!this.socket) return;

    this.socket.setNoDelay(this.options.noDelay!);

    this.socket.on('data', (data: Buffer) => {
      this.onData(data);
    });

    this.socket.on('close', (hadError: boolean) => {
      this.state = TcpState.disconnected;
      this.stopKeepAlive();
      this.emit('close', hadError);
    });

    this.socket.on('error', (err: Error) => {
      this.state = TcpState.error;
      this.emit('error', err);
    });

    this.socket.on('end', () => {
      this.emit('end');
    });

    if (this.options.keepAlive) {
      this.startKeepAlive();
    }
  }

  private onData(data: Buffer): void {
    this.lastActivity = GetRuntimeMSec();
    this.buffer = Buffer.concat([this.buffer, data]);
    this.bytesReceived += data.length;
    this.emit('data', this.buffer);
  }

  send(data: Buffer | Uint8Array): boolean {
    if (this.state !== TcpState.connected || !this.socket) {
      return false;
    }

    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    this.socket.write(buffer);
    this.bytesSent += buffer.length;
    this.lastActivity = GetRuntimeMSec();
    this.emit('sent', buffer);
    return true;
  }

  private startKeepAlive(): void {
    this.keepAliveTimer = setInterval(() => {
      if (this.state === TcpState.connected) {
        this.emit('keepalive');
      }
    }, 30000);
  }

  private stopKeepAlive(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  async disconnect(): Promise<void> {
    if (this.state === TcpState.disconnected) {
      return;
    }

    this.state = TcpState.disconnecting;
    this.stopKeepAlive();
    this.clearBuffer();

    if (this.socket) {
      this.socket.end();
      this.socket = null;
    }

    this.state = TcpState.disconnected;
  }

  private clearBuffer(): void {
    this.buffer = Buffer.alloc(0);
  }

  getStats(): { bytesReceived: number; bytesSent: number; connected: boolean } {
    return {
      bytesReceived: this.bytesReceived,
      bytesSent: this.bytesSent,
      connected: this.state === TcpState.connected,
    };
  }

  getRemoteAddress(): string {
    return `${this.options.host}:${this.options.port}`;
  }
}

// ============================================================================
// TcpServer
// ============================================================================

export class TcpServer extends EventEmitter {
  private server: net.Server | null = null;
  private options: Required<TcpOptions>;
  private connections: Map<string, TcpConnection> = new Map();
  private state: TcpState = TcpState.idle;

  constructor(options: TcpOptions) {
    super();
    this.options = {
      host: options.host || '0.0.0.0',
      port: options.port || 8710,
      timeout: options.timeout || 30000,
    };
  }

  async start(): Promise<void> {
    if (this.state === TcpState.listening) {
      return;
    }

    this.server = net.createServer((socket: net.Socket) => {
      this.handleConnection(socket);
    });

    this.server.on('error', (err: Error) => {
      this.state = TcpState.error;
      this.emit('error', err);
    });

    return new Promise<void>((resolve, reject) => {
      this.server!.listen(this.options.port, this.options.host, () => {
        this.state = TcpState.listening;
        this.emit('listening');
        resolve();
      });

      this.server!.on('error', (err: Error) => {
        this.state = TcpState.error;
        this.emit('error', err);
        reject(err);
      });
    });
  }

  private handleConnection(socket: net.Socket): void {
    const remoteAddress = socket.remoteAddress || '';
    const remotePort = socket.remotePort || 0;
    const id = `${remoteAddress}:${remotePort}`;

    const connection: TcpConnection = {
      id,
      socket,
      remoteAddress,
      remotePort,
      connectedAt: Date.now(),
      lastActivity: Date.now(),
      bytesReceived: 0,
      bytesSent: 0,
    };

    this.connections.set(id, connection);
    this.emit('connection', connection);

    socket.on('data', (data: Buffer) => {
      connection.bytesReceived += data.length;
      connection.lastActivity = Date.now();
      this.emit('data', connection, data);
    });

    socket.on('close', (hadError: boolean) => {
      this.connections.delete(id);
      this.emit('disconnect', connection, hadError);
    });

    socket.on('error', (err: Error) => {
      this.emit('error', connection, err);
    });
  }

  async stop(): Promise<void> {
    if (this.state === TcpState.disconnected) {
      return;
    }

    this.state = TcpState.disconnecting;

    // Close all connections
    for (const connection of this.connections.values()) {
      connection.socket.destroy();
    }
    this.connections.clear();

    // Close server
    this.server?.close(() => {
      this.state = TcpState.disconnected;
      this.emit('close');
    });
  }

  getConnection(id: string): TcpConnection | undefined {
    return this.connections.get(id);
  }

  getConnections(): TcpConnection[] {
    return Array.from(this.connections.values());
  }

  getConnectionCount(): number {
    return this.connections.size;
  }

  getState(): TcpState {
    return this.state;
  }
}
