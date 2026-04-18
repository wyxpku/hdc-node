/**
 * Command Translation Module
 *
 * Translates CLI commands into internal command format.
 * Translated from: src/host/translate.cpp
 */

import { CommandFlag } from '../index.js';
import { parseExtendedShellArgs, encodeExtendedShellTlv } from './shell.js';

export interface FormatCommand {
  cmdFlag: CommandFlag;
  parameters: string;
  bJumpDo: boolean; // If true, command should not be sent to device
}

const MAX_CONNECT_KEY_SIZE = 50;

/**
 * Get help text for HDC commands
 */
export function usage(): string {
  return `OpenHarmony Device Connector (HDC) Tool
Version: Node.js Implementation

Usage: hdc [options] <command> [arguments]

Options:
  -h, --help      Show this help message
  -v, --version   Show version info
  -l[0-5]         Set log level (0=off, 5=verbose)
  -t <key>        Specify target device by key
  -s [ip:]port    Connect to server at address

Commands:
  list targets    List connected devices
  tconn key [-remove]  Connect/disconnect TCP device
  tmode usb       Switch device to USB mode
  tmode port <port>    Switch device to TCP mode
  shell [command]       Run shell command on device
  file send [-a] [-z] [-sync] [-m] <local> <remote>  Send file/dir to device
  file recv [-a] [-z] <remote> <local>              Receive file from device
  install [-r] [-g] [-d] <path>  Install application
  uninstall [-k] [-n <name>] [-m <module>] [-v <ver>] [-u <user>] <package>
                                Uninstall application
  sideload <path>       Sideload OTA package
  fport <local> <remote>  Forward port
  rport <remote> <local>  Reverse forward port
  fport ls        List port forwards
  fport rm <task> Remove port forward
  hilog           View device logs
  jpid            List JDWP debuggable processes
  target boot     Reboot device
  start           Start HDC server
  kill            Stop HDC server
  checkserver     Check server version
`;
}

export function verbose(): string {
  return usage() + `
flash commands:
  flash <partition> <image>  Flash partition with image

For more information, visit:
https://gitee.com/openharmony/developtools_hdc
`;
}

/**
 * Parse target connect command (tconn)
 */
export function targetConnect(cmd: FormatCommand): string {
  const parts = cmd.parameters.trim().split(/\s+/);

  if (parts[0].length > MAX_CONNECT_KEY_SIZE) {
    cmd.bJumpDo = true;
    return 'Error connect key\'s size';
  }

  // Check for -remove flag
  if (parts.length > 1 && parts[parts.length - 1] === '-remove') {
    cmd.cmdFlag = CommandFlag.CMD_KERNEL_TARGET_DISCONNECT;
    cmd.parameters = parts.slice(0, -1).join(' ');
    return '';
  }

  // Validate IP:port format
  const key = parts[0];
  if (key.includes(':')) {
    const [host, portStr] = key.split(':');
    const port = parseInt(portStr, 10);

    // Handle localhost
    if (host === 'localhost') {
      cmd.parameters = `127.0.0.1:${port}`;
      return '';
    }

    // Validate port range
    if (isNaN(port) || port < 1 || port > 65535) {
      cmd.bJumpDo = true;
      return 'IP:Port incorrect';
    }

    // Validate IP address
    if (!isValidIP(host)) {
      cmd.bJumpDo = true;
      return '[E001104]:IP address incorrect';
    }
  }

  cmd.cmdFlag = CommandFlag.CMD_KERNEL_TARGET_CONNECT;
  return '';
}

function isValidIP(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;

  for (const part of parts) {
    const num = parseInt(part, 10);
    if (isNaN(num) || num < 0 || num > 255) {
      return false;
    }
  }
  return true;
}

/**
 * Parse forward port command (fport)
 */
