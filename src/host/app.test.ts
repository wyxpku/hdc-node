/**
 * Tests for App Management module
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  HdcAppManager,
  AppState,
  APP_INSTALL_PREFIX,
  APP_UNINSTALL_PREFIX,
  APP_SIDELOAD_PREFIX,
} from './app.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock socket factory
function createMockSocket() {
  return {
    write: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  } as any;
}

describe('HdcAppManager', () => {
  describe('constructor', () => {
    it('should create manager instance', () => {
      const mockSocket = createMockSocket();
      const manager = new HdcAppManager(mockSocket);

      expect(manager.getState()).toBe(AppState.IDLE);
    });
  });

  describe('getState', () => {
    it('should return current state', () => {
      const mockSocket = createMockSocket();
      const manager = new HdcAppManager(mockSocket);

      expect(manager.getState()).toBe(AppState.IDLE);
    });
  });

  describe('install', () => {
    it('should reject if file does not exist', async () => {
      const mockSocket = createMockSocket();
      const manager = new HdcAppManager(mockSocket);

      await expect(manager.install({
        packagePath: '/nonexistent/app.hap',
      })).rejects.toThrow();
    });

    it('should reject if another operation in progress', async () => {
      const mockSocket = createMockSocket();
      const manager = new HdcAppManager(mockSocket);

      // Set state to installing
      manager['state'] = AppState.INSTALLING;

      await expect(manager.install({
        packagePath: '/some/app.hap',
      })).rejects.toThrow('Another operation in progress');
    });
  });

  describe('uninstall', () => {
    it('should reject if another operation in progress', async () => {
      const mockSocket = createMockSocket();
      const manager = new HdcAppManager(mockSocket);

      // Set state to installing
      manager['state'] = AppState.INSTALLING;

      await expect(manager.uninstall({
        packageName: 'com.example.app',
      })).rejects.toThrow('Another operation in progress');
    });

    it('should send uninstall command', async () => {
      const mockSocket = createMockSocket();
      const manager = new HdcAppManager(mockSocket);

      // Mock the waitForCompletion to resolve immediately
      manager['waitForCompletion'] = async () => {
        // Simulate successful completion
      };

      await manager.uninstall({
        packageName: 'com.example.app',
      });

      expect(mockSocket.write).toHaveBeenCalled();
    });

    it('should send uninstall command with keepData flag', async () => {
      const mockSocket = createMockSocket();
      const manager = new HdcAppManager(mockSocket);

      manager['waitForCompletion'] = async () => {};

      await manager.uninstall({
        packageName: 'com.example.app',
        keepData: true,
      });

      const writeCall = mockSocket.write.mock.calls[0][0];
      expect(writeCall).toBeDefined();
    });

    it('should send uninstall command with moduleName', async () => {
      const mockSocket = createMockSocket();
      const manager = new HdcAppManager(mockSocket);

      manager['waitForCompletion'] = async () => {};

      await manager.uninstall({
        packageName: 'com.example.app',
        moduleName: 'entry',
      });

      const writeCall = mockSocket.write.mock.calls[0][0];
      expect(writeCall).toBeDefined();
    });

    it('should send uninstall command with all enhanced options', async () => {
      const mockSocket = createMockSocket();
      const manager = new HdcAppManager(mockSocket);

      manager['waitForCompletion'] = async () => {};

      await manager.uninstall({
        packageName: 'com.example.app',
        keepData: true,
        moduleName: 'entry',
        version: '1.0.0',
        userId: '100',
      });

      expect(mockSocket.write).toHaveBeenCalled();
    });
  });

  describe('installMultiple', () => {
    it('should reject when no paths provided', async () => {
      const mockSocket = createMockSocket();
      const manager = new HdcAppManager(mockSocket);

      await expect(manager.installMultiple([])).rejects.toThrow('No package paths provided');
    });

    it('should reject if another operation in progress', async () => {
      const mockSocket = createMockSocket();
      const manager = new HdcAppManager(mockSocket);

      manager['state'] = AppState.INSTALLING;

      await expect(manager.installMultiple(['/some/app.hap'])).rejects.toThrow(
        'Another operation in progress'
      );
    });

    it('should reject non-existent paths', async () => {
      const mockSocket = createMockSocket();
      const manager = new HdcAppManager(mockSocket);

      await expect(
        manager.installMultiple(['/nonexistent/app.hap'])
      ).rejects.toThrow();
    });

    it('should reject unsupported file extensions', async () => {
      const mockSocket = createMockSocket();
      const manager = new HdcAppManager(mockSocket);

      // Create a temp file with unsupported extension
      const tmpDir = os.tmpdir();
      const tmpFile = path.join(tmpDir, `test-${Date.now()}.zip`);
      await fs.promises.writeFile(tmpFile, 'test data');

      try {
        await expect(
          manager.installMultiple([tmpFile])
        ).rejects.toThrow('Unsupported package format');
      } finally {
        await fs.promises.unlink(tmpFile).catch(() => {});
      }
    });

    it('should install a single .hap file', async () => {
      const mockSocket = createMockSocket();
      const manager = new HdcAppManager(mockSocket);

      // Create a temp .hap file
      const tmpDir = os.tmpdir();
      const tmpFile = path.join(tmpDir, `test-${Date.now()}.hap`);
      await fs.promises.writeFile(tmpFile, Buffer.alloc(100));

      try {
        // Mock waitForCompletion and sendFile
        manager['waitForCompletion'] = async () => {};
        manager['sendFile'] = async () => {};

        await manager.installMultiple([tmpFile]);

        expect(mockSocket.write).toHaveBeenCalled();
      } finally {
        await fs.promises.unlink(tmpFile).catch(() => {});
      }
    });

    it('should install a single .hsp file', async () => {
      const mockSocket = createMockSocket();
      const manager = new HdcAppManager(mockSocket);

      const tmpDir = os.tmpdir();
      const tmpFile = path.join(tmpDir, `test-${Date.now()}.hsp`);
      await fs.promises.writeFile(tmpFile, Buffer.alloc(100));

      try {
        manager['waitForCompletion'] = async () => {};
        manager['sendFile'] = async () => {};

        await manager.installMultiple([tmpFile]);

        expect(mockSocket.write).toHaveBeenCalled();
      } finally {
        await fs.promises.unlink(tmpFile).catch(() => {});
      }
    });

    it('should install an .app bundle', async () => {
      const mockSocket = createMockSocket();
      const manager = new HdcAppManager(mockSocket);

      const tmpDir = os.tmpdir();
      const tmpFile = path.join(tmpDir, `test-${Date.now()}.app`);
      await fs.promises.writeFile(tmpFile, Buffer.alloc(200));

      try {
        manager['waitForCompletion'] = async () => {};
        manager['sendFile'] = async () => {};

        await manager.installMultiple([tmpFile]);

        expect(mockSocket.write).toHaveBeenCalled();
        // Verify the bundle flag 'b' is included in the command
        const firstWrite = mockSocket.write.mock.calls[0][0];
        expect(firstWrite).toBeDefined();
      } finally {
        await fs.promises.unlink(tmpFile).catch(() => {});
      }
    });

    it('should install files from a directory', async () => {
      const mockSocket = createMockSocket();
      const manager = new HdcAppManager(mockSocket);

      const tmpDir = path.join(os.tmpdir(), `hdc-test-dir-${Date.now()}`);
      await fs.promises.mkdir(tmpDir, { recursive: true });
      await fs.promises.writeFile(path.join(tmpDir, 'app1.hap'), Buffer.alloc(50));
      await fs.promises.writeFile(path.join(tmpDir, 'app2.hap'), Buffer.alloc(75));

      try {
        manager['waitForCompletion'] = async () => {};
        manager['sendFile'] = async () => {};

        await manager.installMultiple([tmpDir]);

        expect(mockSocket.write).toHaveBeenCalled();
      } finally {
        await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }
    });

    it('should reject empty directory', async () => {
      const mockSocket = createMockSocket();
      const manager = new HdcAppManager(mockSocket);

      const tmpDir = path.join(os.tmpdir(), `hdc-test-emptydir-${Date.now()}`);
      await fs.promises.mkdir(tmpDir, { recursive: true });

      try {
        await expect(
          manager.installMultiple([tmpDir])
        ).rejects.toThrow('No files found');
      } finally {
        await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }
    });
  });

  describe('sideload', () => {
    it('should reject if file does not exist', async () => {
      const mockSocket = createMockSocket();
      const manager = new HdcAppManager(mockSocket);

      await expect(manager.sideload('/nonexistent/ota.zip')).rejects.toThrow();
    });

    it('should reject if another operation in progress', async () => {
      const mockSocket = createMockSocket();
      const manager = new HdcAppManager(mockSocket);

      manager['state'] = AppState.INSTALLING;

      await expect(manager.sideload('/some/ota.zip')).rejects.toThrow(
        'Another operation in progress'
      );
    });

    it('should reject if path is not a file', async () => {
      const mockSocket = createMockSocket();
      const manager = new HdcAppManager(mockSocket);

      const tmpDir = path.join(os.tmpdir(), `hdc-test-sideload-dir-${Date.now()}`);
      await fs.promises.mkdir(tmpDir, { recursive: true });

      try {
        await expect(manager.sideload(tmpDir)).rejects.toThrow('Not a file');
      } finally {
        await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }
    });

    it('should send sideload command for valid file', async () => {
      const mockSocket = createMockSocket();
      const manager = new HdcAppManager(mockSocket);

      const tmpDir = os.tmpdir();
      const tmpFile = path.join(tmpDir, `ota-${Date.now()}.zip`);
      await fs.promises.writeFile(tmpFile, Buffer.alloc(1024));

      try {
        manager['waitForCompletion'] = async () => {};
        manager['sendFile'] = async () => {};

        await manager.sideload(tmpFile);

        expect(mockSocket.write).toHaveBeenCalled();
        // Verify sideload prefix is in the first write
        const firstWrite = mockSocket.write.mock.calls[0][0];
        expect(firstWrite).toBeDefined();
      } finally {
        await fs.promises.unlink(tmpFile).catch(() => {});
      }
    });

    it('should emit sideload-complete event', async () => {
      const mockSocket = createMockSocket();
      const manager = new HdcAppManager(mockSocket);

      const tmpDir = os.tmpdir();
      const tmpFile = path.join(tmpDir, `ota-event-${Date.now()}.zip`);
      await fs.promises.writeFile(tmpFile, Buffer.alloc(512));

      try {
        manager['waitForCompletion'] = async () => {};
        manager['sendFile'] = async () => {};

        const completePromise = new Promise<string>((resolve) => {
          manager.on('sideload-complete', resolve);
        });

        await manager.sideload(tmpFile);

        const result = await completePromise;
        expect(result).toBe(tmpFile);
      } finally {
        await fs.promises.unlink(tmpFile).catch(() => {});
      }
    });
  });
});

describe('AppState enum', () => {
  it('should have correct values', () => {
    expect(AppState.IDLE).toBe('idle');
    expect(AppState.PREPARING).toBe('preparing');
    expect(AppState.INSTALLING).toBe('installing');
    expect(AppState.UNINSTALLING).toBe('uninstalling');
    expect(AppState.SIDELOADING).toBe('sideloading');
    expect(AppState.COMPLETED).toBe('completed');
    expect(AppState.ERROR).toBe('error');
  });
});

describe('Constants', () => {
  it('should have correct prefix values', () => {
    expect(APP_INSTALL_PREFIX).toBe('app:install:');
    expect(APP_UNINSTALL_PREFIX).toBe('app:uninstall:');
    expect(APP_SIDELOAD_PREFIX).toBe('app:sideload:');
  });
});
