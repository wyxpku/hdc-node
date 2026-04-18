/**
 * Parser Module Tests
 */

import { describe, it, expect } from 'vitest';
import { parseCommand, getHelp, parseServerAddress, getDefaultServerAddress, ParseError, buildCommandString } from './parser.js';

describe('parseCommand', () => {
  it('should parse empty args', () => {
    const result = parseCommand([]);
    expect(result).toEqual({
      command: '',
      args: [],
      logLevel: 2,
      runInServer: false,
      spawnedServer: false,
      skipPullup: false,
    });
  });

  it('should parse simple command with ls and -la args', () => {
    const result = parseCommand(['shell', 'ls', '-la']);
    expect(result).toMatchObject({
      command: 'shell',
      args: ['ls', '-la'],
      logLevel: 2,    // -la should not change log level
    });
  });

  it('should parse list targets command', () => {
    const result = parseCommand(['list', 'targets']);
    expect(result).toMatchObject({
      command: 'list',
      args: ['targets'],
    });
  });

  it('should parse -t target option', () => {
    const result = parseCommand(['-t', '192.168.1.100:5555', 'shell']);
    expect(result).toMatchObject({
      command: 'shell',
      args: [],
      targetKey: '192.168.1.100:5555',
    });
  });

  it('should parse -s server option', () => {
    const result = parseCommand(['-s', '192.168.1.1:8710', 'list', 'targets']);
    expect(result).toMatchObject({
      command: 'list',
      args: ['targets'],
      serverAddr: '192.168.1.1:8710',
    });
  });

  it('should parse -l log level', () => {
    expect(parseCommand(['-l0', 'shell']).logLevel).toBe(0);
    expect(parseCommand(['-l3', 'shell']).logLevel).toBe(3);
    expect(parseCommand(['-l5', 'shell']).logLevel).toBe(5);
  });

  it('should parse --server mode', () => {
    const result = parseCommand(['--server']);
    expect(result).toMatchObject({
      runInServer: true,
    });
  });

  it('should parse -S server mode', () => {
    const result = parseCommand(['-S']);
    expect(result).toMatchObject({
      runInServer: true,
    });
  });

  it('should return error for -t without value', () => {
    const result = parseCommand(['-t']);
    expect(result).toBeInstanceOf(ParseError);
    expect((result as ParseError).message).toContain('-t requires');
  });

  it('should return error for -s without value', () => {
    const result = parseCommand(['-s']);
    expect(result).toBeInstanceOf(ParseError);
    expect((result as ParseError).message).toContain('-s requires');
  });

  it('should return help for -h', () => {
    const result = parseCommand(['-h']);
    expect(result).toBeInstanceOf(ParseError);
    expect((result as ParseError).message).toContain('OpenHarmony Device Connector');
  });

  it('should parse version command', () => {
    const result = parseCommand(['-v']);
    expect(result).toMatchObject({
      command: 'version',
    });
  });

  it('should parse file send command', () => {
    const result = parseCommand(['file', 'send', './local.txt', '/data/remote.txt']);
    expect(result).toMatchObject({
      command: 'file',
      args: ['send', './local.txt', '/data/remote.txt'],
    });
  });

  it('should parse install command', () => {
    const result = parseCommand(['install', '/data/app.hap']);
    expect(result).toMatchObject({
      command: 'install',
      args: ['/data/app.hap'],
    });
  });

  it('should parse multiple options', () => {
    const result = parseCommand(['-l4', '-t', 'device1', '-s', 'localhost:8710', 'shell', 'ls']);
    expect(result).toMatchObject({
      logLevel: 4,
      targetKey: 'device1',
      serverAddr: 'localhost:8710',
      command: 'shell',
      args: ['ls'],
    });
  });

  // --- New options ---

  describe('-e forward IP option', () => {
    it('should parse -e with IP address', () => {
      const result = parseCommand(['-e', '0.0.0.0', 'fport', 'tcp:8080', 'tcp:80']);
      expect(result).toMatchObject({
        command: 'fport',
        args: ['tcp:8080', 'tcp:80'],
        forwardIP: '0.0.0.0',
      });
    });

    it('should return error for -e without value', () => {
      const result = parseCommand(['-e']);
      expect(result).toBeInstanceOf(ParseError);
      expect((result as ParseError).message).toContain('-e requires');
    });
  });

  describe('-m server mode option', () => {
    it('should parse -m as server mode', () => {
      const result = parseCommand(['-m']);
      expect(result).toMatchObject({
        runInServer: true,
        command: '',
      });
    });

    it('should parse -m with -s port', () => {
      const result = parseCommand(['-m', '-s', '0.0.0.0:9999']);
      expect(result).toMatchObject({
        runInServer: true,
        serverAddr: '0.0.0.0:9999',
      });
    });
  });

  describe('-p skip pullup option', () => {
    it('should parse -p as skip pullup', () => {
      const result = parseCommand(['-p', 'list', 'targets']);
      expect(result).toMatchObject({
        skipPullup: true,
        command: 'list',
        args: ['targets'],
      });
    });
  });

  // --- New commands ---

  describe('discover command', () => {
    it('should parse discover command', () => {
      const result = parseCommand(['discover']);
      expect(result).toMatchObject({
        command: 'discover',
        args: [],
      });
    });
  });

  describe('checkserver command', () => {
    it('should parse checkserver command', () => {
      const result = parseCommand(['checkserver']);
      expect(result).toMatchObject({
        command: 'checkserver',
        args: [],
      });
    });
  });

  describe('checkdevice command', () => {
    it('should parse checkdevice command with key', () => {
      const result = parseCommand(['checkdevice', 'device123']);
      expect(result).toMatchObject({
        command: 'checkdevice',
        args: ['device123'],
      });
    });
  });

  describe('wait command', () => {
    it('should parse wait command', () => {
      const result = parseCommand(['wait']);
      expect(result).toMatchObject({
        command: 'wait',
        args: [],
      });
    });
  });

  describe('tconn command', () => {
    it('should parse tconn with IP:port', () => {
      const result = parseCommand(['tconn', '192.168.1.100:5555']);
      expect(result).toMatchObject({
        command: 'tconn',
        args: ['192.168.1.100:5555'],
      });
    });

    it('should parse tconn with -remove flag', () => {
      const result = parseCommand(['tconn', '192.168.1.100:5555', '-remove']);
      expect(result).toMatchObject({
        command: 'tconn',
        args: ['192.168.1.100:5555', '-remove'],
      });
    });
  });

  describe('any command', () => {
    it('should parse any command', () => {
      const result = parseCommand(['any']);
      expect(result).toMatchObject({
        command: 'any',
        args: [],
      });
    });
  });

  describe('jpid command', () => {
    it('should parse jpid command', () => {
      const result = parseCommand(['jpid']);
      expect(result).toMatchObject({
        command: 'jpid',
        args: [],
      });
    });
  });

  describe('track-jpid command', () => {
    it('should parse track-jpid command', () => {
      const result = parseCommand(['track-jpid']);
      expect(result).toMatchObject({
        command: 'track-jpid',
        args: [],
      });
    });

    it('should parse track-jpid -a flag', () => {
      const result = parseCommand(['track-jpid', '-a']);
      expect(result).toMatchObject({
        command: 'track-jpid',
        args: ['-a'],
      });
    });

    it('should parse track-jpid with -p consumed as skipPullup option', () => {
      // -p is always consumed as the skipPullup option regardless of position
      const result = parseCommand(['track-jpid', '-p']);
      expect(result).toMatchObject({
        command: 'track-jpid',
        args: [],
        skipPullup: true,
      });
    });
  });

  describe('target mount command', () => {
    it('should parse target mount', () => {
      const result = parseCommand(['target', 'mount']);
      expect(result).toMatchObject({
        command: 'target',
        args: ['mount'],
      });
    });
  });

  describe('target boot command', () => {
    it('should parse target boot', () => {
      const result = parseCommand(['target', 'boot']);
      expect(result).toMatchObject({
        command: 'target',
        args: ['boot'],
      });
    });

    it('should parse target boot -bootloader', () => {
      const result = parseCommand(['target', 'boot', '-bootloader']);
      expect(result).toMatchObject({
        command: 'target',
        args: ['boot', '-bootloader'],
      });
    });

    it('should parse target boot -recovery', () => {
      const result = parseCommand(['target', 'boot', '-recovery']);
      expect(result).toMatchObject({
        command: 'target',
        args: ['boot', '-recovery'],
      });
    });
  });

  describe('tmode command', () => {
    it('should parse tmode usb', () => {
      const result = parseCommand(['tmode', 'usb']);
      expect(result).toMatchObject({
        command: 'tmode',
        args: ['usb'],
      });
    });

    it('should parse tmode port with port number', () => {
      const result = parseCommand(['tmode', 'port', '5555']);
      expect(result).toMatchObject({
        command: 'tmode',
        args: ['port', '5555'],
      });
    });
  });

  describe('smode command', () => {
    it('should parse smode command', () => {
      const result = parseCommand(['smode']);
      expect(result).toMatchObject({
        command: 'smode',
        args: [],
      });
    });

    it('should parse smode -r', () => {
      const result = parseCommand(['smode', '-r']);
      expect(result).toMatchObject({
        command: 'smode',
        args: ['-r'],
      });
    });
  });

  describe('hilog command', () => {
    it('should parse hilog command', () => {
      const result = parseCommand(['hilog']);
      expect(result).toMatchObject({
        command: 'hilog',
        args: [],
      });
    });

    it('should parse hilog with options', () => {
      const result = parseCommand(['hilog', '-x']);
      expect(result).toMatchObject({
        command: 'hilog',
        args: ['-x'],
      });
    });
  });

  describe('bugreport command', () => {
    it('should parse bugreport command', () => {
      const result = parseCommand(['bugreport']);
      expect(result).toMatchObject({
        command: 'bugreport',
        args: [],
      });
    });

    it('should parse bugreport with file path', () => {
      const result = parseCommand(['bugreport', '/tmp/report.zip']);
      expect(result).toMatchObject({
        command: 'bugreport',
        args: ['/tmp/report.zip'],
      });
    });
  });

  describe('sideload command', () => {
    it('should parse sideload with path', () => {
      const result = parseCommand(['sideload', '/tmp/update.zip']);
      expect(result).toMatchObject({
        command: 'sideload',
        args: ['/tmp/update.zip'],
      });
    });
  });

  describe('keygen command', () => {
    it('should parse keygen with file path', () => {
      const result = parseCommand(['keygen', '~/.hdc/key']);
      expect(result).toMatchObject({
        command: 'keygen',
        args: ['~/.hdc/key'],
      });
    });
  });

  describe('rport command', () => {
    it('should parse rport with remote and local', () => {
      const result = parseCommand(['rport', 'tcp:8080', 'tcp:80']);
      expect(result).toMatchObject({
        command: 'rport',
        args: ['tcp:8080', 'tcp:80'],
      });
    });
  });

  describe('update command', () => {
    it('should parse update with package path', () => {
      const result = parseCommand(['update', '/tmp/update.pkg']);
      expect(result).toMatchObject({
        command: 'update',
        args: ['/tmp/update.pkg'],
      });
    });
  });

  describe('flash command', () => {
    it('should parse flash with partition and image', () => {
      const result = parseCommand(['flash', 'system', '/tmp/system.img']);
      expect(result).toMatchObject({
        command: 'flash',
        args: ['system', '/tmp/system.img'],
      });
    });

    it('should parse flash with -f flag', () => {
      const result = parseCommand(['flash', '-f', 'system', '/tmp/system.img']);
      expect(result).toMatchObject({
        command: 'flash',
        args: ['-f', 'system', '/tmp/system.img'],
      });
    });
  });

  describe('erase command', () => {
    it('should parse erase with partition', () => {
      const result = parseCommand(['erase', 'cache']);
      expect(result).toMatchObject({
        command: 'erase',
        args: ['cache'],
      });
    });

    it('should parse erase with -f flag', () => {
      const result = parseCommand(['erase', '-f', 'cache']);
      expect(result).toMatchObject({
        command: 'erase',
        args: ['-f', 'cache'],
      });
    });
  });

  describe('format command', () => {
    it('should parse format with partition', () => {
      const result = parseCommand(['format', 'data']);
      expect(result).toMatchObject({
        command: 'format',
        args: ['data'],
      });
    });

    it('should parse format with -f flag', () => {
      const result = parseCommand(['format', '-f', 'data']);
      expect(result).toMatchObject({
        command: 'format',
        args: ['-f', 'data'],
      });
    });
  });

  describe('start command', () => {
    it('should parse start command', () => {
      const result = parseCommand(['start']);
      expect(result).toMatchObject({
        command: 'start',
        args: [],
      });
    });

    it('should parse start -r', () => {
      const result = parseCommand(['start', '-r']);
      expect(result).toMatchObject({
        command: 'start',
        args: ['-r'],
      });
    });
  });

  describe('server command', () => {
    it('should parse server command', () => {
      const result = parseCommand(['server']);
      expect(result).toMatchObject({
        command: 'server',
        args: [],
        runInServer: false,
      });
    });
  });

  describe('--spawned-server internal flag', () => {
    it('should parse --spawned-server flag', () => {
      const result = parseCommand(['--spawned-server']);
      expect(result).toMatchObject({
        spawnedServer: true,
      });
    });
  });
});

