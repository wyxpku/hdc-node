#!/usr/bin/env node

/**
 * HDC CLI Entry Point
 *
 * Command line interface for HDC (OpenHarmony Device Connector).
 * Ported from: hdc-source/src/host/main.cpp
 */

import { parseCommand, ParsedCommand, getHelp } from './host/parser.js';
import { TcpClient, TcpServer, TcpState } from './common/tcp.js';
import { HdcSession, HdcSessionManager, ConnType } from './common/session.js';
import { HdcShell, executeShell } from './host/shell.js';
import { HdcFileSender, HdcFileReceiver, sendDirectory } from './host/file.js';
import { createPacket, parsePacket } from './common/message.js';
import { CommandId } from './common/protocol.js';
import { GetRandomString } from './common/base.js';

const VERSION = '1.0.0';
const DEFAULT_PORT = 8710;

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
    console.error(`Error: ${parsed.message}`);
    console.error('\n' + getHelp());
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

  // Client mode - connect to server or device
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
  const port = parsed.serverAddr ? parseInt(parsed.serverAddr.split(':')[1] || '8710') : DEFAULT_PORT;
  
  const server = new TcpServer({ host: '0.0.0.0', port });
  const sessionManager = new HdcSessionManager(true);

  server.on('listening', () => {
    console.log(`HDC server listening on port ${port}`);
    console.log('Press Ctrl+C to stop');
  });

  server.on('connection', (connection) => {
    console.log(`Client connected: ${connection.remoteAddress}:${connection.remotePort}`);
    
    // Create session for this connection
    const session = sessionManager.createSession(ConnType.CONN_TCP);
    session.attachSocket(connection.socket);
    
    session.on('handshake', (handshake) => {
      console.log(`Session ${session.sessionId} handshake complete`);
    });

    session.on('close', () => {
      console.log(`Session ${session.sessionId} closed`);
    });
  });

  server.on('error', (err: Error) => {
    console.error(`Server error: ${err.message}`);
  });

  try {
    await server.start();

    // Handle shutdown signals
    process.on('SIGINT', async () => {
      console.log('\nShutting down...');
      sessionManager.closeAll();
      await server.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      sessionManager.closeAll();
      await server.stop();
      process.exit(0);
    });

  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

// ============================================================================
// Client Mode
// ============================================================================

async function runClient(parsed: ParsedCommand): Promise<void> {
  const host = parsed.serverAddr?.split(':')[0] || '127.0.0.1';
  const port = parseInt(parsed.serverAddr?.split(':')[1] || '8710');

  const client = new TcpClient({ host, port, timeout: 5000 });

  try {
    await client.connect();
    
    const result = await handleCommand(client, parsed);
    if (result) {
      console.log(result);
    }
  } finally {
    await client.disconnect();
  }
}

/**
 * Handle client command
 */
async function handleCommand(client: TcpClient, parsed: ParsedCommand): Promise<string | void> {
  const { command, args } = parsed;

  switch (command) {
    case 'list':
      return await handleList(client, args);
    
    case 'shell':
      return await handleShell(client, args);
    
    case 'file':
      return await handleFile(client, args);
    
    case 'send':
      // Alias for file send
      return await handleFile(client, ['send', ...args]);
    
    case 'recv':
    case 'pull':
      // Alias for file recv
      return await handleFile(client, ['recv', ...args]);
    
    case 'install':
      return await handleInstall(client, args);
    
    case 'uninstall':
      return await handleUninstall(client, args);
    
    case 'fport':
      return await handleForward(client, args);
    
    case 'kill':
      return await handleKill(client);
    
    default:
      return `Unknown command: ${command}\n${getHelp()}`;
  }
}

// ============================================================================
// Command Handlers
// ============================================================================

async function handleList(client: TcpClient, args: string[]): Promise<string> {
  const subCmd = args[0] || 'targets';
  
  if (subCmd === 'targets') {
    // List connected devices
    const request = createPacket(Buffer.from('list:targets'));
    client.send(request);
    
    // For now, return mock data
    return '127.0.0.1:5555\n(1 device)';
  }
  
  return `Unknown list type: ${subCmd}`;
}

async function handleShell(client: TcpClient, args: string[]): Promise<string> {
  const shellCmd = args.join(' ');
  
  if (!shellCmd) {
    // Interactive shell mode
    return 'Interactive shell mode not yet supported. Use: hdc shell <command>';
  }

  // One-shot shell command
  try {
    const request = createPacket(Buffer.from(`shell:${shellCmd}`));
    client.send(request);
    return 'Shell command sent';
  } catch (err) {
    throw new Error(`Shell execution failed: ${err}`);
  }
}

async function handleFile(client: TcpClient, args: string[]): Promise<string> {
  const subCmd = args[0];
  
  switch (subCmd) {
    case 'send':
      const localPath = args[1];
      const remotePath = args[2];
      if (!localPath || !remotePath) {
        return 'Usage: hdc file send <local> <remote>';
      }
      try {
        const request = createPacket(Buffer.from(`file:send:${remotePath}`));
        client.send(request);
        return `Sending ${localPath} to ${remotePath}`;
      } catch (err) {
        throw new Error(`Send failed: ${err}`);
      }

    case 'recv':
    case 'pull':
      const recvRemote = args[1];
      const recvLocal = args[2];
      if (!recvRemote || !recvLocal) {
        return 'Usage: hdc file recv <remote> <local>';
      }
      try {
        const request = createPacket(Buffer.from(`file:recv:${recvRemote}`));
        client.send(request);
        return `Receiving ${recvRemote} to ${recvLocal}`;
      } catch (err) {
        throw new Error(`Receive failed: ${err}`);
      }

    default:
      return 'Usage: hdc file <send|recv> ...';
  }
}

async function handleInstall(client: TcpClient, args: string[]): Promise<string> {
  const packagePath = args[0];
  if (!packagePath) {
    return 'Usage: hdc install <package>';
  }
  
  try {
    const request = createPacket(Buffer.from(`install:${packagePath}`));
    client.send(request);
    return `Installing ${packagePath}`;
  } catch (err) {
    throw new Error(`Install failed: ${err}`);
  }
}

async function handleUninstall(client: TcpClient, args: string[]): Promise<string> {
  const packageName = args[0];
  if (!packageName) {
    return 'Usage: hdc uninstall <package>';
  }
  
  try {
    const request = createPacket(Buffer.from(`uninstall:${packageName}`));
    client.send(request);
    return `Uninstalling ${packageName}`;
  } catch (err) {
    throw new Error(`Uninstall failed: ${err}`);
  }
}

async function handleForward(client: TcpClient, args: string[]): Promise<string> {
  const subCmd = args[0];
  
  switch (subCmd) {
    case 'list':
      const listRequest = createPacket(Buffer.from('fport:list'));
      client.send(listRequest);
      return 'Port forwards:';
    
    case 'add':
      const localPort = args[1];
      const remotePort = args[2];
      if (!localPort || !remotePort) {
        return 'Usage: hdc fport add <local> <remote>';
      }
      const addRequest = createPacket(Buffer.from(`fport:add:${localPort}:${remotePort}`));
      client.send(addRequest);
      return `Forwarding ${localPort} -> ${remotePort}`;
    
    case 'rm':
    case 'remove':
      const rmPort = args[1];
      if (!rmPort) {
        return 'Usage: hdc fport rm <port>';
      }
      const rmRequest = createPacket(Buffer.from(`fport:rm:${rmPort}`));
      client.send(rmRequest);
      return `Removed forward ${rmPort}`;
    
    default:
      return 'Usage: hdc fport <list|add|rm> ...';
  }
}

async function handleKill(client: TcpClient): Promise<string> {
  const request = createPacket(Buffer.from('kill'));
  client.send(request);
  return 'Server killed';
}

// ============================================================================
// Run
// ============================================================================

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
