/**
 * HDC Server Module
 *
 * Background server that listens on TCP port 8710 for local client connections.
 * When a client connects, the server sends a ChannelHandShake, receives the
 * client's response with connectKey, and routes commands to the appropriate
 * daemon session.
 *
 * Ported from: hdc_rust/src/host/server.rs
 */

import { EventEmitter } from 'events';
import * as net from 'net';
import {
  encodeChannelHandShake,
  decodeChannelHandShake,
  ChannelHandShake,
} from '../common/channel.js';
import {
  parsePacket,
  createPacket,
  PACKET_HEADER_SIZE,
  PAYLOAD_PROTECT_VCODE,
} from '../common/message.js';
import { PayloadProtect } from '../common/serialization.js';
import { DEFAULT_PORT, CommandId, HDC_VERSION_STRING } from '../common/protocol.js';
import { HdcSession } from '../common/session.js';

// ============================================================================
// Types
// ============================================================================

export interface ServerOptions {
  port: number;
  host: string;
}

export interface ClientConnection {
  id: number;
  socket: net.Socket;
  handshakeOK: boolean;
  connectKey: string;
  buffer: Buffer;
}

// ============================================================================
// HdcServer
// ============================================================================

export class HdcServer extends EventEmitter {
  private server: net.Server | null = null;
  private options: ServerOptions;
  private clients: Map<number, ClientConnection> = new Map();
  private daemonSessions: Map<string, HdcSession> = new Map(); // connectKey -> session
  private nextChannelId: number = 1;
  private running: boolean = false;

  constructor(options?: Partial<ServerOptions>) {
    super();
    this.options = {
      port: options?.port ?? DEFAULT_PORT,
      host: options?.host ?? '127.0.0.1',
    };
  }

