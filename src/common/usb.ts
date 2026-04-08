/**
 * HDC USB Module
 *
 * USB connection management for HDC devices.
 * Ported from: hdc-source/src/common/usb.cpp
 *
 * Note: In Node.js, USB access requires native modules like usb or node-usb.
 * This implementation provides a high-level API with pluggable backends.
 */

import { EventEmitter } from 'events';
import { GetRandomU32 } from './base.js';

// ============================================================================
// Constants
// ============================================================================

export const USB_VENDOR_ID_HUAWEI = 0x12d1;
export const USB_PRODUCT_ID_HDC = 0x5000;
export const USB_INTERFACE_CLASS = 0xFF;
export const USB_ENDPOINT_IN = 0x81;
export const USB_ENDPOINT_OUT = 0x01;
export const USB_MAX_PACKET_SIZE = 512;
export const USB_READ_TIMEOUT = 5000;
export const USB_WRITE_TIMEOUT = 5000;

export enum USBState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  ERROR = 'error',
}

// ============================================================================
// Types
// ============================================================================

export interface USBDevice {
  busNumber: number;
  deviceAddress: number;
  vendorId: number;
  productId: number;
  serialNumber?: string;
  manufacturer?: string;
  product?: string;
}

export interface USBOptions {
  vendorId?: number;
  productId?: number;
  serialNumber?: string;
  timeout?: number;
}

export interface USBEndpoint {
  address: number;
  direction: 'in' | 'out';
  transferType: 'bulk' | 'interrupt' | 'isochronous';
  maxPacketSize: number;
}

export interface USBInterface {
  interfaceNumber: number;
  alternateSetting: number;
  interfaceClass: number;
  interfaceSubClass: number;
  interfaceProtocol: number;
  endpoints: USBEndpoint[];
}

// ============================================================================
// HdcUSB - USB Connection
// ============================================================================

export class HdcUSB extends EventEmitter {
  private state: USBState = USBState.DISCONNECTED;
  private device: USBDevice | null = null;
  private options: Required<USBOptions>;
  private readBuffer: Buffer[] = [];
  private writeQueue: Buffer[] = [];

  constructor(options: USBOptions = {}) {
    super();
    this.options = {
      vendorId: options.vendorId || USB_VENDOR_ID_HUAWEI,
      productId: options.productId || USB_PRODUCT_ID_HDC,
      serialNumber: options.serialNumber || '',
      timeout: options.timeout || USB_READ_TIMEOUT,
    };
  }

  /**
   * Get current state
   */
  getState(): USBState {
    return this.state;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.state === USBState.CONNECTED;
  }

  /**
   * Get device info
   */
  getDevice(): USBDevice | null {
    return this.device;
  }

  /**
   * List available USB devices
   * Note: Requires native USB module
   */
  async listDevices(): Promise<USBDevice[]> {
    // This is a stub implementation
    // In production, this would use node-usb or similar
    return [];
  }

  /**
   * Connect to USB device
   * Note: Requires native USB module
   */
  async connect(): Promise<void> {
    if (this.state === USBState.CONNECTED) {
      return;
    }

    this.state = USBState.CONNECTING;
    this.emit('connecting');

    try {
      // This is a stub implementation
      // In production, this would:
      // 1. Find device with matching vendor/product ID
      // 2. Open device
      // 3. Claim interface
      // 4. Start reading from endpoint

      throw new Error('USB support requires native module (usb or node-usb)');
    } catch (err) {
      this.state = USBState.ERROR;
      this.emit('error', err);
      throw err;
    }
  }

  /**
   * Disconnect from USB device
   */
  async disconnect(): Promise<void> {
    if (this.state === USBState.DISCONNECTED) {
      return;
    }

    try {
      // Release resources
      this.device = null;
      this.readBuffer = [];
      this.writeQueue = [];

      this.state = USBState.DISCONNECTED;
      this.emit('disconnect');
    } catch (err) {
      this.state = USBState.ERROR;
      this.emit('error', err);
    }
  }

  /**
   * Write data to USB device
   */
  async write(data: Buffer): Promise<number> {
    if (!this.isConnected()) {
      throw new Error('USB device not connected');
    }

    // Stub implementation
    // In production, this would write to USB OUT endpoint
    this.writeQueue.push(data);
    this.emit('write', data);
    return data.length;
  }

  /**
   * Read data from USB device
   */
  async read(size: number = USB_MAX_PACKET_SIZE): Promise<Buffer> {
    if (!this.isConnected()) {
      throw new Error('USB device not connected');
    }

    // Stub implementation
    // In production, this would read from USB IN endpoint
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('USB read timeout'));
      }, this.options.timeout);

      // Wait for data in buffer
      const checkBuffer = () => {
        if (this.readBuffer.length > 0) {
          clearTimeout(timeout);
          resolve(this.readBuffer.shift()!);
        } else {
          setTimeout(checkBuffer, 10);
        }
      };
      checkBuffer();
    });
  }

  /**
   * Get connection key for this device
   */
  getConnectionKey(): string {
    if (!this.device) {
      return '';
    }
    return `usb:${this.device.busNumber}:${this.device.deviceAddress}`;
  }
}

// ============================================================================
// HdcUSBManager - Manage multiple USB connections
// ============================================================================

export class HdcUSBManager extends EventEmitter {
  private connections: Map<string, HdcUSB> = new Map();

  /**
   * Create new USB connection
   */
  createConnection(options?: USBOptions): HdcUSB {
    const usb = new HdcUSB(options);

    usb.on('connect', () => {
      this.emit('connect', usb);
    });

    usb.on('disconnect', () => {
      const key = usb.getConnectionKey();
      this.connections.delete(key);
      this.emit('disconnect', usb);
    });

    usb.on('error', (err: Error) => {
      this.emit('error', usb, err);
    });

    return usb;
  }

  /**
   * Get connection by key
   */
  getConnection(key: string): HdcUSB | undefined {
    return this.connections.get(key);
  }

  /**
   * List all connections
   */
  listConnections(): HdcUSB[] {
    return Array.from(this.connections.values());
  }

  /**
   * Get connection count
   */
  get count(): number {
    return this.connections.size;
  }

  /**
   * Disconnect all
   */
  async disconnectAll(): Promise<void> {
    const promises = Array.from(this.connections.values()).map(usb => usb.disconnect());
    await Promise.all(promises);
    this.connections.clear();
  }
}

// ============================================================================
// Helper functions
// ============================================================================

/**
 * Check if USB is available
 */
export function isUSBAvailable(): boolean {
  try {
    require.resolve('usb');
    return true;
  } catch {
    return false;
  }
}

/**
 * Get USB backend name
 */
export function getUSBBackend(): string | null {
  if (isUSBAvailable()) {
    return 'node-usb';
  }
  return null;
}
