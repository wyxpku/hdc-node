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
import { parsePacket, PacketParseResult } from './message.js';
import { PKG_PAYLOAD_MAX_SIZE } from './protocol.js';
import { GetRuntimeMSec, GetRandomU32 } from './base.js';

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

export interface SessionHandshake {
  banner: string;
  authType: AuthType;
  sessionId: number;
  connectKey: string;
  version: string;
}

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
    
    const handshake: SessionHandshake = {
      banner: HANDSHAKE_MESSAGE,
      authType: AuthType.AUTH_NONE,
      sessionId: this.sessionId,
      connectKey: this.connectKey,
      version: String(HDC_PROTOCOL_VERSION),
    };
    
    const payload = this.buildHandshakePayload(handshake);
    const packet = this.buildPacket(payload);
    
    this.socket?.write(packet);
    this.updateActivity();
  }
  
  /**
   * Build handshake payload
   */
  private buildHandshakePayload(handshake: SessionHandshake): Buffer {
    const parts: Buffer[] = [];
    
    // Banner (12 bytes)
    const bannerBuf = Buffer.alloc(12);
    bannerBuf.write(handshake.banner, 0, 'utf8');
    parts.push(bannerBuf);
    
    // Session ID (4 bytes)
    const sessionIdBuf = Buffer.alloc(4);
    sessionIdBuf.writeUInt32BE(handshake.sessionId, 0);
    parts.push(sessionIdBuf);
    
    // Auth type (1 byte)
    parts.push(Buffer.from([handshake.authType]));
    
    // Connect key (variable)
    const connectKeyBuf = Buffer.from(handshake.connectKey, 'utf8');
    const keyLenBuf = Buffer.alloc(2);
    keyLenBuf.writeUInt16BE(connectKeyBuf.length, 0);
    parts.push(keyLenBuf);
    parts.push(connectKeyBuf);
    
    // Version (variable)
    const versionBuf = Buffer.from(handshake.version, 'utf8');
    const verLenBuf = Buffer.alloc(2);
    verLenBuf.writeUInt16BE(versionBuf.length, 0);
    parts.push(verLenBuf);
    parts.push(versionBuf);
    
    return Buffer.concat(parts);
  }
  
  /**
   * Build packet with size prefix
   */
  private buildPacket(payload: Buffer): Buffer {
    const sizeBuf = Buffer.alloc(4);
    sizeBuf.writeUInt32BE(payload.length, 0);
    return Buffer.concat([sizeBuf, payload]);
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
    while (this.buffer.length >= 4) {
      const packetSize = this.buffer.readUInt32BE(0);
      
      if (packetSize <= 0 || packetSize > PKG_PAYLOAD_MAX_SIZE) {
        this.emit('error', new Error(`Invalid packet size: ${packetSize}`));
        this.close();
        return;
      }
      
      const totalSize = 4 + packetSize;
      if (this.buffer.length < totalSize) {
        break;
      }
      
      const packetData = this.buffer.subarray(0, totalSize);
      this.buffer = this.buffer.subarray(totalSize);
      
      try {
        const packet = parsePacket(packetData);
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
      const handshake = this.parseHandshakePayload(packet.payload);
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
   * Parse handshake payload
   */
  private parseHandshakePayload(payload: Buffer): SessionHandshake {
    let offset = 0;
    
    const banner = payload.subarray(offset, offset + 12).toString('utf8').replace(/\0/g, '');
    offset += 12;
    
    const sessionId = payload.readUInt32BE(offset);
    offset += 4;
    
    const authType = payload.readUInt8(offset);
    offset += 1;
    
    const keyLen = payload.readUInt16BE(offset);
    offset += 2;
    const connectKey = payload.subarray(offset, offset + keyLen).toString('utf8');
    offset += keyLen;
    
    const verLen = payload.readUInt16BE(offset);
    offset += 2;
    const version = payload.subarray(offset, offset + verLen).toString('utf8');
    
    return { banner, authType, sessionId, connectKey, version };
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
    this.sendRaw(payload);
  }
  
  /**
   * Send raw data
   */
  private sendRaw(data: Buffer): boolean {
    if (!this.socket || this.state !== SessionState.READY) {
      return false;
    }
    
    const packet = this.buildPacket(data);
    
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
    return this.sendRaw(data instanceof Uint8Array ? Buffer.from(data) : data);
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