  /**
   * Start the HDC server listening on the configured TCP address.
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.server = net.createServer();

      this.server.on('error', (err: Error) => {
        if (!this.running) {
          reject(err);
        } else {
          this.emit('error', err);
        }
      });

      this.server.on('connection', (socket: net.Socket) => {
        this.acceptClient(socket);
      });

      this.server.listen(this.options.port, this.options.host, () => {
        this.running = true;
        this.emit('started');
        resolve();
      });
    });
  }

  /**
   * Gracefully stop the server and disconnect all clients.
   */
  async stop(): Promise<void> {
    if (!this.running && !this.server) {
      return;
    }

    this.running = false;

    // Close all client connections
    for (const [id, client] of this.clients) {
      client.socket.destroy();
    }
    this.clients.clear();

    // Close all daemon sessions
    for (const [key, session] of this.daemonSessions) {
      session.close();
    }
    this.daemonSessions.clear();

    // Close the server
    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => {
          this.server = null;
          this.emit('stopped');
          resolve();
        });
      });
    }
  }

  /**
   * Check if server is running.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get the address the server is listening on.
   */
  address(): net.AddressInfo | string | null {
    return this.server?.address() ?? null;
  }

  /**
   * Get number of connected clients.
   */
  get clientCount(): number {
    return this.clients.size;
  }

  /**
   * Get number of registered daemon sessions.
   */
  get daemonSessionCount(): number {
    return this.daemonSessions.size;
  }

  // ==========================================================================
  // Daemon Session Management
  // ==========================================================================

  /**
   * Register a daemon session (device) with the server.
   */
  registerDaemonSession(connectKey: string, session: HdcSession): void {
    this.daemonSessions.set(connectKey, session);
    this.emit('daemon-registered', connectKey, session);
  }

  /**
   * Remove a registered daemon session.
   */
  removeDaemonSession(connectKey: string): void {
    const session = this.daemonSessions.get(connectKey);
    if (session) {
      this.daemonSessions.delete(connectKey);
      this.emit('daemon-removed', connectKey);
    }
  }

  /**
   * Get a daemon session by connectKey.
   */
  getDaemonSession(connectKey: string): HdcSession | undefined {
    return this.daemonSessions.get(connectKey);
  }

  /**
   * List all registered daemon connectKeys.
   */
  listDaemonKeys(): string[] {
    return Array.from(this.daemonSessions.keys());
  }

  // ==========================================================================
  // Client Handling
  // ==========================================================================

  /**
   * Accept a new client connection, send ChannelHandShake.
   */
  private acceptClient(socket: net.Socket): void {
    const channelId = this.nextChannelId++;

    const client: ClientConnection = {
      id: channelId,
      socket,
      handshakeOK: false,
      connectKey: '',
      buffer: Buffer.alloc(0),
    };

    this.clients.set(channelId, client);
    this.emit('client-connected', client);

    // Build and send ChannelHandShake with the assigned channelId in network byte order
    const handshake: ChannelHandShake = {
      banner: 'OHOS HDC',
      channelId,
      connectKey: '',
      version: HDC_VERSION_STRING,
    };

    const handshakeBuf = encodeChannelHandShake(handshake, true, true);
    socket.write(handshakeBuf);

    socket.on('data', (data: Buffer) => {
      this.handleClientData(client, data);
    });

    socket.on('close', () => {
      this.handleClientDisconnect(client);
    });

    socket.on('error', (err: Error) => {
      this.emit('client-error', client, err);
      this.handleClientDisconnect(client);
    });
  }

  /**
   * Handle incoming data from a client.
   */
  private handleClientData(client: ClientConnection, data: Buffer): void {
    client.buffer = Buffer.concat([client.buffer, data]);

    if (!client.handshakeOK) {
      // Still waiting for handshake response
      // ChannelHandShake short form is 44 bytes, long form is 108 bytes
      if (client.buffer.length >= 44) {
        this.handleChannelHandshake(client);
      }
      return;
    }

    // After handshake, process commands
    this.processCommandBuffer(client);
  }

  /**
   * Process the client's ChannelHandShake response.
   */
  private handleChannelHandshake(client: ClientConnection): void {
    try {
      const hs = decodeChannelHandShake(client.buffer);

      // Extract the connectKey from the handshake response
      client.connectKey = hs.connectKey;
      client.handshakeOK = true;

      // Consume the handshake bytes (44 for short form, up to 108 for long form)
      const consumedBytes = client.buffer.length >= 108 ? 108 : 44;
      client.buffer = client.buffer.subarray(consumedBytes);

      this.emit('client-handshake', client, hs);
    } catch (err) {
      this.emit('client-error', client, err as Error);
      client.socket.destroy();
      this.clients.delete(client.id);
    }
  }

  /**
   * Process the command buffer after handshake is complete.
   * Tries to parse HDC packets and extract commands.
   */
  private processCommandBuffer(client: ClientConnection): void {
    // Try to parse as text command first (simpler local commands)
    const text = client.buffer.toString('utf-8').trim();
    if (text.length > 0) {
      // Try to handle as local command
      const handled = this.handleLocalCommand(client, text);
      if (handled) {
        client.buffer = Buffer.alloc(0);
        return;
      }
    }

    // Try to parse as HDC packet
    if (client.buffer.length >= PACKET_HEADER_SIZE) {
      const packet = parsePacket(client.buffer);
      if (packet) {
        const totalSize = PACKET_HEADER_SIZE + packet.header.headSize + packet.header.dataSize;
        client.buffer = client.buffer.subarray(totalSize);

        // Extract text payload for command routing
        const payloadStr = packet.payload.toString('utf-8').trim();
        if (payloadStr.length > 0) {
          this.handleCommand(client, payloadStr);
        }
        return;
      }
    }

    // If we can't parse it, try raw text for local commands
    if (text.length > 0) {
      this.handleCommand(client, text);
      client.buffer = Buffer.alloc(0);
    }
  }

  /**
   * Route incoming command from client.
   */
  private handleCommand(client: ClientConnection, command: string): void {
    // Try local commands first
    const handled = this.handleLocalCommand(client, command);
    if (handled) {
      return;
    }

    // For remote commands, forward to the daemon session matching connectKey
    if (client.connectKey) {
      const session = this.daemonSessions.get(client.connectKey);
      if (session) {
        // Forward raw data to the daemon session
        const payload = Buffer.from(command, 'utf-8');
        const protect: PayloadProtect = {
          channelId: client.id,
          commandFlag: CommandId.CMD_UNITY_EXECUTE,
          checkSum: 0,
          vCode: PAYLOAD_PROTECT_VCODE,
        };
        const packet = createPacket(payload, protect);
        const socket = session.getSocket();
        if (socket) {
          socket.write(packet);
        }
        return;
      }
    }

    // No daemon session found for remote command
    const response = `Error: no device found for key '${client.connectKey}'\n`;
    client.socket.write(response);
  }

  /**
   * Handle local commands (handled by server directly).
   * Returns true if the command was handled locally.
   */
  private handleLocalCommand(client: ClientConnection, command: string): boolean {
    const trimmed = command.trim();
    const lower = trimmed.toLowerCase();

    // list targets - list connected daemon sessions
    if (lower === 'list targets') {
      const keys = this.listDaemonKeys();
      let response: string;
      if (keys.length === 0) {
        response = '[Empty]\n';
      } else {
        response = keys.join('\n') + `\n(${keys.length} devices)\n`;
      }
      client.socket.write(response);
      return true;
    }

    // tconn - connect to a device (for now, just acknowledge)
    if (lower.startsWith('tconn')) {
      // Will be implemented with full remote routing
      client.socket.write('tconn: not yet implemented\n');
      return true;
    }

    // fport ls - list port forwards
    if (lower === 'fport ls' || lower.startsWith('fport ls ')) {
      client.socket.write('fport ls: no forwards\n');
      return true;
    }

    // fport rm - remove port forward
    if (lower.startsWith('fport rm')) {
      client.socket.write('fport rm: not yet implemented\n');
      return true;
    }

    // start - server is already running
    if (lower === 'start') {
      client.socket.write('Server already running\n');
      return true;
    }

    // kill - shutdown server
    if (lower === 'kill') {
      client.socket.write('Server shutting down\n');
      // Schedule shutdown so we can send the response first
      setImmediate(() => {
        this.stop();
      });
      return true;
    }

    // version - return version string
    if (lower === 'version') {
      client.socket.write(`HDC ${HDC_VERSION_STRING}\n`);
      return true;
    }

    // Not a local command
    return false;
  }

  /**
   * Handle client disconnection.
   */
  private handleClientDisconnect(client: ClientConnection): void {
    if (this.clients.has(client.id)) {
      this.clients.delete(client.id);
      this.emit('client-disconnected', client);
    }
  }
}
