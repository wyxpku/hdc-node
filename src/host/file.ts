/**
 * HDC File Transfer Module
 *
 * Provides file send/recv functionality with TransferConfig negotiation,
 * TransferPayload chunk headers, directory TAR support, and configurable
 * file transfer options.
 *
 * Ported from: hdc-source/src/common/transfer.cpp
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import { createPacket, parsePacket, PAYLOAD_PROTECT_VCODE } from '../common/message.js';
import { CommandId } from '../common/protocol.js';
import { GetRandomString } from '../common/base.js';
import { PayloadProtect } from '../common/serialization.js';
import {
  TransferConfig,
  TransferPayload,
  encodeTransferConfig,
  decodeTransferConfig,
  encodeTransferPayload,
  decodeTransferPayload,
  TRANSFER_PAYLOAD_SIZE,
} from '../common/transfer.js';
import {
  TarHeader,
  encodeTarHeader,
  decodeTarHeader,
  TAR_HEADER_SIZE,
} from '../common/header.js';

// ============================================================================
// Constants
// ============================================================================

export const DEFAULT_CHUNK_SIZE = 64 * 1024; // 64KB
/** High-speed mode chunk size used when server supports huge buffer */
export const HIGH_SPEED_CHUNK_SIZE = 512 * 1024; // 512KB

export const FILE_SEND_PREFIX = 'file:send:';
export const FILE_RECV_PREFIX = 'file:recv:';
export const FILE_DATA_PREFIX = 'file:data:';
export const FILE_FINISH = 'file:finish';
export const FILE_ERROR = 'file:error';

/** Compress types matching the C++ enum */
export const COMPRESS_NONE = 0;
export const COMPRESS_GZIP = 1;

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
  /** If true, only update file if newer (maps to -sync flag) */
  updateIfNew?: boolean;
  /** Whether server supports huge buffer for high-speed mode */
  serverHugeBuffer?: boolean;
}

export interface FileInfo {
  path: string;
  size: number;
  mtime: Date;
  atime: Date;
  isDirectory: boolean;
}

/**
 * Parsed file transfer command options from CLI
 */
export interface FileTransferFlags {
  holdTimestamp: boolean;   // -a flag
  compress: boolean;        // -z flag
  updateIfNew: boolean;     // -sync flag
  directoryMode: boolean;   // -m flag (directory transfer)
}

// ============================================================================
// Helper
// ============================================================================

function fileProtect(commandFlag: number = 0): PayloadProtect {
  return {
    channelId: 0,
    commandFlag,
    checkSum: 0,
    vCode: PAYLOAD_PROTECT_VCODE,
  };
}

/**
 * Build a TransferConfig from file stats and transfer options.
 */
