/**
 * Tests for UART module
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HdcUART, HdcUARTManager, UARTState, DEFAULT_BAUD_RATE } from './uart.js';

describe('HdcUART', () => {
  describe('constructor', () => {
    it('should create UART instance', () => {
      const uart = new HdcUART({ path: '/dev/ttyUSB0' });

      expect(uart.getState()).toBe(UARTState.CLOSED);
      expect(uart.getPath()).toBe('/dev/ttyUSB0');
    });

    it('should accept custom options', () => {
      const uart = new HdcUART({
        path: '/dev/ttyUSB1',
        baudRate: 9600,
        dataBits: 7,
        stopBits: 2,
        parity: 'even',
        flowControl: 'hardware',
        timeout: 10000,
      });

      expect(uart.getPath()).toBe('/dev/ttyUSB1');
      expect(uart.getBaudRate()).toBe(9600);
      expect(uart['options'].dataBits).toBe(7);
      expect(uart['options'].stopBits).toBe(2);
      expect(uart['options'].parity).toBe('even');
      expect(uart['options'].flowControl).toBe('hardware');
      expect(uart['options'].timeout).toBe(10000);
    });

    it('should use default options', () => {
      const uart = new HdcUART({ path: '/dev/ttyUSB0' });

      expect(uart.getBaudRate()).toBe(DEFAULT_BAUD_RATE);
      expect(uart['options'].dataBits).toBe(8);
      expect(uart['options'].stopBits).toBe(1);
      expect(uart['options'].parity).toBe('none');
    });
  });

  describe('getState', () => {
    it('should return current state', () => {
      const uart = new HdcUART({ path: '/dev/ttyUSB0' });
      expect(uart.getState()).toBe(UARTState.CLOSED);
    });
  });

  describe('isOpen', () => {
    it('should return false when closed', () => {
      const uart = new HdcUART({ path: '/dev/ttyUSB0' });
      expect(uart.isOpen()).toBe(false);
    });
  });

  describe('getPath', () => {
    it('should return port path', () => {
      const uart = new HdcUART({ path: '/dev/ttyACM0' });
      expect(uart.getPath()).toBe('/dev/ttyACM0');
    });
  });

  describe('getBaudRate', () => {
    it('should return baud rate', () => {
      const uart = new HdcUART({ path: '/dev/ttyUSB0', baudRate: 57600 });
      expect(uart.getBaudRate()).toBe(57600);
    });
  });

  describe('listPorts', () => {
    it('should return empty array (stub)', async () => {
      const ports = await HdcUART.listPorts();
      expect(ports).toEqual([]);
    });
  });

  describe('open', () => {
    it('should throw error (stub implementation)', async () => {
      const uart = new HdcUART({ path: '/dev/ttyUSB0' });

      await expect(uart.open()).rejects.toThrow('native module');
    });
  });

  describe('close', () => {
    it('should handle close when not open', async () => {
      const uart = new HdcUART({ path: '/dev/ttyUSB0' });
      await uart.close();
      expect(uart.getState()).toBe(UARTState.CLOSED);
    });

    it('should be idempotent', async () => {
      const uart = new HdcUART({ path: '/dev/ttyUSB0' });
      await uart.close();
      await uart.close();
      await uart.close();
      expect(uart.getState()).toBe(UARTState.CLOSED);
    });
  });

  describe('write', () => {
    it('should throw error when not open', async () => {
      const uart = new HdcUART({ path: '/dev/ttyUSB0' });
      await expect(uart.write(Buffer.from('test'))).rejects.toThrow('not open');
    });
  });

  describe('read', () => {
    it('should throw error when not open', async () => {
      const uart = new HdcUART({ path: '/dev/ttyUSB0' });
      await expect(uart.read()).rejects.toThrow('not open');
    });
  });

  describe('setBaudRate', () => {
    it('should throw error when not open', async () => {
      const uart = new HdcUART({ path: '/dev/ttyUSB0' });
      await expect(uart.setBaudRate(115200)).rejects.toThrow('not open');
    });
  });

  describe('flush', () => {
    it('should throw error when not open', async () => {
      const uart = new HdcUART({ path: '/dev/ttyUSB0' });
      await expect(uart.flush()).rejects.toThrow('not open');
    });
  });

  describe('drain', () => {
    it('should throw error when not open', async () => {
      const uart = new HdcUART({ path: '/dev/ttyUSB0' });
      await expect(uart.drain()).rejects.toThrow('not open');
    });
  });

  describe('getConnectionKey', () => {
    it('should return connection key', () => {
      const uart = new HdcUART({ path: '/dev/ttyUSB0', baudRate: 115200 });
      expect(uart.getConnectionKey()).toBe('uart:/dev/ttyUSB0:115200');
    });
  });
});

describe('HdcUARTManager', () => {
  let manager: HdcUARTManager;

  beforeEach(() => {
    manager = new HdcUARTManager();
  });

  afterEach(async () => {
    await manager.closeAll();
  });

  describe('constructor', () => {
    it('should create manager', () => {
      expect(manager.count).toBe(0);
    });
  });

  describe('createConnection', () => {
    it('should create UART connection', () => {
      const uart = manager.createConnection({ path: '/dev/ttyUSB0' });
      expect(uart).toBeDefined();
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

  describe('closeAll', () => {
    it('should close all connections', async () => {
      manager.createConnection({ path: '/dev/ttyUSB0' });
      manager.createConnection({ path: '/dev/ttyUSB1' });

      await manager.closeAll();

      expect(manager.count).toBe(0);
    });
  });
});

describe('UARTState enum', () => {
  it('should have correct values', () => {
    expect(UARTState.CLOSED).toBe('closed');
    expect(UARTState.OPENING).toBe('opening');
    expect(UARTState.OPEN).toBe('open');
    expect(UARTState.CLOSING).toBe('closing');
    expect(UARTState.ERROR).toBe('error');
  });
});

describe('Constants', () => {
  it('should have correct default baud rate', () => {
    expect(DEFAULT_BAUD_RATE).toBe(115200);
  });
});
