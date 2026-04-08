/**
 * Tests for App Management module
 */

import { describe, it, expect, vi } from 'vitest';
import { HdcAppManager, AppState, APP_INSTALL_PREFIX, APP_UNINSTALL_PREFIX } from './app.js';

// Mock socket factory
function createMockSocket() {
  return {
    write: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  } as any;
}

describe('HdcAppManager', () => {
  describe('constructor', () => {
    it('should create manager instance', () => {
      const mockSocket = createMockSocket();
      const manager = new HdcAppManager(mockSocket);

      expect(manager.getState()).toBe(AppState.IDLE);
    });
  });

  describe('getState', () => {
    it('should return current state', () => {
      const mockSocket = createMockSocket();
      const manager = new HdcAppManager(mockSocket);

      expect(manager.getState()).toBe(AppState.IDLE);
    });
  });

  describe('install', () => {
    it('should reject if file does not exist', async () => {
      const mockSocket = createMockSocket();
      const manager = new HdcAppManager(mockSocket);

      await expect(manager.install({
        packagePath: '/nonexistent/app.hap',
      })).rejects.toThrow();
    });

    it('should reject if another operation in progress', async () => {
      const mockSocket = createMockSocket();
      const manager = new HdcAppManager(mockSocket);

      // Set state to installing
      manager['state'] = AppState.INSTALLING;

      await expect(manager.install({
        packagePath: '/some/app.hap',
      })).rejects.toThrow('Another operation in progress');
    });
  });

  describe('uninstall', () => {
    it('should reject if another operation in progress', async () => {
      const mockSocket = createMockSocket();
      const manager = new HdcAppManager(mockSocket);

      // Set state to installing
      manager['state'] = AppState.INSTALLING;

      await expect(manager.uninstall({
        packageName: 'com.example.app',
      })).rejects.toThrow('Another operation in progress');
    });

    it('should send uninstall command', async () => {
      const mockSocket = createMockSocket();
      const manager = new HdcAppManager(mockSocket);

      // Mock the waitForCompletion to resolve immediately
      manager['waitForCompletion'] = async () => {
        // Simulate successful completion
      };

      await manager.uninstall({
        packageName: 'com.example.app',
      });

      expect(mockSocket.write).toHaveBeenCalled();
    });
  });
});

describe('AppState enum', () => {
  it('should have correct values', () => {
    expect(AppState.IDLE).toBe('idle');
    expect(AppState.PREPARING).toBe('preparing');
    expect(AppState.INSTALLING).toBe('installing');
    expect(AppState.UNINSTALLING).toBe('uninstalling');
    expect(AppState.COMPLETED).toBe('completed');
    expect(AppState.ERROR).toBe('error');
  });
});

describe('Constants', () => {
  it('should have correct prefix values', () => {
    expect(APP_INSTALL_PREFIX).toBe('app:install:');
    expect(APP_UNINSTALL_PREFIX).toBe('app:uninstall:');
  });
});