function buildTransferConfig(
  filePath: string,
  remotePath: string,
  stats: fs.Stats,
  options: Required<TransferOptions>,
  functionName: string = 'send',
  clientCwd: string = '',
): TransferConfig {
  const compressType = options.compress ? COMPRESS_GZIP : COMPRESS_NONE;
  return {
    fileSize: stats.size,
    atime: Math.floor(stats.atimeMs / 1000),
    mtime: Math.floor(stats.mtimeMs / 1000),
    options: '',
    path: remotePath,
    optionalName: path.basename(filePath),
    updateIfNew: options.updateIfNew ?? false,
    compressType,
    holdTimestamp: options.preserveTimestamp,
    functionName,
    clientCwd,
    reserve1: '',
    reserve2: '',
  };
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
    const effectiveChunkSize = options.serverHugeBuffer
      ? (options.chunkSize || HIGH_SPEED_CHUNK_SIZE)
      : (options.chunkSize || DEFAULT_CHUNK_SIZE);
    this.options = {
      chunkSize: effectiveChunkSize,
      onProgress: options.onProgress ?? (() => {}),
      preserveTimestamp: options.preserveTimestamp ?? false,
      compress: options.compress ?? false,
      updateIfNew: options.updateIfNew ?? false,
      serverHugeBuffer: options.serverHugeBuffer ?? false,
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
   * Start sending file with TransferConfig negotiation.
   * Sends TransferConfig (protobuf) with file metadata before data chunks.
   * Each data chunk is prefixed with a 16-byte TransferPayload header.
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

      // Build and send TransferConfig
      const config = buildTransferConfig(
        this.localPath,
        this.remotePath,
        stats,
        this.options,
        'send',
        process.cwd(),
      );
      const configBuf = encodeTransferConfig(config);
      const configPacket = createPacket(configBuf, fileProtect(CommandId.CMD_FILE_BEGIN));
      this.socket.write(configPacket);

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
   * Send file content with TransferPayload headers on each chunk.
   */
  private async sendFile(): Promise<void> {
    return new Promise((resolve, reject) => {
      let chunkIndex = 0;
      this.fileStream = fs.createReadStream(this.localPath, {
        highWaterMark: this.options.chunkSize,
      });

      this.fileStream.on('data', (chunk: string | Buffer) => {
        if (this.state === TransferState.CANCELLED) {
          this.fileStream?.destroy();
          return;
        }

        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

        // Build TransferPayload header for this chunk
        const payloadHeader: TransferPayload = {
          index: chunkIndex,
          compressType: this.options.compress ? COMPRESS_GZIP : COMPRESS_NONE,
          compressSize: buf.length,
          uncompressSize: buf.length,
        };
        const headerBuf = encodeTransferPayload(payloadHeader);

        // Combine header + data into one packet
        const combinedPayload = Buffer.concat([headerBuf, buf]);
        const packet = createPacket(combinedPayload, fileProtect(CommandId.CMD_FILE_DATA));
        this.socket.write(packet);

        this.bytesTransferred += buf.length;
        chunkIndex++;
        this.emitProgress();
      });

      this.fileStream.on('end', () => {
        // Send finish marker
        const finishPacket = createPacket(Buffer.from(FILE_FINISH), fileProtect(CommandId.CMD_FILE_FINISH));
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
   * Start receiving file with TransferConfig negotiation.
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

      // Send file request with TransferConfig
      const requestConfig: TransferConfig = {
        fileSize: 0,
        atime: 0,
        mtime: 0,
        options: '',
        path: this.remotePath,
        optionalName: '',
        updateIfNew: this.options.updateIfNew,
        compressType: this.options.compress ? COMPRESS_GZIP : COMPRESS_NONE,
        holdTimestamp: this.options.preserveTimestamp,
        functionName: 'recv',
        clientCwd: process.cwd(),
        reserve1: '',
        reserve2: '',
      };
      const configBuf = encodeTransferConfig(requestConfig);
      const requestPacket = createPacket(configBuf, fileProtect(CommandId.CMD_FILE_INIT));
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
   * Receive file content, parsing TransferPayload headers from each chunk.
   */
  private async receiveFile(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.fileStream = fs.createWriteStream(this.localPath);
      let expectingConfig = true;

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

          if (expectingConfig) {
            // First packet contains TransferConfig (protobuf)
            try {
              const config = decodeTransferConfig(payload);
              this.totalBytes = config.fileSize;
              expectingConfig = false;
            } catch {
              // Fallback: try legacy text format
              const info = payload.toString();
              const match = info.match(/^file:info:(\d+)$/);
              if (match) {
                this.totalBytes = parseInt(match[1], 10);
                expectingConfig = false;
              }
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

          // Try to parse TransferPayload header (16 bytes) from chunk
          if (payload.length >= TRANSFER_PAYLOAD_SIZE) {
            const tpHeader = decodeTransferPayload(payload);
            if (tpHeader !== null) {
              // Strip the 16-byte header and write the actual data
              const fileData = payload.subarray(TRANSFER_PAYLOAD_SIZE);
              this.fileStream?.write(fileData);
              this.bytesTransferred += fileData.length;
            } else {
              // No valid header, write raw data
              this.fileStream?.write(payload);
              this.bytesTransferred += payload.length;
            }
          } else {
            // Small payload, write as-is
            this.fileStream?.write(payload);
            this.bytesTransferred += payload.length;
          }
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
// Directory Transfer with TAR headers
// ============================================================================

/**
 * Send a directory to the device using TAR headers.
 * Each file gets a TAR header followed by file data, padded to 512-byte blocks.
 */
export async function sendDirectory(
  socket: net.Socket,
  localDir: string,
  remoteDir: string,
  options?: TransferOptions
): Promise<void> {
  const dirStats = await fs.promises.stat(localDir);
  if (!dirStats.isDirectory()) {
    throw new Error(`Not a directory: ${localDir}`);
  }

  // Build list of all entries (files and directories) for TAR
  const entries = listAllEntries(localDir);

  // Send directory init with TransferConfig
  const dirConfig: TransferConfig = {
    fileSize: 0,
    atime: Math.floor(dirStats.atimeMs / 1000),
    mtime: Math.floor(dirStats.mtimeMs / 1000),
    options: '',
    path: remoteDir,
    optionalName: path.basename(localDir),
    updateIfNew: options?.updateIfNew ?? false,
    compressType: options?.compress ? COMPRESS_GZIP : COMPRESS_NONE,
    holdTimestamp: options?.preserveTimestamp ?? false,
    functionName: 'dirsend',
    clientCwd: process.cwd(),
    reserve1: '',
    reserve2: '',
  };
  const configBuf = encodeTransferConfig(dirConfig);
  const configPacket = createPacket(configBuf, fileProtect(CommandId.CMD_DIR_MODE));
  socket.write(configPacket);

  // Send each entry as a TAR header + data
  for (const entry of entries) {
    const relativePath = path.relative(localDir, entry.fullPath).replace(/\\/g, '/');
    const tarPath = relativePath;

    const stats = await fs.promises.stat(entry.fullPath);

    if (entry.isDirectory) {
      // Send directory TAR header
      const tarHeader: TarHeader = {
        filename: tarPath + '/',
        fileSize: 0,
        mtime: Math.floor(stats.mtimeMs / 1000),
        typeFlag: '5',
        prefix: '',
      };
      const headerBuf = encodeTarHeader(tarHeader);
      const packet = createPacket(headerBuf, fileProtect(CommandId.CMD_FILE_DATA));
      socket.write(packet);
    } else {
      // Send file TAR header + data
      const tarHeader: TarHeader = {
        filename: tarPath,
        fileSize: stats.size,
        mtime: Math.floor(stats.mtimeMs / 1000),
        typeFlag: '0',
        prefix: '',
      };
      const headerBuf = encodeTarHeader(tarHeader);
      const headerPacket = createPacket(headerBuf, fileProtect(CommandId.CMD_FILE_DATA));
      socket.write(headerPacket);

      // Send file data in chunks, padded to 512-byte blocks
      const chunkSize = options?.serverHugeBuffer
        ? HIGH_SPEED_CHUNK_SIZE
        : (options?.chunkSize || DEFAULT_CHUNK_SIZE);

      await new Promise<void>((resolve, reject) => {
        const stream = fs.createReadStream(entry.fullPath, { highWaterMark: chunkSize });
        let chunkIndex = 0;

        stream.on('data', (chunk: string | Buffer) => {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

          // Add TransferPayload header
          const payloadHeader: TransferPayload = {
            index: chunkIndex,
            compressType: options?.compress ? COMPRESS_GZIP : COMPRESS_NONE,
            compressSize: buf.length,
            uncompressSize: buf.length,
          };
          const headerBytes = encodeTransferPayload(payloadHeader);
          const combined = Buffer.concat([headerBytes, buf]);
          const packet = createPacket(combined, fileProtect(CommandId.CMD_FILE_DATA));
          socket.write(packet);
          chunkIndex++;
        });

        stream.on('end', () => {
          // Pad to 512-byte boundary
          const remainder = stats.size % TAR_HEADER_SIZE;
          if (remainder > 0) {
            const paddingSize = TAR_HEADER_SIZE - remainder;
            const padding = Buffer.alloc(paddingSize, 0);
            const padPacket = createPacket(padding, fileProtect(CommandId.CMD_FILE_DATA));
            socket.write(padPacket);
          }
          resolve();
        });

        stream.on('error', reject);
      });
    }
  }

  // Send end-of-archive marker (two 512-byte zero blocks)
  const eofBlock = Buffer.alloc(TAR_HEADER_SIZE * 2, 0);
  const eofPacket = createPacket(eofBlock, fileProtect(CommandId.CMD_FILE_FINISH));
  socket.write(eofPacket);
}

/**
 * List all files and directories recursively.
 */
interface DirEntry {
  fullPath: string;
  isDirectory: boolean;
}

function listAllEntries(dir: string): DirEntry[] {
  const entries: DirEntry[] = [];
  const items = fs.readdirSync(dir, { withFileTypes: true });

  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      entries.push({ fullPath, isDirectory: true });
      entries.push(...listAllEntries(fullPath));
    } else {
      entries.push({ fullPath, isDirectory: false });
    }
  }

  return entries;
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
    atime: stats.atime,
    isDirectory: stats.isDirectory(),
  };
}

/**
 * List files in directory (files only, recursive)
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
 * Parse file transfer flags from CLI arguments.
 * Supports: -a (holdTimestamp), -z (compress), -sync (updateIfNew), -m (directory mode)
 */
export function parseFileTransferFlags(args: string[]): { flags: FileTransferFlags; remaining: string[] } {
  const flags: FileTransferFlags = {
    holdTimestamp: false,
    compress: false,
    updateIfNew: false,
    directoryMode: false,
  };
  const remaining: string[] = [];

  for (const arg of args) {
    switch (arg) {
      case '-a':
        flags.holdTimestamp = true;
        break;
      case '-z':
        flags.compress = true;
        break;
      case '-sync':
        flags.updateIfNew = true;
        break;
      case '-m':
        flags.directoryMode = true;
        break;
      default:
        remaining.push(arg);
        break;
    }
  }

  return { flags, remaining };
}

/**
 * Convert FileTransferFlags to TransferOptions
 */
export function flagsToOptions(flags: FileTransferFlags): TransferOptions {
  return {
    preserveTimestamp: flags.holdTimestamp,
    compress: flags.compress,
    updateIfNew: flags.updateIfNew,
  };
}
