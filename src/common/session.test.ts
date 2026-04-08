/**
 * Tests for session module
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  HdcSession,
  HdcSessionManager,
  SessionState,
  ConnType,
  AuthType,
  TaskType,
  HANDSHAKE_MESSAGE,
  HDC_PROTOCOL_VERSION,
} from './session.js';

describe('HdcSession', () => {
  let session: HdcSession;
  
  beforeEach(() => {
    session = new HdcSession({
      serverOrDaemon: true,
      connType: ConnType.CONN_TCP,
    });
  });
  
  afterEach(() => {
    session.close();
  });
  
  describe('constructor', () => {
    it('should create session with correct properties', () => {
      expect(session.connType).toBe(ConnType.CONN_TCP);
      expect(session.serverOrDaemon).toBe(true);
      expect(session.state).toBe(SessionState.INIT);
      expect(session.sessionId).toBeGreaterThan(0);
    });
    
    it('should accept custom session ID', () => {
      const customSession = new HdcSession({
        serverOrDaemon: false,
        connType: ConnType.CONN_USB,
        sessionId: 12345,
      });
      
      expect(customSession.sessionId).toBe(12345);
      expect(customSession.connType).toBe(ConnType.CONN_USB);
      expect(customSession.serverOrDaemon).toBe(false);
      
      customSession.close();
    });
  });
  
  describe('channel management', () => {
    it('should create channel', () => {
      const channel = session.createChannel(100);
      
      expect(channel).not.toBeNull();
      expect(channel!.channelId).toBeGreaterThan(0);
      expect(channel!.sessionId).toBe(session.sessionId);
      expect(channel!.commandId).toBe(100);
    });
    
    it('should get channel by ID', () => {
      const channel = session.createChannel(100);
      const found = session.getChannel(channel!.channelId);
      
      expect(found).toBeDefined();
      expect(found!.channelId).toBe(channel!.channelId);
    });
    
    it('should return undefined for non-existent channel', () => {
      const found = session.getChannel(99999);
      expect(found).toBeUndefined();
    });
    
    it('should remove channel', () => {
      const channel = session.createChannel(100);
      const result = session.removeChannel(channel!.channelId);
      
      expect(result).toBe(true);
      expect(session.getChannel(channel!.channelId)).toBeUndefined();
    });
    
    it('should list all channels', () => {
      session.createChannel(100);
      session.createChannel(200);
      session.createChannel(300);
      
      const channels = session.listChannels();
      expect(channels.length).toBe(3);
    });
  });
  
  describe('task management', () => {
    it('should create task', () => {
      const task = session.createTask(1, TaskType.TYPE_SHELL);
      
      expect(task.channelId).toBe(1);
      expect(task.sessionId).toBe(session.sessionId);
      expect(task.taskType).toBe(TaskType.TYPE_SHELL);
      expect(task.hasInitial).toBe(false);
    });
    
    it('should get task by channel ID', () => {
      session.createTask(1, TaskType.TYPE_SHELL);
      const found = session.getTask(1);
      
      expect(found).toBeDefined();
      expect(found!.taskType).toBe(TaskType.TYPE_SHELL);
    });
    
    it('should remove task', () => {
      session.createTask(1, TaskType.TYPE_SHELL);
      const result = session.removeTask(1);
      
      expect(result).toBe(true);
      expect(session.getTask(1)).toBeUndefined();
    });
  });
  
  describe('close', () => {
    it('should close session', () => {
      session.close();
      expect(session.state).toBe(SessionState.CLOSED);
    });
    
    it('should be idempotent', () => {
      session.close();
      session.close();
      session.close();
      expect(session.state).toBe(SessionState.CLOSED);
    });
    
    it('should clear channels on close', () => {
      session.createChannel(100);
      session.createChannel(200);
      
      session.close();
      
      expect(session.listChannels().length).toBe(0);
    });
  });
  
  describe('send', () => {
    it('should return false when not ready', () => {
      const result = session.send(1, Buffer.from('test'));
      expect(result).toBe(false);
    });
  });
  
  describe('isActive', () => {
    it('should return false when not ready', () => {
      expect(session.isActive()).toBe(false);
    });
  });
});

describe('HdcSessionManager', () => {
  let manager: HdcSessionManager;
  
  beforeEach(() => {
    manager = new HdcSessionManager(true);
  });
  
  afterEach(() => {
    manager.closeAll();
  });
  
  describe('constructor', () => {
    it('should create manager', () => {
      expect(manager.count).toBe(0);
    });
    
    it('should accept serverOrDaemon flag', () => {
      const clientManager = new HdcSessionManager(false);
      expect(clientManager['serverOrDaemon']).toBe(false);
    });
  });
  
  describe('createSession', () => {
    it('should create and register session', () => {
      const session = manager.createSession(ConnType.CONN_TCP);
      
      expect(session).toBeDefined();
      expect(manager.count).toBe(1);
      expect(manager.getSession(session.sessionId)).toBe(session);
    });
    
    it('should create multiple sessions', () => {
      manager.createSession(ConnType.CONN_TCP);
      manager.createSession(ConnType.CONN_USB);
      manager.createSession(ConnType.CONN_UART);
      
      expect(manager.count).toBe(3);
    });
  });
  
  describe('getSession', () => {
    it('should return session by ID', () => {
      const session = manager.createSession(ConnType.CONN_TCP);
      const found = manager.getSession(session.sessionId);
      
      expect(found).toBe(session);
    });
    
    it('should return undefined for non-existent ID', () => {
      const found = manager.getSession(99999);
      expect(found).toBeUndefined();
    });
  });
  
  describe('removeSession', () => {
    it('should remove session', () => {
      const session = manager.createSession(ConnType.CONN_TCP);
      const result = manager.removeSession(session.sessionId);
      
      expect(result).toBe(true);
      expect(manager.count).toBe(0);
    });
    
    it('should return false for non-existent session', () => {
      const result = manager.removeSession(99999);
      expect(result).toBe(false);
    });
  });
  
  describe('listSessions', () => {
    it('should list all sessions', () => {
      const s1 = manager.createSession(ConnType.CONN_TCP);
      const s2 = manager.createSession(ConnType.CONN_USB);
      
      const sessions = manager.listSessions();
      
      expect(sessions.length).toBe(2);
      expect(sessions).toContain(s1);
      expect(sessions).toContain(s2);
    });
  });
  
  describe('getActiveSessions', () => {
    it('should return only active sessions', () => {
      manager.createSession(ConnType.CONN_TCP);
      manager.createSession(ConnType.CONN_USB);
      
      const active = manager.getActiveSessions();
      
      // No sessions have sockets attached, so none are active
      expect(active.length).toBe(0);
    });
  });
  
  describe('closeAll', () => {
    it('should close all sessions', () => {
      manager.createSession(ConnType.CONN_TCP);
      manager.createSession(ConnType.CONN_USB);
      manager.createSession(ConnType.CONN_UART);
      
      manager.closeAll();
      
      expect(manager.count).toBe(0);
    });
  });
});

describe('Constants', () => {
  it('should have correct handshake message', () => {
    expect(HANDSHAKE_MESSAGE).toBe('OHOS HDC');
  });
  
  it('should have protocol version', () => {
    expect(HDC_PROTOCOL_VERSION).toBe(1);
  });
});

describe('Enums', () => {
  it('should have correct ConnType values', () => {
    expect(ConnType.CONN_TCP).toBe(0);
    expect(ConnType.CONN_USB).toBe(1);
    expect(ConnType.CONN_UART).toBe(2);
    expect(ConnType.CONN_USB_SERIAL).toBe(3);
  });
  
  it('should have correct AuthType values', () => {
    expect(AuthType.AUTH_NONE).toBe(0);
    expect(AuthType.AUTH_TOKEN).toBe(1);
    expect(AuthType.AUTH_PUBLICKEY).toBe(3);
    expect(AuthType.AUTH_OK).toBe(4);
    expect(AuthType.AUTH_FAIL).toBe(5);
  });
  
  it('should have correct TaskType values', () => {
    expect(TaskType.TYPE_UNITY).toBe(0);
    expect(TaskType.TYPE_SHELL).toBe(1);
    expect(TaskType.TYPE_FILE).toBe(2);
    expect(TaskType.TYPE_FORWARD).toBe(3);
    expect(TaskType.TYPE_APP).toBe(4);
  });
  
  it('should have correct SessionState values', () => {
    expect(SessionState.INIT).toBe(0);
    expect(SessionState.CONNECTING).toBe(1);
    expect(SessionState.HANDSHAKE).toBe(2);
    expect(SessionState.AUTH).toBe(3);
    expect(SessionState.READY).toBe(4);
    expect(SessionState.CLOSING).toBe(5);
    expect(SessionState.CLOSED).toBe(6);
  });
});
