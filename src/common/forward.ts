/**
 * HDC Forward Module
 *
 * Provides port forwarding functionality (TCP port forwarding).
 * Supports all 7 forward node types and reverse forwarding.
 * Ported from: hdc-source/src/common/forward.cpp
 */

import { EventEmitter } from 'events';
import * as net from 'net';
import { HdcSession } from '../common/session.js';
import { GetRandomString } from '../common/base.js';

// ============================================================================
// Constants
// ============================================================================

export const DEFAULT_BUFFER_SIZE = 64 * 1024;

export enum ForwardType {
  TCP = 'tcp',
  JDWP = 'jdwp',
  ARK = 'ark',
  ABSTRACT = 'localabstract',
  FILESYSTEM = 'localfilesystem',
  DEV = 'dev',
  RESERVED = 'reserved',
}

export enum ForwardState {
  IDLE = 'idle',
  LISTENING = 'listening',
  CONNECTING = 'connecting',
  FORAWRDING = 'forwarding',
  CLOSED = 'closed',
  ERROR = 'error',
}

// ============================================================================
// Forward Node Types
// ============================================================================

export interface ForwardNode {
  type: ForwardType;
  value: string; // port number, socket name, pid, etc.
}

/**
 * Mapping from string prefix to ForwardType.
 * Order matters: longer prefixes must come first to avoid partial matches.
 */
const FORWARD_TYPE_PREFIXES: [string, ForwardType][] = [
  ['localabstract:', ForwardType.ABSTRACT],
  ['localfilesystem:', ForwardType.FILESYSTEM],
  ['tcp:', ForwardType.TCP],
  ['jdwp:', ForwardType.JDWP],
  ['ark:', ForwardType.ARK],
  ['dev:', ForwardType.DEV],
  ['reserved:', ForwardType.RESERVED],
];

/**
 * Parse a forward node spec string into a ForwardNode.
 *
 * Supported specs:
 *   "tcp:8080"                     -> { type: TCP, value: "8080" }
 *   "localabstract:mysocket"       -> { type: ABSTRACT, value: "mysocket" }
 *   "jdwp:1234"                    -> { type: JDWP, value: "1234" }
 *   "ark:1234@5678@Debugger"       -> { type: ARK, value: "1234@5678@Debugger" }
 *   "dev:/dev/ttyUSB0"             -> { type: DEV, value: "/dev/ttyUSB0" }
 *   "localfilesystem:/tmp/sock"    -> { type: FILESYSTEM, value: "/tmp/sock" }
 *   "reserved: anything"           -> { type: RESERVED, value: " anything" }
 */
export function parseForwardNode(spec: string): ForwardNode | null {
  if (!spec || typeof spec !== 'string') {
    return null;
  }

  const trimmed = spec.trim();
  if (trimmed.length === 0) {
    return null;
  }

  for (const [prefix, type] of FORWARD_TYPE_PREFIXES) {
    if (trimmed.startsWith(prefix)) {
      const value = trimmed.substring(prefix.length);
      if (value.length === 0) {
        return null;
      }
      return { type, value };
    }
  }

  return null;
}

/**
 * Format a ForwardNode back into its string specification.
 * e.g. { type: ForwardType.TCP, value: "8080" } -> "tcp:8080"
 */
export function formatForwardNode(node: ForwardNode): string {
  return `${node.type}:${node.value}`;
}

// ============================================================================
// Types
// ============================================================================

export interface ForwardOptions {
  localPort: number;
  remoteHost: string;
  remotePort: number;
  type?: ForwardType;
}

export interface ForwardSession {
  id: string;
  type: ForwardType;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  state: ForwardState;
  bytesForwarded: number;
  connections: number;
  startTime: number;
}

// ============================================================================
// HdcForward - Port Forwarding
// ============================================================================

export class HdcForward extends EventEmitter {
  private id: string;
  private type: ForwardType;
  private localPort: number;
  private remoteHost: string;
  private remotePort: number;
  private state: ForwardState = ForwardState.IDLE;
  private server: net.Server | null = null;
  private deviceSocket: net.Socket | null = null;
  private bytesForwarded: number = 0;
  private connections: number = 0;
  private startTime: number = 0;
  private activeSockets: Set<net.Socket> = new Set();

