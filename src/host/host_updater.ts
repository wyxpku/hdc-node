/**
 * HDC Flashd Update Module
 *
 * Provides flashd commands (update/flash/erase/format) for device firmware
 * management. Implements the flashd protocol pattern with init, check, begin,
 * data, progress, and finish steps.
 *
 * Ported from: hdc-source/src/host/flashd.cpp
 */

import { EventEmitter } from 'events';
import * as net from 'net';
import * as fs from 'fs';
import { createPacket, parsePacket, PAYLOAD_PROTECT_VCODE } from '../common/message.js';
import { CommandId } from '../common/protocol.js';
import {
  TransferConfig,
  TransferPayload,
  encodeTransferConfig,
  encodeTransferPayload,
  TRANSFER_PAYLOAD_SIZE,
} from '../common/transfer.js';
import { PayloadProtect } from '../common/serialization.js';

// ============================================================================
// Constants
// ============================================================================

export const DEFAULT_CHUNK_SIZE = 64 * 1024; // 64KB
export const FLASHD_FINISH = 'flashd:finish';
export const FLASHD_ERROR = 'flashd:error';
export const FLASHD_PROGRESS_PREFIX = 'flashd:progress:';

// ============================================================================
// Enums & Interfaces
// ============================================================================

export enum FlashdState {
  IDLE = 'idle',
  PREPARING = 'preparing',
  TRANSFERRING = 'transferring',
  VERIFYING = 'verifying',
  COMPLETED = 'completed',
  ERROR = 'error',
}

export interface FlashdOptions {
  force?: boolean; // -f flag, skip confirmation
  partition?: string;
  imagePath?: string;
  packagePath?: string;
}

export interface FlashdProgress {
  bytesTransferred: number;
  totalBytes: number;
  percentage: number;
  partition?: string;
}

// ============================================================================
// Helper
// ============================================================================

function flashdProtect(commandFlag: number = 0): PayloadProtect {
  return {
    channelId: 0,
    commandFlag,
    checkSum: 0,
    vCode: PAYLOAD_PROTECT_VCODE,
  };
}

/**
 * Build a TransferConfig for flashd init commands.
 */
function buildFlashdTransferConfig(
  fileSize: number,
  partition: string,
  remotePath: string,
  functionName: string,
): TransferConfig {
  return {
    fileSize,
    atime: 0,
    mtime: 0,
    options: '',
    path: remotePath,
    optionalName: partition,
    updateIfNew: false,
    compressType: 0,
    holdTimestamp: false,
    functionName,
    clientCwd: '',
    reserve1: '',
    reserve2: '',
  };
}

// ============================================================================
// HdcFlashd - Client-side flashd command manager
// ============================================================================

export class HdcFlashd extends EventEmitter {
  private socket: net.Socket;
  private state: FlashdState = FlashdState.IDLE;
  private bytesTransferred: number = 0;
  private totalBytes: number = 0;
  private currentPartition?: string;

  constructor(socket: net.Socket) {
    super();
    this.socket = socket;
  }

