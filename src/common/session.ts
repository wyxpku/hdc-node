/**
 * HDC Session Module
 *
 * Manages connections between host and daemon.
 * Ported from: hdc-source/src/common/session.cpp
 *
 * In TypeScript, we use:
 * - EventEmitter for async events
 * - Map for session/channel management
 * - async/await for async operations
 */

import { EventEmitter } from 'events';
import * as net from 'net';
import { parsePacket, PacketParseResult, createPacket, PACKET_HEADER_SIZE, PAYLOAD_PROTECT_VCODE } from './message.js';
import { PKG_PAYLOAD_MAX_SIZE, CommandId } from './protocol.js';
import { GetRuntimeMSec, GetRandomU32 } from './base.js';
import { PayloadProtect, encodeSessionHandShake, decodeSessionHandShake, SessionHandShake } from './serialization.js';

// ============================================================================
// Types and Constants
// ============================================================================

export enum ConnType {
  CONN_TCP = 0,
  CONN_USB = 1,
  CONN_UART = 2,
  CONN_USB_SERIAL = 3,
}

export enum AuthType {
  AUTH_NONE = 0,
  AUTH_TOKEN = 1,
  AUTH_SIGNATURE = 2,
  AUTH_PUBLICKEY = 3,
  AUTH_OK = 4,
  AUTH_FAIL = 5,
  AUTH_SSL_TLS_PSK = 6,
}

export enum TaskType {
  TYPE_UNITY = 0,
  TYPE_SHELL = 1,
  TYPE_FILE = 2,
  TYPE_FORWARD = 3,
  TYPE_APP = 4,
  TYPE_FLASHD = 5,
}

export enum SessionState {
  INIT = 0,
  CONNECTING = 1,
  HANDSHAKE = 2,
  AUTH = 3,
  READY = 4,
  CLOSING = 5,
  CLOSED = 6,
}

export const HANDSHAKE_MESSAGE = 'OHOS HDC';
export const HDC_PROTOCOL_VERSION = 1;
export const DEFAULT_SESSION_TIMEOUT = 30000;
export const HEARTBEAT_INTERVAL = 10000;

// ============================================================================
// Interfaces
// ============================================================================

// Re-export SessionHandShake from serialization module
export type { SessionHandShake } from './serialization.js';

export interface SessionOptions {
  serverOrDaemon: boolean;
  connType: ConnType;
  sessionId?: number;
  timeout?: number;
}

export interface ChannelInfo {
  channelId: number;
  sessionId: number;
  commandId: number;
  taskType: TaskType;
  createTime: number;
  lastActivity: number;
}

export interface TaskInfo {
  channelId: number;
  sessionId: number;
  taskType: TaskType;
  taskClass: any;
  hasInitial: boolean;
  createTime: number;
}

// ============================================================================
// HdcSession
// ============================================================================

export class HdcSession extends EventEmitter {
  public sessionId: number;
  public connType: ConnType;
  public serverOrDaemon: boolean;
  public state: SessionState;
  public connectKey: string;
  
  public authType: AuthType = AuthType.AUTH_NONE;
  public version: string = '';
  public features: Set<string> = new Set();
  
  private socket: net.Socket | null = null;
  private buffer: Buffer = Buffer.alloc(0);
  private channels: Map<number, ChannelInfo> = new Map();
  private tasks: Map<number, TaskInfo> = new Map();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private lastActivity: number = 0;
  private timeout: number;
  
  constructor(options: SessionOptions) {
    super();
    this.sessionId = options.sessionId ?? GetRandomU32();
    this.connType = options.connType;
    this.serverOrDaemon = options.serverOrDaemon;
    this.timeout = options.timeout ?? DEFAULT_SESSION_TIMEOUT;
    this.state = SessionState.INIT;
    this.connectKey = '';
    this.lastActivity = GetRuntimeMSec();
  }
  
  /**
   * Attach socket to this session
   */
  attachSocket(socket: net.Socket): void {
    this.socket = socket;
    this.state = SessionState.CONNECTING;
    
    socket.on('data', (data: Buffer) => this.onData(data));
    socket.on('close', () => this.onClose());
    socket.on('error', (err: Error) => this.onError(err));
    
    this.sendHandshake();
  }
  
  /**
   * Get attached socket
   */
  getSocket(): net.Socket | null {
    return this.socket;
  }
  
