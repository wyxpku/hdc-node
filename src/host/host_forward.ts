/**
 * HDC Host Forward Manager
 *
 * Host-side port forwarding manager that works with the HDC server.
 * Manages forward and reverse forward entries for connected devices.
 * Ported from: hdc-source/src/host/forward.cpp
 */

import { EventEmitter } from 'events';
import {
  ForwardNode,
  ForwardState,
  ForwardType,
  parseForwardNode,
  formatForwardNode,
} from '../common/forward.js';
import { GetRandomString } from '../common/base.js';

// ============================================================================
// Types
// ============================================================================

export interface ForwardEntry {
  taskStr: string; // e.g., "tcp:8080 tcp:9090"
  localNode: ForwardNode;
  remoteNode: ForwardNode;
  isReverse: boolean;
  sessionId: string;
  state: ForwardState;
}

// ============================================================================
// HdcHostForward - Host-side Forward Manager
// ============================================================================

export class HdcHostForward extends EventEmitter {
  private forwards: Map<string, ForwardEntry> = new Map();

  /**
   * Create a forward: localNode -> remoteNode
   * Returns the task string used as the unique key.
   */
  async addForward(
    localNode: ForwardNode,
    remoteNode: ForwardNode,
    sessionId: string
  ): Promise<string> {
    const taskStr = `${formatForwardNode(localNode)} ${formatForwardNode(remoteNode)}`;

    if (this.forwards.has(taskStr)) {
      throw new Error(`Forward already exists: ${taskStr}`);
    }

    const entry: ForwardEntry = {
      taskStr,
      localNode,
      remoteNode,
      isReverse: false,
      sessionId,
      state: ForwardState.LISTENING,
    };

    this.forwards.set(taskStr, entry);
    this.emit('forward-added', entry);

    return taskStr;
  }

  /**
   * Create a reverse forward: remoteNode -> localNode
   * Returns the task string used as the unique key.
   */
  async addReverse(
    remoteNode: ForwardNode,
    localNode: ForwardNode,
    sessionId: string
  ): Promise<string> {
    const taskStr = `${formatForwardNode(remoteNode)} ${formatForwardNode(localNode)}`;

    if (this.forwards.has(taskStr)) {
      throw new Error(`Reverse forward already exists: ${taskStr}`);
    }

    const entry: ForwardEntry = {
      taskStr,
      localNode,
      remoteNode,
      isReverse: true,
      sessionId,
      state: ForwardState.LISTENING,
    };

    this.forwards.set(taskStr, entry);
    this.emit('reverse-added', entry);

    return taskStr;
  }

  /**
   * List all forward entries
   */
  listForwards(): ForwardEntry[] {
    return Array.from(this.forwards.values());
  }

  /**
   * Remove a forward by its task string.
   * Returns true if the forward was found and removed.
   */
  removeForward(taskStr: string): boolean {
    const entry = this.forwards.get(taskStr);
    if (!entry) {
      return false;
    }

    this.forwards.delete(taskStr);
    entry.state = ForwardState.CLOSED;
    this.emit(entry.isReverse ? 'reverse-removed' : 'forward-removed', entry);

    return true;
  }

  /**
   * Remove all forwards for a given session ID.
   * Returns the number of forwards removed.
   */
  removeForwardsBySession(sessionId: string): number {
    let count = 0;
    for (const [taskStr, entry] of this.forwards) {
      if (entry.sessionId === sessionId) {
        this.forwards.delete(taskStr);
        entry.state = ForwardState.CLOSED;
        this.emit(
          entry.isReverse ? 'reverse-removed' : 'forward-removed',
          entry
        );
        count++;
      }
    }
    return count;
  }

  /**
   * Get a forward entry by task string.
   */
  getForward(taskStr: string): ForwardEntry | undefined {
    return this.forwards.get(taskStr);
  }

  /**
   * Get all forwards for a given session.
   */
  getForwardsBySession(sessionId: string): ForwardEntry[] {
    const results: ForwardEntry[] = [];
    for (const entry of this.forwards.values()) {
      if (entry.sessionId === sessionId) {
        results.push(entry);
      }
    }
    return results;
  }

  /**
   * Get total forward count
   */
  get count(): number {
    return this.forwards.size;
  }

  /**
   * Format forwards list as a human-readable string (similar to `fport ls` output).
   */
  formatList(): string {
    const entries = this.listForwards();
    if (entries.length === 0) {
      return '[Empty]\n';
    }

    const lines = entries.map((entry) => {
      const direction = entry.isReverse ? '[R]' : '[F]';
      return `${direction} ${entry.taskStr}`;
    });

    return lines.join('\n') + `\n(${entries.length} forwards)\n`;
  }

  /**
   * Remove all forwards
   */
  clear(): void {
    for (const [taskStr, entry] of this.forwards) {
      entry.state = ForwardState.CLOSED;
      this.emit(
        entry.isReverse ? 'reverse-removed' : 'forward-removed',
        entry
      );
    }
    this.forwards.clear();
  }
}
