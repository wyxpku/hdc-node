#!/usr/bin/env node

/**
 * HDC CLI Entry Point
 *
 * Command line interface for HDC (OpenHarmony Device Connector).
 * Ported from: hdc_rust/src/host/main.rs
 */

import { parseCommand, ParsedCommand, getHelp } from './host/parser.js';
import { HdcClient } from './host/client.js';
import { HdcServer } from './host/server.js';
import { string2FormatCommand, usage } from './host/translate.js';
import { VERSION } from './index.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const parsed = parseCommand(args);

  if (parsed instanceof Error) {
    console.error(parsed.message);
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
    console.log(`hdc version ${VERSION}`);
    process.exit(0);
  }

  // Run in server mode
  if (parsed.runInServer) {
    const server = new HdcServer({
      port: parsed.serverAddr ? parseInt(parsed.serverAddr.split(':')[1]) : 8710,
    });

    try {
      await server.start();
      console.log('HDC server started. Press Ctrl+C to stop.');

      // Handle shutdown signals
      process.on('SIGINT', async () => {
        console.log('\nShutting down...');
        await server.stop();
        process.exit(0);
      });

      process.on('SIGTERM', async () => {
        await server.stop();
        process.exit(0);
      });

    } catch (err) {
      console.error('Failed to start server:', err);
      process.exit(1);
    }
    return;
  }

  // Client mode
  const client = new HdcClient({
    serverAddr: parsed.serverAddr,
  });

  try {
    await client.connect();

    // Handle commands
    const result = await handleCommand(client, parsed);
    if (result) {
      console.log(result);
    }

  } catch (err) {
    console.error('Error:', err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    await client.disconnect();
  }
}

/**
 * Handle client command
 */
async function handleCommand(client: HdcClient, parsed: ParsedCommand): Promise<string | void> {
  const { command, args } = parsed;

  switch (command) {
    case 'list':
      if (args[0] === 'targets') {
        const devices = await client.listDevices();
        return devices.map(d => d.connectKey).join('\n');
      }
      return usage();

    case 'shell':
      // TODO: Implement shell
      const shellCmd = args.join(' ');
      console.log(`Shell command: ${shellCmd}`);
      return 'Shell not yet implemented';

    case 'file':
      // TODO: Implement file transfer
      const subCmd = args[0];
      if (subCmd === 'send') {
        const [local, remote] = args.slice(1);
        console.log(`Send: ${local} -> ${remote}`);
        return 'File transfer not yet implemented';
      } else if (subCmd === 'recv') {
        const [remote, local] = args.slice(1);
        console.log(`Recv: ${remote} -> ${local}`);
        return 'File transfer not yet implemented';
      }
      return usage();

    case 'install':
      // TODO: Implement install
      const packagePath = args[0];
      console.log(`Install: ${packagePath}`);
      return 'Install not yet implemented';

    case 'uninstall':
      // TODO: Implement uninstall
      const packageName = args[0];
      console.log(`Uninstall: ${packageName}`);
      return 'Uninstall not yet implemented';

    case 'fport':
      // TODO: Implement port forwarding
      return 'Port forwarding not yet implemented';

    case 'hilog':
      // TODO: Implement hilog
      return 'Hilog not yet implemented';

    default:
      return usage();
  }
}

// Run main
main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
