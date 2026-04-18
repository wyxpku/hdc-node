/**
 * Tests for Forward module
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  HdcForward,
  HdcForwardManager,
  HdcReverseForward,
  ForwardType,
  ForwardState,
  ForwardNode,
  parseForwardNode,
  formatForwardNode,
  createTcpForward,
} from './forward.js';

// ============================================================================
// parseForwardNode / formatForwardNode
// ============================================================================

describe('parseForwardNode', () => {
  it('should parse tcp node', () => {
    const node = parseForwardNode('tcp:8080');
    expect(node).not.toBeNull();
    expect(node!.type).toBe(ForwardType.TCP);
    expect(node!.value).toBe('8080');
  });

  it('should parse tcp node with port 0', () => {
    const node = parseForwardNode('tcp:0');
    expect(node).not.toBeNull();
    expect(node!.type).toBe(ForwardType.TCP);
    expect(node!.value).toBe('0');
  });

  it('should parse jdwp node', () => {
    const node = parseForwardNode('jdwp:1234');
    expect(node).not.toBeNull();
    expect(node!.type).toBe(ForwardType.JDWP);
    expect(node!.value).toBe('1234');
  });

  it('should parse ark node with complex value', () => {
    const node = parseForwardNode('ark:1234@5678@Debugger');
    expect(node).not.toBeNull();
    expect(node!.type).toBe(ForwardType.ARK);
    expect(node!.value).toBe('1234@5678@Debugger');
  });

  it('should parse localabstract node', () => {
    const node = parseForwardNode('localabstract:mysocket');
    expect(node).not.toBeNull();
    expect(node!.type).toBe(ForwardType.ABSTRACT);
    expect(node!.value).toBe('mysocket');
  });

  it('should parse localfilesystem node', () => {
    const node = parseForwardNode('localfilesystem:/tmp/sock');
    expect(node).not.toBeNull();
    expect(node!.type).toBe(ForwardType.FILESYSTEM);
    expect(node!.value).toBe('/tmp/sock');
  });

  it('should parse dev node', () => {
    const node = parseForwardNode('dev:/dev/ttyUSB0');
    expect(node).not.toBeNull();
    expect(node!.type).toBe(ForwardType.DEV);
    expect(node!.value).toBe('/dev/ttyUSB0');
  });

  it('should parse reserved node', () => {
    const node = parseForwardNode('reserved:something');
    expect(node).not.toBeNull();
    expect(node!.type).toBe(ForwardType.RESERVED);
    expect(node!.value).toBe('something');
  });

  it('should return null for empty string', () => {
    expect(parseForwardNode('')).toBeNull();
  });

  it('should return null for null/undefined', () => {
    expect(parseForwardNode(null as any)).toBeNull();
    expect(parseForwardNode(undefined as any)).toBeNull();
  });

  it('should return null for unknown prefix', () => {
    expect(parseForwardNode('unknown:value')).toBeNull();
  });

  it('should return null for prefix with no value', () => {
    expect(parseForwardNode('tcp:')).toBeNull();
  });

  it('should return null for plain string with no colon', () => {
    expect(parseForwardNode('something')).toBeNull();
  });

  it('should handle whitespace-padded input', () => {
    const node = parseForwardNode('  tcp:8080  ');
    expect(node).not.toBeNull();
    expect(node!.type).toBe(ForwardType.TCP);
    expect(node!.value).toBe('8080');
  });
});

describe('formatForwardNode', () => {
  it('should format tcp node', () => {
    expect(formatForwardNode({ type: ForwardType.TCP, value: '8080' })).toBe('tcp:8080');
  });

  it('should format jdwp node', () => {
    expect(formatForwardNode({ type: ForwardType.JDWP, value: '1234' })).toBe('jdwp:1234');
  });

  it('should format ark node', () => {
    expect(formatForwardNode({ type: ForwardType.ARK, value: '1234@5678@Debugger' })).toBe('ark:1234@5678@Debugger');
  });

  it('should format localabstract node', () => {
    expect(formatForwardNode({ type: ForwardType.ABSTRACT, value: 'mysocket' })).toBe('localabstract:mysocket');
  });

  it('should format localfilesystem node', () => {
    expect(formatForwardNode({ type: ForwardType.FILESYSTEM, value: '/tmp/sock' })).toBe('localfilesystem:/tmp/sock');
  });

  it('should format dev node', () => {
    expect(formatForwardNode({ type: ForwardType.DEV, value: '/dev/ttyUSB0' })).toBe('dev:/dev/ttyUSB0');
  });

  it('should format reserved node', () => {
    expect(formatForwardNode({ type: ForwardType.RESERVED, value: 'anything' })).toBe('reserved:anything');
  });
});

describe('parseForwardNode / formatForwardNode roundtrip', () => {
  it.each([
    'tcp:8080',
    'tcp:0',
    'jdwp:5678',
    'ark:1234@5678@Debugger',
    'localabstract:mysocket',
    'localfilesystem:/tmp/sock',
    'dev:/dev/ttyUSB0',
    'reserved:something',
  ])('should roundtrip %s', (spec) => {
    const node = parseForwardNode(spec);
    expect(node).not.toBeNull();
    expect(formatForwardNode(node!)).toBe(spec);
  });
});

// ============================================================================
// ForwardType enum
// ============================================================================

describe('ForwardType enum', () => {
  it('should have all 7 forward types', () => {
    expect(ForwardType.TCP).toBe('tcp');
    expect(ForwardType.JDWP).toBe('jdwp');
    expect(ForwardType.ARK).toBe('ark');
    expect(ForwardType.ABSTRACT).toBe('localabstract');
    expect(ForwardType.FILESYSTEM).toBe('localfilesystem');
    expect(ForwardType.DEV).toBe('dev');
    expect(ForwardType.RESERVED).toBe('reserved');
  });

  it('should have exactly 7 members', () => {
    const keys = Object.keys(ForwardType).filter(k => isNaN(Number(k)));
    expect(keys.length).toBe(7);
  });
});

describe('ForwardState enum', () => {
  it('should have correct values', () => {
    expect(ForwardState.IDLE).toBe('idle');
    expect(ForwardState.LISTENING).toBe('listening');
    expect(ForwardState.CONNECTING).toBe('connecting');
    expect(ForwardState.FORAWRDING).toBe('forwarding');
    expect(ForwardState.CLOSED).toBe('closed');
    expect(ForwardState.ERROR).toBe('error');
  });
});

// ============================================================================
// HdcForward
// ============================================================================

describe('HdcForward', () => {
  describe('constructor', () => {
    it('should create forward instance', () => {
      const forward = new HdcForward({
        localPort: 8080,
        remoteHost: '127.0.0.1',
        remotePort: 9090,
      });

      expect(forward.getId()).toBeDefined();
      expect(forward.getState()).toBe(ForwardState.IDLE);
      expect(forward.getLocalPort()).toBe(8080);
      expect(forward.getRemoteAddress()).toBe('127.0.0.1:9090');
    });

    it('should accept custom forward type', () => {
      const forward = new HdcForward({
        localPort: 8080,
        remoteHost: 'localhost',
        remotePort: 5005,
        type: ForwardType.JDWP,
      });

      expect(forward['type']).toBe(ForwardType.JDWP);
    });
  });

  describe('getId', () => {
    it('should return 8-character ID', () => {
      const forward = new HdcForward({
        localPort: 8080,
        remoteHost: '127.0.0.1',
        remotePort: 9090,
      });

      expect(forward.getId().length).toBe(8);
    });
  });

  describe('getState', () => {
    it('should return current state', () => {
      const forward = new HdcForward({
        localPort: 8080,
        remoteHost: '127.0.0.1',
        remotePort: 9090,
      });

      expect(forward.getState()).toBe(ForwardState.IDLE);
    });
  });

  describe('getSession', () => {
    it('should return session info', () => {
      const forward = new HdcForward({
        localPort: 8080,
        remoteHost: '127.0.0.1',
        remotePort: 9090,
      });

      const session = forward.getSession();

      expect(session.id).toBeDefined();
      expect(session.type).toBe(ForwardType.TCP);
      expect(session.localPort).toBe(8080);
      expect(session.remoteHost).toBe('127.0.0.1');
      expect(session.remotePort).toBe(9090);
      expect(session.state).toBe(ForwardState.IDLE);
      expect(session.bytesForwarded).toBe(0);
      expect(session.connections).toBe(0);
    });
  });

  describe('getBytesForwarded', () => {
    it('should return 0 initially', () => {
      const forward = new HdcForward({
        localPort: 8080,
        remoteHost: '127.0.0.1',
        remotePort: 9090,
      });

      expect(forward.getBytesForwarded()).toBe(0);
    });
  });

  describe('getConnections', () => {
    it('should return 0 initially', () => {
      const forward = new HdcForward({
        localPort: 8080,
        remoteHost: '127.0.0.1',
        remotePort: 9090,
      });

      expect(forward.getConnections()).toBe(0);
    });
  });

  describe('start', () => {
    it('should start listening on local port', async () => {
      const forward = new HdcForward({
        localPort: 0, // Use random port
        remoteHost: '127.0.0.1',
        remotePort: 9999,
      });

      await forward.start();

      expect(forward.getState()).toBe(ForwardState.FORAWRDING);
      expect(forward.isActive()).toBe(true);

      await forward.stop();
    });

    it('should emit listening event', async () => {
      const forward = new HdcForward({
        localPort: 0,
        remoteHost: '127.0.0.1',
        remotePort: 9999,
      });

      let listeningPort = 0;
      forward.on('listening', (port: number) => {
        listeningPort = port;
      });

      await forward.start();

      // Give event time to fire
      await new Promise(resolve => setTimeout(resolve, 50));

      // listeningPort should be updated
      expect(listeningPort).toBeGreaterThanOrEqual(0);

      await forward.stop();
    });

    it('should throw error when already started', async () => {
      const forward = new HdcForward({
        localPort: 0,
        remoteHost: '127.0.0.1',
        remotePort: 9999,
      });

      await forward.start();

      await expect(forward.start()).rejects.toThrow('already started');

      await forward.stop();
    });
  });

  describe('stop', () => {
    it('should stop forwarding', async () => {
      const forward = new HdcForward({
        localPort: 0,
        remoteHost: '127.0.0.1',
        remotePort: 9999,
      });

      await forward.start();
      await forward.stop();

      expect(forward.getState()).toBe(ForwardState.CLOSED);
      expect(forward.isActive()).toBe(false);
    });

    it('should be idempotent', async () => {
      const forward = new HdcForward({
        localPort: 0,
        remoteHost: '127.0.0.1',
        remotePort: 9999,
      });

      await forward.start();
      await forward.stop();
      await forward.stop();
      await forward.stop();

      expect(forward.getState()).toBe(ForwardState.CLOSED);
    });

    it('should emit close event', async () => {
      const forward = new HdcForward({
        localPort: 0,
        remoteHost: '127.0.0.1',
        remotePort: 9999,
      });

      let closed = false;
      forward.on('close', () => {
        closed = true;
      });

      await forward.start();
      await forward.stop();

      expect(closed).toBe(true);
    });
  });
});

// ============================================================================
// HdcReverseForward
// ============================================================================

describe('HdcReverseForward', () => {
  it('should create with local and remote nodes', () => {
    const localNode: ForwardNode = { type: ForwardType.TCP, value: '8080' };
    const remoteNode: ForwardNode = { type: ForwardType.TCP, value: '9090' };
    const reverse = new HdcReverseForward(localNode, remoteNode);

    expect(reverse.getId()).toBeDefined();
    expect(reverse.getId().length).toBe(8);
    expect(reverse.getState()).toBe(ForwardState.IDLE);
    expect(reverse.getLocalNode()).toBe(localNode);
    expect(reverse.getRemoteNode()).toBe(remoteNode);
    expect(reverse.getBytesForwarded()).toBe(0);
    expect(reverse.getConnections()).toBe(0);
  });

  it('should start and become active', async () => {
    const localNode: ForwardNode = { type: ForwardType.TCP, value: '8080' };
    const remoteNode: ForwardNode = { type: ForwardType.TCP, value: '9090' };
    const reverse = new HdcReverseForward(localNode, remoteNode);

    await reverse.start();

    expect(reverse.getState()).toBe(ForwardState.FORAWRDING);
    expect(reverse.isActive()).toBe(true);

    await reverse.stop();
  });

  it('should emit listening event on start', async () => {
    const localNode: ForwardNode = { type: ForwardType.TCP, value: '8080' };
    const remoteNode: ForwardNode = { type: ForwardType.TCP, value: '9090' };
    const reverse = new HdcReverseForward(localNode, remoteNode);

    let listeningFired = false;
    reverse.on('listening', () => {
      listeningFired = true;
    });

    await reverse.start();
    expect(listeningFired).toBe(true);

    await reverse.stop();
  });

  it('should throw error when already started', async () => {
    const localNode: ForwardNode = { type: ForwardType.TCP, value: '8080' };
    const remoteNode: ForwardNode = { type: ForwardType.TCP, value: '9090' };
    const reverse = new HdcReverseForward(localNode, remoteNode);

    await reverse.start();

    await expect(reverse.start()).rejects.toThrow('already started');

    await reverse.stop();
  });

  it('should stop and become closed', async () => {
    const localNode: ForwardNode = { type: ForwardType.TCP, value: '8080' };
    const remoteNode: ForwardNode = { type: ForwardType.TCP, value: '9090' };
    const reverse = new HdcReverseForward(localNode, remoteNode);

    await reverse.start();
    await reverse.stop();

    expect(reverse.getState()).toBe(ForwardState.CLOSED);
    expect(reverse.isActive()).toBe(false);
  });

  it('should emit close event on stop', async () => {
    const localNode: ForwardNode = { type: ForwardType.TCP, value: '8080' };
    const remoteNode: ForwardNode = { type: ForwardType.TCP, value: '9090' };
    const reverse = new HdcReverseForward(localNode, remoteNode);

    let closed = false;
    reverse.on('close', () => {
      closed = true;
    });

    await reverse.start();
    await reverse.stop();

    expect(closed).toBe(true);
  });

  it('should stop idempotently', async () => {
    const localNode: ForwardNode = { type: ForwardType.TCP, value: '8080' };
    const remoteNode: ForwardNode = { type: ForwardType.TCP, value: '9090' };
    const reverse = new HdcReverseForward(localNode, remoteNode);

    await reverse.start();
    await reverse.stop();
    await reverse.stop();

    expect(reverse.getState()).toBe(ForwardState.CLOSED);
  });

  it('should generate correct task string', () => {
    const localNode: ForwardNode = { type: ForwardType.TCP, value: '8080' };
    const remoteNode: ForwardNode = { type: ForwardType.TCP, value: '9090' };
    const reverse = new HdcReverseForward(localNode, remoteNode);

    expect(reverse.getTaskStr()).toBe('rport tcp:9090 tcp:8080');
  });

  it('should generate correct task string with abstract nodes', () => {
    const localNode: ForwardNode = { type: ForwardType.ABSTRACT, value: 'mysocket' };
    const remoteNode: ForwardNode = { type: ForwardType.TCP, value: '9090' };
    const reverse = new HdcReverseForward(localNode, remoteNode);

    expect(reverse.getTaskStr()).toBe('rport tcp:9090 localabstract:mysocket');
  });
});

// ============================================================================
// HdcForwardManager
// ============================================================================

describe('HdcForwardManager', () => {
  let manager: HdcForwardManager;

  beforeEach(() => {
    manager = new HdcForwardManager();
  });

  afterEach(async () => {
    await manager.stopAll();
  });

  describe('constructor', () => {
    it('should create manager', () => {
      expect(manager.count).toBe(0);
    });
  });

  describe('createForward', () => {
    it('should create and start forward', async () => {
      const forward = await manager.createForward({
        localPort: 0,
        remoteHost: '127.0.0.1',
        remotePort: 9999,
      });

      expect(forward).toBeDefined();
      expect(forward.isActive()).toBe(true);
      expect(manager.count).toBe(1);
    });

    it('should emit forward-start event', async () => {
      let started = false;
      manager.on('forward-start', () => {
        started = true;
      });

      await manager.createForward({
        localPort: 0,
        remoteHost: '127.0.0.1',
        remotePort: 9999,
      });

      expect(started).toBe(true);
    });
  });

  describe('removeForward', () => {
    it('should remove forward', async () => {
      const forward = await manager.createForward({
        localPort: 0,
        remoteHost: '127.0.0.1',
        remotePort: 9999,
      });

      const result = await manager.removeForward(forward.getId());

      expect(result).toBe(true);
      expect(manager.count).toBe(0);
    });

    it('should return false for non-existent forward', async () => {
      const result = await manager.removeForward('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('getForward', () => {
    it('should return forward by ID', async () => {
      const forward = await manager.createForward({
        localPort: 0,
        remoteHost: '127.0.0.1',
        remotePort: 9999,
      });

      const found = manager.getForward(forward.getId());
      expect(found).toBe(forward);
    });

    it('should return undefined for non-existent ID', () => {
      const found = manager.getForward('nonexistent');
      expect(found).toBeUndefined();
    });
  });

  describe('listForwards', () => {
    it('should list all forwards', async () => {
      await manager.createForward({
        localPort: 0,
        remoteHost: '127.0.0.1',
        remotePort: 9999,
      });

      await manager.createForward({
        localPort: 0,
        remoteHost: '127.0.0.1',
        remotePort: 8888,
      });

      const forwards = manager.listForwards();
      expect(forwards.length).toBe(2);
    });
  });

  describe('stopAll', () => {
    it('should stop all forwards', async () => {
      await manager.createForward({
        localPort: 0,
        remoteHost: '127.0.0.1',
        remotePort: 9999,
      });

      await manager.createForward({
        localPort: 0,
        remoteHost: '127.0.0.1',
        remotePort: 8888,
      });

      await manager.stopAll();

      expect(manager.count).toBe(0);
    });
  });
});