  /**
   * Update firmware from package.
   *
   * Protocol: CMD_FLASHD_UPDATE_INIT → CMD_FLASHD_CHECK → CMD_FLASHD_BEGIN →
   *           CMD_FLASHD_DATA chunks → CMD_FLASHD_PROGRESS → CMD_FLASHD_FINISH
   */
  async update(packagePath: string, options?: FlashdOptions): Promise<void> {
    if (this.state !== FlashdState.IDLE) {
      throw new Error('Flashd operation already in progress');
    }

    this.state = FlashdState.PREPARING;
    this.bytesTransferred = 0;

    try {
      const stats = await fs.promises.stat(packagePath);
      if (!stats.isFile()) {
        throw new Error(`Not a file: ${packagePath}`);
      }

      this.totalBytes = stats.size;

      // 1. Send CMD_FLASHD_UPDATE_INIT with TransferConfig
      const config = buildFlashdTransferConfig(
        stats.size,
        '',
        packagePath,
        'update',
      );
      const configBuf = encodeTransferConfig(config);
      const initPacket = createPacket(configBuf, flashdProtect(CommandId.CMD_FLASHD_UPDATE_INIT));
      this.socket.write(initPacket);

      // 2. Send CMD_FLASHD_CHECK
      const checkPacket = createPacket(Buffer.alloc(0), flashdProtect(CommandId.CMD_FLASHD_CHECK));
      this.socket.write(checkPacket);

      // 3. Send CMD_FLASHD_BEGIN
      const beginPacket = createPacket(Buffer.alloc(0), flashdProtect(CommandId.CMD_FLASHD_BEGIN));
      this.socket.write(beginPacket);

      // 4. Send image data with TransferPayload headers
      this.state = FlashdState.TRANSFERRING;
      this.emit('start');
      await this.sendImageData(packagePath, CommandId.CMD_FLASHD_DATA);

      // 5. Send CMD_FLASHD_FINISH
      const finishPacket = createPacket(
        Buffer.from(FLASHD_FINISH),
        flashdProtect(CommandId.CMD_FLASHD_FINISH),
      );
      this.socket.write(finishPacket);

      this.state = FlashdState.COMPLETED;
      this.emit('complete');
    } catch (err) {
      this.state = FlashdState.ERROR;
      this.emit('error', err);
      throw err;
    }
  }

  /**
   * Flash a partition with image.
   *
   * Protocol: CMD_FLASHD_FLASH_INIT → CMD_FLASHD_CHECK → CMD_FLASHD_BEGIN →
   *           CMD_FLASHD_DATA chunks → CMD_FLASHD_PROGRESS → CMD_FLASHD_FINISH
   */
  async flash(partition: string, imagePath: string, options?: FlashdOptions): Promise<void> {
    if (this.state !== FlashdState.IDLE) {
      throw new Error('Flashd operation already in progress');
    }

    this.state = FlashdState.PREPARING;
    this.currentPartition = partition;
    this.bytesTransferred = 0;

    try {
      const stats = await fs.promises.stat(imagePath);
      if (!stats.isFile()) {
        throw new Error(`Not a file: ${imagePath}`);
      }

      this.totalBytes = stats.size;

      // 1. Send CMD_FLASHD_FLASH_INIT with TransferConfig
      const config = buildFlashdTransferConfig(
        stats.size,
        partition,
        imagePath,
        'flash',
      );
      const configBuf = encodeTransferConfig(config);
      const initPacket = createPacket(configBuf, flashdProtect(CommandId.CMD_FLASHD_FLASH_INIT));
      this.socket.write(initPacket);

      // 2. Send CMD_FLASHD_CHECK
      const checkPacket = createPacket(Buffer.alloc(0), flashdProtect(CommandId.CMD_FLASHD_CHECK));
      this.socket.write(checkPacket);

      // 3. Send CMD_FLASHD_BEGIN
      const beginPacket = createPacket(Buffer.alloc(0), flashdProtect(CommandId.CMD_FLASHD_BEGIN));
      this.socket.write(beginPacket);

      // 4. Send image data with TransferPayload headers
      this.state = FlashdState.TRANSFERRING;
      this.emit('start');
      await this.sendImageData(imagePath, CommandId.CMD_FLASHD_DATA);

      // 5. Send CMD_FLASHD_FINISH
      const finishPacket = createPacket(
        Buffer.from(FLASHD_FINISH),
        flashdProtect(CommandId.CMD_FLASHD_FINISH),
      );
      this.socket.write(finishPacket);

      this.state = FlashdState.COMPLETED;
      this.emit('complete');
    } catch (err) {
      this.state = FlashdState.ERROR;
      this.emit('error', err);
      throw err;
    }
  }

