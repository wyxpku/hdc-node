/**
 * Tests for Host Forward Manager module
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  HdcHostForward,
  ForwardEntry,
} from './host_forward.js';
import {
  ForwardType,
  ForwardState,
  ForwardNode,
  parseForwardNode,
  formatForwardNode,
} from '../common/forward.js';

describe('HdcHostForward', () => {
  let hostForward: HdcHostForward;

  beforeEach(() => {
    hostForward = new HdcHostForward();
  });

  afterEach(() => {
    hostForward.clear();
  });

  describe('constructor', () => {
    it('should start with zero forwards', () => {
      expect(hostForward.count).toBe(0);
      expect(hostForward.listForwards()).toEqual([]);
    });
  });

  describe('addForward', () => {
    it('should add a TCP forward entry', async () => {
      const localNode: ForwardNode = { type: ForwardType.TCP, value: '8080' };
      const remoteNode: ForwardNode = { type: ForwardType.TCP, value: '9090' };

      const taskStr = await hostForward.addForward(localNode, remoteNode, 'session-1');

      expect(taskStr).toBe('tcp:8080 tcp:9090');
      expect(hostForward.count).toBe(1);

      const entry = hostForward.getForward(taskStr);
      expect(entry).toBeDefined();
      expect(entry!.isReverse).toBe(false);
      expect(entry!.sessionId).toBe('session-1');
      expect(entry!.localNode).toEqual(localNode);
      expect(entry!.remoteNode).toEqual(remoteNode);
    });

    it('should add a forward with abstract local node', async () => {
      const localNode: ForwardNode = { type: ForwardType.ABSTRACT, value: 'mysocket' };
      const remoteNode: ForwardNode = { type: ForwardType.TCP, value: '9090' };

      const taskStr = await hostForward.addForward(localNode, remoteNode, 'session-1');

      expect(taskStr).toBe('localabstract:mysocket tcp:9090');
      expect(hostForward.count).toBe(1);
    });

    it('should add a JDWP forward', async () => {
      const localNode: ForwardNode = { type: ForwardType.TCP, value: '8700' };
      const remoteNode: ForwardNode = { type: ForwardType.JDWP, value: '1234' };

      const taskStr = await hostForward.addForward(localNode, remoteNode, 'session-1');

      expect(taskStr).toBe('tcp:8700 jdwp:1234');
      expect(hostForward.count).toBe(1);
    });

    it('should add a dev forward', async () => {
      const localNode: ForwardNode = { type: ForwardType.DEV, value: '/dev/ttyUSB0' };
      const remoteNode: ForwardNode = { type: ForwardType.TCP, value: '9090' };

      const taskStr = await hostForward.addForward(localNode, remoteNode, 'session-1');

      expect(taskStr).toBe('dev:/dev/ttyUSB0 tcp:9090');
    });

    it('should emit forward-added event', async () => {
      let emittedEntry: ForwardEntry | undefined;
      hostForward.on('forward-added', (entry: ForwardEntry) => {
        emittedEntry = entry;
      });

      const localNode: ForwardNode = { type: ForwardType.TCP, value: '8080' };
      const remoteNode: ForwardNode = { type: ForwardType.TCP, value: '9090' };

      await hostForward.addForward(localNode, remoteNode, 'session-1');

      expect(emittedEntry).toBeDefined();
      expect(emittedEntry!.taskStr).toBe('tcp:8080 tcp:9090');
    });

    it('should reject duplicate forward', async () => {
      const localNode: ForwardNode = { type: ForwardType.TCP, value: '8080' };
      const remoteNode: ForwardNode = { type: ForwardType.TCP, value: '9090' };

      await hostForward.addForward(localNode, remoteNode, 'session-1');

      await expect(
        hostForward.addForward(localNode, remoteNode, 'session-2')
      ).rejects.toThrow('Forward already exists');
    });

    it('should track state as LISTENING', async () => {
      const localNode: ForwardNode = { type: ForwardType.TCP, value: '8080' };
      const remoteNode: ForwardNode = { type: ForwardType.TCP, value: '9090' };

      const taskStr = await hostForward.addForward(localNode, remoteNode, 'session-1');
      const entry = hostForward.getForward(taskStr);

      expect(entry!.state).toBe(ForwardState.LISTENING);
    });
  });

  describe('addReverse', () => {
    it('should add a reverse forward entry', async () => {
      const remoteNode: ForwardNode = { type: ForwardType.TCP, value: '9090' };
      const localNode: ForwardNode = { type: ForwardType.TCP, value: '8080' };

      const taskStr = await hostForward.addReverse(remoteNode, localNode, 'session-1');

      expect(taskStr).toBe('tcp:9090 tcp:8080');
      expect(hostForward.count).toBe(1);

      const entry = hostForward.getForward(taskStr);
      expect(entry).toBeDefined();
      expect(entry!.isReverse).toBe(true);
      expect(entry!.sessionId).toBe('session-1');
    });

    it('should emit reverse-added event', async () => {
      let emittedEntry: ForwardEntry | undefined;
      hostForward.on('reverse-added', (entry: ForwardEntry) => {
        emittedEntry = entry;
      });

      const remoteNode: ForwardNode = { type: ForwardType.TCP, value: '9090' };
      const localNode: ForwardNode = { type: ForwardType.TCP, value: '8080' };

      await hostForward.addReverse(remoteNode, localNode, 'session-1');

      expect(emittedEntry).toBeDefined();
      expect(emittedEntry!.isReverse).toBe(true);
    });

    it('should reject duplicate reverse forward', async () => {
      const remoteNode: ForwardNode = { type: ForwardType.TCP, value: '9090' };
      const localNode: ForwardNode = { type: ForwardType.TCP, value: '8080' };

      await hostForward.addReverse(remoteNode, localNode, 'session-1');

      await expect(
        hostForward.addReverse(remoteNode, localNode, 'session-2')
      ).rejects.toThrow('Reverse forward already exists');
    });
  });

  describe('listForwards', () => {
    it('should list empty when no forwards', () => {
      expect(hostForward.listForwards()).toEqual([]);
    });

    it('should list all forwards and reverses', async () => {
      const local1: ForwardNode = { type: ForwardType.TCP, value: '8080' };
      const remote1: ForwardNode = { type: ForwardType.TCP, value: '9090' };
      await hostForward.addForward(local1, remote1, 'session-1');

      const remote2: ForwardNode = { type: ForwardType.TCP, value: '7070' };
      const local2: ForwardNode = { type: ForwardType.ABSTRACT, value: 'mysock' };
      await hostForward.addReverse(remote2, local2, 'session-2');

      const list = hostForward.listForwards();
      expect(list.length).toBe(2);

      const forwardEntry = list.find(e => !e.isReverse);
      expect(forwardEntry).toBeDefined();
      expect(forwardEntry!.taskStr).toBe('tcp:8080 tcp:9090');

      const reverseEntry = list.find(e => e.isReverse);
      expect(reverseEntry).toBeDefined();
      expect(reverseEntry!.taskStr).toBe('tcp:7070 localabstract:mysock');
    });
  });

  describe('removeForward', () => {
    it('should remove a forward by task string', async () => {
      const localNode: ForwardNode = { type: ForwardType.TCP, value: '8080' };
      const remoteNode: ForwardNode = { type: ForwardType.TCP, value: '9090' };

      const taskStr = await hostForward.addForward(localNode, remoteNode, 'session-1');
      expect(hostForward.count).toBe(1);

      const result = hostForward.removeForward(taskStr);
      expect(result).toBe(true);
      expect(hostForward.count).toBe(0);
    });

    it('should emit forward-removed event', async () => {
      let removedEntry: ForwardEntry | undefined;
      hostForward.on('forward-removed', (entry: ForwardEntry) => {
        removedEntry = entry;
      });

      const localNode: ForwardNode = { type: ForwardType.TCP, value: '8080' };
      const remoteNode: ForwardNode = { type: ForwardType.TCP, value: '9090' };

      const taskStr = await hostForward.addForward(localNode, remoteNode, 'session-1');
      hostForward.removeForward(taskStr);

      expect(removedEntry).toBeDefined();
      expect(removedEntry!.taskStr).toBe('tcp:8080 tcp:9090');
    });

    it('should emit reverse-removed event for reverse forward', async () => {
      let removedEntry: ForwardEntry | undefined;
      hostForward.on('reverse-removed', (entry: ForwardEntry) => {
        removedEntry = entry;
      });

      const remoteNode: ForwardNode = { type: ForwardType.TCP, value: '9090' };
      const localNode: ForwardNode = { type: ForwardType.TCP, value: '8080' };

      const taskStr = await hostForward.addReverse(remoteNode, localNode, 'session-1');
      hostForward.removeForward(taskStr);

      expect(removedEntry).toBeDefined();
      expect(removedEntry!.isReverse).toBe(true);
    });

    it('should return false for non-existent forward', () => {
      expect(hostForward.removeForward('tcp:9999 tcp:8888')).toBe(false);
    });

    it('should set state to CLOSED on removed entry', async () => {
      const localNode: ForwardNode = { type: ForwardType.TCP, value: '8080' };
      const remoteNode: ForwardNode = { type: ForwardType.TCP, value: '9090' };

      const taskStr = await hostForward.addForward(localNode, remoteNode, 'session-1');
      const entryBefore = hostForward.getForward(taskStr);
      expect(entryBefore!.state).toBe(ForwardState.LISTENING);

      hostForward.removeForward(taskStr);
      expect(entryBefore!.state).toBe(ForwardState.CLOSED);
    });
  });

  describe('removeForwardsBySession', () => {
    it('should remove all forwards for a session', async () => {
      const l1: ForwardNode = { type: ForwardType.TCP, value: '8080' };
      const r1: ForwardNode = { type: ForwardType.TCP, value: '9090' };
      await hostForward.addForward(l1, r1, 'session-1');

      const l2: ForwardNode = { type: ForwardType.TCP, value: '8081' };
      const r2: ForwardNode = { type: ForwardType.TCP, value: '9091' };
      await hostForward.addForward(l2, r2, 'session-1');

      const l3: ForwardNode = { type: ForwardType.TCP, value: '8082' };
      const r3: ForwardNode = { type: ForwardType.TCP, value: '9092' };
      await hostForward.addForward(l3, r3, 'session-2');

      expect(hostForward.count).toBe(3);

      const removed = hostForward.removeForwardsBySession('session-1');
      expect(removed).toBe(2);
      expect(hostForward.count).toBe(1);
    });

    it('should return 0 for non-existent session', () => {
      expect(hostForward.removeForwardsBySession('no-such-session')).toBe(0);
    });
  });

  describe('getForwardsBySession', () => {
    it('should return forwards for a specific session', async () => {
      const l1: ForwardNode = { type: ForwardType.TCP, value: '8080' };
      const r1: ForwardNode = { type: ForwardType.TCP, value: '9090' };
      await hostForward.addForward(l1, r1, 'session-1');

      const r2: ForwardNode = { type: ForwardType.TCP, value: '7070' };
      const l2: ForwardNode = { type: ForwardType.TCP, value: '6060' };
      await hostForward.addReverse(r2, l2, 'session-2');

      const session1Forwards = hostForward.getForwardsBySession('session-1');
      expect(session1Forwards.length).toBe(1);
      expect(session1Forwards[0].sessionId).toBe('session-1');
      expect(session1Forwards[0].isReverse).toBe(false);

      const session2Forwards = hostForward.getForwardsBySession('session-2');
      expect(session2Forwards.length).toBe(1);
      expect(session2Forwards[0].sessionId).toBe('session-2');
      expect(session2Forwards[0].isReverse).toBe(true);
    });

    it('should return empty for non-existent session', () => {
      expect(hostForward.getForwardsBySession('no-such-session')).toEqual([]);
    });
  });

  describe('formatList', () => {
    it('should return empty message when no forwards', () => {
      expect(hostForward.formatList()).toBe('[Empty]\n');
    });

    it('should format forwards list with direction indicators', async () => {
      const l1: ForwardNode = { type: ForwardType.TCP, value: '8080' };
      const r1: ForwardNode = { type: ForwardType.TCP, value: '9090' };
      await hostForward.addForward(l1, r1, 'session-1');

      const r2: ForwardNode = { type: ForwardType.TCP, value: '7070' };
      const l2: ForwardNode = { type: ForwardType.TCP, value: '6060' };
      await hostForward.addReverse(r2, l2, 'session-2');

      const output = hostForward.formatList();

      expect(output).toContain('[F] tcp:8080 tcp:9090');
      expect(output).toContain('[R] tcp:7070 tcp:6060');
      expect(output).toContain('(2 forwards)');
    });
  });

  describe('clear', () => {
    it('should remove all forwards', async () => {
      const l1: ForwardNode = { type: ForwardType.TCP, value: '8080' };
      const r1: ForwardNode = { type: ForwardType.TCP, value: '9090' };
      await hostForward.addForward(l1, r1, 'session-1');

      const r2: ForwardNode = { type: ForwardType.TCP, value: '7070' };
      const l2: ForwardNode = { type: ForwardType.TCP, value: '6060' };
      await hostForward.addReverse(r2, l2, 'session-2');

      expect(hostForward.count).toBe(2);

      hostForward.clear();
      expect(hostForward.count).toBe(0);
    });
  });
});