  constructor(options: ForwardOptions) {
    super();
    this.id = GetRandomString(8);
    this.type = options.type || ForwardType.TCP;
    this.localPort = options.localPort;
    this.remoteHost = options.remoteHost;
    this.remotePort = options.remotePort;
  }

  /**
   * Get forward session ID
   */
  getId(): string {
    return this.id;
  }

  /**
   * Get current state
   */
  getState(): ForwardState {
    return this.state;
  }

  /**
   * Get local port
   */
  getLocalPort(): number {
    return this.localPort;
  }

  /**
   * Get remote address
   */
  getRemoteAddress(): string {
    return `${this.remoteHost}:${this.remotePort}`;
  }

  /**
   * Get bytes forwarded
   */
  getBytesForwarded(): number {
    return this.bytesForwarded;
  }

  /**
   * Get active connections
   */
  getConnections(): number {
    return this.connections;
  }

  /**
   * Get session info
   */
  getSession(): ForwardSession {
    return {
      id: this.id,
      type: this.type,
      localPort: this.localPort,
      remoteHost: this.remoteHost,
      remotePort: this.remotePort,
      state: this.state,
      bytesForwarded: this.bytesForwarded,
      connections: this.connections,
      startTime: this.startTime,
    };
  }

  /**
   * Start forwarding (listen on local port)
   */
  async start(): Promise<void> {
    if (this.state !== ForwardState.IDLE) {
      throw new Error('Forward already started');
    }

    this.state = ForwardState.LISTENING;
    this.startTime = Date.now();

    return new Promise((resolve, reject) => {
      this.server = net.createServer((clientSocket: net.Socket) => {
        this.handleConnection(clientSocket);
      });

      this.server.on('error', (err: Error) => {
        this.state = ForwardState.ERROR;
        this.emit('error', err);
        reject(err);
      });

      this.server.listen(this.localPort, () => {
        this.state = ForwardState.FORAWRDING;
        this.emit('listening', this.localPort);
        resolve();
      });
    });
  }

  /**
   * Handle new connection to local port
   */
  private handleConnection(clientSocket: net.Socket): void {
    this.connections++;
    this.activeSockets.add(clientSocket);

    this.emit('connection', {
      localAddress: clientSocket.localAddress,
      localPort: clientSocket.localPort,
      remoteAddress: clientSocket.remoteAddress,
      remotePort: clientSocket.remotePort,
    });

    // Connect to remote target
    const targetSocket = net.createConnection(
      { host: this.remoteHost, port: this.remotePort },
      () => {
        this.setupForwarding(clientSocket, targetSocket);
      }
    );

    targetSocket.on('error', (err: Error) => {
      this.emit('target-error', err);
      clientSocket.destroy();
    });

    clientSocket.on('error', (err: Error) => {
      this.emit('client-error', err);
      targetSocket.destroy();
    });

    clientSocket.on('close', () => {
      this.connections--;
      this.activeSockets.delete(clientSocket);
    });
  }

  /**
   * Setup bidirectional forwarding between client and target
   */
  private setupForwarding(client: net.Socket, target: net.Socket): void {
    // Client -> Target
    client.on('data', (data: Buffer) => {
      this.bytesForwarded += data.length;
      target.write(data);
    });

    // Target -> Client
    target.on('data', (data: Buffer) => {
      this.bytesForwarded += data.length;
      client.write(data);
    });

    // Handle close
    client.on('close', () => target.destroy());
    target.on('close', () => client.destroy());
  }

  /**
   * Stop forwarding
   */
  async stop(): Promise<void> {
    if (this.state === ForwardState.CLOSED) {
      return;
    }

    this.state = ForwardState.CLOSED;

    // Close all active connections
    for (const socket of this.activeSockets) {
      socket.destroy();
    }
    this.activeSockets.clear();

    // Close server
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }

    this.emit('close');
  }

  /**
   * Check if forwarding is active
   */
  isActive(): boolean {
    return this.state === ForwardState.FORAWRDING;
  }
}

// ============================================================================
// HdcReverseForward - Reverse Port Forwarding
// ============================================================================

