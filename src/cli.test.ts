/**
 * Tests for CLI module
 */

import { describe, it, expect } from 'vitest';
import { parseCommand } from './host/parser.js';

describe('CLI argument parsing', () => {
  describe('help', () => {
    it('should parse help command', () => {
      const result = parseCommand(['help']);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        expect(result.command).toBe('help');
      }
    });

    it('should return parse error for --help flag (show help)', () => {
      const result = parseCommand(['--help']);
      // --help returns ParseError with help text
      expect(result).toBeInstanceOf(Error);
    });

    it('should return parse error for -h flag (show help)', () => {
      const result = parseCommand(['-h']);
      // -h returns ParseError with help text
      expect(result).toBeInstanceOf(Error);
    });
  });

  describe('version', () => {
    it('should parse version command', () => {
      const result = parseCommand(['version']);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        expect(result.command).toBe('version');
      }
    });

    it('should parse --version flag', () => {
      const result = parseCommand(['--version']);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        expect(result.command).toBe('version');
      }
    });

    it('should parse -v flag', () => {
      const result = parseCommand(['-v']);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        expect(result.command).toBe('version');
      }
    });
  });

  describe('list', () => {
    it('should parse list targets', () => {
      const result = parseCommand(['list', 'targets']);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        expect(result.command).toBe('list');
        expect(result.args).toContain('targets');
      }
    });
  });

  describe('shell', () => {
    it('should parse shell command', () => {
      const result = parseCommand(['shell', 'ls', '-la']);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        expect(result.command).toBe('shell');
        expect(result.args).toEqual(['ls', '-la']);
      }
    });

    it('should parse shell command with multiple args', () => {
      const result = parseCommand(['shell', 'echo', 'hello', 'world']);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        expect(result.command).toBe('shell');
        expect(result.args).toEqual(['echo', 'hello', 'world']);
      }
    });
  });

  describe('file', () => {
    it('should parse file send', () => {
      const result = parseCommand(['file', 'send', '/local/file.txt', '/remote/file.txt']);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        expect(result.command).toBe('file');
        expect(result.args).toEqual(['send', '/local/file.txt', '/remote/file.txt']);
      }
    });

    it('should parse file recv', () => {
      const result = parseCommand(['file', 'recv', '/remote/file.txt', '/local/file.txt']);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        expect(result.command).toBe('file');
        expect(result.args).toEqual(['recv', '/remote/file.txt', '/local/file.txt']);
      }
    });
  });

  describe('server mode', () => {
    it('should parse --server flag', () => {
      const result = parseCommand(['--server']);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        expect(result.runInServer).toBe(true);
      }
    });

    it('should parse -S flag', () => {
      const result = parseCommand(['-S']);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        expect(result.runInServer).toBe(true);
      }
    });

    it('should parse server as command', () => {
      const result = parseCommand(['server']);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        expect(result.command).toBe('server');
      }
    });
  });

  describe('server address', () => {
    it('should parse server address', () => {
      const result = parseCommand(['-s', '192.168.1.1:8710', 'list']);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        expect(result.serverAddr).toBe('192.168.1.1:8710');
      }
    });
  });
});