export function forwardPort(input: string, cmd: FormatCommand): string {
  const trimmed = input.trim();

  if (!trimmed) {
    cmd.bJumpDo = true;
    return 'Incorrect forward command';
  }

  // Remove "fport" prefix if present
  const withoutPrefix = trimmed.replace(/^fport\s+/i, '').trim();
  const parts = withoutPrefix.split(/\s+/);
  const subCmd = parts[0].toLowerCase();

  switch (subCmd) {
    case 'ls':
    case 'list':
      cmd.cmdFlag = CommandFlag.CMD_FORWARD_LIST;
      cmd.bJumpDo = false;
      return '';

    case 'rm':
    case 'remove':
      if (parts.length < 3) {
        cmd.bJumpDo = true;
        return 'Incorrect forward command';
      }
      cmd.cmdFlag = CommandFlag.CMD_FORWARD_REMOVE;
      cmd.parameters = parts.slice(1).join(' ');
      cmd.bJumpDo = false;
      return '';

    case 'tcp':
      // fport tcp:localPort tcp:remotePort
      if (parts.length < 3) {
        cmd.bJumpDo = true;
        return 'Incorrect forward command';
      }
      cmd.cmdFlag = CommandFlag.CMD_FORWARD_INIT;
      cmd.parameters = `fport ${withoutPrefix}`;
      cmd.bJumpDo = false;
      return '';

    default:
      // Check if it's a task specification (tcp:1234 tcp:5678)
      if (parts.length >= 2 && parts[0].includes(':') && parts[1].includes(':')) {
        cmd.cmdFlag = CommandFlag.CMD_FORWARD_INIT;
        cmd.parameters = `fport ${withoutPrefix}`;
        cmd.bJumpDo = false;
        return '';
      }
      cmd.bJumpDo = true;
      return 'Incorrect forward command';
  }
}

/**
 * Parse reverse port command (rport)
 * rport <remote> <local> - reverse forward: device initiates connection
 */
export function reversePort(input: string, cmd: FormatCommand): string {
  const trimmed = input.trim();

  if (!trimmed) {
    cmd.bJumpDo = true;
    return 'Incorrect reverse forward command';
  }

  // Remove "rport" prefix if present
  const withoutPrefix = trimmed.replace(/^rport\s+/i, '').trim();
  const parts = withoutPrefix.split(/\s+/);

  // rport requires exactly two node specs: <remote> <local>
  if (parts.length < 2) {
    cmd.bJumpDo = true;
    return 'Incorrect reverse forward command';
  }

  // Both parts must contain a colon (forward node spec format)
  if (!parts[0].includes(':') || !parts[1].includes(':')) {
    cmd.bJumpDo = true;
    return 'Incorrect reverse forward command';
  }

  cmd.cmdFlag = CommandFlag.CMD_FORWARD_INIT;
  cmd.parameters = `rport ${withoutPrefix}`;
  cmd.bJumpDo = false;
  return '';
}

/**
 * Parse run mode command (tmode)
 */
export function runMode(input: string, cmd: FormatCommand): string {
  const trimmed = input.trim();

  if (!trimmed) {
    cmd.bJumpDo = true;
    return 'Error tmode command';
  }

  // Remove "tmode" prefix if present
  const withoutPrefix = trimmed.replace(/^tmode\s+/i, '').trim();
  if (!withoutPrefix) {
    cmd.bJumpDo = true;
    return 'Error tmode command';
  }

  const parts = withoutPrefix.split(/\s+/);
  const mode = parts[0].toLowerCase();

  if (mode !== 'port' && mode !== 'usb') {
    cmd.bJumpDo = true;
    return 'Error tmode command';
  }

  if (mode === 'usb') {
    cmd.cmdFlag = CommandFlag.CMD_UNITY_RUNMODE;
    cmd.parameters = 'usb';
    cmd.bJumpDo = false;
    return '';
  }

  // port mode
  if (parts.length < 2) {
    // "tmode port" without a port number defaults to tcp mode
    cmd.cmdFlag = CommandFlag.CMD_UNITY_RUNMODE;
    cmd.parameters = 'tcp';
    cmd.bJumpDo = false;
    return '';
  }

  const portStr = parts[1];
  if (portStr.toLowerCase() === 'close') {
    cmd.cmdFlag = CommandFlag.CMD_UNITY_RUNMODE;
    cmd.parameters = 'tcp close';
    cmd.bJumpDo = false;
    return '';
  }

  const port = parseInt(portStr, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    cmd.bJumpDo = true;
    return 'Incorrect port range';
  }

  cmd.cmdFlag = CommandFlag.CMD_UNITY_RUNMODE;
  cmd.parameters = `tcp ${port}`;
  cmd.bJumpDo = false;
  return '';
}