export class HdcReverseForward extends EventEmitter {
  private id: string;
  private localNode: ForwardNode;
  private remoteNode: ForwardNode;
  private state: ForwardState = ForwardState.IDLE;
  private bytesForwarded: number = 0;
  private connections: number = 0;
  private startTime: number = 0;

  constructor(localNode: ForwardNode, remoteNode: ForwardNode) {
    super();
    this.id = GetRandomString(8);
    this.localNode = localNode;
    this.remoteNode = remoteNode;
  }

  /**
   * Get reverse forward ID
   */
  getId(): string {
    return this.id;
  }

  /**
   * Get current state
   */
  getState(): ForwardState {
    return this.state;
  }

  /**
   * Get local node
   */
  getLocalNode(): ForwardNode {
    return this.localNode;
  }

  /**
   * Get remote node
   */
  getRemoteNode(): ForwardNode {
    return this.remoteNode;
  }

  /**
   * Get bytes forwarded
   */
  getBytesForwarded(): number {
    return this.bytesForwarded;
  }

  /**
   * Get active connections
   */
  getConnections(): number {
    return this.connections;
  }

  /**
   * Get the task string representation for this reverse forward.
   * Format: "rport <remote> <local>"
   */
  getTaskStr(): string {
    return `rport ${formatForwardNode(this.remoteNode)} ${formatForwardNode(this.localNode)}`;
  }

  /**
   * Start reverse forwarding.
   * In reverse forward: device connects to remote, host listens on local.
   * The actual data-plane is handled by the daemon on the device side;
   * the host side tracks state and handles local connections.
   */
  async start(): Promise<void> {
    if (this.state !== ForwardState.IDLE) {
      throw new Error('Reverse forward already started');
    }

    this.state = ForwardState.LISTENING;
    this.startTime = Date.now();

    // For reverse forwarding, the device initiates the connection.
    // The host registers interest and the daemon on the device side
    // listens and connects back. We mark state as forwarding.
    this.state = ForwardState.FORAWRDING;
    this.emit('listening');
  }

  /**
   * Stop reverse forwarding
   */
  async stop(): Promise<void> {
    if (this.state === ForwardState.CLOSED) {
      return;
    }

    this.state = ForwardState.CLOSED;
    this.emit('close');
  }

  /**
   * Check if reverse forwarding is active
   */
  isActive(): boolean {
    return this.state === ForwardState.FORAWRDING;
  }
}

// ============================================================================
// HdcForwardManager - Manage multiple forwards
// ============================================================================

export class HdcForwardManager extends EventEmitter {
  private forwards: Map<string, HdcForward> = new Map();

  /**
   * Create and start a new forward
   */
  async createForward(options: ForwardOptions): Promise<HdcForward> {
    const forward = new HdcForward(options);

    forward.on('listening', (port: number) => {
      this.emit('forward-start', forward, port);
    });

    forward.on('close', () => {
      this.emit('forward-stop', forward);
      this.forwards.delete(forward.getId());
    });

    forward.on('error', (err: Error) => {
      this.emit('forward-error', forward, err);
    });

    await forward.start();
    this.forwards.set(forward.getId(), forward);

    return forward;
  }

  /**
   * Stop and remove a forward
   */
  async removeForward(id: string): Promise<boolean> {
    const forward = this.forwards.get(id);
    if (!forward) {
      return false;
    }

    await forward.stop();
    return true;
  }

  /**
   * Get forward by ID
   */
  getForward(id: string): HdcForward | undefined {
    return this.forwards.get(id);
  }

  /**
   * List all forwards
   */
  listForwards(): HdcForward[] {
    return Array.from(this.forwards.values());
  }

  /**
   * Get forward count
   */
  get count(): number {
    return this.forwards.size;
  }

  /**
   * Stop all forwards
   */
  async stopAll(): Promise<void> {
    const promises = Array.from(this.forwards.values()).map(f => f.stop());
    await Promise.all(promises);
    this.forwards.clear();
  }
}

// ============================================================================
// Helper functions
// ============================================================================

/**
 * Create a simple TCP forward
 */
export async function createTcpForward(
  localPort: number,
  remoteHost: string,
  remotePort: number
): Promise<HdcForward> {
  const forward = new HdcForward({
    localPort,
    remoteHost,
    remotePort,
    type: ForwardType.TCP,
  });

  await forward.start();
  return forward;
}