  /**
   * Erase a partition.
   *
   * Protocol: CMD_FLASHD_ERASE → CMD_FLASHD_FINISH (no data transfer)
   */
  async erase(partition: string, options?: FlashdOptions): Promise<void> {
    if (this.state !== FlashdState.IDLE) {
      throw new Error('Flashd operation already in progress');
    }

    this.state = FlashdState.PREPARING;
    this.currentPartition = partition;
    this.bytesTransferred = 0;
    this.totalBytes = 0;

    try {
      // 1. Send CMD_FLASHD_ERASE with partition info as TransferConfig
      const config = buildFlashdTransferConfig(0, partition, '', 'erase');
      const configBuf = encodeTransferConfig(config);
      const erasePacket = createPacket(configBuf, flashdProtect(CommandId.CMD_FLASHD_ERASE));
      this.socket.write(erasePacket);

      // 2. Send CMD_FLASHD_FINISH
      const finishPacket = createPacket(
        Buffer.from(FLASHD_FINISH),
        flashdProtect(CommandId.CMD_FLASHD_FINISH),
      );
      this.socket.write(finishPacket);

      this.state = FlashdState.COMPLETED;
      this.emit('complete');
    } catch (err) {
      this.state = FlashdState.ERROR;
      this.emit('error', err);
      throw err;
    }
  }

  /**
   * Format a partition.
   *
   * Protocol: CMD_FLASHD_FORMAT → CMD_FLASHD_FINISH (no data transfer)
   */
  async format(partition: string, options?: FlashdOptions): Promise<void> {
    if (this.state !== FlashdState.IDLE) {
      throw new Error('Flashd operation already in progress');
    }

    this.state = FlashdState.PREPARING;
    this.currentPartition = partition;
    this.bytesTransferred = 0;
    this.totalBytes = 0;

    try {
      // 1. Send CMD_FLASHD_FORMAT with partition info as TransferConfig
      const config = buildFlashdTransferConfig(0, partition, '', 'format');
      const configBuf = encodeTransferConfig(config);
      const formatPacket = createPacket(configBuf, flashdProtect(CommandId.CMD_FLASHD_FORMAT));
      this.socket.write(formatPacket);

      // 2. Send CMD_FLASHD_FINISH
      const finishPacket = createPacket(
        Buffer.from(FLASHD_FINISH),
        flashdProtect(CommandId.CMD_FLASHD_FINISH),
      );
      this.socket.write(finishPacket);

      this.state = FlashdState.COMPLETED;
      this.emit('complete');
    } catch (err) {
      this.state = FlashdState.ERROR;
      this.emit('error', err);
      throw err;
    }
  }

  /**
   * Send image data with TransferPayload headers on each chunk.
   */
  private async sendImageData(filePath: string, commandId: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let chunkIndex = 0;
      const stream = fs.createReadStream(filePath, {
        highWaterMark: DEFAULT_CHUNK_SIZE,
      });

      stream.on('data', (chunk: string | Buffer) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

        // Build TransferPayload header for this chunk
        const payloadHeader: TransferPayload = {
          index: chunkIndex,
          compressType: 0,
          compressSize: buf.length,
          uncompressSize: buf.length,
        };
        const headerBuf = encodeTransferPayload(payloadHeader);

        // Combine header + data into one packet
        const combinedPayload = Buffer.concat([headerBuf, buf]);
        const packet = createPacket(combinedPayload, flashdProtect(commandId));
        this.socket.write(packet);

        this.bytesTransferred += buf.length;
        chunkIndex++;
        this.emitProgress();
      });

      stream.on('end', () => {
        resolve();
      });

      stream.on('error', (err) => {
        reject(err);
      });

      this.socket.on('error', (err) => {
        stream.destroy();
        reject(err);
      });
    });
  }

  /**
   * Get current state.
   */
  getState(): FlashdState {
    return this.state;
  }

  /**
   * Get progress info.
   */
  getProgress(): FlashdProgress {
    return {
      bytesTransferred: this.bytesTransferred,
      totalBytes: this.totalBytes,
      percentage: this.totalBytes > 0
        ? Math.round((this.bytesTransferred / this.totalBytes) * 100)
        : 0,
      partition: this.currentPartition,
    };
  }

  /**
   * Reset state to IDLE for reuse.
   */
  reset(): void {
    this.state = FlashdState.IDLE;
    this.bytesTransferred = 0;
    this.totalBytes = 0;
    this.currentPartition = undefined;
  }

  /**
   * Emit progress event.
   */
  private emitProgress(): void {
    const progress = this.getProgress();
    this.emit('progress', progress);
  }
}
