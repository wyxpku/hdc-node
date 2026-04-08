/**
 * HDC App Management Module
 *
 * Provides app installation and uninstallation functionality.
 * Ported from: hdc-source/src/host/task_app.cpp
 */

import { EventEmitter } from 'events';
import * as net from 'net';
import * as path from 'path';
import * as fs from 'fs';
import { createPacket, parsePacket } from '../common/message.js';
import { GetRandomString } from '../common/base.js';

// ============================================================================
// Constants
// ============================================================================

export const APP_INSTALL_PREFIX = 'app:install:';
export const APP_UNINSTALL_PREFIX = 'app:uninstall:';
export const APP_LIST_PREFIX = 'app:list';
export const APP_DATA = 'app:data';
export const APP_FINISH = 'app:finish';
export const APP_ERROR = 'app:error';

export enum AppState {
  IDLE = 'idle',
  PREPARING = 'preparing',
  INSTALLING = 'installing',
  UNINSTALLING = 'uninstalling',
  COMPLETED = 'completed',
  ERROR = 'error',
}

// ============================================================================
// Types
// ============================================================================

export interface AppInfo {
  packageName: string;
  version?: string;
  size?: number;
  installTime?: Date;
}

export interface InstallOptions {
  packagePath: string;
  reinstall?: boolean;
  downgrade?: boolean;
  grantPermissions?: boolean;
}

export interface UninstallOptions {
  packageName: string;
  keepData?: boolean;
}

// ============================================================================
// HdcAppManager - App Installation/Uninstallation
// ============================================================================

export class HdcAppManager extends EventEmitter {
  private socket: net.Socket;
  private state: AppState = AppState.IDLE;
  private currentPackage: string = '';
  private bytesTransferred: number = 0;
  private totalBytes: number = 0;

  constructor(socket: net.Socket) {
    super();
    this.socket = socket;
  }

  /**
   * Get current state
   */
  getState(): AppState {
    return this.state;
  }

  /**
   * Install application
   */
  async install(options: InstallOptions): Promise<void> {
    if (this.state !== AppState.IDLE) {
      throw new Error('Another operation in progress');
    }

    this.state = AppState.PREPARING;
    this.currentPackage = options.packagePath;

    try {
      // Check if package file exists
      const stats = await fs.promises.stat(options.packagePath);
      if (!stats.isFile()) {
        throw new Error(`Not a file: ${options.packagePath}`);
      }

      this.totalBytes = stats.size;
      this.state = AppState.INSTALLING;

      // Send install command
      const flags = [];
      if (options.reinstall) flags.push('r');
      if (options.downgrade) flags.push('d');
      if (options.grantPermissions) flags.push('g');

      const command = `${APP_INSTALL_PREFIX}${flags.join('')}:${options.packagePath}`;
      const request = createPacket(Buffer.from(command));
      this.socket.write(request);

      // Send package data
      await this.sendFile(options.packagePath);

      // Wait for completion
      await this.waitForCompletion();

      this.state = AppState.COMPLETED;
      this.emit('install-complete', options.packagePath);
    } catch (err) {
      this.state = AppState.ERROR;
      this.emit('error', err);
      throw err;
    } finally {
      this.reset();
    }
  }

  /**
   * Uninstall application
   */
  async uninstall(options: UninstallOptions): Promise<void> {
    if (this.state !== AppState.IDLE) {
      throw new Error('Another operation in progress');
    }

    this.state = AppState.UNINSTALLING;
    this.currentPackage = options.packageName;

    try {
      const flags = options.keepData ? 'k' : '';
      const command = `${APP_UNINSTALL_PREFIX}${flags}:${options.packageName}`;
      const request = createPacket(Buffer.from(command));
      this.socket.write(request);

      // Wait for completion
      await this.waitForCompletion();

      this.state = AppState.COMPLETED;
      this.emit('uninstall-complete', options.packageName);
    } catch (err) {
      this.state = AppState.ERROR;
      this.emit('error', err);
      throw err;
    } finally {
      this.reset();
    }
  }

  /**
   * List installed applications
   */
  async listPackages(): Promise<AppInfo[]> {
    return new Promise((resolve, reject) => {
      const request = createPacket(Buffer.from(APP_LIST_PREFIX));
      this.socket.write(request);

      const handler = (data: Buffer) => {
        try {
          const parsed = parsePacket(data);
          if (!parsed) return;

          const payload = parsed.payload.toString();

          if (payload.startsWith(APP_DATA)) {
            const packages = payload.substring(APP_DATA.length);
            const apps = packages.split('\n').map(line => {
              const [packageName, version, sizeStr] = line.split(':');
              return {
                packageName,
                version,
                size: parseInt(sizeStr, 10) || undefined,
              } as AppInfo;
            }).filter(app => app.packageName);

            this.socket.off('data', handler);
            resolve(apps);
          } else if (payload.startsWith(APP_ERROR)) {
            this.socket.off('data', handler);
            reject(new Error(payload.substring(APP_ERROR.length)));
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
        reject(new Error('List packages timeout'));
      }, 30000);
    });
  }

  /**
   * Send file data
   */
  private async sendFile(filePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const stream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 });

      stream.on('data', (chunk: Buffer) => {
        const packet = createPacket(chunk);
        this.socket.write(packet);
        this.bytesTransferred += chunk.length;
        this.emit('progress', {
          bytesTransferred: this.bytesTransferred,
          totalBytes: this.totalBytes,
          percentage: Math.round((this.bytesTransferred / this.totalBytes) * 100),
        });
      });

      stream.on('end', () => {
        // Send finish marker
        const finishPacket = createPacket(Buffer.from(APP_FINISH));
        this.socket.write(finishPacket);
        resolve();
      });

      stream.on('error', reject);

      this.socket.on('error', (err) => {
        stream.destroy();
        reject(err);
      });
    });
  }

  /**
   * Wait for operation completion
   */
  private waitForCompletion(): Promise<void> {
    return new Promise((resolve, reject) => {
      const handler = (data: Buffer) => {
        try {
          const parsed = parsePacket(data);
          if (!parsed) return;

          const payload = parsed.payload.toString();

          if (payload.startsWith(APP_FINISH)) {
            this.socket.off('data', handler);
            resolve();
          } else if (payload.startsWith(APP_ERROR)) {
            this.socket.off('data', handler);
            reject(new Error(payload.substring(APP_ERROR.length)));
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
        reject(new Error('Operation timeout'));
      }, 60000);
    });
  }

  /**
   * Reset state
   */
  private reset(): void {
    this.state = AppState.IDLE;
    this.currentPackage = '';
    this.bytesTransferred = 0;
    this.totalBytes = 0;
  }
}

// ============================================================================
// Helper functions
// ============================================================================

/**
 * Install application (simple API)
 */
export async function installApp(
  socket: net.Socket,
  packagePath: string,
  options?: Partial<InstallOptions>
): Promise<void> {
  const manager = new HdcAppManager(socket);
  await manager.install({ packagePath, ...options });
}

/**
 * Uninstall application (simple API)
 */
export async function uninstallApp(
  socket: net.Socket,
  packageName: string,
  keepData?: boolean
): Promise<void> {
  const manager = new HdcAppManager(socket);
  await manager.uninstall({ packageName, keepData });
}

/**
 * List installed applications (simple API)
 */
export async function listApps(socket: net.Socket): Promise<AppInfo[]> {
  const manager = new HdcAppManager(socket);
  return manager.listPackages();
}
