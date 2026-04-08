/**
 * HDC Shell Module
 *
 * Provides shell command execution on device.
 * Ported from: hdc-source/src/daemon/shell.cpp
 */

import { EventEmitter } from 'events';
import * as net from 'net';
import { createPacket, parsePacket } from '../common/message.js';
import { GetRandomString } from '../common/base.js';

// ============================================================================
// Constants
// ============================================================================

export const SHELL_PREFIX = 'shell:';
export const SHELL_INITIAL = 'shell:init';
export const SHELL_DATA = 'shell:data';
export const SHELL_SIGNAL = 'shell:signal';

export enum ShellState {
  IDLE = 'idle',
  STARTING = 'starting',
  RUNNING = 'running',
  EXITING = 'exiting',
  CLOSED = 'closed',
  ERROR = 'error',
}

export enum ShellSignal {
  SIGINT = 2,   // Ctrl+C
  SIGQUIT = 3,  // Ctrl+\
  SIGKILL = 9,  // Force kill
  SIGTERM = 15, // Terminate
}

// ============================================================================
// Types
// ============================================================================

export interface ShellOptions {
  command: string;
  pty?: boolean;      // Use PTY mode
  timeout?: number;   // Timeout in milliseconds
  env?: Record<string, string>;
  cwd?: string;
}

export interface ShellSession {
  sessionId: string;
  command: string;
  state: ShellState;
  exitCode: number | null;
  startTime: number;
}

// ============================================================================
// HdcShell - Client side shell execution
// ============================================================================

export class HdcShell extends EventEmitter {
  private socket: net.Socket | null = null;
  private sessionId: string;
  private command: string;
  private state: ShellState = ShellState.IDLE;
  private exitCode: number | null = null;
  private startTime: number = 0;
  private stdout: string = '';
  private stderr: string = '';
  private timeout: number;
  private timeoutTimer: NodeJS.Timeout | null = null;

