/**
 * HDC Base Module - Core utilities
 *
 * Ported from: hdc-source/src/common/base.cpp (108KB)
 * 
 * This module provides fundamental utilities used throughout HDC:
 * - Logging
 * - String manipulation
 * - Buffer operations
 * - Time utilities
 * - File operations
 * - Network utilities
 * - Encoding (Base64, Hex)
 */

// ============================================================================
// Constants
// ============================================================================

export const LOG_OFF = 0;
export const LOG_FATAL = 1;
export const LOG_ERROR = 2;
export const LOG_WARN = 3;
export const LOG_INFO = 4;
export const LOG_DEBUG = 5;
export const LOG_ALL = 6;

export const TIME_BASE = 1000;
export const TIME_BUF_SIZE = 64;
export const BUF_SIZE_DEFAULT = 1024;
export const MAX_SIZE_IOBUF = 1024 * 1024; // 1MB
export const MAX_SIZE_IOBUF_STABLE = 256 * 1024; // 256KB
export const HDC_SOCKETPAIR_SIZE = MAX_SIZE_IOBUF;
export const MAX_USBFFS_BULK = 16384;
export const MAX_USBFFS_BULK_STABLE = 16384;

export const WHITE_SPACES = " \t\n\r\f\v";

// ============================================================================
// Global State
// ============================================================================

let g_logLevel: number = LOG_DEBUG;
let g_isBackgroundServer: boolean = false;

// ============================================================================
// Log Functions
// ============================================================================

export function GetLogLevel(): number {
  return g_logLevel;
}

export function SetLogLevel(level: number): void {
  g_logLevel = level;
}

export function GetLogLevelString(level: number): string {
  switch (level) {
    case LOG_FATAL: return 'F';
    case LOG_ERROR: return 'E';
    case LOG_WARN: return 'W';
    case LOG_INFO: return 'I';
    case LOG_DEBUG: return 'D';
    default: return 'A';
  }
}

export function GetTimeString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');
  const second = String(now.getSeconds()).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  
  if (g_logLevel >= LOG_DEBUG) {
    return `${year}-${month}-${day} ${hour}:${minute}:${second}.${ms}`;
  }
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

export function PrintMessage(fmt: string, ...args: any[]): void {
  const timestamp = GetTimeString();
  const levelStr = GetLogLevelString(LOG_INFO);
  const message = StringFormat(fmt, ...args);
  console.log(`[${timestamp}][${levelStr}] ${message}`);
}

// ============================================================================
// String Utilities
// ============================================================================

export function StringFormat(fmt: string, ...args: any[]): string {
  // Simple format replacement for %s, %d, %f, %x, %X
  let index = 0;
  return fmt.replace(/%([sdfxX%])/g, (match, specifier) => {
    if (specifier === '%') return '%';
    if (index >= args.length) return match;
    const arg = args[index++];
    switch (specifier) {
      case 's': return String(arg);
      case 'd': return String(Math.floor(Number(arg)));
      case 'f': return String(Number(arg));
      case 'x': return Math.floor(Number(arg)).toString(16);
      case 'X': return Math.floor(Number(arg)).toString(16).toUpperCase();
      default: return match;
    }
  });
}

export function RightTrim(s: string, whitespace: string = WHITE_SPACES): string {
  const end = s.length - 1;
  let i = end;
  while (i >= 0 && whitespace.includes(s[i])) i--;
  return s.substring(0, i + 1);
}

export function LeftTrim(s: string, whitespace: string = WHITE_SPACES): string {
  let i = 0;
  while (i < s.length && whitespace.includes(s[i])) i++;
  return s.substring(i);
}

export function Trim(s: string, whitespace: string = WHITE_SPACES): string {
  return LeftTrim(RightTrim(s, whitespace), whitespace);
}

export function SplitString(origString: string, seq: string): string[] {
  if (!origString) return [];
  return origString.split(seq).filter(s => s.length > 0);
}

export function ReplaceAll(str: string, from: string, to: string): string {
  return str.split(from).join(to);
}

export function IsDigitString(str: string): boolean {
  return /^\d+$/.test(str);
}

export function StringEndsWith(s: string, sub: string): number {
  if (s.endsWith(sub)) {
    return s.length - sub.length;
  }
  return -1;
}

export function ShellCmdTrim(cmd: string): string {
  let result = Trim(cmd);
  // Remove paired quotes
  if ((result.startsWith('"') && result.endsWith('"')) ||
      (result.startsWith("'") && result.endsWith("'"))) {
    result = result.slice(1, -1);
  }
  return result;
}

// ============================================================================
// Random Utilities
// ============================================================================

