/**
 * HDC UART Module
 *
 * Serial port (UART) connection management for HDC devices.
 * Ported from: hdc-source/src/common/uart.cpp
 *
 * Note: In Node.js, serial port access requires the 'serialport' package.
 * This implementation provides a high-level API with pluggable backends.
 */

import { EventEmitter } from 'events';
import { GetRandomString } from './base.js';

// ============================================================================
// Constants
// ============================================================================

export const DEFAULT_BAUD_RATE = 115200;
export const DEFAULT_DATA_BITS = 8;
export const DEFAULT_STOP_BITS = 1;
export const DEFAULT_PARITY = 'none';

export enum UARTState {
  CLOSED = 'closed',
  OPENING = 'opening',
  OPEN = 'open',
  CLOSING = 'closing',
  ERROR = 'error',
}

export type ParityType = 'none' | 'even' | 'odd' | 'mark' | 'space';
export type FlowControlType = 'none' | 'hardware' | 'software';

// ============================================================================
// Types
// ============================================================================

export interface UARTOptions {
  path: string;
  baudRate?: number;
  dataBits?: 5 | 6 | 7 | 8;
  stopBits?: 1 | 2;
  parity?: ParityType;
  flowControl?: FlowControlType;
  timeout?: number;
}

export interface UARTPortInfo {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
  pnpId?: string;
  vendorId?: string;
  productId?: string;
}

// ============================================================================
// HdcUART - Serial Port Connection
// ============================================================================

export class HdcUART extends EventEmitter {
  private state: UARTState = UARTState.CLOSED;
  private options: Required<UARTOptions>;
  private port: any = null;
  private buffer: Buffer = Buffer.alloc(0);

  constructor(options: UARTOptions) {
    super();
    this.options = {
      path: options.path,
      baudRate: options.baudRate ?? DEFAULT_BAUD_RATE,
      dataBits: options.dataBits ?? 8,
      stopBits: options.stopBits ?? 1,
      parity: options.parity ?? 'none',
      flowControl: options.flowControl ?? 'none',
      timeout: options.timeout ?? 5000,
    };
  }

  /**
   * Get current state
   */
  getState(): UARTState {
    return this.state;
  }

  /**
   * Check if port is open
   */
  isOpen(): boolean {
    return this.state === UARTState.OPEN;
  }

  /**
   * Get port path
   */
  getPath(): string {
    return this.options.path;
  }

  /**
   * Get baud rate
   */
  getBaudRate(): number {
    return this.options.baudRate;
  }

  /**
   * List available serial ports
   * Note: Requires 'serialport' package
   */
  static async listPorts(): Promise<UARTPortInfo[]> {
    // Stub implementation
    // In production, this would use serialport.list()
    return [];
  }

  /**
   * Open serial port
   * Note: Requires 'serialport' package
   */
  async open(): Promise<void> {
    if (this.state === UARTState.OPEN) {
      return;
    }

    this.state = UARTState.OPENING;
    this.emit('opening');

    try {
      // Stub implementation
      // In production, this would:
      // 1. Import serialport package
      // 2. Create SerialPort instance
      // 3. Open port with options
      // 4. Setup data handlers

      throw new Error('UART support requires native module (serialport)');
    } catch (err) {
      this.state = UARTState.ERROR;
      this.emit('error', err);
      throw err;
    }
  }

  /**
   * Close serial port
   */
  async close(): Promise<void> {
    if (this.state === UARTState.CLOSED) {
      return;
    }

    this.state = UARTState.CLOSING;

    try {
      if (this.port) {
        // Close port
        this.port = null;
      }

      this.buffer = Buffer.alloc(0);
      this.state = UARTState.CLOSED;
      this.emit('close');
    } catch (err) {
      this.state = UARTState.ERROR;
      this.emit('error', err);
    }
  }

  /**
   * Write data to serial port
   */
  async write(data: Buffer): Promise<number> {
    if (!this.isOpen()) {
      throw new Error('Serial port not open');
    }

    // Stub implementation
    // In production, this would write to SerialPort
    this.emit('write', data);
    return data.length;
  }

  /**
   * Read data from serial port
   */
  async read(size?: number, timeout?: number): Promise<Buffer> {
    if (!this.isOpen()) {
      throw new Error('Serial port not open');
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('UART read timeout'));
      }, timeout ?? this.options.timeout);

      const checkBuffer = () => {
        if (this.buffer.length > 0) {
          clearTimeout(timer);
          const data = size ? this.buffer.subarray(0, size) : this.buffer;
          this.buffer = size ? this.buffer.subarray(size) : Buffer.alloc(0);
          resolve(data);
        } else {
          setTimeout(checkBuffer, 10);
        }
      };
      checkBuffer();
    });
  }

  /**
   * Set baud rate
   */
  async setBaudRate(baudRate: number): Promise<void> {
    if (!this.isOpen()) {
      throw new Error('Serial port not open');
    }

    this.options.baudRate = baudRate;
    // In production, this would call port.update({ baudRate })
    this.emit('baudrate-change', baudRate);
  }

  /**
   * Flush buffers
   */
  async flush(): Promise<void> {
    if (!this.isOpen()) {
      throw new Error('Serial port not open');
    }

    this.buffer = Buffer.alloc(0);
    // In production, this would call port.flush()
    this.emit('flush');
  }

  /**
   * Drain output buffer
   */
  async drain(): Promise<void> {
    if (!this.isOpen()) {
      throw new Error('Serial port not open');
    }

    // In production, this would call port.drain()
    this.emit('drain');
  }

  /**
   * Handle incoming data
   */
  private onData(data: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, data]);
    this.emit('data', data);
  }

  /**
   * Get connection key
   */
  getConnectionKey(): string {
    return `uart:${this.options.path}:${this.options.baudRate}`;
  }
}

// ============================================================================
// HdcUARTManager - Manage multiple UART connections
// ============================================================================

export class HdcUARTManager extends EventEmitter {
  private connections: Map<string, HdcUART> = new Map();

  /**
   * Create new UART connection
   */
  createConnection(options: UARTOptions): HdcUART {
    const uart = new HdcUART(options);

    uart.on('open', () => {
      const key = uart.getConnectionKey();
      this.connections.set(key, uart);
      this.emit('connect', uart);
    });

    uart.on('close', () => {
      const key = uart.getConnectionKey();
      this.connections.delete(key);
      this.emit('disconnect', uart);
    });

    uart.on('error', (err: Error) => {
      this.emit('error', uart, err);
    });

    return uart;
  }

  /**
   * Get connection by key
   */
  getConnection(key: string): HdcUART | undefined {
    return this.connections.get(key);
  }

  /**
   * List all connections
   */
  listConnections(): HdcUART[] {
    return Array.from(this.connections.values());
  }

  /**
   * Get connection count
   */
  get count(): number {
    return this.connections.size;
  }

  /**
   * Close all connections
   */
  async closeAll(): Promise<void> {
    const promises = Array.from(this.connections.values()).map(uart => uart.close());
    await Promise.all(promises);
    this.connections.clear();
  }
}

// ============================================================================
// Helper functions
// ============================================================================

/**
 * Check if serialport is available
 */
export function isUARTAvailable(): boolean {
  try {
    require.resolve('serialport');
    return true;
  } catch {
    return false;
  }
}

/**
 * Get UART backend name
 */
export function getUARTBackend(): string | null {
  if (isUARTAvailable()) {
    return 'serialport';
  }
  return null;
}
