/**
 * Tests for Flashd Update module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  HdcFlashd,
  FlashdState,
  FlashdProgress,
  DEFAULT_CHUNK_SIZE,
  FLASHD_FINISH,
  FLASHD_ERROR,
} from './host_updater.js';
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
import { CommandId } from '../common/protocol.js';
import { parsePacket } from '../common/message.js';
import {
  updateFirmware,
  flashPartition,
  erasePartition,
  formatPartition,
  string2FormatCommand,
  createFormatCommand,
  FormatCommand,
} from './translate.js';
import { CommandFlag } from '../index.js';

// Mock socket factory
function createMockSocket() {
  const handlers: Map<string, Function[]> = new Map();
  const writtenBuffers: Buffer[] = [];

  return {
    write: vi.fn((data: Buffer) => {
      writtenBuffers.push(data);
    }),
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
    _writtenBuffers: writtenBuffers,
  } as any;
}

// Helper to extract commandFlag from a written packet
function extractCommandFlag(buf: Buffer): number {
  const parsed = parsePacket(buf);
  if (!parsed) return -1;
  return parsed.protect.commandFlag;
}

// ============================================================================
// HdcFlashd tests
// ============================================================================

describe('HdcFlashd', () => {
  let mockSocket: ReturnType<typeof createMockSocket>;
  let flashd: HdcFlashd;

  beforeEach(() => {
    mockSocket = createMockSocket();
    flashd = new HdcFlashd(mockSocket);
  });

  describe('constructor and state management', () => {
    it('should initialize with IDLE state', () => {
      expect(flashd.getState()).toBe(FlashdState.IDLE);
    });

    it('should return initial progress', () => {
      const progress = flashd.getProgress();
      expect(progress.bytesTransferred).toBe(0);
      expect(progress.totalBytes).toBe(0);
      expect(progress.percentage).toBe(0);
      expect(progress.partition).toBeUndefined();
    });

    it('should reset state to IDLE', async () => {
      const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'hdc-flashd-'));
      const testFile = path.join(tempDir, 'test.img');
      await fs.promises.writeFile(testFile, 'x'.repeat(100));

      try {
        await flashd.update(testFile);
        expect(flashd.getState()).toBe(FlashdState.COMPLETED);

        flashd.reset();
        expect(flashd.getState()).toBe(FlashdState.IDLE);
        expect(flashd.getProgress().bytesTransferred).toBe(0);
        expect(flashd.getProgress().totalBytes).toBe(0);
      } finally {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('update', () => {
    let tempDir: string;
    let testPkg: string;

    beforeEach(async () => {
      tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'hdc-flashd-'));
      testPkg = path.join(tempDir, 'update.zip');
      await fs.promises.writeFile(testPkg, 'x'.repeat(256));
    });

    afterEach(async () => {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    });

    it('should send correct command sequence for update', async () => {
      await flashd.update(testPkg);

      // Verify completed
      expect(flashd.getState()).toBe(FlashdState.COMPLETED);

      // Verify socket writes happened
      const writes = mockSocket._writtenBuffers as Buffer[];
      expect(writes.length).toBeGreaterThan(0);

      // First write: CMD_FLASHD_UPDATE_INIT
      const initCmd = extractCommandFlag(writes[0]);
      expect(initCmd).toBe(CommandId.CMD_FLASHD_UPDATE_INIT);

      // Second write: CMD_FLASHD_CHECK
      const checkCmd = extractCommandFlag(writes[1]);
      expect(checkCmd).toBe(CommandId.CMD_FLASHD_CHECK);

      // Third write: CMD_FLASHD_BEGIN
      const beginCmd = extractCommandFlag(writes[2]);
      expect(beginCmd).toBe(CommandId.CMD_FLASHD_BEGIN);

      // Data packets: CMD_FLASHD_DATA
      const dataCmd = extractCommandFlag(writes[3]);
      expect(dataCmd).toBe(CommandId.CMD_FLASHD_DATA);

      // Last write: CMD_FLASHD_FINISH
      const finishCmd = extractCommandFlag(writes[writes.length - 1]);
      expect(finishCmd).toBe(CommandId.CMD_FLASHD_FINISH);
    });

    it('should reject non-existent package', async () => {
      await expect(flashd.update('/nonexistent/package.zip')).rejects.toThrow();
      expect(flashd.getState()).toBe(FlashdState.ERROR);
    });

    it('should reject when not IDLE', async () => {
      // Set state to non-IDLE
      flashd['state'] = FlashdState.TRANSFERRING;
      await expect(flashd.update(testPkg)).rejects.toThrow('already in progress');
    });

    it('should track progress during update', async () => {
      const progressEvents: FlashdProgress[] = [];
      flashd.on('progress', (p: FlashdProgress) => progressEvents.push(p));

      await flashd.update(testPkg);

      expect(progressEvents.length).toBeGreaterThan(0);
      const lastProgress = progressEvents[progressEvents.length - 1];
      expect(lastProgress.bytesTransferred).toBe(256);
      expect(lastProgress.totalBytes).toBe(256);
      expect(lastProgress.percentage).toBe(100);
    });

    it('should emit start and complete events', async () => {
      let started = false;
      let completed = false;
      flashd.on('start', () => { started = true; });
      flashd.on('complete', () => { completed = true; });

      await flashd.update(testPkg);

      expect(started).toBe(true);
      expect(completed).toBe(true);
    });

    it('should send TransferConfig with update function name', async () => {
      await flashd.update(testPkg);

      const writes = mockSocket._writtenBuffers as Buffer[];
      const initPacket = parsePacket(writes[0]);
      expect(initPacket).not.toBeNull();

      const config = decodeTransferConfig(initPacket!.payload);
      expect(config.functionName).toBe('update');
      expect(config.fileSize).toBe(256);
    });
  });

  describe('flash', () => {
    let tempDir: string;
    let testImg: string;

    beforeEach(async () => {
      tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'hdc-flashd-'));
      testImg = path.join(tempDir, 'boot.img');
      await fs.promises.writeFile(testImg, 'x'.repeat(512));
    });

    afterEach(async () => {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    });

    it('should send image data with TransferPayload headers', async () => {
      await flashd.flash('boot', testImg);

      const writes = mockSocket._writtenBuffers as Buffer[];
      expect(writes.length).toBeGreaterThan(0);

      // First write: CMD_FLASHD_FLASH_INIT
      const initCmd = extractCommandFlag(writes[0]);
      expect(initCmd).toBe(CommandId.CMD_FLASHD_FLASH_INIT);

      // Second write: CMD_FLASHD_CHECK
      const checkCmd = extractCommandFlag(writes[1]);
      expect(checkCmd).toBe(CommandId.CMD_FLASHD_CHECK);

      // Third write: CMD_FLASHD_BEGIN
      const beginCmd = extractCommandFlag(writes[2]);
      expect(beginCmd).toBe(CommandId.CMD_FLASHD_BEGIN);

      // Data packets: CMD_FLASHD_DATA with TransferPayload header
      const dataPacket = parsePacket(writes[3]);
      expect(dataPacket).not.toBeNull();
      expect(dataPacket!.protect.commandFlag).toBe(CommandId.CMD_FLASHD_DATA);

      // Verify TransferPayload header at start of payload
      const payload = dataPacket!.payload;
      expect(payload.length).toBeGreaterThanOrEqual(TRANSFER_PAYLOAD_SIZE);
      const tpHeader = decodeTransferPayload(payload);
      expect(tpHeader).not.toBeNull();
      expect(tpHeader!.index).toBe(0);
      expect(tpHeader!.uncompressSize).toBeGreaterThan(0);

      // Last write: CMD_FLASHD_FINISH
      const finishCmd = extractCommandFlag(writes[writes.length - 1]);
      expect(finishCmd).toBe(CommandId.CMD_FLASHD_FINISH);
    });

    it('should send TransferConfig with partition info', async () => {
      await flashd.flash('system', testImg);

      const writes = mockSocket._writtenBuffers as Buffer[];
      const initPacket = parsePacket(writes[0]);
      expect(initPacket).not.toBeNull();

      const config = decodeTransferConfig(initPacket!.payload);
      expect(config.functionName).toBe('flash');
      expect(config.optionalName).toBe('system');
      expect(config.fileSize).toBe(512);
    });

    it('should track partition in progress', async () => {
      await flashd.flash('vendor', testImg);

      const progress = flashd.getProgress();
      expect(progress.partition).toBe('vendor');
    });

    it('should reject non-existent image', async () => {
      await expect(flashd.flash('boot', '/nonexistent/boot.img')).rejects.toThrow();
      expect(flashd.getState()).toBe(FlashdState.ERROR);
    });
  });

  describe('erase', () => {
    it('should send init + finish (no data)', async () => {
      await flashd.erase('cache');

      const writes = mockSocket._writtenBuffers as Buffer[];
      expect(writes.length).toBe(2);

      // First write: CMD_FLASHD_ERASE
      const eraseCmd = extractCommandFlag(writes[0]);
      expect(eraseCmd).toBe(CommandId.CMD_FLASHD_ERASE);

      // Second write: CMD_FLASHD_FINISH
      const finishCmd = extractCommandFlag(writes[1]);
      expect(finishCmd).toBe(CommandId.CMD_FLASHD_FINISH);

      expect(flashd.getState()).toBe(FlashdState.COMPLETED);
    });

    it('should send TransferConfig with erase function name', async () => {
      await flashd.erase('userdata');

      const writes = mockSocket._writtenBuffers as Buffer[];
      const erasePacket = parsePacket(writes[0]);
      expect(erasePacket).not.toBeNull();

      const config = decodeTransferConfig(erasePacket!.payload);
      expect(config.functionName).toBe('erase');
      expect(config.optionalName).toBe('userdata');
      expect(config.fileSize).toBe(0);
    });

    it('should track partition in progress', async () => {
      await flashd.erase('cache');

      const progress = flashd.getProgress();
      expect(progress.partition).toBe('cache');
    });
  });

  describe('format', () => {
    it('should send init + finish (no data)', async () => {
      await flashd.format('data');

      const writes = mockSocket._writtenBuffers as Buffer[];
      expect(writes.length).toBe(2);

      // First write: CMD_FLASHD_FORMAT
      const formatCmd = extractCommandFlag(writes[0]);
      expect(formatCmd).toBe(CommandId.CMD_FLASHD_FORMAT);

      // Second write: CMD_FLASHD_FINISH
      const finishCmd = extractCommandFlag(writes[1]);
      expect(finishCmd).toBe(CommandId.CMD_FLASHD_FINISH);

      expect(flashd.getState()).toBe(FlashdState.COMPLETED);
    });

    it('should send TransferConfig with format function name', async () => {
      await flashd.format('misc');

      const writes = mockSocket._writtenBuffers as Buffer[];
      const formatPacket = parsePacket(writes[0]);
      expect(formatPacket).not.toBeNull();

      const config = decodeTransferConfig(formatPacket!.payload);
      expect(config.functionName).toBe('format');
      expect(config.optionalName).toBe('misc');
      expect(config.fileSize).toBe(0);
    });

    it('should track partition in progress', async () => {
      await flashd.format('data');

      const progress = flashd.getProgress();
      expect(progress.partition).toBe('data');
    });
  });

  describe('progress tracking', () => {
    it('should calculate percentage correctly', async () => {
      const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'hdc-flashd-'));
      const testFile = path.join(tempDir, 'test.img');
      await fs.promises.writeFile(testFile, 'x'.repeat(1000));

      try {
        await flashd.flash('test', testFile);

        const progress = flashd.getProgress();
        expect(progress.bytesTransferred).toBe(1000);
        expect(progress.totalBytes).toBe(1000);
        expect(progress.percentage).toBe(100);
      } finally {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      }
    });

    it('should return 0 percentage when totalBytes is 0', () => {
      const progress = flashd.getProgress();
      expect(progress.percentage).toBe(0);
    });
  });

  describe('error handling', () => {
    it('should emit error event on failure', async () => {
      let errorEmitted = false;
      flashd.on('error', () => { errorEmitted = true; });

      await expect(flashd.update('/nonexistent/path')).rejects.toThrow();
      expect(errorEmitted).toBe(true);
      expect(flashd.getState()).toBe(FlashdState.ERROR);
    });
  });
});

// ============================================================================
// Translate.ts parsing for flashd commands
// ============================================================================

describe('TranslateCommand UpdateFirmware', () => {
  let cmd: FormatCommand;

  beforeEach(() => {
    cmd = createFormatCommand();
  });

  it('should parse update with package path', () => {
    cmd.parameters = '/path/to/update.zip';
    const result = updateFirmware(cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_FLASHD_UPDATE_INIT);
    expect(cmd.bJumpDo).toBe(false);
    expect(cmd.parameters).toBe('/path/to/update.zip');
  });

  it('should reject update without package path', () => {
    cmd.parameters = '';
    const result = updateFirmware(cmd);

    expect(cmd.bJumpDo).toBe(true);
    expect(result).toContain('Incorrect update command');
  });
});

describe('TranslateCommand FlashPartition', () => {
  let cmd: FormatCommand;

  beforeEach(() => {
    cmd = createFormatCommand();
  });

  it('should parse flash with partition and image', () => {
    cmd.parameters = 'boot /path/to/boot.img';
    const result = flashPartition(cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_FLASHD_FLASH_INIT);
    expect(cmd.bJumpDo).toBe(false);
    expect(cmd.parameters).toContain('boot');
    expect(cmd.parameters).toContain('/path/to/boot.img');
  });

  it('should parse flash with -f flag', () => {
    cmd.parameters = '-f system /path/to/system.img';
    const result = flashPartition(cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_FLASHD_FLASH_INIT);
    expect(cmd.bJumpDo).toBe(false);
    expect(cmd.parameters).toContain('-f');
  });

  it('should reject flash without enough arguments', () => {
    cmd.parameters = 'boot';
    const result = flashPartition(cmd);

    expect(cmd.bJumpDo).toBe(true);
    expect(result).toContain('Incorrect flash command');
  });

  it('should reject flash with no arguments', () => {
    cmd.parameters = '';
    const result = flashPartition(cmd);

    expect(cmd.bJumpDo).toBe(true);
    expect(result).toContain('Incorrect flash command');
  });

  it('should reject flash with unknown flag', () => {
    cmd.parameters = '-x boot /path/to/boot.img';
    const result = flashPartition(cmd);

    expect(cmd.bJumpDo).toBe(true);
    expect(result).toContain('Unknown flash flag');
  });
});

describe('TranslateCommand ErasePartition', () => {
  let cmd: FormatCommand;

  beforeEach(() => {
    cmd = createFormatCommand();
  });

  it('should parse erase with partition', () => {
    cmd.parameters = 'cache';
    const result = erasePartition(cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_FLASHD_ERASE);
    expect(cmd.bJumpDo).toBe(false);
    expect(cmd.parameters).toContain('cache');
  });

  it('should parse erase with -f flag', () => {
    cmd.parameters = '-f userdata';
    const result = erasePartition(cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_FLASHD_ERASE);
    expect(cmd.bJumpDo).toBe(false);
    expect(cmd.parameters).toContain('-f');
    expect(cmd.parameters).toContain('userdata');
  });

  it('should reject erase without partition', () => {
    cmd.parameters = '';
    const result = erasePartition(cmd);

    expect(cmd.bJumpDo).toBe(true);
    expect(result).toContain('Incorrect erase command');
  });

  it('should reject erase with only -f flag', () => {
    cmd.parameters = '-f';
    const result = erasePartition(cmd);

    expect(cmd.bJumpDo).toBe(true);
    expect(result).toContain('Incorrect erase command');
  });
});

describe('TranslateCommand FormatPartition', () => {
  let cmd: FormatCommand;

  beforeEach(() => {
    cmd = createFormatCommand();
  });

  it('should parse format with partition', () => {
    cmd.parameters = 'data';
    const result = formatPartition(cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_FLASHD_FORMAT);
    expect(cmd.bJumpDo).toBe(false);
    expect(cmd.parameters).toContain('data');
  });

  it('should parse format with -f flag', () => {
    cmd.parameters = '-f misc';
    const result = formatPartition(cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_FLASHD_FORMAT);
    expect(cmd.bJumpDo).toBe(false);
    expect(cmd.parameters).toContain('-f');
    expect(cmd.parameters).toContain('misc');
  });

  it('should reject format without partition', () => {
    cmd.parameters = '';
    const result = formatPartition(cmd);

    expect(cmd.bJumpDo).toBe(true);
    expect(result).toContain('Incorrect format command');
  });

  it('should reject format with unknown flag', () => {
    cmd.parameters = '-x data';
    const result = formatPartition(cmd);

    expect(cmd.bJumpDo).toBe(true);
    expect(result).toContain('Unknown format flag');
  });
});

describe('TranslateCommand flashd via string2FormatCommand', () => {
  let cmd: FormatCommand;

  beforeEach(() => {
    cmd = createFormatCommand();
  });

  it('should parse update command via string2FormatCommand', () => {
    const result = string2FormatCommand('update /path/to/update.zip', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_FLASHD_UPDATE_INIT);
    expect(cmd.bJumpDo).toBe(false);
  });

  it('should parse flash command via string2FormatCommand', () => {
    const result = string2FormatCommand('flash boot /path/to/boot.img', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_FLASHD_FLASH_INIT);
    expect(cmd.bJumpDo).toBe(false);
  });

  it('should parse flash -f command via string2FormatCommand', () => {
    const result = string2FormatCommand('flash -f system /path/to/system.img', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_FLASHD_FLASH_INIT);
    expect(cmd.bJumpDo).toBe(false);
  });

  it('should parse erase command via string2FormatCommand', () => {
    const result = string2FormatCommand('erase cache', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_FLASHD_ERASE);
    expect(cmd.bJumpDo).toBe(false);
  });

  it('should parse erase -f command via string2FormatCommand', () => {
    const result = string2FormatCommand('erase -f userdata', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_FLASHD_ERASE);
    expect(cmd.bJumpDo).toBe(false);
  });

  it('should parse format command via string2FormatCommand', () => {
    const result = string2FormatCommand('format data', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_FLASHD_FORMAT);
    expect(cmd.bJumpDo).toBe(false);
  });

  it('should parse format -f command via string2FormatCommand', () => {
    const result = string2FormatCommand('format -f misc', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_FLASHD_FORMAT);
    expect(cmd.bJumpDo).toBe(false);
  });

  it('should reject update without path via string2FormatCommand', () => {
    const result = string2FormatCommand('update', cmd);

    expect(cmd.bJumpDo).toBe(true);
    expect(result).toContain('Incorrect update command');
  });

  it('should reject flash without enough args via string2FormatCommand', () => {
    const result = string2FormatCommand('flash boot', cmd);

    expect(cmd.bJumpDo).toBe(true);
    expect(result).toContain('Incorrect flash command');
  });

  it('should reject erase without partition via string2FormatCommand', () => {
    const result = string2FormatCommand('erase', cmd);

    expect(cmd.bJumpDo).toBe(true);
    expect(result).toContain('Incorrect erase command');
  });

  it('should reject format without partition via string2FormatCommand', () => {
    const result = string2FormatCommand('format', cmd);

    expect(cmd.bJumpDo).toBe(true);
    expect(result).toContain('Incorrect format command');
  });
});