  constructor(socket: net.Socket, options: ShellOptions) {
    super();
    this.socket = socket;
    this.sessionId = GetRandomString(8);
    this.command = options.command;
    this.timeout = options.timeout || 30000; // 30s default
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
  getState(): ShellState {
    return this.state;
  }

  /**
   * Get exit code
   */
  getExitCode(): number | null {
    return this.exitCode;
  }

  /**
   * Start shell execution
   */
  async start(): Promise<void> {
    if (this.state !== ShellState.IDLE) {
      throw new Error('Shell already started');
    }

    this.state = ShellState.STARTING;
    this.startTime = Date.now();

    // Setup data handler
    this.socket?.on('data', (data: Buffer) => this.onData(data));
    this.socket?.on('close', () => this.onClose());
    this.socket?.on('error', (err: Error) => this.onError(err));

    // Send shell init command
    const initPayload = Buffer.from(`${SHELL_INITIAL}:${this.command}`);
    const packet = createPacket(initPayload);
    this.socket?.write(packet);

    // Start timeout timer
    this.timeoutTimer = setTimeout(() => {
      if (this.state === ShellState.RUNNING) {
        this.emit('timeout');
        this.kill();
      }
    }, this.timeout);

    return new Promise((resolve, reject) => {
      const onReady = () => {
        this.state = ShellState.RUNNING;
        this.emit('start');
        resolve();
      };

      const onError = (err: Error) => {
        this.state = ShellState.ERROR;
        reject(err);
      };

      this.once('ready', onReady);
      this.once('error', onError);
    });
  }

  /**
   * Write data to shell stdin
   */
  write(data: Buffer | string): boolean {
    if (this.state !== ShellState.RUNNING || !this.socket) {
      return false;
    }

    const buffer = typeof data === 'string' ? Buffer.from(data) : data;
    const payload = Buffer.concat([
      Buffer.from(`${SHELL_DATA}:`),
      buffer,
    ]);
    const packet = createPacket(payload);
    this.socket.write(packet);
    return true;
  }

  /**
   * Send signal to shell
   */
  sendSignal(signal: ShellSignal): boolean {
    if (this.state !== ShellState.RUNNING || !this.socket) {
      return false;
    }

    const payload = Buffer.from(`${SHELL_SIGNAL}:${signal}`);
    const packet = createPacket(payload);
    this.socket.write(packet);
    return true;
  }

  /**
   * Kill shell (SIGKILL)
   */
  kill(): void {
    this.sendSignal(ShellSignal.SIGKILL);
  }

  /**
   * Interrupt shell (SIGINT / Ctrl+C)
   */
  interrupt(): void {
    this.sendSignal(ShellSignal.SIGINT);
  }

  /**
   * Resize terminal (for PTY mode)
   */
  resize(rows: number, cols: number): boolean {
    if (this.state !== ShellState.RUNNING || !this.socket) {
      return false;
    }

    const payload = Buffer.from(`shell:resize:${rows}:${cols}`);
    const packet = createPacket(payload);
    this.socket.write(packet);
    return true;
  }

  /**
   * Close shell session
   */
  close(): void {
    if (this.state === ShellState.CLOSED) {
      return;
    }

    this.state = ShellState.EXITING;
    this.clearTimeout();

    if (this.socket) {
      // Send close command
      const payload = Buffer.from('shell:close');
      const packet = createPacket(payload);
      this.socket.write(packet);
    }

    this.state = ShellState.CLOSED;
    this.emit('close', this.exitCode);
  }

  /**
   * Handle incoming data
   */
  private onData(data: Buffer): void {
    try {
      const parsed = parsePacket(data);
      if (!parsed) return;

      const payload = parsed.payload.toString('utf8');

      // Parse response type
      if (payload.startsWith('shell:stdout:')) {
        const output = payload.substring('shell:stdout:'.length);
        this.stdout += output;
        this.emit('stdout', Buffer.from(output));
      } else if (payload.startsWith('shell:stderr:')) {
        const output = payload.substring('shell:stderr:'.length);
        this.stderr += output;
        this.emit('stderr', Buffer.from(output));
      } else if (payload.startsWith('shell:exit:')) {
        this.exitCode = parseInt(payload.substring('shell:exit:'.length), 10);
        this.state = ShellState.CLOSED;
        this.clearTimeout();
        this.emit('exit', this.exitCode);
      } else if (payload.startsWith('shell:ready')) {
        this.state = ShellState.RUNNING;
        this.emit('ready');
      }
    } catch (err) {
      this.emit('error', err as Error);
    }
  }

  /**
   * Handle socket close
   */
  private onClose(): void {
    this.state = ShellState.CLOSED;
    this.clearTimeout();
    this.emit('close', this.exitCode);
  }

  /**
   * Handle error
   */
  private onError(err: Error): void {
    this.state = ShellState.ERROR;
    this.clearTimeout();
    this.emit('error', err);
  }

  /**
   * Clear timeout timer
   */
  private clearTimeout(): void {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }

  /**
   * Get session info
   */
  getSession(): ShellSession {
    return {
      sessionId: this.sessionId,
      command: this.command,
      state: this.state,
      exitCode: this.exitCode,
      startTime: this.startTime,
    };
  }

  /**
   * Get accumulated stdout
   */
  getStdout(): string {
    return this.stdout;
  }

  /**
   * Get accumulated stderr
   */
  getStderr(): string {
    return this.stderr;
  }
}

// ============================================================================
// Helper functions
// ============================================================================

/**
 * Execute a simple shell command and return result
 */
export async function executeShell(
  socket: net.Socket,
  command: string,
  timeout: number = 30000
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const shell = new HdcShell(socket, { command, timeout });

    let stdout = '';
    let stderr = '';

    shell.on('stdout', (data: Buffer) => {
      stdout += data.toString();
    });

    shell.on('stderr', (data: Buffer) => {
      stderr += data.toString();
    });

    shell.on('exit', (code: number | null) => {
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 1,
      });
    });

    shell.on('error', (err: Error) => {
      reject(err);
    });

    shell.on('timeout', () => {
      reject(new Error('Shell execution timeout'));
    });

    shell.start().catch(reject);
  });
}
