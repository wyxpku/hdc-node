/**
 * HDC Server Module
 *
 * Background server that manages device connections.
 * Ported from: hdc_rust/src/host/server.rs
 */

import * as net from 'net';
import { parsePacket, createPacket } from '../common/message.js';

export interface ServerOptions {
  port?: number;
  host?: string;
}

export interface DeviceConnection {
  socket: net.Socket;
  connectKey: string;
  connType: number;
  lastActivity: Date;
}

export class HdcServer {
  private server: net.Server | null = null;
  private port: number;
  private host: string;
  private devices: Map<string, DeviceConnection> = new Map();
  private running: boolean = false;

  constructor(options: ServerOptions = {}) {
    this.port = options.port || 8710;
    this.host = options.host || '127.0.0.1';
  }

  /**
   * Start the HDC server
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket: net.Socket) => {
        this.handleConnection(socket);
      });

      this.server.on('error', (err) => {
        reject(err);
      });

      this.server.listen(this.port, this.host, () => {
        this.running = true;
        console.log(`HDC server listening on ${this.host}:${this.port}`);
        resolve();
      });
    });
  }

  /**
   * Stop the HDC server
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      // Close all device connections
      for (const [key, conn] of this.devices) {
        conn.socket.end();
      }
      this.devices.clear();

      // Close server
      if (this.server) {
        this.server.close(() => {
          this.running = false;
          console.log('HDC server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Handle new connection
   */
  private handleConnection(socket: net.Socket): void {
    const remoteAddr = socket.remoteAddress;
    const remotePort = socket.remotePort;
    const connectKey = `${remoteAddr}:${remotePort}`;

    console.log(`New connection from ${connectKey}`);

    const deviceConn: DeviceConnection = {
      socket,
      connectKey,
      connType: 1, // TCP
      lastActivity: new Date(),
    };

    this.devices.set(connectKey, deviceConn);

    socket.on('data', (data: Buffer) => {
      this.handleDeviceData(connectKey, data);
    });

    socket.on('close', () => {
      this.handleDeviceDisconnect(connectKey);
    });

    socket.on('error', (err) => {
      console.error(`Device ${connectKey} error:`, err);
      this.handleDeviceDisconnect(connectKey);
    });
  }

  /**
   * Handle data from device
   */
  private handleDeviceData(connectKey: string, data: Buffer): void {
    const device = this.devices.get(connectKey);
    if (!device) return;

    device.lastActivity = new Date();

    try {
      const packet = parsePacket(data);
      if (packet) {
        console.log(`Message from ${connectKey}:`, packet.header);
        // Process message based on content
        this.processMessage(device, packet.payload);
      }
    } catch (err) {
      console.error(`Failed to parse message from ${connectKey}:`, err);
    }
  }

  /**
   * Process incoming message
   */
  private processMessage(device: DeviceConnection, payload: Buffer): void {
    // TODO: Implement actual message processing based on payload content
    console.log('Payload from', device.connectKey, payload.toString());
  }

  /**
   * Handle device disconnect
   */
  private handleDeviceDisconnect(connectKey: string): void {
    console.log(`Device disconnected: ${connectKey}`);
    this.devices.delete(connectKey);
  }

  /**
   * List connected devices
   */
  listDevices(): DeviceConnection[] {
    return Array.from(this.devices.values());
  }

  /**
   * Check if server is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get device by connect key
   */
  getDevice(connectKey: string): DeviceConnection | undefined {
    return this.devices.get(connectKey);
  }

  /**
   * Send command to device
   */
  sendToDevice(connectKey: string, data: Buffer): boolean {
    const device = this.devices.get(connectKey);
    if (!device) {
      console.error(`Device not found: ${connectKey}`);
      return false;
    }

    device.socket.write(data);
    device.lastActivity = new Date();
    return true;
  }
}
