/**
 * Tests for CLI module
 */

import { describe, it, expect } from 'vitest';
import { parseCommand, buildCommandString, parseServerAddress } from './host/parser.js';

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

    it('should parse -m flag', () => {
      const result = parseCommand(['-m']);
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

  describe('new options', () => {
    it('should parse -e forward IP', () => {
      const result = parseCommand(['-e', '0.0.0.0', 'fport', 'tcp:8080', 'tcp:80']);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        expect(result.forwardIP).toBe('0.0.0.0');
        expect(result.command).toBe('fport');
      }
    });

    it('should parse -p skip pullup', () => {
      const result = parseCommand(['-p', 'shell', 'ls']);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        expect(result.skipPullup).toBe(true);
        expect(result.command).toBe('shell');
      }
    });

    it('should parse -m server mode with -s port', () => {
      const result = parseCommand(['-m', '-s', '0.0.0.0:9999']);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        expect(result.runInServer).toBe(true);
        expect(result.serverAddr).toBe('0.0.0.0:9999');
      }
    });
  });

  describe('new commands', () => {
    it('should parse discover command', () => {
      const result = parseCommand(['discover']);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        expect(result.command).toBe('discover');
      }
    });

    it('should parse checkserver command', () => {
      const result = parseCommand(['checkserver']);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        expect(result.command).toBe('checkserver');
      }
    });

    it('should parse checkdevice command with key', () => {
      const result = parseCommand(['checkdevice', 'abc123']);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        expect(result.command).toBe('checkdevice');
        expect(result.args).toEqual(['abc123']);
      }
    });

    it('should parse wait command', () => {
      const result = parseCommand(['wait']);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        expect(result.command).toBe('wait');
      }
    });

    it('should parse tconn command', () => {
      const result = parseCommand(['tconn', '192.168.1.100:5555']);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        expect(result.command).toBe('tconn');
        expect(result.args).toEqual(['192.168.1.100:5555']);
      }
    });

    it('should parse tconn with -remove', () => {
      const result = parseCommand(['tconn', '192.168.1.100:5555', '-remove']);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        expect(result.command).toBe('tconn');
        expect(result.args).toEqual(['192.168.1.100:5555', '-remove']);
      }
    });

    it('should parse any command', () => {
      const result = parseCommand(['any']);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        expect(result.command).toBe('any');
      }
    });

    it('should parse jpid command', () => {
      const result = parseCommand(['jpid']);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        expect(result.command).toBe('jpid');
      }
    });

    it('should parse track-jpid command', () => {
      const result = parseCommand(['track-jpid']);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        expect(result.command).toBe('track-jpid');
      }
    });

    it('should parse track-jpid -a', () => {
      const result = parseCommand(['track-jpid', '-a']);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        expect(result.command).toBe('track-jpid');
        expect(result.args).toEqual(['-a']);
      }
    });

    it('should parse target mount', () => {
      const result = parseCommand(['target', 'mount']);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        expect(result.command).toBe('target');
        expect(result.args).toEqual(['mount']);
      }
    });

    it('should parse target boot', () => {
      const result = parseCommand(['target', 'boot']);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        expect(result.command).toBe('target');
        expect(result.args).toEqual(['boot']);
      }
    });

    it('should parse target boot -bootloader', () => {
      const result = parseCommand(['target', 'boot', '-bootloader']);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        expect(result.command).toBe('target');
        expect(result.args).toEqual(['boot', '-bootloader']);
      }
    });

    it('should parse tmode usb', () => {
      const result = parseCommand(['tmode', 'usb']);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        expect(result.command).toBe('tmode');
        expect(result.args).toEqual(['usb']);
      }
    });

    it('should parse tmode port with port number', () => {
      const result = parseCommand(['tmode', 'port', '5555']);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        expect(result.command).toBe('tmode');
        expect(result.args).toEqual(['port', '5555']);
      }
    });

    it('should parse smode', () => {
      const result = parseCommand(['smode']);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        expect(result.command).toBe('smode');
      }
    });

    it('should parse smode -r', () => {
      const result = parseCommand(['smode', '-r']);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        expect(result.command).toBe('smode');
        expect(result.args).toEqual(['-r']);
      }
    });

    it('should parse hilog', () => {
      const result = parseCommand(['hilog']);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        expect(result.command).toBe('hilog');
      }
    });

    it('should parse hilog with options', () => {
      const result = parseCommand(['hilog', '-x']);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        expect(result.command).toBe('hilog');
        expect(result.args).toEqual(['-x']);
      }
    });

    it('should parse bugreport', () => {
      const result = parseCommand(['bugreport']);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        expect(result.command).toBe('bugreport');
      }
    });

    it('should parse bugreport with file', () => {
      const result = parseCommand(['bugreport', '/tmp/report.zip']);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        expect(result.command).toBe('bugreport');
        expect(result.args).toEqual(['/tmp/report.zip']);
      }
    });

    it('should parse sideload', () => {
      const result = parseCommand(['sideload', '/tmp/update.zip']);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        expect(result.command).toBe('sideload');
        expect(result.args).toEqual(['/tmp/update.zip']);
      }
    });

    it('should parse keygen', () => {
      const result = parseCommand(['keygen', '~/.hdc/key']);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        expect(result.command).toBe('keygen');
        expect(result.args).toEqual(['~/.hdc/key']);
      }
    });

    it('should parse rport', () => {
      const result = parseCommand(['rport', 'tcp:8080', 'tcp:80']);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        expect(result.command).toBe('rport');
        expect(result.args).toEqual(['tcp:8080', 'tcp:80']);
      }
    });

    it('should parse update', () => {
      const result = parseCommand(['update', '/tmp/update.pkg']);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        expect(result.command).toBe('update');
        expect(result.args).toEqual(['/tmp/update.pkg']);
      }
    });

    it('should parse flash', () => {
      const result = parseCommand(['flash', 'system', '/tmp/system.img']);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        expect(result.command).toBe('flash');
        expect(result.args).toEqual(['system', '/tmp/system.img']);
      }
    });

    it('should parse flash -f', () => {
      const result = parseCommand(['flash', '-f', 'system', '/tmp/system.img']);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        expect(result.command).toBe('flash');
        expect(result.args).toEqual(['-f', 'system', '/tmp/system.img']);
      }
    });

    it('should parse erase', () => {
      const result = parseCommand(['erase', 'cache']);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        expect(result.command).toBe('erase');
        expect(result.args).toEqual(['cache']);
      }
    });

    it('should parse format', () => {
      const result = parseCommand(['format', 'data']);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        expect(result.command).toBe('format');
        expect(result.args).toEqual(['data']);
      }
    });

    it('should parse start', () => {
      const result = parseCommand(['start']);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        expect(result.command).toBe('start');
      }
    });

    it('should parse start -r', () => {
      const result = parseCommand(['start', '-r']);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        expect(result.command).toBe('start');
        expect(result.args).toEqual(['-r']);
      }
    });
  });

  describe('auto server pull-up flags', () => {
    it('should parse --spawned-server flag', () => {
      const result = parseCommand(['--spawned-server']);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        expect(result.spawnedServer).toBe(true);
      }
    });

    it('should parse -p to skip pullup', () => {
      const result = parseCommand(['-p', 'shell']);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        expect(result.skipPullup).toBe(true);
        expect(result.command).toBe('shell');
      }
    });

    it('should default skipPullup to false', () => {
      const result = parseCommand(['shell']);
      expect(result).not.toBeInstanceOf(Error);
      if (!(result instanceof Error)) {
        expect(result.skipPullup).toBe(false);
      }
    });
  });
});

