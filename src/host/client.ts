/**
 * HDC Client Module
 *
 * Communicates with HDC server via TCP socket.
 * Ported from: hdc_rust/src/host/client.rs
 */

import * as net from 'net';
import { CtrlMessage, PacketHeader, createPacket, parsePacket } from '../common/message.js';
import { CommandId } from '../common/protocol.js';
import { parseServerAddress, ParsedCommand } from './parser.js';

export interface ClientOptions {
  serverAddr?: string;
  timeout?: number;
}

export interface Device {
  connectKey: string;
  connType: number;
  status: string;
}

export class HdcClient {
  private socket: net.Socket | null = null;
  private serverAddr: string;
  private serverPort: number;
  private timeout: number;
  private requestId: number = 0;

  constructor(options: ClientOptions = {}) {
    const addr = parseServerAddress(options.serverAddr || '127.0.0.1:8710');
    this.serverAddr = addr.host;
    this.serverPort = addr.port;
    this.timeout = options.timeout || 10000;
  }

  /**
   * Connect to HDC server
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection(
        { host: this.serverAddr, port: this.serverPort },
        () => {
          this.setupSocket();
          resolve();
        }
      );

      this.socket.setTimeout(this.timeout, () => {
        reject(new Error('Connection timeout'));
      });

      this.socket.on('error', (err) => {
        reject(err);
      });
    });
  }

  private setupSocket(): void {
    if (!this.socket) return;

    this.socket.on('data', (data: Buffer) => {
      this.handleData(data);
    });

    this.socket.on('close', () => {
      this.handleClose();
    });

    this.socket.on('error', (err) => {
      this.handleError(err);
    });
  }

  private handleData(data: Buffer): void {
    // TODO: Parse response and emit events
    try {
      const packet = parsePacket(data);
      console.log('Received:', packet);
    } catch (err) {
      console.error('Parse error:', err);
    }
  }

  private handleClose(): void {
    console.log('Connection to HDC server closed');
    this.socket = null;
  }

  private handleError(err: Error): void {
    console.error('Socket error:', err);
  }

  /**
   * Send command to server
   */
  async sendCommand(command: string, args: string[] = []): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.socket.writable) {
        reject(new Error('Not connected'));
        return;
      }

      const requestId = ++this.requestId;
      const payload = Buffer.from(JSON.stringify({ command, args, requestId }));
      const packet = createPacket(payload);

      // TODO: Handle response correlation
      this.socket.write(packet);
      
      // Temporary: just resolve with empty
      // In real implementation, we'd wait for response
      setTimeout(() => resolve('Command sent'), 100);
    });
  }

  /**
   * List connected devices
   */
  async listDevices(): Promise<Device[]> {
    // TODO: Implement actual device listing
    // For now, return mock devices
    return [
      { connectKey: '127.0.0.1:5555', connType: 1, status: 'connected' },
    ];
  }

  /**
   * Close connection
   */
  async disconnect(): Promise<void> {
    if (this.socket) {
      this.socket.end();
      this.socket = null;
    }
  }
}
