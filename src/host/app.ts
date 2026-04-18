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
import { createPacket, parsePacket, PAYLOAD_PROTECT_VCODE } from '../common/message.js';
import { CommandId } from '../common/protocol.js';
import { GetRandomString } from '../common/base.js';
import { PayloadProtect } from '../common/serialization.js';
import { encodeTarHeader, TarHeader, TAR_HEADER_SIZE } from '../common/header.js';

// ============================================================================
// Constants
// ============================================================================

export const APP_INSTALL_PREFIX = 'app:install:';
export const APP_UNINSTALL_PREFIX = 'app:uninstall:';
export const APP_SIDELOAD_PREFIX = 'app:sideload:';
export const APP_LIST_PREFIX = 'app:list';
export const APP_DATA = 'app:data';
export const APP_FINISH = 'app:finish';
export const APP_ERROR = 'app:error';

export enum AppState {
  IDLE = 'idle',
  PREPARING = 'preparing',
  INSTALLING = 'installing',
  UNINSTALLING = 'uninstalling',
  SIDELOADING = 'sideloading',
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
  moduleName?: string;
  version?: string;
  userId?: string;
}

// ============================================================================
// Helper
// ============================================================================

function appProtect(commandFlag: number = 0): PayloadProtect {
  return {
    channelId: 0,
    commandFlag,
    checkSum: 0,
    vCode: PAYLOAD_PROTECT_VCODE,
  };
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
      const request = createPacket(Buffer.from(command), appProtect(CommandId.CMD_APP_BEGIN));
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
   * Install multiple packages.
   *
   * Supports:
   *  - Single .hap/.hsp files (delegates to install())
   *  - .app bundle (extract and install all packages inside)
   *  - Directory (auto-tar using TAR headers, send all files)
   */
  async installMultiple(packagePaths: string[], options?: Partial<InstallOptions>): Promise<void> {
    if (this.state !== AppState.IDLE) {
      throw new Error('Another operation in progress');
    }

    if (packagePaths.length === 0) {
      throw new Error('No package paths provided');
    }

    // Process each path
    for (const pkgPath of packagePaths) {
      const resolvedPath = path.resolve(pkgPath);
      const stat = await fs.promises.stat(resolvedPath);

      if (stat.isFile()) {
        const ext = path.extname(resolvedPath).toLowerCase();

        if (ext === '.hap' || ext === '.hsp') {
          // Single package - use standard install
          await this.install({
            packagePath: resolvedPath,
            ...options,
          });
        } else if (ext === '.app') {
          // .app bundle - extract and install all packages inside
          await this.installAppBundle(resolvedPath, options);
        } else {
          throw new Error(`Unsupported package format: ${ext}`);
        }
      } else if (stat.isDirectory()) {
        // Directory - auto-tar and send all files
        await this.installDirectory(resolvedPath, options);
      } else {
        throw new Error(`Not a file or directory: ${resolvedPath}`);
      }
    }
  }

  /**
   * Install an .app bundle by sending it with bundle flag.
   * The server-side extracts and installs all contained packages.
   */
  private async installAppBundle(bundlePath: string, options?: Partial<InstallOptions>): Promise<void> {
    if (this.state !== AppState.IDLE) {
      this.state = AppState.PREPARING;
    }

    this.currentPackage = bundlePath;

    try {
      const stats = await fs.promises.stat(bundlePath);
      this.totalBytes = stats.size;
      this.state = AppState.INSTALLING;

      // Build flags including bundle indicator
      const flags = ['b']; // bundle flag
      if (options?.reinstall) flags.push('r');
      if (options?.downgrade) flags.push('d');
      if (options?.grantPermissions) flags.push('g');

      const command = `${APP_INSTALL_PREFIX}${flags.join('')}:${bundlePath}`;
      const request = createPacket(Buffer.from(command), appProtect(CommandId.CMD_APP_BEGIN));
      this.socket.write(request);

      // Send bundle data
      await this.sendFile(bundlePath);

      // Wait for completion
      await this.waitForCompletion();

      this.state = AppState.COMPLETED;
      this.emit('install-complete', bundlePath);
    } catch (err) {
      this.state = AppState.ERROR;
      this.emit('error', err);
      throw err;
    } finally {
      this.reset();
    }
  }

  /**
   * Install a directory by creating TAR headers for all files
   * and sending them sequentially.
   */
  private async installDirectory(dirPath: string, options?: Partial<InstallOptions>): Promise<void> {
    if (this.state !== AppState.IDLE) {
      this.state = AppState.PREPARING;
    }

    this.currentPackage = dirPath;

    try {
      // Collect all files in directory recursively
      const files = await this.collectFiles(dirPath);

      if (files.length === 0) {
        throw new Error(`No files found in directory: ${dirPath}`);
      }

      // Calculate total size (headers + file data)
      let totalSize = 0;
      for (const file of files) {
        const stat = await fs.promises.stat(file);
        totalSize += TAR_HEADER_SIZE + stat.size;
      }
      // Add end-of-archive marker (two 512-byte zero blocks)
      totalSize += TAR_HEADER_SIZE * 2;

      this.totalBytes = totalSize;
      this.state = AppState.INSTALLING;

      // Build flags including directory indicator
      const flags = ['t']; // tar/directory flag
      if (options?.reinstall) flags.push('r');
      if (options?.downgrade) flags.push('d');
      if (options?.grantPermissions) flags.push('g');

      const dirName = path.basename(dirPath);
      const command = `${APP_INSTALL_PREFIX}${flags.join('')}:${dirName}`;
      const request = createPacket(Buffer.from(command), appProtect(CommandId.CMD_APP_BEGIN));
      this.socket.write(request);

      // Send each file with its TAR header
      for (const filePath of files) {
        const stat = await fs.promises.stat(filePath);
        const relativePath = path.relative(dirPath, filePath);

        const header: TarHeader = {
          filename: relativePath,
          fileSize: stat.size,
          mtime: Math.floor(stat.mtimeMs / 1000),
          typeFlag: '0', // regular file
          prefix: '',
        };

        // Send TAR header
        const headerBuf = encodeTarHeader(header);
        const headerPacket = createPacket(headerBuf, appProtect(CommandId.CMD_APP_DATA));
        this.socket.write(headerPacket);
        this.bytesTransferred += TAR_HEADER_SIZE;

        // Send file data
        await this.sendFile(filePath);
      }

      // Send end-of-archive marker (two zero-filled 512-byte blocks)
      const zeroBlock = Buffer.alloc(TAR_HEADER_SIZE * 2, 0);
      const endPacket = createPacket(zeroBlock, appProtect(CommandId.CMD_APP_DATA));
      this.socket.write(endPacket);

      // Send finish marker
      const finishPacket = createPacket(Buffer.from(APP_FINISH), appProtect(CommandId.CMD_APP_FINISH));
      this.socket.write(finishPacket);

      // Wait for completion
      await this.waitForCompletion();

      this.state = AppState.COMPLETED;
      this.emit('install-complete', dirPath);
    } catch (err) {
      this.state = AppState.ERROR;
      this.emit('error', err);
      throw err;
    } finally {
      this.reset();
    }
  }

  /**
   * Recursively collect all files in a directory.
   */
  private async collectFiles(dirPath: string): Promise<string[]> {
    const result: string[] = [];
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        const subFiles = await this.collectFiles(fullPath);
        result.push(...subFiles);
      } else if (entry.isFile()) {
        result.push(fullPath);
      }
    }

    return result;
  }

  /**
   * Uninstall application with enhanced options.
   *
   * Supports:
   *  - -k : keep data
   *  - -n / -m : module name
   *  - -v : version
   *  - -u : user ID
   */
  async uninstall(options: UninstallOptions): Promise<void> {
    if (this.state !== AppState.IDLE) {
      throw new Error('Another operation in progress');
    }

    this.state = AppState.UNINSTALLING;
    this.currentPackage = options.packageName;

    try {
      // Build flag string
      const flags: string[] = [];
      if (options.keepData) flags.push('k');

      // Build optional parameters string
      const params: string[] = [];
      if (options.moduleName) {
        params.push(`-n ${options.moduleName}`);
      }
      if (options.version) {
        params.push(`-v ${options.version}`);
      }
      if (options.userId) {
        params.push(`-u ${options.userId}`);
      }

      const flagStr = flags.join('');
      const paramStr = params.length > 0 ? ` ${params.join(' ')}` : '';
      const command = `${APP_UNINSTALL_PREFIX}${flagStr}:${options.packageName}${paramStr}`;
      const request = createPacket(Buffer.from(command), appProtect(CommandId.CMD_APP_UNINSTALL));
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
   * Sideload an OTA package to the device for flashing.
   * Uses CMD_APP_SIDELOAD command flag.
   */
  async sideload(packagePath: string): Promise<void> {
    if (this.state !== AppState.IDLE) {
      throw new Error('Another operation in progress');
    }

    this.state = AppState.PREPARING;
    this.currentPackage = packagePath;

    try {
      // Verify the package file exists
      const stats = await fs.promises.stat(packagePath);
      if (!stats.isFile()) {
        throw new Error(`Not a file: ${packagePath}`);
      }

      this.totalBytes = stats.size;
      this.state = AppState.SIDELOADING;

      // Send sideload command
      const command = `${APP_SIDELOAD_PREFIX}${packagePath}`;
      const request = createPacket(Buffer.from(command), appProtect(CommandId.CMD_APP_SIDELOAD));
      this.socket.write(request);

      // Send package data
      await this.sendFile(packagePath);

      // Wait for completion
      await this.waitForCompletion();

      this.state = AppState.COMPLETED;
      this.emit('sideload-complete', packagePath);
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
      const request = createPacket(Buffer.from(APP_LIST_PREFIX), appProtect(CommandId.CMD_APP_INIT));
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

      stream.on('data', (chunk: string | Buffer) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const packet = createPacket(buf, appProtect(CommandId.CMD_APP_DATA));
        this.socket.write(packet);
        this.bytesTransferred += buf.length;
        this.emit('progress', {
          bytesTransferred: this.bytesTransferred,
          totalBytes: this.totalBytes,
          percentage: Math.round((this.bytesTransferred / this.totalBytes) * 100),
        });
      });

      stream.on('end', () => {
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
 * Install multiple packages (simple API)
 */
export async function installMultipleApps(
  socket: net.Socket,
  packagePaths: string[],
  options?: Partial<InstallOptions>
): Promise<void> {
  const manager = new HdcAppManager(socket);
  await manager.installMultiple(packagePaths, options);
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
 * Sideload OTA package (simple API)
 */
export async function sideloadApp(
  socket: net.Socket,
  packagePath: string
): Promise<void> {
  const manager = new HdcAppManager(socket);
  await manager.sideload(packagePath);
}

/**
 * List installed applications (simple API)
 */
export async function listApps(socket: net.Socket): Promise<AppInfo[]> {
  const manager = new HdcAppManager(socket);
  return manager.listPackages();
}