/**
 * Parse target reboot command
 *
 * target boot            → parameters: "reboot"
 * target boot -bootloader → parameters: "reboot bootloader"
 * target boot -recovery   → parameters: "reboot recovery"
 * target boot MYMODE      → parameters: "reboot MYMODE"
 */
export function targetReboot(input: string, cmd: FormatCommand): void {
  const trimmed = input.trim();
  cmd.cmdFlag = CommandFlag.CMD_UNITY_REBOOT;

  if (!trimmed) {
    cmd.parameters = 'reboot';
    return;
  }

  const parts = trimmed.split(/\s+/);
  const first = parts[0];

  if (first === '-bootloader') {
    cmd.parameters = 'reboot bootloader';
  } else if (first === '-recovery') {
    cmd.parameters = 'reboot recovery';
  } else {
    cmd.parameters = `reboot ${first}`;
  }
}

/**
 * Parse file transfer command.
 *
 * Syntax:
 *   file send [-a] [-z] [-sync] [-m] <local> <remote>
 *   file recv [-a] [-z] <remote> <local>
 *
 * Options:
 *   -a      preserve timestamp (holdTimestamp)
 *   -z      enable compression
 *   -sync   only update if newer
 *   -m      directory transfer mode
 */
export function fileTransfer(cmd: FormatCommand): string {
  const parts = cmd.parameters.trim().split(/\s+/);
  if (parts.length === 0) {
    cmd.bJumpDo = true;
    return 'Incorrect file command';
  }

  const subCmd = parts[0].toLowerCase();

  if (subCmd !== 'send' && subCmd !== 'recv') {
    cmd.bJumpDo = true;
    return 'Incorrect file command';
  }

  // Parse flags and collect remaining positional args
  const flags: string[] = [];
  const positional: string[] = [];

  for (let i = 1; i < parts.length; i++) {
    if (parts[i].startsWith('-')) {
      flags.push(parts[i]);
    } else {
      positional.push(parts[i]);
    }
  }

  // Validate we have 2 positional args (local + remote or remote + local)
  if (positional.length < 2) {
    cmd.bJumpDo = true;
    return `Incorrect file ${subCmd} command: need <source> and <destination>`;
  }

  // Build parameters string with flags encoded
  const flagStr = flags.join(',');
  const src = positional[0];
  const dst = positional[1];

  if (subCmd === 'send') {
    cmd.cmdFlag = CommandFlag.CMD_FILE_SEND;
    cmd.parameters = `${flagStr}|${src}|${dst}`;
    cmd.bJumpDo = false;
  } else {
    cmd.cmdFlag = CommandFlag.CMD_FILE_RECV;
    cmd.parameters = `${flagStr}|${dst}|${src}`;
    cmd.bJumpDo = false;
  }

  return '';
}

/**
 * Extract file transfer flags from a parameters string produced by fileTransfer().
 * Returns an object with the parsed flags.
 */
export function parseFileTransferParams(params: string): {
  holdTimestamp: boolean;
  compress: boolean;
  updateIfNew: boolean;
  directoryMode: boolean;
  localPath: string;
  remotePath: string;
} {
  const [flagStr, ...paths] = params.split('|');
  const flags = flagStr ? flagStr.split(',') : [];

  return {
    holdTimestamp: flags.includes('-a'),
    compress: flags.includes('-z'),
    updateIfNew: flags.includes('-sync'),
    directoryMode: flags.includes('-m'),
    localPath: paths[0] || '',
    remotePath: paths[1] || '',
  };
}

/**
 * Parse install command.
 *
 * Syntax:
 *   install [-r] [-g] [-d] <path>
 *
 * Options:
 *   -r   reinstall (replace existing)
 *   -g   grant all runtime permissions
 *   -d   allow version downgrade
 */
export function installApp(cmd: FormatCommand): string {
  const parts = cmd.parameters.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    cmd.bJumpDo = true;
    return 'Incorrect install command: need <package path>';
  }

  const flags: string[] = [];
  const positional: string[] = [];

  for (const part of parts) {
    if (part === '-r') {
      flags.push('r');
    } else if (part === '-g') {
      flags.push('g');
    } else if (part === '-d') {
      flags.push('d');
    } else if (part.startsWith('-')) {
      cmd.bJumpDo = true;
      return `Unknown install flag: ${part}`;
    } else {
      positional.push(part);
    }
  }

  if (positional.length === 0) {
    cmd.bJumpDo = true;
    return 'Incorrect install command: need <package path>';
  }

  cmd.cmdFlag = CommandFlag.CMD_APP_INSTALL;
  cmd.parameters = `${flags.join('')}|${positional.join(',')}`;
  cmd.bJumpDo = false;
  return '';
}

