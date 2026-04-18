/**
 * HDC Channel Module
 *
 * Channel abstraction for data streaming between host and daemon.
 * Ported from: hdc-source/src/common/channel.cpp
 */

import { EventEmitter } from 'events';
import { HdcSession } from './session.js';
import { GetRandomU32 } from './base.js';

// ============================================================================
// Constants
// ============================================================================

export const MAX_CHANNEL_COUNT = 1024;
export const CHANNEL_BUF_SIZE = 64 * 1024;

// ChannelHandShake constants
export const BANNER_FEATURE_TAG_OFFSET = 11;
export const HUGE_BUF_TAG = 0x48; // 'H' - indicates 512KB buffer support

export enum ChannelState {
  IDLE = 'idle',
  INITIALIZING = 'initializing',
  READY = 'ready',
  TRANSFERRING = 'transferring',
  CLOSING = 'closing',
  CLOSED = 'closed',
  ERROR = 'error',
}

// ============================================================================
// Types
// ============================================================================

export interface ChannelOptions {
  channelId?: number;
  sessionId: number;
  commandId?: number;
  bufferSize?: number;
}

export interface ChannelInfo {
  channelId: number;
  sessionId: number;
  commandId: number;
  state: ChannelState;
  bytesReceived: number;
  bytesSent: number;
  createTime: number;
  lastActivity: number;
}

// ============================================================================
// ChannelHandShake - Raw struct encoding/decoding
// ============================================================================

export interface ChannelHandShake {
  banner: string;
  channelId: number;
  connectKey: string;
  version: string;
}

/**
 * Encode a ChannelHandShake struct into a packed binary buffer.
 * Short form: 44 bytes (banner + union). Long form: 108 bytes (banner + union + version).
 */
export function encodeChannelHandShake(
  hs: ChannelHandShake,
  longForm: boolean,
  hugeBuffer: boolean = true,
): Buffer {
  const size = longForm ? 108 : 44;
  const buf = Buffer.alloc(size, 0);

  // Write banner into first 11 bytes as ASCII, padded with 0x00
  const bannerBytes = Buffer.from(hs.banner, 'ascii');
  const bannerLen = Math.min(bannerBytes.length, 11);
  bannerBytes.copy(buf, 0, 0, bannerLen);
  // Remaining banner bytes are already 0 from alloc

  // Feature tag at offset 11
  if (hugeBuffer) {
    buf[BANNER_FEATURE_TAG_OFFSET] = HUGE_BUF_TAG;
  }

  // Union field at offset 12 (32 bytes)
  if (hs.connectKey.length > 0) {
    const keyBytes = Buffer.from(hs.connectKey, 'ascii');
    const keyLen = Math.min(keyBytes.length, 32);
    keyBytes.copy(buf, 12, 0, keyLen);
  } else {
    buf.writeUInt32BE(hs.channelId, 12);
  }

  // Version at offset 44 (64 bytes), only in long form
  if (longForm && hs.version.length > 0) {
    const verBytes = Buffer.from(hs.version, 'ascii');
    const verLen = Math.min(verBytes.length, 64);
    verBytes.copy(buf, 44, 0, verLen);
  }

  return buf;
}

/**
 * Decode a packed binary buffer into a ChannelHandShake struct.
 */
export function decodeChannelHandShake(buf: Buffer): ChannelHandShake {
  // Read banner from bytes 0-10 as ASCII, strip trailing nulls
  const banner = buf.subarray(0, 11).toString('ascii').replace(/\0+$/, '');

  // Read connectKey from bytes 12-43 as ASCII, strip trailing nulls
  const connectKey = buf.subarray(12, 44).toString('ascii').replace(/\0+$/, '');

  // Read channelId as uint32 BE at offset 12
  const channelId = buf.readUInt32BE(12);

  // Read version from bytes 44-107 if long form (buffer >= 108 bytes)
  let version = '';
  if (buf.length >= 108) {
    version = buf.subarray(44, 108).toString('ascii').replace(/\0+$/, '');
  }

  return { banner, channelId, connectKey, version };
}

// ============================================================================
// HdcChannel - Single Channel
// ============================================================================

export class HdcChannel extends EventEmitter {
  public channelId: number;
  public sessionId: number;
  public commandId: number;
  
  private state: ChannelState = ChannelState.IDLE;
  private bufferSize: number;
  private bytesReceived: number = 0;
  private bytesSent: number = 0;
  private createTime: number;
  private lastActivity: number;
  private readBuffer: Buffer[] = [];
  private writeQueue: Buffer[] = [];

  constructor(options: ChannelOptions) {
    super();
    this.channelId = options.channelId ?? GetRandomU32();
    this.sessionId = options.sessionId;
    this.commandId = options.commandId ?? 0;
    this.bufferSize = options.bufferSize ?? CHANNEL_BUF_SIZE;
    this.createTime = Date.now();
    this.lastActivity = Date.now();
  }

  /**
   * Get channel state
   */
  getState(): ChannelState {
    return this.state;
  }

  /**
   * Get channel info
   */
  getInfo(): ChannelInfo {
    return {
      channelId: this.channelId,
      sessionId: this.sessionId,
      commandId: this.commandId,
      state: this.state,
      bytesReceived: this.bytesReceived,
      bytesSent: this.bytesSent,
      createTime: this.createTime,
      lastActivity: this.lastActivity,
    };
  }

