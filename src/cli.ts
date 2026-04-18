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
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as child_process from 'child_process';
import { parseCommand, ParsedCommand, getHelp, parseServerAddress, getDefaultServerAddress, buildCommandString } from './host/parser.js';
import { HdcClient } from './host/client.js';
import { HdcServer } from './host/server.js';
import { HdcAuth } from './common/auth.js';
import { DEFAULT_PORT } from './common/protocol.js';

const SERVER_PID_FILE = path.join(os.tmpdir(), '.HDCServer.pid');

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

  // Handle kill locally - stop the official HDC server
  if (parsed.command === 'kill') {
    await runKill(parsed);
    return;
  }

  // Handle start locally - ensure server is running
  if (parsed.command === 'start') {
    await runStart(parsed);
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

  // Write PID file so client can kill/restart us
  fs.writeFileSync(SERVER_PID_FILE, String(process.pid));

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
    try { fs.unlinkSync(SERVER_PID_FILE); } catch { /* ignore */ }
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
    path.join(import.meta.dirname, 'cli.js'),
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

/**
 * Commands that don't need a target device (handled locally by server).
 */
function isLocalOnlyCommand(command: string): boolean {
  const locals = ['list', 'kill', 'start', 'version', 'help', 'server', 'keygen', 'discover'];
  return locals.includes(command);
}

/**
 * Commands that need a target device.
 */
function isTargetCommand(command: string): boolean {
  const targetCommands = [
    'shell', 'file', 'install', 'uninstall', 'fport', 'rport',
    'target', 'smode', 'tmode', 'hilog', 'jpid', 'track-jpid',
    'bugreport', 'sideload', 'tconn', 'checkdevice', 'wait', 'any',
    'update', 'flash', 'erase', 'format',
  ];
  return targetCommands.includes(command);
}

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

  // Determine connectKey: use -t value, or "any" for auto-select
  let connectKey = parsed.targetKey || '';
  if (!connectKey && parsed.command && isTargetCommand(parsed.command)) {
    connectKey = 'any';
  }

  // Connect to server via HdcClient
  const client = new HdcClient({
    host,
    port,
    connectKey,
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
// Kill / Start Server
// ============================================================================

/**
 * Read the HDC server PID from the PID file.
 */
function readServerPid(): number {
  try {
    const pidStr = fs.readFileSync(SERVER_PID_FILE, 'utf8').trim();
    const pid = parseInt(pidStr, 10);
    return isNaN(pid) ? 0 : pid;
  } catch {
    return 0;
  }
}

/**
 * Kill the HDC server daemon by PID.
 * On non-OHOS, the official client reads PID from /tmp/.HDCServer.pid and sends SIGKILL.
 */
async function runKill(parsed: ParsedCommand): Promise<void> {
  const isRestart = parsed.args.includes('-r');
  const pid = readServerPid();

  if (pid > 0) {
    try {
      process.kill(pid, 'SIGKILL');
      console.log('Kill server finish');
    } catch {
      // Process may already be dead
      console.log('Kill server finish');
    }
  } else {
    // No PID file — try connecting and see if server responds
    const addr = parsed.serverAddr || getDefaultServerAddress();
    const { host, port } = parseServerAddress(addr);
    const alive = await checkServerAlive(host, port);
    if (!alive) {
      console.log('No running HDC server found');
      return;
    }
    // Server is alive but we don't know its PID — can't kill
    console.log('Server is running but PID file not found. Kill it manually.');
    return;
  }

  // Restart if requested
  if (isRestart) {
    await pullupServer(
      ...(parsed.serverAddr
        ? (() => { const a = parseServerAddress(parsed.serverAddr); return [a.host, a.port] as const; })()
        : ['127.0.0.1', DEFAULT_PORT] as const),
    );
    console.log('Server restarted');
  }
}

/**
 * Start or restart the HDC server daemon.
 */
async function runStart(parsed: ParsedCommand): Promise<void> {
  const isRestart = parsed.args.includes('-r');
  const addr = parsed.serverAddr || getDefaultServerAddress();
  const { host, port } = parseServerAddress(addr);

  if (isRestart) {
    // Kill existing server first
    const pid = readServerPid();
    if (pid > 0) {
      try { process.kill(pid, 'SIGKILL'); } catch { /* already dead */ }
      await new Promise(r => setTimeout(r, 200));
    }
  }

  const alive = await checkServerAlive(host, port);
  if (alive && !isRestart) {
    console.log('Server already running');
    return;
  }

  await pullupServer(host, port);
  const retryAlive = await checkServerAlive(host, port);
  if (retryAlive) {
    console.log('Server started');
  } else {
    console.error('Failed to start server');
    process.exit(1);
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