/**
 * Parse uninstall command.
 *
 * Syntax:
 *   uninstall [-k] [-n <name>] [-m <module>] [-v <version>] [-u <user>] <package>
 *
 * Options:
 *   -k           keep data
 *   -n <name>    module name
 *   -m <module>  module name (alias for -n)
 *   -v <version> version
 *   -u <user>    user ID
 */
export function uninstallApp(cmd: FormatCommand): string {
  const parts = cmd.parameters.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    cmd.bJumpDo = true;
    return 'Incorrect uninstall command: need <package name>';
  }

  const flags: string[] = [];
  const extras: string[] = [];
  let packageName = '';

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    if (part === '-k') {
      flags.push('k');
    } else if (part === '-n' || part === '-m') {
      // Module name
      if (i + 1 >= parts.length) {
        cmd.bJumpDo = true;
        return `Missing value for ${part}`;
      }
      extras.push(`-n ${parts[++i]}`);
    } else if (part === '-v') {
      if (i + 1 >= parts.length) {
        cmd.bJumpDo = true;
        return 'Missing value for -v';
      }
      extras.push(`-v ${parts[++i]}`);
    } else if (part === '-u') {
      if (i + 1 >= parts.length) {
        cmd.bJumpDo = true;
        return 'Missing value for -u';
      }
      extras.push(`-u ${parts[++i]}`);
    } else if (part.startsWith('-')) {
      cmd.bJumpDo = true;
      return `Unknown uninstall flag: ${part}`;
    } else {
      packageName = part;
    }
  }

  if (!packageName) {
    cmd.bJumpDo = true;
    return 'Incorrect uninstall command: need <package name>';
  }

  cmd.cmdFlag = CommandFlag.CMD_APP_UNINSTALL;
  const flagStr = flags.join('');
  const extraStr = extras.length > 0 ? ` ${extras.join(' ')}` : '';
  cmd.parameters = `${flagStr}|${packageName}${extraStr}`;
  cmd.bJumpDo = false;
  return '';
}

/**
 * Parse sideload command.
 *
 * Syntax:
 *   sideload <path>
 */
export function sideloadApp(cmd: FormatCommand): string {
  const parts = cmd.parameters.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    cmd.bJumpDo = true;
    return 'Incorrect sideload command: need <package path>';
  }

  // Reject any flags - sideload takes only a path
  if (parts[0].startsWith('-')) {
    cmd.bJumpDo = true;
    return `Incorrect sideload command: unexpected flag ${parts[0]}`;
  }

  cmd.cmdFlag = CommandFlag.CMD_APP_SIDELOAD;
  cmd.parameters = parts[0];
  cmd.bJumpDo = false;
  return '';
}

/**
 * Parse update command.
 *
 * Syntax:
 *   update <package>
 */
export function updateFirmware(cmd: FormatCommand): string {
  const parts = cmd.parameters.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    cmd.bJumpDo = true;
    return 'Incorrect update command: need <package path>';
  }

  cmd.cmdFlag = CommandFlag.CMD_FLASHD_UPDATE_INIT;
  cmd.parameters = parts[0];
  cmd.bJumpDo = false;
  return '';
}

/**
 * Parse flash command.
 *
 * Syntax:
 *   flash [-f] <partition> <image>
 */
export function flashPartition(cmd: FormatCommand): string {
  const parts = cmd.parameters.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    cmd.bJumpDo = true;
    return 'Incorrect flash command: need <partition> <image>';
  }

  let force = false;
  const positional: string[] = [];

  for (const part of parts) {
    if (part === '-f') {
      force = true;
    } else if (part.startsWith('-')) {
      cmd.bJumpDo = true;
      return `Unknown flash flag: ${part}`;
    } else {
      positional.push(part);
    }
  }

  if (positional.length < 2) {
    cmd.bJumpDo = true;
    return 'Incorrect flash command: need <partition> <image>';
  }

  cmd.cmdFlag = CommandFlag.CMD_FLASHD_FLASH_INIT;
  cmd.parameters = `${force ? '-f|' : ''}${positional[0]}|${positional[1]}`;
  cmd.bJumpDo = false;
  return '';
}

