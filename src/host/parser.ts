/**
 * Command Parser Module
 *
 * Parses command line arguments into structured command format.
 * Ported from: hdc_rust/src/host/parser.rs
 */

export interface ParsedCommand {
  command: string;
  args: string[];
  targetKey?: string;
  serverAddr?: string;
  logLevel: number;
  runInServer: boolean;
  spawnedServer: boolean;
}

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

const DEFAULT_LOG_LEVEL = 2; // WARN
const DEFAULT_SERVER_PORT = 8710;

/**
 * Parse command line arguments
 */
export function parseCommand(args: string[]): ParsedCommand | ParseError {
  const result: ParsedCommand = {
    command: '',
    args: [],
    logLevel: DEFAULT_LOG_LEVEL,
    runInServer: false,
    spawnedServer: false,
  };

  let i = 0;
  const positionalArgs: string[] = [];

  while (i < args.length) {
    const arg = args[i];

    if (arg === '-h' || arg === '--help') {
      return new ParseError(getHelpText());
    }

    if (arg === '-v' || arg === '--version') {
      result.command = 'version';
      return result;
    }

    // Log level: -l0 to -l5 (must be -l followed by digit 0-5)
    if (arg.startsWith('-l') && arg.length === 3) {
      const level = parseInt(arg.slice(2), 10);
      if (!isNaN(level) && level >= 0 && level <= 5) {
        result.logLevel = level;
        i++;
        continue;
      }
    }

    // Target device key: -t <key>
    if (arg === '-t') {
      if (i + 1 >= args.length) {
        return new ParseError('Error: -t requires a device key');
      }
      result.targetKey = args[++i];
      i++;
      continue;
    }

    // Server address: -s [ip:]port
    if (arg === '-s') {
      if (i + 1 >= args.length) {
        return new ParseError('Error: -s requires an address');
      }
      result.serverAddr = args[++i];
      i++;
      continue;
    }

    // Server mode
    if (arg === '--server' || arg === '-S') {
      result.runInServer = true;
      i++;
      continue;
    }

    // Spawned server (internal)
    if (arg === '--spawned-server') {
      result.spawnedServer = true;
      i++;
      continue;
    }

    // Positional argument
    positionalArgs.push(arg);
    i++;
  }

  // First positional arg is the command
  if (positionalArgs.length > 0) {
    result.command = positionalArgs[0];
    result.args = positionalArgs.slice(1);
  }

  return result;
}

export function getHelp(): string {
  return getHelpText();
}

function getHelpText(): string {
  return `OpenHarmony Device Connector (HDC) - Node.js Implementation

Usage: hdc [options] <command> [arguments]

Options:
  -h, --help      Show this help message
  -v, --version   Show version info
  -l[0-5]         Set log level (0=off, 1=fatal, 2=error, 3=warn, 4=info, 5=debug)
  -t <key>        Specify target device by key
  -s [ip:]port    Connect to server at address
  -S, --server    Run as HDC server daemon

Commands:
  list targets              List connected devices
  tconn <key> [-remove]     Connect/disconnect TCP device
  tmode usb                 Switch device to USB mode
  tmode port <port>         Switch device to TCP mode
  shell [command]           Run shell command on device
  file send <local> <remote>   Send file to device
  file recv <remote> <local>   Receive file from device
  install <package>         Install application
  uninstall <package>       Uninstall application
  fport <local> <remote>    Forward port
  rport <remote> <local>    Reverse forward port
  fport ls                  List port forwards
  fport rm <task>           Remove port forward
  hilog                     View device logs
  jpid                      List JDWP debuggable processes
  target boot               Reboot device
  smode [-r]                Start/stop server daemon
  kill                      Kill server daemon

Examples:
  hdc list targets
  hdc -t 192.168.1.100:5555 shell
  hdc file send ./app.hap /data/local/tmp/
  hdc install /data/local/tmp/app.hap
`;
}

/**
 * Get default server address
 */
export function getDefaultServerAddress(): string {
  return `127.0.0.1:${DEFAULT_SERVER_PORT}`;
}

/**
 * Parse server address string
 */
export function parseServerAddress(addr: string): { host: string; port: number } {
  if (addr.includes(':')) {
    const [host, portStr] = addr.split(':');
    return { host, port: parseInt(portStr, 10) || DEFAULT_SERVER_PORT };
  }
  return { host: '127.0.0.1', port: parseInt(addr, 10) || DEFAULT_SERVER_PORT };
}
