/**
 * Tests for File Transfer module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  HdcFileTransfer,
  HdcFileSender,
  HdcFileReceiver,
  TransferState,
  sendFile,
  receiveFile,
  getFileInfo,
  listFiles,
  DEFAULT_CHUNK_SIZE,
  FILE_SEND_PREFIX,
  FILE_RECV_PREFIX,
} from './file.js';

// Mock socket factory
function createMockSocket() {
  const handlers: Map<string, Function[]> = new Map();

  return {
    write: vi.fn(),
    on: vi.fn((event: string, handler: Function) => {
      if (!handlers.has(event)) {
        handlers.set(event, []);
      }
      handlers.get(event)?.push(handler);
    }),
    off: vi.fn((event: string, handler: Function) => {
      const eventHandlers = handlers.get(event);
      if (eventHandlers) {
        const index = eventHandlers.indexOf(handler);
        if (index > -1) {
          eventHandlers.splice(index, 1);
        }
      }
    }),
    once: vi.fn(),
    emit: vi.fn((event: string, ...args: any[]) => {
      const eventHandlers = handlers.get(event);
      if (eventHandlers) {
        eventHandlers.forEach(h => h(...args));
      }
    }),
    destroy: vi.fn(),
    _handlers: handlers,
  } as any;
}

describe('HdcFileTransfer', () => {
  describe('constructor', () => {
    it('should create transfer instance', () => {
      const mockSocket = createMockSocket();
      const transfer = new HdcFileTransfer(
        mockSocket,
        '/local/file.txt',
        '/remote/file.txt'
      );

      expect(transfer.getState()).toBe(TransferState.IDLE);
      expect(transfer.getBytesTransferred()).toBe(0);
      expect(transfer.getTotalBytes()).toBe(0);
    });

    it('should accept custom options', () => {
      const mockSocket = createMockSocket();
      const transfer = new HdcFileTransfer(
        mockSocket,
        '/local/file.txt',
        '/remote/file.txt',
        {
          chunkSize: 128 * 1024,
          preserveTimestamp: true,
          compress: true,
        }
      );

      expect(transfer['options'].chunkSize).toBe(128 * 1024);
      expect(transfer['options'].preserveTimestamp).toBe(true);
      expect(transfer['options'].compress).toBe(true);
    });
  });

  describe('getPercentage', () => {
    it('should return 0 when total is 0', () => {
      const mockSocket = createMockSocket();
      const transfer = new HdcFileTransfer(mockSocket, '/local', '/remote');
      expect(transfer.getPercentage()).toBe(0);
    });

    it('should calculate percentage correctly', () => {
      const mockSocket = createMockSocket();
      const transfer = new HdcFileTransfer(mockSocket, '/local', '/remote');
      transfer['totalBytes'] = 1000;
      transfer['bytesTransferred'] = 500;
      expect(transfer.getPercentage()).toBe(50);
    });
  });

  describe('getSpeed', () => {
    it('should return 0 when no time elapsed', () => {
      const mockSocket = createMockSocket();
      const transfer = new HdcFileTransfer(mockSocket, '/local', '/remote');
      transfer['startTime'] = Date.now();
      expect(transfer.getSpeed()).toBe(0);
    });
  });

  describe('getETA', () => {
    it('should return 0 when speed is 0', () => {
      const mockSocket = createMockSocket();
      const transfer = new HdcFileTransfer(mockSocket, '/local', '/remote');
      expect(transfer.getETA()).toBe(0);
    });
  });

  describe('getProgress', () => {
    it('should return progress info', () => {
      const mockSocket = createMockSocket();
      const transfer = new HdcFileTransfer(mockSocket, '/local', '/remote');
      transfer['totalBytes'] = 1000;
      transfer['bytesTransferred'] = 500;
      transfer['startTime'] = Date.now() - 1000;

      const progress = transfer.getProgress();

      expect(progress.bytesTransferred).toBe(500);
      expect(progress.totalBytes).toBe(1000);
      expect(progress.percentage).toBe(50);
      expect(progress.speed).toBeDefined();
      expect(progress.eta).toBeDefined();
    });
  });

  describe('cancel', () => {
    it('should cancel transfer when transferring', () => {
      const mockSocket = createMockSocket();
      const transfer = new HdcFileTransfer(mockSocket, '/local', '/remote');
      transfer['state'] = TransferState.TRANSFERRING;

      transfer.cancel();

      expect(transfer.getState()).toBe(TransferState.CANCELLED);
    });

    it('should not cancel when not transferring', () => {
      const mockSocket = createMockSocket();
      const transfer = new HdcFileTransfer(mockSocket, '/local', '/remote');

      transfer.cancel();

      expect(transfer.getState()).toBe(TransferState.IDLE);
    });
  });
});

describe('HdcFileSender', () => {
  let tempDir: string;
  let testFile: string;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'hdc-test-'));
    testFile = path.join(tempDir, 'test.txt');
    await fs.promises.writeFile(testFile, 'Hello, World!');
  });

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  describe('constructor', () => {
    it('should create sender instance', () => {
      const mockSocket = createMockSocket();
      const sender = new HdcFileSender(mockSocket, testFile, '/remote/test.txt');

      expect(sender.getState()).toBe(TransferState.IDLE);
    });
  });
});

describe('HdcFileReceiver', () => {
  let tempDir: string;
  let localFile: string;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'hdc-test-'));
    localFile = path.join(tempDir, 'received.txt');
  });

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  describe('constructor', () => {
    it('should create receiver instance', () => {
      const mockSocket = createMockSocket();
      const receiver = new HdcFileReceiver(mockSocket, localFile, '/remote/test.txt');

      expect(receiver.getState()).toBe(TransferState.IDLE);
    });
  });
});

describe('Helper functions', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'hdc-test-'));
  });

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  describe('getFileInfo', () => {
    it('should return file info', async () => {
      const testFile = path.join(tempDir, 'test.txt');
      await fs.promises.writeFile(testFile, 'Hello');

      const info = await getFileInfo(testFile);

      expect(info.path).toBe(testFile);
      expect(info.size).toBe(5);
      expect(info.isDirectory).toBe(false);
      expect(info.mtime).toBeInstanceOf(Date);
    });
  });

  describe('listFiles', () => {
    it('should list files recursively', async () => {
      await fs.promises.writeFile(path.join(tempDir, 'file1.txt'), '1');
      await fs.promises.mkdir(path.join(tempDir, 'subdir'));
      await fs.promises.writeFile(path.join(tempDir, 'subdir', 'file2.txt'), '2');

      const files = listFiles(tempDir);

      expect(files.length).toBe(2);
      expect(files.some(f => f.endsWith('file1.txt'))).toBe(true);
      expect(files.some(f => f.endsWith('file2.txt'))).toBe(true);
    });

    it('should return empty array for empty directory', () => {
      const files = listFiles(tempDir);
      expect(files.length).toBe(0);
    });
  });
});

describe('TransferState enum', () => {
  it('should have correct values', () => {
    expect(TransferState.IDLE).toBe('idle');
    expect(TransferState.PREPARING).toBe('preparing');
    expect(TransferState.TRANSFERRING).toBe('transferring');
    expect(TransferState.COMPLETED).toBe('completed');
    expect(TransferState.ERROR).toBe('error');
    expect(TransferState.CANCELLED).toBe('cancelled');
  });
});

describe('Constants', () => {
  it('should have correct values', () => {
    expect(DEFAULT_CHUNK_SIZE).toBe(64 * 1024);
    expect(FILE_SEND_PREFIX).toBe('file:send:');
    expect(FILE_RECV_PREFIX).toBe('file:recv:');
  });
});