/**
 * Parse erase command.
 *
 * Syntax:
 *   erase [-f] <partition>
 */
export function erasePartition(cmd: FormatCommand): string {
  const parts = cmd.parameters.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    cmd.bJumpDo = true;
    return 'Incorrect erase command: need <partition>';
  }

  let force = false;
  let partition = '';

  for (const part of parts) {
    if (part === '-f') {
      force = true;
    } else if (part.startsWith('-')) {
      cmd.bJumpDo = true;
      return `Unknown erase flag: ${part}`;
    } else {
      partition = part;
    }
  }

  if (!partition) {
    cmd.bJumpDo = true;
    return 'Incorrect erase command: need <partition>';
  }

  cmd.cmdFlag = CommandFlag.CMD_FLASHD_ERASE;
  cmd.parameters = `${force ? '-f|' : ''}${partition}`;
  cmd.bJumpDo = false;
  return '';
}

/**
 * Parse format command.
 *
 * Syntax:
 *   format [-f] <partition>
 */
export function formatPartition(cmd: FormatCommand): string {
  const parts = cmd.parameters.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    cmd.bJumpDo = true;
    return 'Incorrect format command: need <partition>';
  }

  let force = false;
  let partition = '';

  for (const part of parts) {
    if (part === '-f') {
      force = true;
    } else if (part.startsWith('-')) {
      cmd.bJumpDo = true;
      return `Unknown format flag: ${part}`;
    } else {
      partition = part;
    }
  }

  if (!partition) {
    cmd.bJumpDo = true;
    return 'Incorrect format command: need <partition>';
  }

  cmd.cmdFlag = CommandFlag.CMD_FLASHD_FORMAT;
  cmd.parameters = `${force ? '-f|' : ''}${partition}`;
  cmd.bJumpDo = false;
  return '';
}

/**
 * Main command parser
 */
