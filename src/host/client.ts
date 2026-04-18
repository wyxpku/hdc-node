/**
 * HDC Client Module
 *
 * Connects to the local HDC server via TCP using the channel protocol.
 * The channel layer uses 4-byte big-endian length-prefixed framing for
 * all data (ChannelHandShake and command data).
 *
 * Architecture:
 *   [hdc CLI] --TCP/Channel--> [HdcServer on host] --Session--> [HdcDaemon on device]
 *
 * Ported from: hdc-source/src/host/client.cpp
 */

import * as net from 'net';
import { EventEmitter } from 'events';
import {
  encodeChannelHandShake,
  decodeChannelHandShake,
  ChannelHandShake,
} from '../common/channel.js';

export const HDC_VERSION = 'Ver: 3.2.0';

export interface ClientOptions {
  host: string;
  port: number;
  connectKey?: string;
  timeout?: number;
}

export class HdcClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private options: Required<ClientOptions>;
  private channelId: number = 0;
  private handshakeOK: boolean = false;
  private buffer: Buffer = Buffer.alloc(0);

  constructor(options: ClientOptions) {
    super();
    this.options = {
      host: options.host,
      port: options.port,
      connectKey: options.connectKey ?? '',
      timeout: options.timeout ?? 10000,
    };
  }

  /**
   * Connect to the HDC server and perform channel handshake.
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, this.options.timeout);

      this.socket = net.createConnection(
        { host: this.options.host, port: this.options.port },
        () => this.emit('connected'),
      );

      this.socket.on('data', (data: Buffer) => this.onData(data));
      this.socket.on('error', (err: Error) => {
        clearTimeout(timer);
        this.emit('error', err);
        reject(err);
      });
      this.socket.on('close', () => this.emit('close'));

      this.once('handshake', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private onData(data: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, data]);

    if (!this.handshakeOK) {
      this.tryProcessChannelHandshake();
      return;
    }

    // After handshake, read length-prefixed frames
    this.readFrames();
  }

  /**
   * Try to process channel handshake. The official server sends a 4-byte
   * big-endian length prefix before the ChannelHandShake struct (value = 44).
   * We also handle raw struct without prefix for our own server.
   */
  private tryProcessChannelHandshake(): void {
    // Check if buffer starts with 4-byte length prefix (value = 44)
    if (this.buffer.length >= 4) {
      const maybeLen = this.buffer.readUInt32BE(0);
      if (maybeLen === 44 && this.buffer.length >= 4 + 44) {
        this.processChannelHandshake(this.buffer.subarray(4, 4 + 44), 4 + 44);
        return;
      }
    }

    // Raw format: ChannelHandShake starts directly (for our own server)
    if (this.buffer.length >= 44 && this.buffer.toString('ascii', 0, 8) === 'OHOS HDC') {
      this.processChannelHandshake(this.buffer.subarray(0, 44), 44);
    }
  }

  private processChannelHandshake(hsBuf: Buffer, consumedBytes: number): void {
    const hs = decodeChannelHandShake(hsBuf);

    if (!hs.banner.startsWith('OHOS HDC')) {
      if (this.socket) {
        this.socket.destroy();
        this.socket = null;
      }
      this.emit('error', new Error('Invalid channel handshake banner'));
      return;
    }

    this.channelId = hs.channelId;

    // Respond with our handshake WITH length prefix (matching official protocol)
    const hsPayload = encodeChannelHandShake({
      banner: 'OHOS HDC',
      channelId: 0,
      connectKey: this.options.connectKey,
      version: HDC_VERSION,
    }, false);

    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(hsPayload.length, 0);
    this.socket!.write(Buffer.concat([lenBuf, hsPayload]));

    this.handshakeOK = true;
    this.buffer = this.buffer.subarray(consumedBytes);
    this.emit('handshake');
  }

  /**
   * Read length-prefixed frames from buffer and emit as 'response' events.
   */
  private readFrames(): void {
    while (this.buffer.length >= 4) {
      const frameLen = this.buffer.readUInt32BE(0);
      if (this.buffer.length < 4 + frameLen) break;

      const frameData = this.buffer.subarray(4, 4 + frameLen);
      this.buffer = this.buffer.subarray(4 + frameLen);
      this.emit('response', Buffer.from(frameData));
    }
  }

  isHandshakeOK(): boolean {
    return this.handshakeOK;
  }

  getChannelId(): number {
    return this.channelId;
  }

  /**
   * Execute a command string and collect the response.
   * Sends a length-prefixed null-terminated command string.
   */
  async executeCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.handshakeOK) {
        reject(new Error('Not connected'));
        return;
      }

      const chunks: Buffer[] = [];
      const timer = setTimeout(() => {
        this.off('response', handler);
        this.off('close', closeHandler);
        reject(new Error('Command timeout'));
      }, this.options.timeout);

      const handler = (data: Buffer) => {
        chunks.push(data);
      };

      const closeHandler = () => {
        clearTimeout(timer);
        this.off('response', handler);
        const result = Buffer.concat(chunks).toString('utf8').replace(/\0+$/, '');
        resolve(result);
      };

      this.on('response', handler);
      this.once('close', closeHandler);

      // Send length-prefixed null-terminated command string
      const cmdBuf = Buffer.from(command + '\0');
      const lenBuf = Buffer.alloc(4);
      lenBuf.writeUInt32BE(cmdBuf.length, 0);
      this.socket.write(Buffer.concat([lenBuf, cmdBuf]));
    });
  }

  /**
   * Send length-prefixed raw data to the server.
   */
  send(data: Buffer): boolean {
    if (!this.socket || !this.handshakeOK) return false;
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    this.socket.write(Buffer.concat([lenBuf, data]));
    return true;
  }

  /**
   * Send command with 2-byte LE command prefix (for file/app/remote ops).
   */
  sendPrefixedCommand(commandId: number, data: Buffer): boolean {
    if (!this.socket || !this.handshakeOK) return false;
    const prefix = Buffer.alloc(2);
    prefix.writeUInt16LE(commandId, 0);
    return this.send(Buffer.concat([prefix, data]));
  }

  /**
   * Disconnect from the server.
   */
  async disconnect(): Promise<void> {
    if (this.socket) {
      this.socket.end();
      this.socket = null;
    }
    this.handshakeOK = false;
  }
}
