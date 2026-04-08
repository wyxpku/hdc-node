/**
 * Tests for Shell module
 */

import { describe, it, expect, vi } from 'vitest';
import { HdcShell, ShellState, ShellSignal, SHELL_PREFIX, SHELL_INITIAL } from './shell.js';

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
});