describe('parseServerAddress', () => {
  it('should parse ip:port', () => {
    const result = parseServerAddress('192.168.1.1:8710');
    expect(result).toEqual({ host: '192.168.1.1', port: 8710 });
  });

  it('should parse port only', () => {
    const result = parseServerAddress('8710');
    expect(result).toEqual({ host: '127.0.0.1', port: 8710 });
  });

  it('should handle invalid port', () => {
    const result = parseServerAddress('localhost:abc');
    expect(result).toEqual({ host: 'localhost', port: 8710 });
  });

  it('should parse 0.0.0.0 address', () => {
    const result = parseServerAddress('0.0.0.0:9999');
    expect(result).toEqual({ host: '0.0.0.0', port: 9999 });
  });
});

describe('getDefaultServerAddress', () => {
  it('should return default address', () => {
    expect(getDefaultServerAddress()).toBe('127.0.0.1:8710');
  });
});

describe('getHelp', () => {
  it('should return help text', () => {
    const help = getHelp();
    expect(help).toContain('OpenHarmony Device Connector');
    expect(help).toContain('Usage:');
    expect(help).toContain('Commands:');
  });

  it('should document all new options', () => {
    const help = getHelp();
    expect(help).toContain('-e <ip>');
    expect(help).toContain('-m');
    expect(help).toContain('-p');
    expect(help).toContain('Skip server auto-pull-up');
  });

  it('should document all new commands', () => {
    const help = getHelp();
    expect(help).toContain('discover');
    expect(help).toContain('checkserver');
    expect(help).toContain('checkdevice');
    expect(help).toContain('wait');
    expect(help).toContain('tconn');
    expect(help).toContain('any');
    expect(help).toContain('jpid');
    expect(help).toContain('track-jpid');
    expect(help).toContain('target mount');
    expect(help).toContain('target boot');
    expect(help).toContain('tmode');
    expect(help).toContain('smode');
    expect(help).toContain('hilog');
    expect(help).toContain('bugreport');
    expect(help).toContain('sideload');
    expect(help).toContain('keygen');
    expect(help).toContain('rport');
    expect(help).toContain('update');
    expect(help).toContain('flash');
    expect(help).toContain('erase');
    expect(help).toContain('format');
    expect(help).toContain('start');
  });
});

describe('buildCommandString', () => {
  it('should build simple command string', () => {
    const result = buildCommandString({
      command: 'shell',
      args: ['ls', '-la'],
      logLevel: 2,
      runInServer: false,
      spawnedServer: false,
      skipPullup: false,
    });
    expect(result).toBe('shell ls -la');
  });

  it('should include targetKey when present', () => {
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

  it('should include forwardIP when present', () => {
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

  it('should include targetKey and forwardIP when both present', () => {
    const result = buildCommandString({
      command: 'shell',
      args: ['ls'],
      targetKey: 'device1',
      forwardIP: '0.0.0.0',
      logLevel: 2,
      runInServer: false,
      spawnedServer: false,
      skipPullup: false,
    });
    expect(result).toBe('-t device1 -e 0.0.0.0 shell ls');
  });

  it('should handle command with no args', () => {
    const result = buildCommandString({
      command: 'list',
      args: ['targets'],
      logLevel: 2,
      runInServer: false,
      spawnedServer: false,
      skipPullup: false,
    });
    expect(result).toBe('list targets');
  });
});