export function GetRandomNum(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function GetRandomU32(): number {
  return Math.floor(Math.random() * 0xFFFFFFFF);
}

export function GetRandom(min: number = 0, max: number = Number.MAX_SAFE_INTEGER): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function GetRandomString(expectedLen: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < expectedLen; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// ============================================================================
// Time Utilities
// ============================================================================

export function GetRuntimeMSec(): number {
  return Date.now();
}

export function GetRuntimeSec(): number {
  return Math.floor(Date.now() / 1000);
}

// ============================================================================
// Buffer Utilities
// ============================================================================

export function CalcCheckSum(data: Uint8Array | Buffer, len?: number): number {
  const length = len ?? data.length;
  let sum = 0;
  for (let i = 0; i < length; i++) {
    sum += data[i];
  }
  return sum & 0xFF;
}

export function ReallocBuf(origBuf: Uint8Array, sizeWanted: number): Uint8Array {
  const newBuf = new Uint8Array(sizeWanted);
  newBuf.set(origBuf.subarray(0, Math.min(origBuf.length, sizeWanted)));
  return newBuf;
}

// ============================================================================
// Encoding Utilities
// ============================================================================

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function Base64Encode(input: Uint8Array | Buffer): string {
  const bytes = Buffer.isBuffer(input) ? new Uint8Array(input) : input;
  let result = '';
  
  for (let i = 0; i < bytes.length; i += 3) {
    const remaining = bytes.length - i;
    const a = bytes[i];
    const b = remaining > 1 ? bytes[i + 1] : 0;
    const c = remaining > 2 ? bytes[i + 2] : 0;
    
    const bitmap = (a << 16) | (b << 8) | c;
    
    result += BASE64_CHARS[(bitmap >> 18) & 63];
    result += BASE64_CHARS[(bitmap >> 12) & 63];
    
    if (remaining > 1) {
      result += BASE64_CHARS[(bitmap >> 6) & 63];
    } else {
      result += '=';
    }
    
    if (remaining > 2) {
      result += BASE64_CHARS[bitmap & 63];
    } else {
      result += '=';
    }
  }
  
  return result;
}

export function Base64Decode(input: string): Uint8Array {
  // Remove any whitespace and validate
  const cleanInput = input.replace(/\s/g, '');
  const result: number[] = [];
  
  for (let i = 0; i < cleanInput.length; i += 4) {
    const chunk = cleanInput.substr(i, 4);
    
    const a = BASE64_CHARS.indexOf(chunk[0]);
    const b = BASE64_CHARS.indexOf(chunk[1]);
    const c = chunk[2] === '=' ? 0 : BASE64_CHARS.indexOf(chunk[2]);
    const d = chunk[3] === '=' ? 0 : BASE64_CHARS.indexOf(chunk[3]);
    
    const bitmap = (a << 18) | (b << 12) | (c << 6) | d;
    
    result.push((bitmap >> 16) & 255);
    
    if (chunk[2] !== '=') {
      result.push((bitmap >> 8) & 255);
    }
    
    if (chunk[3] !== '=') {
      result.push(bitmap & 255);
    }
  }
  
  return new Uint8Array(result);
}

export function Convert2HexStr(arr: Uint8Array | Buffer, length?: number): string {
  const len = length ?? arr.length;
  let result = '';
  for (let i = 0; i < len; i++) {
    result += arr[i].toString(16).padStart(2, '0');
  }
  return result;
}

export function HexToBytes(hex: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.substr(i, 2), 16));
  }
  return new Uint8Array(bytes);
}

// ============================================================================
// Network Utilities
// ============================================================================

export interface IPPort {
  ip: string;
  port: number;
}

export function ConnectKey2IPPort(connectKey: string): IPPort | null {
  // Format: "ip:port" or "[ipv6]:port"
  const ipv6Match = connectKey.match(/^\[([^\]]+)\]:(\d+)$/);
  if (ipv6Match) {
    return { ip: ipv6Match[1], port: parseInt(ipv6Match[2], 10) };
  }
  
  const parts = connectKey.split(':');
  if (parts.length === 2) {
    const port = parseInt(parts[1], 10);
    if (!isNaN(port)) {
      return { ip: parts[0], port };
    }
  }
  
  return null;
}

export function IPPort2ConnectKey(ip: string, port: number): string {
  if (ip.includes(':')) {
    // IPv6
    return `[${ip}]:${port}`;
  }
  return `${ip}:${port}`;
}

export function IsValidIpv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  
  for (const part of parts) {
    const num = parseInt(part, 10);
    if (isNaN(num) || num < 0 || num > 255) return false;
    if (part !== String(num)) return false; // No leading zeros
  }
  
  return true;
}

