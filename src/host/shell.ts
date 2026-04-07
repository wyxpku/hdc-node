/**
 * Shell Module
 *
 * Provides shell command execution on device.
 * Ported from: hdc_rust/src/host/task.rs
 */

import * as net from 'net';
import { createPacket, parsePacket } from '../common/message.js';

export interface ShellSession {
  sessionId: string;
  socket: net.Socket;
  command: string;
  onData: (data: Buffer) => void;
  onError: (err: Error) => void;
  onEnd: () => void;
}

export interface ShellResult {
  sessionId: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Execute shell command on device
 */
export async function executeShell(
  deviceSocket: net.Socket,
  command: string
): Promise<ShellResult> {
  return new Promise((resolve, reject) => {
    const sessionId = generateSessionId();
    let stdout = '';
    let stderr = '';
    let exitCode = 0;

    // Create shell request
    const payload = Buffer.from(`shell:${command}`);
    const packet = createPacket(payload);

    // Set up response handler
    const onData = (data: Buffer) => {
      const parsed = parsePacket(data);
      if (parsed) {
        stdout += parsed.payload.toString();
      }
    };

    const onEnd = () => {
      deviceSocket.off('data', onData);
      resolve({ sessionId, stdout, stderr, exitCode });
    };

    const onError = (err: Error) => {
      deviceSocket.off('data', onData);
      reject(err);
    };

    deviceSocket.on('data', onData);
    deviceSocket.once('close', onEnd);
    deviceSocket.once('error', onError);

    // Send shell command
    deviceSocket.write(packet);

    // Timeout
    setTimeout(() => {
      deviceSocket.off('data', onData);
      resolve({ sessionId, stdout, stderr, exitCode: -1 });
    }, 30000);
  });
}

/**
 * Create interactive shell session
 */
export function createShellSession(
  deviceSocket: net.Socket,
  onData: (data: Buffer) => void,
  onError: (err: Error) => void,
  onEnd: () => void
): string {
  const sessionId = generateSessionId();

  // Create interactive shell request
  const payload = Buffer.from('shell:');
  const packet = createPacket(payload);

  // Set up handlers
  deviceSocket.on('data', onData);
  deviceSocket.once('error', onError);
  deviceSocket.once('close', onEnd);

  // Send shell request
  deviceSocket.write(packet);

  return sessionId;
}

/**
 * Send data to shell session
 */
export function sendShellInput(deviceSocket: net.Socket, data: Buffer): void {
  const packet = createPacket(data);
  deviceSocket.write(packet);
}

/**
 * End shell session
 */
export function endShellSession(deviceSocket: net.Socket): void {
  // Send EOF marker
  const payload = Buffer.from([0x04]); // Ctrl+D
  const packet = createPacket(payload);
  deviceSocket.write(packet);
}

/**
 * Generate unique session ID
 */
function generateSessionId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
