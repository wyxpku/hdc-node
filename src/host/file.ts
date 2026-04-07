/**
 * File Transfer Module
 *
 * Provides file send/recv functionality.
 * Ported from: hdc_rust/src/transfer
 */

import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import { createPacket, parsePacket } from '../common/message.js';

export interface TransferProgress {
  bytesTransferred: number;
  totalBytes: number;
  percentage: number;
}

export interface TransferOptions {
  chunkSize?: number;
  onProgress?: (progress: TransferProgress) => void;
}

export const DEFAULT_CHUNK_SIZE = 64 * 1024; // 64KB

/**
 * Send file to device
 */
export async function sendFile(
  deviceSocket: net.Socket,
  localPath: string,
  remotePath: string,
  options: TransferOptions = {}
): Promise<void> {
  const chunkSize = options.chunkSize || DEFAULT_CHUNK_SIZE;

  // Check if local file exists
  if (!fs.existsSync(localPath)) {
    throw new Error(`Local file not found: ${localPath}`);
  }

  const stats = fs.statSync(localPath);
  const totalBytes = stats.size;

  // Send file info
  const fileInfo = `file:send:${remotePath}:${totalBytes}`;
  const infoPacket = createPacket(Buffer.from(fileInfo));
  deviceSocket.write(infoPacket);

  // Stream file in chunks
  const fileStream = fs.createReadStream(localPath, { highWaterMark: chunkSize });
  let bytesTransferred = 0;

  return new Promise((resolve, reject) => {
    fileStream.on('data', (chunk: string | Buffer) => {
      const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const packet = createPacket(bufferChunk);
      deviceSocket.write(packet);
      bytesTransferred += bufferChunk.length;

      if (options.onProgress) {
        options.onProgress({
          bytesTransferred,
          totalBytes,
          percentage: Math.round((bytesTransferred / totalBytes) * 100),
        });
      }
    });

    fileStream.on('end', () => {
      resolve();
    });

    fileStream.on('error', (err) => {
      reject(err);
    });

    deviceSocket.on('error', (err) => {
      fileStream.destroy();
      reject(err);
    });
  });
}

/**
 * Receive file from device
 */
export async function receiveFile(
  deviceSocket: net.Socket,
  remotePath: string,
  localPath: string,
  options: TransferOptions = {}
): Promise<void> {
  // Send file request
  const fileRequest = `file:recv:${remotePath}`;
  const requestPacket = createPacket(Buffer.from(fileRequest));
  deviceSocket.write(requestPacket);

  // Ensure parent directory exists
  const parentDir = path.dirname(localPath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  return new Promise((resolve, reject) => {
    const fileStream = fs.createWriteStream(localPath);
    let totalBytes = 0;
    let bytesReceived = 0;
    let expectingInfo = true;

    deviceSocket.on('data', (data: Buffer) => {
      const parsed = parsePacket(data);
      if (!parsed) return;

      if (expectingInfo) {
        // First packet contains file info
        const info = parsed.payload.toString();
        const match = info.match(/^file:info:(\d+)$/);
        if (match) {
          totalBytes = parseInt(match[1], 10);
          expectingInfo = false;
        }
        return;
      }

      // Write file data
      fileStream.write(parsed.payload);
      bytesReceived += parsed.payload.length;

      if (options.onProgress) {
        options.onProgress({
          bytesTransferred: bytesReceived,
          totalBytes,
          percentage: totalBytes > 0 ? Math.round((bytesReceived / totalBytes) * 100) : 0,
        });
      }

      // Check if transfer complete
      if (totalBytes > 0 && bytesReceived >= totalBytes) {
        fileStream.end();
        resolve();
      }
    });

    deviceSocket.on('error', (err) => {
      fileStream.destroy();
      reject(err);
    });

    deviceSocket.on('close', () => {
      fileStream.end();
      resolve();
    });
  });
}

/**
 * Sync directory to device
 */
export async function sendDirectory(
  deviceSocket: net.Socket,
  localDir: string,
  remoteDir: string,
  options: TransferOptions = {}
): Promise<void> {
  // Create tar archive of directory
  // For now, recursively send files
  const files = listFiles(localDir);

  for (const file of files) {
    const relativePath = path.relative(localDir, file);
    const remotePath = `${remoteDir}/${relativePath}`.replace(/\\/g, '/');
    await sendFile(deviceSocket, file, remotePath, options);
  }
}

/**
 * List all files in directory recursively
 */
function listFiles(dir: string): string[] {
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
