/**
 * Tests for base utilities
 */

import { describe, it, expect } from 'vitest';
import {
  // Log constants
  LOG_DEBUG, LOG_INFO, LOG_WARN, LOG_ERROR, LOG_FATAL,
  GetLogLevel, SetLogLevel, GetLogLevelString,
  
  // String utilities
  StringFormat, RightTrim, LeftTrim, Trim, SplitString, ReplaceAll,
  IsDigitString, StringEndsWith, ShellCmdTrim,
  
  // Random utilities
  GetRandomNum, GetRandomU32, GetRandom, GetRandomString,
  
  // Time utilities
  GetRuntimeMSec,
  
  // Buffer utilities
  CalcCheckSum, ReallocBuf,
  
  // Encoding utilities
  Base64Encode, Base64Decode, Convert2HexStr, HexToBytes,
  
  // Network utilities
  ConnectKey2IPPort, IPPort2ConnectKey, IsValidIpv4,
  
  // Byte order utilities
  HostToNet32, NetToHost32, HostToNet16, NetToHost16,
  
  // File utilities
  GetPathWithoutFilename, GetFileNameAny, IsAbsolutePath,
  
  // TLV utilities
  TLV_TAG_LEN, TLV_VAL_LEN, TLV_MIN_LEN, TlvAppend, TlvToStringMap,
  
  // Command parsing
  SplitCommandToArgs,
  
  // Misc
  GetVersion, GetMaxBufSize, ReverseBytes,
} from './base.js';

describe('Log Functions', () => {
  it('should get and set log level', () => {
    const original = GetLogLevel();
    SetLogLevel(LOG_WARN);
    expect(GetLogLevel()).toBe(LOG_WARN);
    SetLogLevel(original);
    expect(GetLogLevel()).toBe(original);
  });

  it('should return correct log level strings', () => {
    expect(GetLogLevelString(LOG_FATAL)).toBe('F');
    expect(GetLogLevelString(LOG_ERROR)).toBe('E');
    expect(GetLogLevelString(LOG_WARN)).toBe('W');
    expect(GetLogLevelString(LOG_INFO)).toBe('I');
    expect(GetLogLevelString(LOG_DEBUG)).toBe('D');
    expect(GetLogLevelString(0)).toBe('A');
  });
});

describe('StringFormat', () => {
  it('should format strings', () => {
    expect(StringFormat('hello %s', 'world')).toBe('hello world');
    expect(StringFormat('count: %d', 42)).toBe('count: 42');
    expect(StringFormat('value: %f', 3.14)).toBe('value: 3.14');
    expect(StringFormat('hex: %x', 255)).toBe('hex: ff');
    expect(StringFormat('HEX: %X', 255)).toBe('HEX: FF');
  });

  it('should handle multiple placeholders', () => {
    expect(StringFormat('%s %d %s', 'test', 123, 'end')).toBe('test 123 end');
  });

  it('should handle escaped percent', () => {
    expect(StringFormat('100%% done')).toBe('100% done');
  });
});

describe('Trim Functions', () => {
  it('should right trim whitespace', () => {
    expect(RightTrim('hello   ')).toBe('hello');
    expect(RightTrim('hello\t\n')).toBe('hello');
    expect(RightTrim('  hello  ')).toBe('  hello');
  });

  it('should left trim whitespace', () => {
    expect(LeftTrim('   hello')).toBe('hello');
    expect(LeftTrim('\t\nhello')).toBe('hello');
    expect(LeftTrim('  hello  ')).toBe('hello  ');
  });

  it('should trim both sides', () => {
    expect(Trim('  hello  ')).toBe('hello');
    expect(Trim('\t\nhello\t\n')).toBe('hello');
  });

  it('should use custom whitespace', () => {
    expect(Trim('--hello--', '-')).toBe('hello');
  });
});

describe('SplitString', () => {
  it('should split string by delimiter', () => {
    expect(SplitString('a,b,c', ',')).toEqual(['a', 'b', 'c']);
    expect(SplitString('one|two|three', '|')).toEqual(['one', 'two', 'three']);
  });

  it('should handle empty string', () => {
    expect(SplitString('', ',')).toEqual([]);
  });

  it('should filter empty segments', () => {
    expect(SplitString('a,,b,,c', ',')).toEqual(['a', 'b', 'c']);
  });
});

describe('ReplaceAll', () => {
  it('should replace all occurrences', () => {
    expect(ReplaceAll('a-b-c', '-', '_')).toBe('a_b_c');
    expect(ReplaceAll('hello world world', 'world', 'there')).toBe('hello there there');
  });
});

