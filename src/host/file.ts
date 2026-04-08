/**
 * HDC File Transfer Module
 *
 * Provides file send/recv functionality.
 * Ported from: hdc-source/src/common/transfer.cpp
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import { createPacket, parsePacket } from '../common/message.js';
import { GetRandomString } from '../common/base.js';

// ============================================================================
// Constants
// ============================================================================

export const DEFAULT_CHUNK_SIZE = 64 * 1024; // 64KB
export const FILE_SEND_PREFIX = 'file:send:';
export const FILE_RECV_PREFIX = 'file:recv:';
export const FILE_DATA_PREFIX = 'file:data:';
export const FILE_FINISH = 'file:finish';
export const FILE_ERROR = 'file:error';

export enum TransferState {
  IDLE = 'idle',
  PREPARING = 'preparing',
  TRANSFERRING = 'transferring',
  COMPLETED = 'completed',
  ERROR = 'error',
  CANCELLED = 'cancelled',
}

// ============================================================================
// Types
// ============================================================================

export interface TransferProgress {
  bytesTransferred: number;
  totalBytes: number;
  percentage: number;
  speed: number; // bytes per second
  eta: number; // estimated time remaining in seconds
}

export interface TransferOptions {
  chunkSize?: number;
  onProgress?: (progress: TransferProgress) => void;
  preserveTimestamp?: boolean;
  compress?: boolean;
}

export interface FileInfo {
  path: string;
  size: number;
  mtime: Date;
  isDirectory: boolean;
}

// ============================================================================
// HdcFileTransfer - Base class for file transfers
// ============================================================================

export class HdcFileTransfer extends EventEmitter {
  protected socket: net.Socket;
  protected localPath: string;
  protected remotePath: string;
  protected options: Required<TransferOptions>;
  protected state: TransferState = TransferState.IDLE;
  protected bytesTransferred: number = 0;
  protected totalBytes: number = 0;
  protected startTime: number = 0;
  protected transferId: string;

  constructor(
    socket: net.Socket,
    localPath: string,
    remotePath: string,
    options: TransferOptions = {}
  ) {
    super();
    this.socket = socket;
    this.localPath = localPath;
    this.remotePath = remotePath;
    this.transferId = GetRandomString(8);
    this.options = {
      chunkSize: options.chunkSize || DEFAULT_CHUNK_SIZE,
      onProgress: options.onProgress,
      preserveTimestamp: options.preserveTimestamp ?? false,
      compress: options.compress ?? false,
    };
  }

  /**
   * Get current state
   */
  getState(): TransferState {
    return this.state;
  }

  /**
   * Get bytes transferred
   */
  getBytesTransferred(): number {
    return this.bytesTransferred;
  }

  /**
   * Get total bytes
   */
  getTotalBytes(): number {
    return this.totalBytes;
  }

  /**
   * Get progress percentage
   */
  getPercentage(): number {
    if (this.totalBytes === 0) return 0;
    return Math.round((this.bytesTransferred / this.totalBytes) * 100);
  }

  /**
   * Get transfer speed in bytes per second
   */
  getSpeed(): number {
    const elapsed = (Date.now() - this.startTime) / 1000;
    if (elapsed === 0) return 0;
    return this.bytesTransferred / elapsed;
  }

  /**
   * Get estimated time remaining in seconds
   */
  getETA(): number {
    const speed = this.getSpeed();
    if (speed === 0) return 0;
    const remaining = this.totalBytes - this.bytesTransferred;
    return remaining / speed;
  }

  /**
   * Get progress info
   */
  getProgress(): TransferProgress {
    return {
      bytesTransferred: this.bytesTransferred,
      totalBytes: this.totalBytes,
      percentage: this.getPercentage(),
      speed: this.getSpeed(),
      eta: this.getETA(),
    };
  }

  /**
   * Cancel transfer
   */
  cancel(): void {
    if (this.state === TransferState.TRANSFERRING) {
      this.state = TransferState.CANCELLED;
      this.emit('cancel');
    }
  }

  /**
   * Emit progress event
   */
  protected emitProgress(): void {
    const progress = this.getProgress();
    this.emit('progress', progress);
    if (this.options.onProgress) {
      this.options.onProgress(progress);
    }
  }
}

// ============================================================================
// HdcFileSender - Send files to device
// ============================================================================

export class HdcFileSender extends HdcFileTransfer {
  private fileStream: fs.ReadStream | null = null;

  constructor(
    socket: net.Socket,
    localPath: string,
    remotePath: string,
    options?: TransferOptions
  ) {
    super(socket, localPath, remotePath, options);
  }

  /**
   * Start sending file
   */
  async start(): Promise<void> {
    if (this.state !== TransferState.IDLE) {
      throw new Error('Transfer already started');
    }

    this.state = TransferState.PREPARING;
    this.startTime = Date.now();

    try {
      // Check if file exists
      const stats = await fs.promises.stat(this.localPath);
      if (!stats.isFile()) {
        throw new Error(`Not a file: ${this.localPath}`);
      }

      this.totalBytes = stats.size;

      // Send file info
      const fileInfo = `${FILE_SEND_PREFIX}${this.remotePath}:${this.totalBytes}`;
      const infoPacket = createPacket(Buffer.from(fileInfo));
      this.socket.write(infoPacket);

      // Start file stream
      this.state = TransferState.TRANSFERRING;
      this.emit('start');

      await this.sendFile();

      this.state = TransferState.COMPLETED;
      this.emit('complete');
    } catch (err) {
      this.state = TransferState.ERROR;
      this.emit('error', err);
      throw err;
    }
  }

