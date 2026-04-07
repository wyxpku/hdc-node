/**
 * Parser Module Tests
 */

import { describe, it, expect } from 'vitest';
import { parseCommand, getHelp, parseServerAddress, getDefaultServerAddress, ParseError } from './parser.js';

describe('parseCommand', () => {
  it('should parse empty args', () => {
    const result = parseCommand([]);
    expect(result).toEqual({
      command: '',
      args: [],
      logLevel: 2,
      runInServer: false,
      spawnedServer: false,
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
});