  /**
   * Update activity timestamp
   */
  updateActivity(): void {
    this.lastActivity = GetRuntimeMSec();
  }
  
  /**
   * Check if session is active
   */
  isActive(): boolean {
    return this.state === SessionState.READY && this.socket !== null;
  }
  
  /**
   * Send handshake message
   */
  private sendHandshake(): void {
    this.state = SessionState.HANDSHAKE;

    const handshake: SessionHandShake = {
      banner: HANDSHAKE_MESSAGE,
      authType: AuthType.AUTH_NONE,
      sessionId: this.sessionId,
      connectKey: this.connectKey,
      buf: '',
      version: String(HDC_PROTOCOL_VERSION),
    };

    const payload = encodeSessionHandShake(handshake);
    const protect: PayloadProtect = {
      channelId: 0,
      commandFlag: CommandId.CMD_KERNEL_HANDSHAKE,
      checkSum: 0,
      vCode: PAYLOAD_PROTECT_VCODE,
    };
    const packet = createPacket(payload, protect);

    this.socket?.write(packet);
    this.updateActivity();
  }
  
  /**
   * Build PayloadProtect for a given channel and command
   */
  private buildProtect(channelId: number = 0, commandFlag: number = 0): PayloadProtect {
    return {
      channelId,
      commandFlag,
      checkSum: 0,
      vCode: PAYLOAD_PROTECT_VCODE,
    };
  }
  
  /**
   * Handle incoming data
   */
  private onData(data: Buffer): void {
    this.updateActivity();
    this.buffer = Buffer.concat([this.buffer, data]);
    this.processBuffer();
  }
  
  /**
   * Process buffered data
   */
  private processBuffer(): void {
    while (this.buffer.length >= PACKET_HEADER_SIZE) {
      // Read headSize from offset 5 (uint16 BE) and dataSize from offset 7 (uint32 BE)
      const headSize = this.buffer.readUInt16BE(5);
      const dataSize = this.buffer.readUInt32BE(7);
      const totalSize = PACKET_HEADER_SIZE + headSize + dataSize;

      if (totalSize <= 0 || totalSize > PACKET_HEADER_SIZE + PKG_PAYLOAD_MAX_SIZE) {
        this.emit('error', new Error(`Invalid packet size: ${totalSize}`));
        this.close();
        return;
      }

      if (this.buffer.length < totalSize) {
        break;
      }

      const packetData = this.buffer.subarray(0, totalSize);
      this.buffer = this.buffer.subarray(totalSize);

      try {
        const packet = parsePacket(packetData);
        if (!packet) continue;
        this.handlePacket(packet);
      } catch (err) {
        this.emit('error', err as Error);
      }
    }
  }
  
  /**
   * Handle parsed packet
   */
  private handlePacket(packet: PacketParseResult): void {
    if (this.state === SessionState.HANDSHAKE) {
      this.handleHandshakeResponse(packet);
    } else if (this.state === SessionState.READY) {
      this.emit('packet', packet);
    }
  }
  
  /**
   * Handle handshake response
   */
  private handleHandshakeResponse(packet: PacketParseResult): void {
    try {
      const handshake = decodeSessionHandShake(packet.payload);
      this.authType = handshake.authType;
      this.version = handshake.version;

      this.state = SessionState.READY;
      this.startHeartbeat();

      this.emit('handshake', handshake);
    } catch (err) {
      this.emit('error', err as Error);
      this.close();
    }
  }
  
  /**
   * Start heartbeat
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    
    this.heartbeatTimer = setInterval(() => {
      if (this.state === SessionState.READY) {
        this.sendHeartbeat();
      }
    }, HEARTBEAT_INTERVAL);
  }
  
  /**
   * Stop heartbeat
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
  
  /**
   * Send heartbeat
   */
  private sendHeartbeat(): void {
    const payload = Buffer.alloc(8);
    payload.writeBigUInt64BE(BigInt(GetRuntimeMSec()), 0);
    this.sendRaw(payload, 0, CommandId.CMD_HEARTBEAT_MSG);
  }
  
  /**
   * Send raw data
   */
  private sendRaw(data: Buffer, channelId: number = 0, commandFlag: number = 0): boolean {
    if (!this.socket || this.state !== SessionState.READY) {
      return false;
    }

    const protect = this.buildProtect(channelId, commandFlag);
    const packet = createPacket(data, protect);

    try {
      this.socket.write(packet);
      this.updateActivity();
      return true;
    } catch {
      return false;
    }
  }
  