  /**
   * Send file content
   */
  private async sendFile(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.fileStream = fs.createReadStream(this.localPath, {
        highWaterMark: this.options.chunkSize,
      });

      this.fileStream.on('data', (chunk: Buffer) => {
        if (this.state === TransferState.CANCELLED) {
          this.fileStream?.destroy();
          return;
        }

        const packet = createPacket(chunk);
        this.socket.write(packet);
        this.bytesTransferred += chunk.length;
        this.emitProgress();
      });

      this.fileStream.on('end', () => {
        // Send finish marker
        const finishPacket = createPacket(Buffer.from(FILE_FINISH));
        this.socket.write(finishPacket);
        resolve();
      });

      this.fileStream.on('error', (err) => {
        reject(err);
      });

      this.socket.on('error', (err) => {
        this.fileStream?.destroy();
        reject(err);
      });
    });
  }
}

// ============================================================================
// HdcFileReceiver - Receive files from device
// ============================================================================

export class HdcFileReceiver extends HdcFileTransfer {
  private fileStream: fs.WriteStream | null = null;

  constructor(
    socket: net.Socket,
    localPath: string,
    remotePath: string,
    options?: TransferOptions
  ) {
    super(socket, localPath, remotePath, options);
  }

  /**
   * Start receiving file
   */
  async start(): Promise<void> {
    if (this.state !== TransferState.IDLE) {
      throw new Error('Transfer already started');
    }

    this.state = TransferState.PREPARING;
    this.startTime = Date.now();

    try {
      // Ensure parent directory exists
      const parentDir = path.dirname(this.localPath);
      await fs.promises.mkdir(parentDir, { recursive: true });

      // Send file request
      const request = `${FILE_RECV_PREFIX}${this.remotePath}`;
      const requestPacket = createPacket(Buffer.from(request));
      this.socket.write(requestPacket);

      // Setup data handler
      this.state = TransferState.TRANSFERRING;
      this.emit('start');

      await this.receiveFile();

      this.state = TransferState.COMPLETED;
      this.emit('complete');
    } catch (err) {
      this.state = TransferState.ERROR;
      this.emit('error', err);
      throw err;
    }
  }

  /**
   * Receive file content
   */
  private async receiveFile(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.fileStream = fs.createWriteStream(this.localPath);
      let expectingInfo = true;

      const dataHandler = (data: Buffer) => {
        if (this.state === TransferState.CANCELLED) {
          this.socket.off('data', dataHandler);
          this.fileStream?.destroy();
          return;
        }

        try {
          const parsed = parsePacket(data);
          if (!parsed) return;

          const payload = parsed.payload;

          if (expectingInfo) {
            // First packet contains file info
            const info = payload.toString();
            const match = info.match(/^file:info:(\d+)$/);
            if (match) {
              this.totalBytes = parseInt(match[1], 10);
              expectingInfo = false;
            }
            return;
          }

          if (payload.toString() === FILE_FINISH) {
            this.fileStream?.end();
            this.socket.off('data', dataHandler);
            resolve();
            return;
          }

          if (payload.toString().startsWith(FILE_ERROR)) {
            const errorMsg = payload.toString().substring(FILE_ERROR.length);
            this.socket.off('data', dataHandler);
            reject(new Error(errorMsg));
            return;
          }

          // Write file data
          this.fileStream?.write(payload);
          this.bytesTransferred += payload.length;
          this.emitProgress();

          // Check if complete
          if (this.totalBytes > 0 && this.bytesTransferred >= this.totalBytes) {
            this.fileStream?.end();
            this.socket.off('data', dataHandler);
            resolve();
          }
        } catch (err) {
          this.socket.off('data', dataHandler);
          reject(err);
        }
      };

      this.socket.on('data', dataHandler);

      this.socket.on('error', (err) => {
        this.socket.off('data', dataHandler);
        this.fileStream?.destroy();
        reject(err);
      });

      this.socket.on('close', () => {
        this.socket.off('data', dataHandler);
        this.fileStream?.end();
        resolve();
      });
    });
  }
}

// ============================================================================
// Helper functions
// ============================================================================

/**
 * Send file to device (simple API)
 */
export async function sendFile(
  socket: net.Socket,
  localPath: string,
  remotePath: string,
  options?: TransferOptions
): Promise<void> {
  const sender = new HdcFileSender(socket, localPath, remotePath, options);
  await sender.start();
}

/**
 * Receive file from device (simple API)
 */
export async function receiveFile(
  socket: net.Socket,
  remotePath: string,
  localPath: string,
  options?: TransferOptions
): Promise<void> {
  const receiver = new HdcFileReceiver(socket, localPath, remotePath, options);
  await receiver.start();
}

/**
 * Get file info
 */
export async function getFileInfo(filePath: string): Promise<FileInfo> {
  const stats = await fs.promises.stat(filePath);
  return {
    path: filePath,
    size: stats.size,
    mtime: stats.mtime,
    isDirectory: stats.isDirectory(),
  };
}

/**
 * List files in directory
 */
export function listFiles(dir: string): string[] {
  const files: string[] = [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(fullPath));
    } else {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Send directory to device
 */
export async function sendDirectory(
  socket: net.Socket,
  localDir: string,
  remoteDir: string,
  options?: TransferOptions
): Promise<void> {
  const files = listFiles(localDir);

  for (const file of files) {
    const relativePath = path.relative(localDir, file);
    const remotePath = `${remoteDir}/${relativePath}`.replace(/\\/g, '/');
    await sendFile(socket, file, remotePath, options);
  }
}