describe('buildCommandString', () => {
  it('should build basic command string', () => {
    const result = buildCommandString({
      command: 'shell',
      args: ['ls'],
      logLevel: 2,
      runInServer: false,
      spawnedServer: false,
      skipPullup: false,
    });
    expect(result).toBe('shell ls');
  });

  it('should include targetKey prefix', () => {
    const result = buildCommandString({
      command: 'shell',
      args: ['ls'],
      targetKey: '192.168.1.100:5555',
      logLevel: 2,
      runInServer: false,
      spawnedServer: false,
      skipPullup: false,
    });
    expect(result).toBe('-t 192.168.1.100:5555 shell ls');
  });

  it('should include forwardIP prefix', () => {
    const result = buildCommandString({
      command: 'fport',
      args: ['tcp:8080', 'tcp:80'],
      forwardIP: '0.0.0.0',
      logLevel: 2,
      runInServer: false,
      spawnedServer: false,
      skipPullup: false,
    });
    expect(result).toBe('-e 0.0.0.0 fport tcp:8080 tcp:80');
  });

  it('should handle tconn command with -remove', () => {
    const result = buildCommandString({
      command: 'tconn',
      args: ['192.168.1.100:5555', '-remove'],
      logLevel: 2,
      runInServer: false,
      spawnedServer: false,
      skipPullup: false,
    });
    expect(result).toBe('tconn 192.168.1.100:5555 -remove');
  });

  it('should handle target boot -bootloader', () => {
    const result = buildCommandString({
      command: 'target',
      args: ['boot', '-bootloader'],
      logLevel: 2,
      runInServer: false,
      spawnedServer: false,
      skipPullup: false,
    });
    expect(result).toBe('target boot -bootloader');
  });
});

describe('parseServerAddress', () => {
  it('should parse host:port', () => {
    expect(parseServerAddress('127.0.0.1:8710')).toEqual({ host: '127.0.0.1', port: 8710 });
  });

  it('should parse port-only as localhost', () => {
    expect(parseServerAddress('8710')).toEqual({ host: '127.0.0.1', port: 8710 });
  });

  it('should parse 0.0.0.0 address', () => {
    expect(parseServerAddress('0.0.0.0:9999')).toEqual({ host: '0.0.0.0', port: 9999 });
  });
});