  /**
   * Initialize channel
   */
  async initialize(): Promise<void> {
    if (this.state !== ChannelState.IDLE) {
      throw new Error('Channel already initialized');
    }

    this.state = ChannelState.INITIALIZING;

    try {
      // Perform initialization
      this.state = ChannelState.READY;
      this.emit('ready');
    } catch (err) {
      this.state = ChannelState.ERROR;
      this.emit('error', err);
      throw err;
    }
  }

  /**
   * Check if channel is ready
   */
  isReady(): boolean {
    return this.state === ChannelState.READY || this.state === ChannelState.TRANSFERRING;
  }

  /**
   * Write data to channel
   */
  async write(data: Buffer): Promise<number> {
    if (!this.isReady()) {
      throw new Error('Channel not ready');
    }

    this.state = ChannelState.TRANSFERRING;
    this.lastActivity = Date.now();

    this.writeQueue.push(data);
    this.bytesSent += data.length;
    this.emit('write', data);

    return data.length;
  }

  /**
   * Read data from channel
   */
  async read(size?: number, timeout: number = 5000): Promise<Buffer> {
    if (!this.isReady()) {
      throw new Error('Channel not ready');
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Channel read timeout'));
      }, timeout);

      const checkBuffer = () => {
        if (this.readBuffer.length > 0) {
          clearTimeout(timer);
          const data = this.readBuffer.shift()!;
          this.bytesReceived += data.length;
          this.lastActivity = Date.now();
          this.emit('read', data);
          resolve(size ? data.subarray(0, size) : data);
        } else if (this.state === ChannelState.CLOSED) {
          clearTimeout(timer);
          resolve(Buffer.alloc(0));
        } else {
          setTimeout(checkBuffer, 10);
        }
      };
      checkBuffer();
    });
  }

  /**
   * Push data to read buffer (for external data injection)
   */
  pushData(data: Buffer): void {
    this.readBuffer.push(data);
    this.bytesReceived += data.length;
    this.lastActivity = Date.now();
    this.emit('data', data);
  }

  /**
   * Flush write queue
   */
  async flush(): Promise<void> {
    this.writeQueue = [];
    this.emit('flush');
  }

  /**
   * Close channel
   */
  async close(): Promise<void> {
    if (this.state === ChannelState.CLOSED) {
      return;
    }

    this.state = ChannelState.CLOSING;

    // Clear buffers
    this.readBuffer = [];
    this.writeQueue = [];

    this.state = ChannelState.CLOSED;
    this.emit('close');
  }

  /**
   * Get bytes statistics
   */
  getStats(): { bytesReceived: number; bytesSent: number } {
    return {
      bytesReceived: this.bytesReceived,
      bytesSent: this.bytesSent,
    };
  }
}

// ============================================================================
// HdcChannelManager - Manage multiple channels
// ============================================================================

export class HdcChannelManager extends EventEmitter {
  private channels: Map<number, HdcChannel> = new Map();
  private maxChannels: number = MAX_CHANNEL_COUNT;

  constructor(maxChannels?: number) {
    super();
    if (maxChannels) {
      this.maxChannels = maxChannels;
    }
  }

  /**
   * Create new channel
   */
  createChannel(options: ChannelOptions): HdcChannel | null {
    if (this.channels.size >= this.maxChannels) {
      return null;
    }

    const channel = new HdcChannel(options);

    channel.on('ready', () => {
      this.emit('channel-ready', channel);
    });

    channel.on('close', () => {
      this.channels.delete(channel.channelId);
      this.emit('channel-close', channel);
    });

    channel.on('error', (err: Error) => {
      this.emit('channel-error', channel, err);
    });

    this.channels.set(channel.channelId, channel);
    this.emit('channel-create', channel);

    return channel;
  }

  /**
   * Get channel by ID
   */
  getChannel(channelId: number): HdcChannel | undefined {
    return this.channels.get(channelId);
  }

  /**
   * Get channels by session ID
   */
  getChannelsBySession(sessionId: number): HdcChannel[] {
    return Array.from(this.channels.values()).filter(c => c.sessionId === sessionId);
  }

  /**
   * Remove channel
   */
  async removeChannel(channelId: number): Promise<boolean> {
    const channel = this.channels.get(channelId);
    if (!channel) {
      return false;
    }

    await channel.close();
    return true;
  }

  /**
   * Remove all channels for session
   */
  async removeSessionChannels(sessionId: number): Promise<number> {
    const channels = this.getChannelsBySession(sessionId);
    let removed = 0;

    for (const channel of channels) {
      await channel.close();
      removed++;
    }

    return removed;
  }

  /**
   * List all channels
   */
  listChannels(): HdcChannel[] {
    return Array.from(this.channels.values());
  }

  /**
   * Get ready channels
   */
  getReadyChannels(): HdcChannel[] {
    return Array.from(this.channels.values()).filter(c => c.isReady());
  }

  /**
   * Get channel count
   */
  get count(): number {
    return this.channels.size;
  }

  /**
   * Close all channels
   */
  async closeAll(): Promise<void> {
    const promises = Array.from(this.channels.values()).map(c => c.close());
    await Promise.all(promises);
    this.channels.clear();
  }
}