describe('IsDigitString', () => {
  it('should return true for digit strings', () => {
    expect(IsDigitString('123')).toBe(true);
    expect(IsDigitString('0')).toBe(true);
  });

  it('should return false for non-digit strings', () => {
    expect(IsDigitString('123a')).toBe(false);
    expect(IsDigitString('abc')).toBe(false);
    expect(IsDigitString('')).toBe(false);
  });
});

describe('StringEndsWith', () => {
  it('should return index where suffix starts', () => {
    expect(StringEndsWith('hello.txt', '.txt')).toBe(5);
    expect(StringEndsWith('test.log', '.log')).toBe(4);
  });

  it('should return -1 if not ending with suffix', () => {
    expect(StringEndsWith('hello.txt', '.log')).toBe(-1);
    expect(StringEndsWith('test', '.txt')).toBe(-1);
  });
});

describe('ShellCmdTrim', () => {
  it('should trim and remove paired quotes', () => {
    expect(ShellCmdTrim('"hello world"')).toBe('hello world');
    expect(ShellCmdTrim("'hello world'")).toBe('hello world');
    expect(ShellCmdTrim('  hello  ')).toBe('hello');
  });
});

describe('Random Functions', () => {
  it('should generate random number in range', () => {
    for (let i = 0; i < 100; i++) {
      const r = GetRandomNum(0, 10);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(10);
    }
  });

  it('should generate random U32', () => {
    const r = GetRandomU32();
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(0xFFFFFFFF);
  });

  it('should generate random string', () => {
    const s = GetRandomString(16);
    expect(s.length).toBe(16);
    expect(GetRandomString(8).length).toBe(8);
  });

  it('should generate unique random strings', () => {
    const s1 = GetRandomString(16);
    const s2 = GetRandomString(16);
    expect(s1).not.toBe(s2);
  });
});

describe('Time Utilities', () => {
  it('should return current time in milliseconds', () => {
    const t1 = GetRuntimeMSec();
    const t2 = GetRuntimeMSec();
    expect(t2).toBeGreaterThanOrEqual(t1);
  });
});

describe('Buffer Utilities', () => {
  it('should calculate checksum', () => {
    expect(CalcCheckSum(new Uint8Array([1, 2, 3, 4, 5]))).toBe(15);
    expect(CalcCheckSum(new Uint8Array([0, 0, 0]))).toBe(0);
    expect(CalcCheckSum(new Uint8Array([255, 1]))).toBe(0); // 256 & 0xFF = 0
  });

  it('should realloc buffer', () => {
    const buf = new Uint8Array([1, 2, 3]);
    const newBuf = ReallocBuf(buf, 10);
    expect(newBuf.length).toBe(10);
    expect(newBuf[0]).toBe(1);
    expect(newBuf[1]).toBe(2);
    expect(newBuf[2]).toBe(3);
    expect(newBuf[3]).toBe(0);
  });
});

describe('Base64 Encoding', () => {
  it('should encode to base64', () => {
    expect(Base64Encode(new Uint8Array([0x61, 0x62, 0x63]))).toBe('YWJj');
    expect(Base64Encode(new Uint8Array([0x68, 0x65, 0x6C, 0x6C, 0x6F]))).toBe('aGVsbG8=');
  });

  it('should decode from base64', () => {
    expect(Array.from(Base64Decode('YWJj'))).toEqual([0x61, 0x62, 0x63]);
    expect(Array.from(Base64Decode('aGVsbG8='))).toEqual([0x68, 0x65, 0x6C, 0x6C, 0x6F]);
  });

  it('should be reversible', () => {
    const original = new Uint8Array([1, 2, 3, 4, 5, 100, 200]);
    const encoded = Base64Encode(original);
    const decoded = Base64Decode(encoded);
    expect(Array.from(decoded)).toEqual(Array.from(original));
  });
});

describe('Hex Encoding', () => {
  it('should convert to hex string', () => {
    expect(Convert2HexStr(new Uint8Array([0x00, 0x01, 0x0F, 0xFF]))).toBe('00010fff');
    expect(Convert2HexStr(new Uint8Array([0xAB, 0xCD]))).toBe('abcd');
  });

  it('should convert from hex string', () => {
    expect(Array.from(HexToBytes('00010fff'))).toEqual([0x00, 0x01, 0x0F, 0xFF]);
    expect(Array.from(HexToBytes('abcd'))).toEqual([0xAB, 0xCD]);
  });

  it('should be reversible', () => {
    const original = new Uint8Array([0x12, 0x34, 0xAB, 0xCD]);
    const hex = Convert2HexStr(original);
    const bytes = HexToBytes(hex);
    expect(Array.from(bytes)).toEqual(Array.from(original));
  });
});