  /**
   * Send data through this session
   */
  send(commandFlag: number, data: Buffer | Uint8Array, channelId: number = 0): boolean {
    return this.sendRaw(
      data instanceof Uint8Array ? Buffer.from(data) : data,
      channelId,
      commandFlag,
    );
  }
  
  /**
   * Handle close
   */
  private onClose(): void {
    this.state = SessionState.CLOSED;
    this.stopHeartbeat();
    this.emit('close');
  }
  
  /**
   * Handle error
   */
  private onError(err: Error): void {
    this.emit('error', err);
  }
  
  /**
   * Close this session
   */
  close(): void {
    if (this.state === SessionState.CLOSED) {
      return;
    }
    
    this.state = SessionState.CLOSING;
    this.stopHeartbeat();
    
    if (this.socket) {
      this.socket.end();
      this.socket = null;
    }
    
    this.channels.clear();
    this.tasks.clear();
    this.state = SessionState.CLOSED;
  }
  
  // ========================================================================
  // Channel Management
  // ========================================================================
  
  createChannel(commandId: number): ChannelInfo | null {
    const channelId = GetRandomU32();
    
    const channel: ChannelInfo = {
      channelId,
      sessionId: this.sessionId,
      commandId,
      taskType: TaskType.TYPE_UNITY,
      createTime: GetRuntimeMSec(),
      lastActivity: GetRuntimeMSec(),
    };
    
    this.channels.set(channelId, channel);
    return channel;
  }
  
  getChannel(channelId: number): ChannelInfo | undefined {
    return this.channels.get(channelId);
  }
  
  removeChannel(channelId: number): boolean {
    return this.channels.delete(channelId);
  }
  
  listChannels(): ChannelInfo[] {
    return Array.from(this.channels.values());
  }
  
  // ========================================================================
  // Task Management
  // ========================================================================
  
  createTask(channelId: number, taskType: TaskType): TaskInfo {
    const task: TaskInfo = {
      channelId,
      sessionId: this.sessionId,
      taskType,
      taskClass: null,
      hasInitial: false,
      createTime: GetRuntimeMSec(),
    };
    
    this.tasks.set(channelId, task);
    return task;
  }
  
  getTask(channelId: number): TaskInfo | undefined {
    return this.tasks.get(channelId);
  }
  
  removeTask(channelId: number): boolean {
    return this.tasks.delete(channelId);
  }
}

// ============================================================================
// HdcSessionManager
// ============================================================================

export class HdcSessionManager extends EventEmitter {
  private sessions: Map<number, HdcSession> = new Map();
  private serverOrDaemon: boolean;
  
  constructor(serverOrDaemon: boolean = true) {
    super();
    this.serverOrDaemon = serverOrDaemon;
  }
  
  createSession(connType: ConnType, socket?: net.Socket): HdcSession {
    const session = new HdcSession({
      serverOrDaemon: this.serverOrDaemon,
      connType,
    });
    
    this.sessions.set(session.sessionId, session);
    
    session.on('close', () => {
      this.sessions.delete(session.sessionId);
      this.emit('session-close', session);
    });
    
    session.on('handshake', (handshake) => {
      this.emit('session-ready', session, handshake);
    });
    
    session.on('packet', (packet) => {
      this.emit('packet', session, packet);
    });
    
    session.on('error', (err) => {
      this.emit('session-error', session, err);
    });
    
    if (socket) {
      session.attachSocket(socket);
    }
    
    return session;
  }
  
  getSession(sessionId: number): HdcSession | undefined {
    return this.sessions.get(sessionId);
  }
  
  getSessionByConnectKey(connectKey: string): HdcSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.connectKey === connectKey) {
        return session;
      }
    }
    return undefined;
  }
  
  removeSession(sessionId: number): boolean {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.sessions.delete(sessionId);  // Remove from map first
      session.close();  // Then close
      return true;
    }
    return false;
  }
  
  listSessions(): HdcSession[] {
    return Array.from(this.sessions.values());
  }
  
  getActiveSessions(): HdcSession[] {
    return Array.from(this.sessions.values()).filter(s => s.isActive());
  }
  
  closeAll(): void {
    for (const session of this.sessions.values()) {
      session.close();
    }
    this.sessions.clear();
  }
  
  get count(): number {
    return this.sessions.size;
  }
}
