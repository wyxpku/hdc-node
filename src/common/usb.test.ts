/**
 * Tests for USB module
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HdcUSB, HdcUSBManager, USBState, USB_VENDOR_ID_HUAWEI, USB_PRODUCT_ID_HDC } from './usb.js';

describe('HdcUSB', () => {
  let usb: HdcUSB;

  beforeEach(() => {
    usb = new HdcUSB();
  });

  afterEach(async () => {
    await usb.disconnect();
  });

  describe('constructor', () => {
    it('should create USB instance', () => {
      expect(usb).toBeDefined();
      expect(usb.getState()).toBe(USBState.DISCONNECTED);
    });

    it('should accept custom options', () => {
      const customUsb = new HdcUSB({
        vendorId: 0x1234,
        productId: 0x5678,
        serialNumber: 'ABC123',
        timeout: 10000,
      });

      expect(customUsb['options'].vendorId).toBe(0x1234);
      expect(customUsb['options'].productId).toBe(0x5678);
      expect(customUsb['options'].serialNumber).toBe('ABC123');
      expect(customUsb['options'].timeout).toBe(10000);
    });

    it('should use default options', () => {
      expect(usb['options'].vendorId).toBe(USB_VENDOR_ID_HUAWEI);
      expect(usb['options'].productId).toBe(USB_PRODUCT_ID_HDC);
      expect(usb['options'].timeout).toBe(5000);
    });
  });

  describe('getState', () => {
    it('should return current state', () => {
      expect(usb.getState()).toBe(USBState.DISCONNECTED);
    });
  });

  describe('isConnected', () => {
    it('should return false when disconnected', () => {
      expect(usb.isConnected()).toBe(false);
    });
  });

  describe('getDevice', () => {
    it('should return null when disconnected', () => {
      expect(usb.getDevice()).toBeNull();
    });
  });

  describe('listDevices', () => {
    it('should return empty array (stub)', async () => {
      const devices = await usb.listDevices();
      expect(devices).toEqual([]);
    });
  });

  describe('connect', () => {
    it('should throw error (stub implementation)', async () => {
      await expect(usb.connect()).rejects.toThrow('native module');
    });
  });

  describe('disconnect', () => {
    it('should handle disconnect when not connected', async () => {
      await usb.disconnect();
      expect(usb.getState()).toBe(USBState.DISCONNECTED);
    });

    it('should be idempotent', async () => {
      await usb.disconnect();
      await usb.disconnect();
      await usb.disconnect();
      expect(usb.getState()).toBe(USBState.DISCONNECTED);
    });
  });

  describe('write', () => {
    it('should throw error when not connected', async () => {
      await expect(usb.write(Buffer.from('test'))).rejects.toThrow('not connected');
    });
  });

  describe('read', () => {
    it('should throw error when not connected', async () => {
      await expect(usb.read()).rejects.toThrow('not connected');
    });
  });

  describe('getConnectionKey', () => {
    it('should return empty string when disconnected', () => {
      expect(usb.getConnectionKey()).toBe('');
    });
  });
});

describe('HdcUSBManager', () => {
  let manager: HdcUSBManager;

  beforeEach(() => {
    manager = new HdcUSBManager();
  });

  afterEach(async () => {
    await manager.disconnectAll();
  });

  describe('constructor', () => {
    it('should create manager', () => {
      expect(manager.count).toBe(0);
    });
  });

  describe('createConnection', () => {
    it('should create USB connection', () => {
      const usb = manager.createConnection();
      expect(usb).toBeDefined();
    });
  });

  describe('getConnection', () => {
    it('should return undefined for non-existent key', () => {
      const conn = manager.getConnection('nonexistent');
      expect(conn).toBeUndefined();
    });
  });

  describe('listConnections', () => {
    it('should return empty array initially', () => {
      const connections = manager.listConnections();
      expect(connections.length).toBe(0);
    });
  });

  describe('count', () => {
    it('should return 0 initially', () => {
      expect(manager.count).toBe(0);
    });
  });

  describe('disconnectAll', () => {
    it('should disconnect all connections', async () => {
      manager.createConnection();
      manager.createConnection();

      await manager.disconnectAll();

      expect(manager.count).toBe(0);
    });
  });
});

describe('USBState enum', () => {
  it('should have correct values', () => {
    expect(USBState.DISCONNECTED).toBe('disconnected');
    expect(USBState.CONNECTING).toBe('connecting');
    expect(USBState.CONNECTED).toBe('connected');
    expect(USBState.ERROR).toBe('error');
  });
});

describe('Constants', () => {
  it('should have correct vendor/product IDs', () => {
    expect(USB_VENDOR_ID_HUAWEI).toBe(0x12d1);
    expect(USB_PRODUCT_ID_HDC).toBe(0x5000);
  });
});