describe('Network Utilities', () => {
  it('should parse IP:port', () => {
    const result = ConnectKey2IPPort('127.0.0.1:8080');
    expect(result).not.toBeNull();
    expect(result!.ip).toBe('127.0.0.1');
    expect(result!.port).toBe(8080);
  });

  it('should parse IPv6 with brackets', () => {
    const result = ConnectKey2IPPort('[::1]:8080');
    expect(result).not.toBeNull();
    expect(result!.ip).toBe('::1');
    expect(result!.port).toBe(8080);
  });

  it('should return null for invalid format', () => {
    expect(ConnectKey2IPPort('invalid')).toBeNull();
    expect(ConnectKey2IPPort('noport:')).toBeNull();
  });

  it('should convert back to connect key', () => {
    expect(IPPort2ConnectKey('127.0.0.1', 8080)).toBe('127.0.0.1:8080');
    expect(IPPort2ConnectKey('::1', 8080)).toBe('[::1]:8080');
  });

  it('should validate IPv4', () => {
    expect(IsValidIpv4('127.0.0.1')).toBe(true);
    expect(IsValidIpv4('192.168.1.1')).toBe(true);
    expect(IsValidIpv4('0.0.0.0')).toBe(true);
    expect(IsValidIpv4('255.255.255.255')).toBe(true);
    expect(IsValidIpv4('256.0.0.1')).toBe(false);
    expect(IsValidIpv4('1.2.3')).toBe(false);
    expect(IsValidIpv4('::1')).toBe(false);
  });
});

describe('Byte Order', () => {
  it('should convert 32-bit host to network', () => {
    expect(HostToNet32(0x12345678)).toBe(0x78563412);
  });

  it('should convert 32-bit network to host', () => {
    expect(NetToHost32(0x78563412)).toBe(0x12345678);
  });

  it('should be reversible for 32-bit', () => {
    const original = 0x12345678;
    expect(NetToHost32(HostToNet32(original))).toBe(original);
  });

  it('should convert 16-bit host to network', () => {
    expect(HostToNet16(0x1234)).toBe(0x3412);
  });

  it('should convert 16-bit network to host', () => {
    expect(NetToHost16(0x3412)).toBe(0x1234);
  });

  it('should be reversible for 16-bit', () => {
    const original = 0xCAFE;
    expect(NetToHost16(HostToNet16(original))).toBe(original);
  });
});

describe('File Utilities', () => {
  it('should get path without filename', () => {
    expect(GetPathWithoutFilename('/path/to/file.txt')).toBe('/path/to');
    expect(GetPathWithoutFilename('relative/path/file.txt')).toBe('relative/path');
    expect(GetPathWithoutFilename('file.txt')).toBe('.');
  });

  it('should get filename from path', () => {
    expect(GetFileNameAny('/path/to/file.txt')).toBe('file.txt');
    expect(GetFileNameAny('file.txt')).toBe('file.txt');
  });

  it('should check absolute path', () => {
    expect(IsAbsolutePath('/absolute/path')).toBe(true);
    expect(IsAbsolutePath('relative/path')).toBe(false);
    expect(IsAbsolutePath('C:\\Windows')).toBe(true); // Windows absolute path
  });
});

describe('TLV Utilities', () => {
  it('should append TLV entries', () => {
    const tlv = TlvAppend('', 'name', 'value');
    expect(tlv.length).toBe(TLV_MIN_LEN);
  });

  it('should parse TLV to map', () => {
    let tlv = '';
    tlv = TlvAppend(tlv, 'key1', 'val1');
    tlv = TlvAppend(tlv, 'key2', 'val2');
    
    const map = TlvToStringMap(tlv);
    expect(map.get('key1')).toBe('val1');
    expect(map.get('key2')).toBe('val2');
    expect(map.size).toBe(2);
  });
});

describe('SplitCommandToArgs', () => {
  it('should split simple command', () => {
    expect(SplitCommandToArgs('ls -la /home')).toEqual(['ls', '-la', '/home']);
  });

  it('should handle quoted strings', () => {
    expect(SplitCommandToArgs('echo "hello world"')).toEqual(['echo', 'hello world']);
    expect(SplitCommandToArgs("echo 'hello world'")).toEqual(['echo', 'hello world']);
  });

  it('should handle extra whitespace', () => {
    expect(SplitCommandToArgs('cmd   arg1\targ2')).toEqual(['cmd', 'arg1', 'arg2']);
  });
});

describe('Misc Utilities', () => {
  it('should return version', () => {
    expect(GetVersion()).toBe('1.0.0');
  });

  it('should return max buffer size', () => {
    expect(GetMaxBufSize()).toBe(1024 * 1024);
  });

  it('should reverse bytes', () => {
    expect(Array.from(ReverseBytes(new Uint8Array([1, 2, 3, 4])))).toEqual([4, 3, 2, 1]);
  });
});
