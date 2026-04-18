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
  parseFileTransferFlags,
  flagsToOptions,
  DEFAULT_CHUNK_SIZE,
  HIGH_SPEED_CHUNK_SIZE,
  FILE_SEND_PREFIX,
  FILE_RECV_PREFIX,
  FileTransferFlags,
} from './file.js';
import {
  TransferConfig,
  encodeTransferConfig,
  decodeTransferConfig,
} from '../common/transfer.js';
import {
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

    it('should use HIGH_SPEED_CHUNK_SIZE when serverHugeBuffer is true', () => {
      const mockSocket = createMockSocket();
      const transfer = new HdcFileTransfer(
        mockSocket,
        '/local/file.txt',
        '/remote/file.txt',
        { serverHugeBuffer: true }
      );

      expect(transfer['options'].chunkSize).toBe(HIGH_SPEED_CHUNK_SIZE);
    });

    it('should use DEFAULT_CHUNK_SIZE when serverHugeBuffer is false', () => {
      const mockSocket = createMockSocket();
      const transfer = new HdcFileTransfer(
        mockSocket,
        '/local/file.txt',
        '/remote/file.txt',
        { serverHugeBuffer: false }
      );

      expect(transfer['options'].chunkSize).toBe(DEFAULT_CHUNK_SIZE);
    });

    it('should accept updateIfNew option', () => {
      const mockSocket = createMockSocket();
      const transfer = new HdcFileTransfer(
        mockSocket,
        '/local/file.txt',
        '/remote/file.txt',
        { updateIfNew: true }
      );

      expect(transfer['options'].updateIfNew).toBe(true);
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

  describe('start', () => {
    it('should send TransferConfig before file data', async () => {
      const mockSocket = createMockSocket();
      const sender = new HdcFileSender(mockSocket, testFile, '/remote/test.txt');

      // Start the send (this writes to socket)
      const startPromise = sender.start();

      // The sender is waiting for the file stream to end, but since it's
      // a real file with content, let the event loop run briefly
      await new Promise(resolve => setTimeout(resolve, 50));

      // Verify socket.write was called (at least for config packet + data packets)
      expect(mockSocket.write).toHaveBeenCalled();

      // First write should contain the TransferConfig
      const firstWrite = mockSocket.write.mock.calls[0][0] as Buffer;
      expect(firstWrite).toBeInstanceOf(Buffer);
      expect(firstWrite.length).toBeGreaterThan(0);
    });

    it('should reject for non-existent file', async () => {
      const mockSocket = createMockSocket();
      const sender = new HdcFileSender(mockSocket, '/nonexistent/file.txt', '/remote/file.txt');

      await expect(sender.start()).rejects.toThrow();
    });

    it('should reject for directory path', async () => {
      const mockSocket = createMockSocket();
      const sender = new HdcFileSender(mockSocket, tempDir, '/remote/dir');

      await expect(sender.start()).rejects.toThrow('Not a file');
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
      expect(info.atime).toBeInstanceOf(Date);
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
    expect(HIGH_SPEED_CHUNK_SIZE).toBe(512 * 1024);
    expect(FILE_SEND_PREFIX).toBe('file:send:');
    expect(FILE_RECV_PREFIX).toBe('file:recv:');
  });
});

describe('parseFileTransferFlags', () => {
  it('should parse all flags', () => {
    const { flags, remaining } = parseFileTransferFlags(['-a', '-z', '-sync', '-m', '/local', '/remote']);

    expect(flags.holdTimestamp).toBe(true);
    expect(flags.compress).toBe(true);
    expect(flags.updateIfNew).toBe(true);
    expect(flags.directoryMode).toBe(true);
    expect(remaining).toEqual(['/local', '/remote']);
  });

  it('should parse no flags', () => {
    const { flags, remaining } = parseFileTransferFlags(['/local', '/remote']);

    expect(flags.holdTimestamp).toBe(false);
    expect(flags.compress).toBe(false);
    expect(flags.updateIfNew).toBe(false);
    expect(flags.directoryMode).toBe(false);
    expect(remaining).toEqual(['/local', '/remote']);
  });

  it('should parse individual flags', () => {
    const result1 = parseFileTransferFlags(['-a', '/src', '/dst']);
    expect(result1.flags.holdTimestamp).toBe(true);
    expect(result1.flags.compress).toBe(false);

    const result2 = parseFileTransferFlags(['-z', '/src', '/dst']);
    expect(result2.flags.holdTimestamp).toBe(false);
    expect(result2.flags.compress).toBe(true);

    const result3 = parseFileTransferFlags(['-sync', '/src', '/dst']);
    expect(result3.flags.updateIfNew).toBe(true);

    const result4 = parseFileTransferFlags(['-m', '/src', '/dst']);
    expect(result4.flags.directoryMode).toBe(true);
  });
});

describe('flagsToOptions', () => {
  it('should convert flags to TransferOptions', () => {
    const flags: FileTransferFlags = {
      holdTimestamp: true,
      compress: true,
      updateIfNew: true,
      directoryMode: false,
    };

    const options = flagsToOptions(flags);

    expect(options.preserveTimestamp).toBe(true);
    expect(options.compress).toBe(true);
    expect(options.updateIfNew).toBe(true);
  });

  it('should handle all-false flags', () => {
    const flags: FileTransferFlags = {
      holdTimestamp: false,
      compress: false,
      updateIfNew: false,
      directoryMode: false,
    };

    const options = flagsToOptions(flags);

    expect(options.preserveTimestamp).toBe(false);
    expect(options.compress).toBe(false);
    expect(options.updateIfNew).toBe(false);
  });
});

describe('TransferConfig integration', () => {
  it('should encode/decode config from file stats', async () => {
    const tempDir2 = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'hdc-cfg-'));
    const testFile = path.join(tempDir2, 'config_test.txt');
    await fs.promises.writeFile(testFile, 'Test content for config');

    const stats = await fs.promises.stat(testFile);

    const config: TransferConfig = {
      fileSize: stats.size,
      atime: Math.floor(stats.atimeMs / 1000),
      mtime: Math.floor(stats.mtimeMs / 1000),
      options: '',
      path: '/remote/config_test.txt',
      optionalName: 'config_test.txt',
      updateIfNew: false,
      compressType: 0,
      holdTimestamp: true,
      functionName: 'send',
      clientCwd: process.cwd(),
      reserve1: '',
      reserve2: '',
    };

    const encoded = encodeTransferConfig(config);
    const decoded = decodeTransferConfig(encoded);

    expect(decoded.fileSize).toBe(stats.size);
    expect(decoded.path).toBe('/remote/config_test.txt');
    expect(decoded.optionalName).toBe('config_test.txt');
    expect(decoded.holdTimestamp).toBe(true);
    expect(decoded.functionName).toBe('send');

    await fs.promises.rm(tempDir2, { recursive: true, force: true });
  });
});

describe('TransferPayload in file context', () => {
  it('should create valid chunk headers', () => {
    const chunkSize = 65536;
    for (let i = 0; i < 5; i++) {
      const header = encodeTransferPayload({
        index: i,
        compressType: 0,
        compressSize: chunkSize,
        uncompressSize: chunkSize,
      });

      expect(header.length).toBe(TRANSFER_PAYLOAD_SIZE);

      const decoded = decodeTransferPayload(header);
      expect(decoded).not.toBeNull();
      expect(decoded!.index).toBe(i);
      expect(decoded!.compressSize).toBe(chunkSize);
    }
  });
});

describe('TAR headers for directory transfer', () => {
  it('should create valid file TAR header', () => {
    const hdr: TarHeader = {
      filename: 'subdir/myfile.txt',
      fileSize: 1024,
      mtime: 1700000000,
      typeFlag: '0',
      prefix: '',
    };

    const encoded = encodeTarHeader(hdr);
    expect(encoded.length).toBe(TAR_HEADER_SIZE);

    const decoded = decodeTarHeader(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded!.filename).toBe('subdir/myfile.txt');
    expect(decoded!.fileSize).toBe(1024);
    expect(decoded!.typeFlag).toBe('0');
  });

  it('should create valid directory TAR header', () => {
    const hdr: TarHeader = {
      filename: 'mydir/',
      fileSize: 0,
      mtime: 1700000000,
      typeFlag: '5',
      prefix: '',
    };

    const encoded = encodeTarHeader(hdr);
    const decoded = decodeTarHeader(encoded);

    expect(decoded).not.toBeNull();
    expect(decoded!.filename).toBe('mydir/');
    expect(decoded!.fileSize).toBe(0);
    expect(decoded!.typeFlag).toBe('5');
  });
});
