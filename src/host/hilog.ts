/**
 * HDC Hilog Module
 *
 * Provides log viewing functionality for OpenHarmony devices.
 * Ported from: hdc-source/src/host/task_unity.cpp (hilog parts)
 */

import { EventEmitter } from 'events';
import * as net from 'net';
import { createPacket, parsePacket, PAYLOAD_PROTECT_VCODE } from '../common/message.js';
import { CommandId } from '../common/protocol.js';
import { GetRandomString } from '../common/base.js';
import { PayloadProtect } from '../common/serialization.js';

// ============================================================================
// Constants
// ============================================================================

export const HILOG_PREFIX = 'hilog:';
export const HILOG_STOP = 'hilog:stop';
export const HILOG_CLEAR = 'hilog:clear';
export const HILOG_STATS = 'hilog:stats';

export enum HilogLevel {
  DEBUG = 'D',
  INFO = 'I',
  WARN = 'W',
  ERROR = 'E',
  FATAL = 'F',
}

export enum HilogState {
  IDLE = 'idle',
  STARTING = 'starting',
  STREAMING = 'streaming',
  STOPPING = 'stopping',
  CLOSED = 'closed',
  ERROR = 'error',
}

// ============================================================================
// Types
// ============================================================================

export interface HilogOptions {
  tags?: string[];
  level?: HilogLevel;
  pid?: number;
  tid?: number;
  domain?: string;
  bufferSize?: number;
}

export interface HilogEntry {
  timestamp: string;
  pid: number;
  tid: number;
  level: HilogLevel;
  tag: string;
  domain: string;
  message: string;
  raw: string;
}

export interface HilogStats {
  bufferSize: number;
  usedSize: number;
  oldestTime: string;
  newestTime: string;
}

// ============================================================================
// Helper
// ============================================================================

function hilogProtect(commandFlag: number = 0): PayloadProtect {
  return {
    channelId: 0,
    commandFlag,
    checkSum: 0,
    vCode: PAYLOAD_PROTECT_VCODE,
  };
}

// ============================================================================
// HdcHilog - Log Streaming
// ============================================================================

export class HdcHilog extends EventEmitter {
  private socket: net.Socket;
  private options: HilogOptions;
  private state: HilogState = HilogState.IDLE;
  private sessionId: string;
  private linesReceived: number = 0;
  private buffer: Buffer = Buffer.alloc(0);

  constructor(socket: net.Socket, options: HilogOptions = {}) {
    super();
    this.socket = socket;
    this.options = options;
    this.sessionId = GetRandomString(8);
  }

  /**
   * Get session ID
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Get current state
   */
  getState(): HilogState {
    return this.state;
  }

  /**
   * Get lines received count
   */
  getLinesReceived(): number {
    return this.linesReceived;
  }

  /**
   * Start log streaming
   */
  async start(): Promise<void> {
    if (this.state !== HilogState.IDLE) {
      throw new Error('Hilog already started');
    }

    this.state = HilogState.STARTING;

    // Build hilog command with options
    const parts = [HILOG_PREFIX];

    if (this.options.level) {
      parts.push(`-L${this.options.level}`);
    }

    if (this.options.tags && this.options.tags.length > 0) {
      parts.push(`-t ${this.options.tags.join(',')}`);
    }

    if (this.options.pid) {
      parts.push(`-P${this.options.pid}`);
    }

    if (this.options.tid) {
      parts.push(`-T${this.options.tid}`);
    }

    if (this.options.domain) {
      parts.push(`-D${this.options.domain}`);
    }

    if (this.options.bufferSize) {
      parts.push(`-b${this.options.bufferSize}`);
    }

    const command = parts.join(' ');
    const request = createPacket(Buffer.from(command), hilogProtect(CommandId.CMD_UNITY_HILOG));
    this.socket.write(request);

    // Setup data handler
    this.socket.on('data', this.handleData.bind(this));

    this.state = HilogState.STREAMING;
    this.emit('start');
  }

  /**
   * Stop log streaming
   */
  async stop(): Promise<void> {
    if (this.state === HilogState.CLOSED || this.state === HilogState.STOPPING) {
      return;
    }

    this.state = HilogState.STOPPING;

    const request = createPacket(Buffer.from(HILOG_STOP), hilogProtect(CommandId.CMD_UNITY_HILOG));
    this.socket.write(request);

    this.socket.off('data', this.handleData.bind(this));

    this.state = HilogState.CLOSED;
    this.emit('stop');
  }

  /**
   * Clear logs
   */
  async clear(): Promise<void> {
    const request = createPacket(Buffer.from(HILOG_CLEAR), hilogProtect(CommandId.CMD_UNITY_HILOG));
    this.socket.write(request);
    this.emit('clear');
  }

  /**
   * Get log statistics
   */
  async getStats(): Promise<HilogStats> {
    return new Promise((resolve, reject) => {
      const request = createPacket(Buffer.from(HILOG_STATS), hilogProtect(CommandId.CMD_UNITY_HILOG));
      this.socket.write(request);

      const handler = (data: Buffer) => {
        try {
          const parsed = parsePacket(data);
          if (!parsed) return;

          const payload = parsed.payload.toString();

          if (payload.startsWith('hilog:stats:')) {
            this.socket.off('data', handler);
            const stats = JSON.parse(payload.substring('hilog:stats:'.length));
            resolve(stats);
          }
        } catch (err) {
          this.socket.off('data', handler);
          reject(err);
        }
      };

      this.socket.on('data', handler);

      // Timeout
      setTimeout(() => {
        this.socket.off('data', handler);
        reject(new Error('Get stats timeout'));
      }, 10000);
    });
  }

  /**
   * Handle incoming data
   */
  private handleData(data: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, data]);
    this.processBuffer();
  }

  /**
   * Process buffered data
   */
  private processBuffer(): void {
    // Split by newlines
    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.subarray(0, newlineIndex).toString('utf8');
      this.buffer = this.buffer.subarray(newlineIndex + 1);

      if (line.trim()) {
        const entry = this.parseLine(line);
        if (entry) {
          this.linesReceived++;
          this.emit('log', entry);
        }
      }
    }
  }

  /**
   * Parse a log line into structured entry
   */
  private parseLine(line: string): HilogEntry | null {
    // Hilog format: timestamp PID-TID level/domain tag: message
    // Example: 01-01 12:00:00.000 1234-5678 I/12345/Tag: message
    const match = line.match(
      /^(\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})\s+(\d+)-(\d+)\s+([DIEFW])\/(\d+)\/([^\s:]+):\s*(.*)$/
    );

    if (!match) {
      // Try simpler format
      return {
        timestamp: '',
        pid: 0,
        tid: 0,
        level: HilogLevel.INFO,
        tag: '',
        domain: '',
        message: line,
        raw: line,
      };
    }

    return {
      timestamp: match[1],
      pid: parseInt(match[2], 10),
      tid: parseInt(match[3], 10),
      level: match[4] as HilogLevel,
      domain: match[5],
      tag: match[6],
      message: match[7],
      raw: line,
    };
  }
}

// ============================================================================
// Helper functions
// ============================================================================

/**
 * Stream hilog entries
 */
export async function streamHilog(
  socket: net.Socket,
  callback: (entry: HilogEntry) => void,
  options?: HilogOptions
): Promise<HdcHilog> {
  const hilog = new HdcHilog(socket, options);

  hilog.on('log', callback);

  await hilog.start();

  return hilog;
}
