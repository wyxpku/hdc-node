#!/usr/bin/env node

/**
 * HDC CLI Entry Point
 *
 * Command line interface for HDC (OpenHarmony Device Connector).
 * Uses HdcClient with channel protocol, auto server pull-up, and full command support.
 *
 * Ported from: hdc-source/src/host/main.cpp
 */

import * as net from 'net';
import * as path from 'path';
import * as fs from 'fs';
import * as child_process from 'child_process';
import { parseCommand, ParsedCommand, getHelp, parseServerAddress, getDefaultServerAddress, buildCommandString } from './host/parser.js';
import { HdcClient } from './host/client.js';
import { HdcServer } from './host/server.js';
import { HdcAuth } from './common/auth.js';
import { DEFAULT_PORT } from './common/protocol.js';

const VERSION = '0.0.1';

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // No arguments - show help
  if (args.length === 0) {
    console.log(getHelp());
    process.exit(0);
  }

  const parsed = parseCommand(args);

  if (parsed instanceof Error) {
    console.error(parsed.message);
    process.exit(1);
  }

  // Show help
  if (parsed.command === 'help' || parsed.args.includes('--help') || parsed.args.includes('-h')) {
    console.log(getHelp());
    process.exit(0);
  }

  // Show version
  if (parsed.command === 'version' || parsed.args.includes('--version') || parsed.args.includes('-v')) {
    console.log(`HDC Node.js v${VERSION}`);
    process.exit(0);
  }

  // Run in server mode
  if (parsed.runInServer || parsed.command === 'server') {
    await runServer(parsed);
    return;
  }

  // Handle keygen locally (does not need server)
  if (parsed.command === 'keygen') {
    await runKeygen(parsed.args);
    return;
  }

  // Client mode - connect to server
  try {
    await runClient(parsed);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

// ============================================================================
// Server Mode
// ============================================================================

async function runServer(parsed: ParsedCommand): Promise<void> {
  const addr = parsed.serverAddr || getDefaultServerAddress();
  const { host, port } = parseServerAddress(addr);

  const server = new HdcServer({ host, port });

  try {
    await server.start();
    console.log(`HDC server listening on ${host}:${port}`);
    console.log('Press Ctrl+C to stop');
  } catch (err) {
    console.error(`Failed to start server: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  // Handle shutdown signals
  const shutdown = async () => {
    console.log('\nShutting down server...');
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// ============================================================================
// Server Alive Check & Auto Pull-Up
// ============================================================================

/**
 * Check if the HDC server is alive by attempting a TCP connection.
 */
async function checkServerAlive(host: string, port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1000);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => {
      resolve(false);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

/**
 * Spawn the HDC server process in the background.
 */
async function pullupServer(host: string, port: number): Promise<void> {
  const serverArgs = ['-m', '-s', `${host}:${port}`];

  const child = child_process.spawn(process.execPath, [
    path.join(__dirname, 'cli.js'),
    ...serverArgs,
  ], {
    detached: true,
    stdio: 'ignore',
  });

  child.unref();

  // Wait briefly for server to start
  await new Promise((r) => setTimeout(r, 500));
}

// ============================================================================
// Client Mode
// ============================================================================

async function runClient(parsed: ParsedCommand): Promise<void> {
  const addr = parsed.serverAddr || getDefaultServerAddress();
  const { host, port } = parseServerAddress(addr);

  // Auto server pull-up
  if (!parsed.spawnedServer && !parsed.skipPullup) {
    const alive = await checkServerAlive(host, port);
    if (!alive) {
      await pullupServer(host, port);
      // Verify server started
      const retryAlive = await checkServerAlive(host, port);
      if (!retryAlive) {
        throw new Error('Failed to start HDC server. Try running "hdc start" manually.');
      }
    }
  }

  // Connect to server via HdcClient
  const client = new HdcClient({
    host,
    port,
    connectKey: parsed.targetKey,
  });

  await client.connect();

  try {
    // Build command string from parsed result and send to server
    const commandStr = buildCommandString(parsed);

    if (commandStr && parsed.command) {
      const response = await client.executeCommand(commandStr);
      if (response) {
        process.stdout.write(response);
      }
    } else {
      console.log(getHelp());
    }
  } finally {
    await client.disconnect();
  }
}

// ============================================================================
// Keygen Command
// ============================================================================

async function runKeygen(args: string[]): Promise<void> {
  const filePath = args[0];
  if (!filePath) {
    console.error('Usage: hdc keygen <FILE>');
    process.exit(1);
  }

  const auth = new HdcAuth();

  try {
    const keyPair = await auth.generateKeyPair();

    // Write private key to specified file
    const dir = path.dirname(path.resolve(filePath));
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(filePath, keyPair.privateKey);

    // Write public key to file with .pub suffix
    const pubPath = filePath + '.pub';
    fs.writeFileSync(pubPath, keyPair.publicKey);

    console.log(`Generated RSA keypair:`);
    console.log(`  Private key: ${path.resolve(filePath)}`);
    console.log(`  Public key:  ${path.resolve(pubPath)}`);
  } catch (err) {
    console.error(`Keygen failed: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

// ============================================================================
// Run
// ============================================================================

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