// ============================================================================
// Byte Order Utilities
// ============================================================================

export function HostToNet64(val: bigint | number): bigint {
  const v = BigInt(val);
  // JavaScript is little-endian by default, network is big-endian
  return (
    ((v & BigInt(0x00000000000000FF)) << BigInt(56)) |
    ((v & BigInt(0x000000000000FF00)) << BigInt(40)) |
    ((v & BigInt(0x0000000000FF0000)) << BigInt(24)) |
    ((v & BigInt(0x00000000FF000000)) << BigInt(8)) |
    ((v & BigInt(0x000000FF00000000)) >> BigInt(8)) |
    ((v & BigInt(0x0000FF0000000000)) >> BigInt(24)) |
    ((v & BigInt(0x00FF000000000000)) >> BigInt(40)) |
    ((v & BigInt(0xFF00000000000000)) >> BigInt(56))
  );
}

export function NetToHost64(val: bigint | number): bigint {
  return HostToNet64(val); // Same operation for reversal
}

export function HostToNet32(val: number): number {
  return (
    ((val & 0x000000FF) << 24) |
    ((val & 0x0000FF00) << 8) |
    ((val & 0x00FF0000) >> 8) |
    ((val & 0xFF000000) >> 24)
  ) >>> 0;
}

export function NetToHost32(val: number): number {
  return HostToNet32(val);
}

export function HostToNet16(val: number): number {
  return ((val & 0x00FF) << 8) | ((val & 0xFF00) >> 8);
}

export function NetToHost16(val: number): number {
  return HostToNet16(val);
}

// ============================================================================
// File Utilities
// ============================================================================

export function GetPathWithoutFilename(path: string): string {
  const lastSep = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  if (lastSep === -1) return '.';
  return path.substring(0, lastSep);
}

export function GetFileNameAny(path: string): string {
  const lastSep = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return path.substring(lastSep + 1);
}

export function GetFullFilePath(path: string): string {
  // In Node.js, we can use path.resolve
  // For now, just return as-is (would need 'path' module for full implementation)
  return path;
}

export function IsAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:/.test(path);
}

export function GetPathSep(): string {
  return '/';
}

// ============================================================================
// TLV Utilities
// ============================================================================

export const TLV_TAG_LEN = 16;
export const TLV_VAL_LEN = 16;
export const TLV_MIN_LEN = TLV_TAG_LEN + TLV_VAL_LEN;

export function TlvAppend(tlv: string, tag: string, val: string): string {
  const paddedTag = tag.padEnd(TLV_TAG_LEN, '\0');
  const paddedVal = val.padEnd(TLV_VAL_LEN, '\0');
  return tlv + paddedTag + paddedVal;
}

export function TlvToStringMap(tlv: string): Map<string, string> {
  const result = new Map<string, string>();
  
  for (let i = 0; i + TLV_MIN_LEN <= tlv.length; i += TLV_MIN_LEN) {
    const tag = tlv.substring(i, i + TLV_TAG_LEN).replace(/\0+$/, '');
    const val = tlv.substring(i + TLV_TAG_LEN, i + TLV_MIN_LEN).replace(/\0+$/, '');
    result.set(tag, val);
  }
  
  return result;
}

// ============================================================================
// Command Parsing
// ============================================================================

export function SplitCommandToArgs(cmdString: string): string[] {
  const args: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';
  
  for (let i = 0; i < cmdString.length; i++) {
    const c = cmdString[i];
    
    if (inQuote) {
      if (c === quoteChar) {
        inQuote = false;
      } else {
        current += c;
      }
    } else if (c === '"' || c === "'") {
      inQuote = true;
      quoteChar = c;
    } else if (c === ' ' || c === '\t') {
      if (current.length > 0) {
        args.push(current);
        current = '';
      }
    } else {
      current += c;
    }
  }
  
  if (current.length > 0) {
    args.push(current);
  }
  
  return args;
}

// ============================================================================
// Version
// ============================================================================

export function GetVersion(): string {
  return '1.0.0';
}

// ============================================================================
// Misc Utilities
// ============================================================================

export function ReverseBytes(data: Uint8Array): Uint8Array {
  const result = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    result[i] = data[data.length - 1 - i];
  }
  return result;
}

export function GetMaxBufSize(): number {
  return MAX_SIZE_IOBUF;
}

export function GetMaxBufSizeStable(): number {
  return MAX_SIZE_IOBUF_STABLE;
}

export function GetUsbffsBulkSize(): number {
  return MAX_USBFFS_BULK;
}