export function string2FormatCommand(
  input: string,
  cmd: FormatCommand
): string {
  const trimmed = input.trim();
  const parts = trimmed.split(/\s+/);
  const mainCmd = parts[0].toLowerCase();

  // Reset command state
  cmd.cmdFlag = CommandFlag.CMD_KERNEL_HELP;
  cmd.parameters = parts.slice(1).join(' ');
  cmd.bJumpDo = false;

  switch (mainCmd) {
    case 'help':
    case '-h':
    case '--help':
      cmd.cmdFlag = CommandFlag.CMD_KERNEL_HELP;
      cmd.bJumpDo = true;
      return usage() + '\n';

    case 'version':
    case '-v':
    case '--version':
      cmd.bJumpDo = true;
      return 'hdc-node v0.0.1\n';

    case 'kill':
      cmd.cmdFlag = CommandFlag.CMD_SERVER_KILL;
      return '';

    case 'start':
      // start [-r]
      cmd.cmdFlag = CommandFlag.CMD_SERVICE_START;
      if (parts.length > 1) {
        cmd.parameters = ['start', ...parts.slice(1)].join(' ');
      } else {
        cmd.parameters = 'start';
      }
      return '';

    case 'checkserver':
      cmd.cmdFlag = CommandFlag.CMD_CHECK_SERVER;
      cmd.parameters = 'checkserver';
      return '';

    case 'checkdevice':
      // checkdevice <key>
      if (parts.length < 2) {
        cmd.bJumpDo = true;
        return 'Incorrect checkdevice command: need <key>\n';
      }
      cmd.cmdFlag = CommandFlag.CMD_CHECK_DEVICE;
      cmd.parameters = ['checkdevice', parts[1]].join(' ');
      return '';

    case 'wait':
      cmd.cmdFlag = CommandFlag.CMD_WAIT_FOR;
      cmd.parameters = 'wait';
      return '';

    case 'list':
      if (parts[1]?.toLowerCase() === 'targets') {
        cmd.cmdFlag = CommandFlag.CMD_KERNEL_TARGET_LIST;
        if (parts.length > 2) {
          cmd.parameters = ['list', 'targets', ...parts.slice(2)].join(' ');
        } else {
          cmd.parameters = 'list targets';
        }
        return '';
      }
      break;

    case 'tconn':
      return targetConnect(cmd);

    case 'tmode':
      return runMode(cmd.parameters, cmd);

    case 'target':
      if (parts[1]?.toLowerCase() === 'boot') {
        targetReboot(parts.slice(2).join(' '), cmd);
        return '';
      }
      if (parts[1]?.toLowerCase() === 'mount') {
        cmd.cmdFlag = CommandFlag.CMD_UNITY_REMOUNT;
        cmd.parameters = 'remount';
        return '';
      }
      break;

    case 'fport':
      return forwardPort(cmd.parameters, cmd);

    case 'rport':
      return reversePort(cmd.parameters, cmd);

    case 'smode':
      // smode [-r]
      cmd.cmdFlag = CommandFlag.CMD_UNITY_ROOTRUN;
      if (parts.length > 1 && parts[1] === '-r') {
        cmd.parameters = 'unroot';
      } else {
        cmd.parameters = 'root';
      }
      return '';

    case 'hilog':
      // hilog [options]
      cmd.cmdFlag = CommandFlag.CMD_UNITY_HILOG;
      if (parts.length > 1) {
        cmd.parameters = ['hilog', ...parts.slice(1)].join(' ');
      } else {
        cmd.parameters = 'hilog';
      }
      return '';

    case 'bugreport':
      // bugreport [FILE]
      cmd.cmdFlag = CommandFlag.CMD_UNITY_BUGREPORT_INIT;
      if (parts.length > 1) {
        cmd.parameters = ['bugreport', parts[1]].join(' ');
      } else {
        cmd.parameters = 'bugreport';
      }
      return '';

    case 'jpid':
      cmd.cmdFlag = CommandFlag.CMD_JDWP_LIST;
      cmd.parameters = 'jpid';
      return '';

    case 'track-jpid':
      // track-jpid [-a|-p]
      cmd.cmdFlag = CommandFlag.CMD_JDWP_TRACK;
      if (parts.length > 1) {
        cmd.parameters = ['track-jpid', ...parts.slice(1)].join(' ');
      } else {
        cmd.parameters = 'track-jpid';
      }
      return '';

    case 'discover':
      cmd.cmdFlag = CommandFlag.CMD_KERNEL_TARGET_DISCOVER;
      cmd.parameters = 'discover';
      return '';

    case 'any':
      cmd.cmdFlag = CommandFlag.CMD_KERNEL_TARGET_ANY;
      cmd.parameters = 'any';
      return '';

    case 'shell': {
      const shellParts = parts.slice(1);

      // Check if this is an extended shell command (has -b flag)
      if (shellParts.length > 0 && shellParts.includes('-b')) {
        const extOptions = parseExtendedShellArgs(shellParts);
        if (extOptions) {
          cmd.cmdFlag = CommandFlag.CMD_UNITY_EXECUTE_EX;
          cmd.parameters = encodeExtendedShellTlv(extOptions);
          return '';
        }
        // Failed to parse extended args
        cmd.bJumpDo = true;
        return 'Invalid extended shell command\n';
      }

      // Regular shell command
      if (shellParts.length === 0) {
        // Interactive shell - no command specified
        cmd.cmdFlag = CommandFlag.CMD_UNITY_EXECUTE;
        cmd.parameters = '';
      } else {
        cmd.cmdFlag = CommandFlag.CMD_UNITY_EXECUTE;
        cmd.parameters = shellParts.join(' ');
      }
      return '';
    }

    case 'file': {
      return fileTransfer(cmd);
    }

    case 'install': {
      return installApp(cmd);
    }

    case 'uninstall': {
      return uninstallApp(cmd);
    }

    case 'sideload': {
      return sideloadApp(cmd);
    }

    case 'update': {
      return updateFirmware(cmd);
    }

    case 'flash': {
      return flashPartition(cmd);
    }

    case 'erase': {
      return erasePartition(cmd);
    }

    case 'format': {
      return formatPartition(cmd);
    }

    default:
      break;
  }

  cmd.bJumpDo = true;
  return 'Unknown command...\n';
}

/**
 * Create a default FormatCommand
 */
export function createFormatCommand(): FormatCommand {
  return {
    cmdFlag: CommandFlag.CMD_KERNEL_HELP,
    parameters: '',
    bJumpDo: false,
  };
}
