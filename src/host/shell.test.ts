/**
 * Tests for Shell module
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  HdcShell,
  ShellState,
  ShellSignal,
  SHELL_PREFIX,
  SHELL_INITIAL,
  SHELL_OPT_BUNDLE_NAME,
  SHELL_OPT_ABILITY_TYPE,
  SHELL_OPT_ABILITY_NAME,
  SHELL_OPT_COMMAND,
  encodeExtendedShellTlv,
  decodeExtendedShellTlv,
  parseExtendedShellArgs,
  ExtendedShellOptions,
} from './shell.js';
import { TlvAppend, TlvToStringMap } from '../common/base.js';

// Mock socket factory
function createMockSocket() {
  return {
    write: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    once: vi.fn(),
    emit: vi.fn(),
    destroy: vi.fn(),
  } as any;
}

describe('HdcShell', () => {
  describe('constructor', () => {
    it('should create shell instance', () => {
      const mockSocket = createMockSocket();
      const shell = new HdcShell(mockSocket, { command: 'ls -la' });

      expect(shell.getSessionId()).toBeDefined();
      expect(shell.getSessionId().length).toBe(8);
      expect(shell.getState()).toBe(ShellState.IDLE);
      expect(shell.getExitCode()).toBeNull();
    });

    it('should accept custom options', () => {
      const mockSocket = createMockSocket();
      const shell = new HdcShell(mockSocket, {
        command: 'echo test',
        pty: true,
        timeout: 60000,
        cwd: '/home',
        env: { PATH: '/usr/bin' },
      });

      expect(shell['command']).toBe('echo test');
      expect(shell['timeout']).toBe(60000);
    });
  });

  describe('getSessionId', () => {
    it('should return session ID', () => {
      const mockSocket = createMockSocket();
      const shell = new HdcShell(mockSocket, { command: 'ls' });

      const sessionId = shell.getSessionId();
      expect(typeof sessionId).toBe('string');
      expect(sessionId.length).toBe(8);
    });
  });

  describe('getState', () => {
    it('should return current state', () => {
      const mockSocket = createMockSocket();
      const shell = new HdcShell(mockSocket, { command: 'ls' });

      expect(shell.getState()).toBe(ShellState.IDLE);
    });
  });

  describe('getExitCode', () => {
    it('should return null initially', () => {
      const mockSocket = createMockSocket();
      const shell = new HdcShell(mockSocket, { command: 'ls' });

      expect(shell.getExitCode()).toBeNull();
    });
  });

  describe('write', () => {
    it('should return false when not running', () => {
      const mockSocket = createMockSocket();
      const shell = new HdcShell(mockSocket, { command: 'ls' });

      const result = shell.write('test');
      expect(result).toBe(false);
    });
  });

  describe('sendSignal', () => {
    it('should return false when not running', () => {
      const mockSocket = createMockSocket();
      const shell = new HdcShell(mockSocket, { command: 'ls' });

      const result = shell.sendSignal(ShellSignal.SIGINT);
      expect(result).toBe(false);
    });
  });

  describe('kill', () => {
    it('should be callable', () => {
      const mockSocket = createMockSocket();
      const shell = new HdcShell(mockSocket, { command: 'ls' });

      // Should not throw
      shell.kill();
    });
  });

  describe('interrupt', () => {
    it('should be callable', () => {
      const mockSocket = createMockSocket();
      const shell = new HdcShell(mockSocket, { command: 'ls' });

      // Should not throw
      shell.interrupt();
    });
  });

  describe('resize', () => {
    it('should return false when not running', () => {
      const mockSocket = createMockSocket();
      const shell = new HdcShell(mockSocket, { command: 'ls' });

      const result = shell.resize(24, 80);
      expect(result).toBe(false);
    });
  });

  describe('close', () => {
    it('should close shell', () => {
      const mockSocket = createMockSocket();
      const shell = new HdcShell(mockSocket, { command: 'ls' });

      shell.close();
      expect(shell.getState()).toBe(ShellState.CLOSED);
    });

    it('should be idempotent', () => {
      const mockSocket = createMockSocket();
      const shell = new HdcShell(mockSocket, { command: 'ls' });

      shell.close();
      shell.close();
      shell.close();
      expect(shell.getState()).toBe(ShellState.CLOSED);
    });
  });

  describe('getSession', () => {
    it('should return session info', () => {
      const mockSocket = createMockSocket();
      const shell = new HdcShell(mockSocket, { command: 'ls -la' });

      const session = shell.getSession();

      expect(session.sessionId).toBeDefined();
      expect(session.command).toBe('ls -la');
      expect(session.state).toBe(ShellState.IDLE);
      expect(session.exitCode).toBeNull();
      expect(session.startTime).toBe(0);
    });
  });

  describe('getStdout/getStderr', () => {
    it('should return empty strings initially', () => {
      const mockSocket = createMockSocket();
      const shell = new HdcShell(mockSocket, { command: 'ls' });

      expect(shell.getStdout()).toBe('');
      expect(shell.getStderr()).toBe('');
    });
  });
});

describe('ShellState enum', () => {
  it('should have correct values', () => {
    expect(ShellState.IDLE).toBe('idle');
    expect(ShellState.STARTING).toBe('starting');
    expect(ShellState.RUNNING).toBe('running');
    expect(ShellState.EXITING).toBe('exiting');
    expect(ShellState.CLOSED).toBe('closed');
    expect(ShellState.ERROR).toBe('error');
  });
});

describe('ShellSignal enum', () => {
  it('should have correct values', () => {
    expect(ShellSignal.SIGINT).toBe(2);
    expect(ShellSignal.SIGQUIT).toBe(3);
    expect(ShellSignal.SIGKILL).toBe(9);
    expect(ShellSignal.SIGTERM).toBe(15);
  });
});

describe('Constants', () => {
  it('should have correct prefix values', () => {
    expect(SHELL_PREFIX).toBe('shell:');
    expect(SHELL_INITIAL).toBe('shell:init');
  });

  it('should have correct TLV tag names', () => {
    expect(SHELL_OPT_BUNDLE_NAME).toBe('optBundleName');
    expect(SHELL_OPT_ABILITY_TYPE).toBe('optAbilityType');
    expect(SHELL_OPT_ABILITY_NAME).toBe('optAbilityName');
    expect(SHELL_OPT_COMMAND).toBe('optShellCmd');
  });
});

// ============================================================================
// Interactive Shell Tests
// ============================================================================

describe('Interactive Shell', () => {
  it('should set stdin to raw mode and restore on exit', () => {
    const mockSocket = createMockSocket();
    const shell = new HdcShell(mockSocket, { command: '' });

    // Simulate a TTY stdin
    const originalIsTTY = process.stdin.isTTY;
    const mockSetRawMode = vi.fn();
    const mockResume = vi.fn();
    const mockOn = vi.fn();
    const mockRemoveListener = vi.fn();
    const mockPause = vi.fn();

    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stdin, 'setRawMode', { value: mockSetRawMode, configurable: true });
    Object.defineProperty(process.stdin, 'resume', { value: mockResume, configurable: true });
    Object.defineProperty(process.stdin, 'on', { value: mockOn, configurable: true });
    Object.defineProperty(process.stdin, 'removeListener', { value: mockRemoveListener, configurable: true });
    Object.defineProperty(process.stdin, 'pause', { value: mockPause, configurable: true });

    try {
      shell.startInteractive();

      // Raw mode should be set
      expect(mockSetRawMode).toHaveBeenCalledWith(true);
      expect(mockResume).toHaveBeenCalled();
      expect(mockOn).toHaveBeenCalledWith('data', expect.any(Function));

      // Simulate exit event to trigger cleanup
      shell.emit('exit', 0);

      // Raw mode should be restored
      expect(mockSetRawMode).toHaveBeenCalledWith(false);
      expect(mockPause).toHaveBeenCalled();
    } finally {
      // Restore original values
      if (originalIsTTY !== undefined) {
        Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
      } else {
        Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true });
      }
    }
  });

  it('should handle non-TTY stdin gracefully', () => {
    const mockSocket = createMockSocket();
    const shell = new HdcShell(mockSocket, { command: '' });

    // Simulate a non-TTY stdin
    Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true });

    const mockOn = vi.fn();
    const mockResume = vi.fn();
    Object.defineProperty(process.stdin, 'on', { value: mockOn, configurable: true });
    Object.defineProperty(process.stdin, 'resume', { value: mockResume, configurable: true });

    // Should not throw
    expect(() => shell.startInteractive()).not.toThrow();
    expect(mockOn).toHaveBeenCalledWith('data', expect.any(Function));
  });
});

// ============================================================================
// Extended Shell TLV Tests
// ============================================================================

describe('Extended Shell TLV Encoding', () => {
  it('should encode bundle name as TLV', () => {
    const options: ExtendedShellOptions = {
      bundleName: 'com.example.app',
    };
    const tlv = encodeExtendedShellTlv(options);

    // Should be decodable
    const map = TlvToStringMap(tlv);
    expect(map.get(SHELL_OPT_BUNDLE_NAME)).toBe('com.example.app');
  });

  it('should encode all options as TLV', () => {
    const options: ExtendedShellOptions = {
      bundleName: 'com.example.app',
      abilityType: 'page',
      abilityName: 'MainAbility',
      command: 'ls -la',
    };
    const tlv = encodeExtendedShellTlv(options);

    const map = TlvToStringMap(tlv);
    expect(map.get(SHELL_OPT_BUNDLE_NAME)).toBe('com.example.app');
    expect(map.get(SHELL_OPT_ABILITY_TYPE)).toBe('page');
    expect(map.get(SHELL_OPT_ABILITY_NAME)).toBe('MainAbility');
    expect(map.get(SHELL_OPT_COMMAND)).toBe('ls -la');
  });

  it('should skip undefined options', () => {
    const options: ExtendedShellOptions = {
      bundleName: 'com.example.app',
    };
    const tlv = encodeExtendedShellTlv(options);

    const map = TlvToStringMap(tlv);
    expect(map.has(SHELL_OPT_BUNDLE_NAME)).toBe(true);
    expect(map.has(SHELL_OPT_ABILITY_TYPE)).toBe(false);
    expect(map.has(SHELL_OPT_ABILITY_NAME)).toBe(false);
    expect(map.has(SHELL_OPT_COMMAND)).toBe(false);
  });

  it('should round-trip encode and decode', () => {
    const options: ExtendedShellOptions = {
      bundleName: 'com.test.bundle',
      abilityType: 'service',
      abilityName: 'TestAbility',
      command: 'echo hello',
    };
    const tlv = encodeExtendedShellTlv(options);
    const decoded = decodeExtendedShellTlv(tlv);

    expect(decoded.bundleName).toBe('com.test.bundle');
    expect(decoded.abilityType).toBe('service');
    expect(decoded.abilityName).toBe('TestAbility');
    expect(decoded.command).toBe('echo hello');
  });
});

describe('parseExtendedShellArgs', () => {
  it('should parse -b bundle name', () => {
    const result = parseExtendedShellArgs(['-b', 'com.example.app']);
    expect(result).not.toBeNull();
    expect(result!.bundleName).toBe('com.example.app');
    expect(result!.abilityType).toBeUndefined();
    expect(result!.abilityName).toBeUndefined();
    expect(result!.command).toBeUndefined();
  });

  it('should parse all options', () => {
    const result = parseExtendedShellArgs([
      '-b', 'com.example.app',
      '-t', 'page',
      '-e', 'MainAbility',
      '-c', 'ls -la',
    ]);
    expect(result).not.toBeNull();
    expect(result!.bundleName).toBe('com.example.app');
    expect(result!.abilityType).toBe('page');
    expect(result!.abilityName).toBe('MainAbility');
    expect(result!.command).toBe('ls -la');
  });

  it('should return null when no -b flag', () => {
    const result = parseExtendedShellArgs(['-t', 'page']);
    expect(result).toBeNull();
  });

  it('should return null for empty args', () => {
    const result = parseExtendedShellArgs([]);
    expect(result).toBeNull();
  });

  it('should parse partial options', () => {
    const result = parseExtendedShellArgs([
      '-b', 'com.example.app',
      '-c', 'cat /proc/version',
    ]);
    expect(result).not.toBeNull();
    expect(result!.bundleName).toBe('com.example.app');
    expect(result!.command).toBe('cat /proc/version');
    expect(result!.abilityType).toBeUndefined();
  });
});

// ============================================================================
// Shell Signal Tests
// ============================================================================

describe('Shell Signal Sending', () => {
  it('should send SIGINT when not running returns false', () => {
    const mockSocket = createMockSocket();
    const shell = new HdcShell(mockSocket, { command: 'ls' });

    // Shell is IDLE, so sendSignal should return false
    const result = shell.sendSignal(ShellSignal.SIGINT);
    expect(result).toBe(false);
    expect(mockSocket.write).not.toHaveBeenCalled();
  });

  it('should send SIGTERM when not running returns false', () => {
    const mockSocket = createMockSocket();
    const shell = new HdcShell(mockSocket, { command: 'ls' });

    const result = shell.sendSignal(ShellSignal.SIGTERM);
    expect(result).toBe(false);
    expect(mockSocket.write).not.toHaveBeenCalled();
  });

  it('should have correct signal values', () => {
    // Verify signal values match expected POSIX signal numbers
    expect(ShellSignal.SIGINT).toBe(2);
    expect(ShellSignal.SIGQUIT).toBe(3);
    expect(ShellSignal.SIGKILL).toBe(9);
    expect(ShellSignal.SIGTERM).toBe(15);
  });
});
