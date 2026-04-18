/**
 * Command Translation Tests
 *
 * Translated from: test/unittest/host/host_translate_test.cpp
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  usage,
  verbose,
  targetConnect,
  forwardPort,
  reversePort,
  runMode,
  targetReboot,
  fileTransfer,
  parseFileTransferParams,
  installApp,
  uninstallApp,
  sideloadApp,
  string2FormatCommand,
  createFormatCommand,
  FormatCommand,
} from './translate.js';
import { CommandFlag } from '../index.js';

describe('TranslateCommand Usage', () => {
  it('should contain main help sections', () => {
    const text = usage();
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain('-l[0-5]');
    expect(text).toContain('checkserver');
    expect(text).toContain('tconn key [-remove]');
    expect(text).toContain('-s [ip:]port');
  });

  it('verbose help should contain flash commands', () => {
    const text = verbose();
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain('-l[0-5]');
    expect(text).toContain('checkserver');
    expect(text).toContain('tconn key [-remove]');
    expect(text).toContain('-s [ip:]port');
    expect(text).toContain('flash commands');
  });
});

describe('TranslateCommand TargetConnect', () => {
  let cmd: FormatCommand;

  beforeEach(() => {
    cmd = createFormatCommand();
  });

  it('should parse target connect', () => {
    cmd.parameters = '127.0.0.1:12345';
    const result = targetConnect(cmd);

    expect(cmd.bJumpDo).toBe(false);
    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_KERNEL_TARGET_CONNECT);
  });

  it('should parse target connect with remove', () => {
    cmd.parameters = '127.0.0.1:12345 -remove';
    const result = targetConnect(cmd);

    expect(cmd.bJumpDo).toBe(false);
    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_KERNEL_TARGET_DISCONNECT);
    expect(cmd.parameters).toBe('127.0.0.1:12345');
  });

  it('should reject long connect key', () => {
    const longCommand = 'a'.repeat(51);
    cmd.parameters = longCommand;
    const result = targetConnect(cmd);

    expect(cmd.bJumpDo).toBe(true);
    expect(result).toBe('Error connect key\'s size');
  });

  it('should reject invalid IP', () => {
    cmd.parameters = '127.0.0.256:12345';
    const result = targetConnect(cmd);

    expect(cmd.bJumpDo).toBe(true);
    expect(result).toBe('[E001104]:IP address incorrect');
  });

  it('should resolve localhost to 127.0.0.1', () => {
    cmd.parameters = 'localhost:12345';
    const result = targetConnect(cmd);

    expect(result).toBe('');
    expect(cmd.parameters).toBe('127.0.0.1:12345');
  });

  it('should reject port out of range', () => {
    cmd.parameters = '127.0.0.1:66666';
    const result = targetConnect(cmd);

    expect(cmd.bJumpDo).toBe(true);
    expect(result).toBe('IP:Port incorrect');
  });
});

describe('TranslateCommand ForwardPort', () => {
  let cmd: FormatCommand;

  beforeEach(() => {
    cmd = createFormatCommand();
  });

  it('should parse fport ls', () => {
    const result = forwardPort('fport ls', cmd);

    expect(cmd.bJumpDo).toBe(false);
    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_FORWARD_LIST);
  });

  it('should parse fport rm', () => {
    const result = forwardPort('fport rm tcp:12345 tcp:54321', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_FORWARD_REMOVE);
    expect(cmd.bJumpDo).toBe(false);
    expect(cmd.parameters).toBe('tcp:12345 tcp:54321');
  });

  it('should parse fport tcp', () => {
    const result = forwardPort('fport tcp:12345 tcp:54321', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_FORWARD_INIT);
    expect(cmd.bJumpDo).toBe(false);
    expect(cmd.parameters).toBe('fport tcp:12345 tcp:54321');
  });

  it('should reject invalid fport command', () => {
    const result = forwardPort('fport invalid', cmd);

    expect(cmd.bJumpDo).toBe(true);
    expect(result).toBe('Incorrect forward command');
  });

  it('should reject empty fport', () => {
    const result = forwardPort('', cmd);

    expect(cmd.bJumpDo).toBe(true);
    expect(result).toBe('Incorrect forward command');
  });
});

describe('TranslateCommand ReversePort', () => {
  let cmd: FormatCommand;

  beforeEach(() => {
    cmd = createFormatCommand();
  });

  it('should parse rport tcp:remote tcp:local', () => {
    const result = reversePort('rport tcp:9090 tcp:8080', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_FORWARD_INIT);
    expect(cmd.bJumpDo).toBe(false);
    expect(cmd.parameters).toBe('rport tcp:9090 tcp:8080');
  });

  it('should parse rport with abstract nodes', () => {
    const result = reversePort('rport localabstract:mysocket tcp:8080', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_FORWARD_INIT);
    expect(cmd.parameters).toBe('rport localabstract:mysocket tcp:8080');
  });

  it('should reject rport with no arguments', () => {
    const result = reversePort('rport', cmd);

    expect(cmd.bJumpDo).toBe(true);
    expect(result).toBe('Incorrect reverse forward command');
  });

  it('should reject rport with only one argument', () => {
    const result = reversePort('rport tcp:9090', cmd);

    expect(cmd.bJumpDo).toBe(true);
    expect(result).toBe('Incorrect reverse forward command');
  });

  it('should reject rport with non-spec arguments', () => {
    const result = reversePort('rport foo bar', cmd);

    expect(cmd.bJumpDo).toBe(true);
    expect(result).toBe('Incorrect reverse forward command');
  });

  it('should reject empty rport', () => {
    const result = reversePort('', cmd);

    expect(cmd.bJumpDo).toBe(true);
    expect(result).toBe('Incorrect reverse forward command');
  });
});

describe('TranslateCommand RunMode', () => {
  let cmd: FormatCommand;

  beforeEach(() => {
    cmd = createFormatCommand();
  });

  it('should parse tmode port with port number', () => {
    const result = runMode('tmode port 8710', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_UNITY_RUNMODE);
    expect(cmd.bJumpDo).toBe(false);
    expect(cmd.parameters).toBe('tcp 8710');
  });

  it('should parse tmode port close', () => {
    const result = runMode('tmode port close', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_UNITY_RUNMODE);
    expect(cmd.bJumpDo).toBe(false);
    expect(cmd.parameters).toBe('tcp close');
  });

  it('should parse tmode port without port number as tcp', () => {
    const result = runMode('tmode port', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_UNITY_RUNMODE);
    expect(cmd.bJumpDo).toBe(false);
    expect(cmd.parameters).toBe('tcp');
  });

  it('should reject invalid tmode', () => {
    const result = runMode('tmode invalid', cmd);

    expect(result).toBe('Error tmode command');
    expect(cmd.bJumpDo).toBe(true);
  });

  it('should reject port out of range (0)', () => {
    const result = runMode('tmode port 0', cmd);

    expect(result).toBe('Incorrect port range');
    expect(cmd.bJumpDo).toBe(true);
  });

  it('should accept minimum port (1)', () => {
    const result = runMode('tmode port 1', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_UNITY_RUNMODE);
    expect(cmd.bJumpDo).toBe(false);
    expect(cmd.parameters).toBe('tcp 1');
  });

  it('should accept maximum port (65535)', () => {
    const result = runMode('tmode port 65535', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_UNITY_RUNMODE);
    expect(cmd.bJumpDo).toBe(false);
    expect(cmd.parameters).toBe('tcp 65535');
  });
});

describe('TranslateCommand TargetReboot', () => {
  let cmd: FormatCommand;

  beforeEach(() => {
    cmd = createFormatCommand();
  });

  it('should parse target boot -bootloader', () => {
    targetReboot('-bootloader', cmd);

    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_UNITY_REBOOT);
    expect(cmd.parameters).toBe('reboot bootloader');
  });

  it('should parse target boot with no args as reboot', () => {
    targetReboot('', cmd);

    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_UNITY_REBOOT);
    expect(cmd.parameters).toBe('reboot');
  });

  it('should parse target boot -recovery', () => {
    targetReboot('-recovery', cmd);

    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_UNITY_REBOOT);
    expect(cmd.parameters).toBe('reboot recovery');
  });

  it('should parse target boot with custom mode', () => {
    targetReboot('MYMODE', cmd);

    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_UNITY_REBOOT);
    expect(cmd.parameters).toBe('reboot MYMODE');
  });
});

describe('TranslateCommand String2FormatCommand', () => {
  let cmd: FormatCommand;

  beforeEach(() => {
    cmd = createFormatCommand();
  });

  it('should parse help command', () => {
    const expectResult = usage() + '\n';
    const result = string2FormatCommand('help', cmd);

    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_KERNEL_HELP);
    expect(result).toBe(expectResult);
  });

  it('should parse kill command', () => {
    const result = string2FormatCommand('kill', cmd);

    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_SERVER_KILL);
    expect(result).toBe('');
  });

  it('should handle unknown command', () => {
    const result = string2FormatCommand('unknown', cmd);

    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_KERNEL_HELP);
    expect(result).toBe('Unknown command...\n');
  });

  it('should parse fport ls command', () => {
    const result = string2FormatCommand('fport ls', cmd);

    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_FORWARD_LIST);
  });

  it('should parse rport command via string2FormatCommand', () => {
    const result = string2FormatCommand('rport tcp:9090 tcp:8080', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_FORWARD_INIT);
    expect(cmd.bJumpDo).toBe(false);
    expect(cmd.parameters).toBe('rport tcp:9090 tcp:8080');
  });

  it('should parse fport add command via string2FormatCommand', () => {
    const result = string2FormatCommand('fport tcp:8080 tcp:9090', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_FORWARD_INIT);
    expect(cmd.bJumpDo).toBe(false);
    expect(cmd.parameters).toBe('fport tcp:8080 tcp:9090');
  });

  it('should parse fport rm command via string2FormatCommand', () => {
    const result = string2FormatCommand('fport rm tcp:8080 tcp:9090', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_FORWARD_REMOVE);
    expect(cmd.bJumpDo).toBe(false);
  });

  it('should parse track-jpid -p command', () => {
    const result = string2FormatCommand('track-jpid -p', cmd);

    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_JDWP_TRACK);
    expect(cmd.parameters).toBe('track-jpid -p');
  });

  // --- New system/unity command tests ---

  // 1. target mount → CMD_UNITY_REMOUNT
  it('should parse target mount command', () => {
    const result = string2FormatCommand('target mount', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_UNITY_REMOUNT);
    expect(cmd.parameters).toBe('remount');
  });

  // 2. target boot → CMD_UNITY_REBOOT
  it('should parse target boot command', () => {
    const result = string2FormatCommand('target boot', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_UNITY_REBOOT);
    expect(cmd.parameters).toBe('reboot');
  });

  it('should parse target boot -bootloader', () => {
    const result = string2FormatCommand('target boot -bootloader', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_UNITY_REBOOT);
    expect(cmd.parameters).toBe('reboot bootloader');
  });

  it('should parse target boot -recovery', () => {
    const result = string2FormatCommand('target boot -recovery', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_UNITY_REBOOT);
    expect(cmd.parameters).toBe('reboot recovery');
  });

  it('should parse target boot with custom mode', () => {
    const result = string2FormatCommand('target boot MYMODE', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_UNITY_REBOOT);
    expect(cmd.parameters).toBe('reboot MYMODE');
  });

  // 3. tmode usb → CMD_UNITY_RUNMODE
  it('should parse tmode usb command', () => {
    const result = string2FormatCommand('tmode usb', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_UNITY_RUNMODE);
    expect(cmd.parameters).toBe('usb');
  });

  // 4. tmode port variations
  it('should parse tmode port without port as tcp', () => {
    const result = string2FormatCommand('tmode port', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_UNITY_RUNMODE);
    expect(cmd.parameters).toBe('tcp');
  });

  it('should parse tmode port 5555 as tcp 5555', () => {
    const result = string2FormatCommand('tmode port 5555', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_UNITY_RUNMODE);
    expect(cmd.parameters).toBe('tcp 5555');
  });

  it('should parse tmode port close as tcp close', () => {
    const result = string2FormatCommand('tmode port close', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_UNITY_RUNMODE);
    expect(cmd.parameters).toBe('tcp close');
  });

  // 5. smode → CMD_UNITY_ROOTRUN
  it('should parse smode command', () => {
    const result = string2FormatCommand('smode', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_UNITY_ROOTRUN);
    expect(cmd.parameters).toBe('root');
  });

  it('should parse smode -r as unroot', () => {
    const result = string2FormatCommand('smode -r', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_UNITY_ROOTRUN);
    expect(cmd.parameters).toBe('unroot');
  });

  // 6. hilog → CMD_UNITY_HILOG
  it('should parse hilog command', () => {
    const result = string2FormatCommand('hilog', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_UNITY_HILOG);
    expect(cmd.parameters).toBe('hilog');
  });

  it('should parse hilog with options', () => {
    const result = string2FormatCommand('hilog -x', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_UNITY_HILOG);
    expect(cmd.parameters).toBe('hilog -x');
  });

  it('should parse hilog with -T TAG', () => {
    const result = string2FormatCommand('hilog -T TAG', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_UNITY_HILOG);
    expect(cmd.parameters).toBe('hilog -T TAG');
  });

  // 7. bugreport → CMD_UNITY_BUGREPORT_INIT
  it('should parse bugreport command', () => {
    const result = string2FormatCommand('bugreport', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_UNITY_BUGREPORT_INIT);
    expect(cmd.parameters).toBe('bugreport');
  });

  it('should parse bugreport with file path', () => {
    const result = string2FormatCommand('bugreport /tmp/report.zip', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_UNITY_BUGREPORT_INIT);
    expect(cmd.parameters).toBe('bugreport /tmp/report.zip');
  });

  // 8. jpid → CMD_JDWP_LIST
  it('should parse jpid command', () => {
    const result = string2FormatCommand('jpid', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_JDWP_LIST);
    expect(cmd.parameters).toBe('jpid');
  });

  // 9. track-jpid → CMD_JDWP_TRACK
  it('should parse track-jpid command', () => {
    const result = string2FormatCommand('track-jpid', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_JDWP_TRACK);
    expect(cmd.parameters).toBe('track-jpid');
  });

  it('should parse track-jpid -a', () => {
    const result = string2FormatCommand('track-jpid -a', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_JDWP_TRACK);
    expect(cmd.parameters).toBe('track-jpid -a');
  });

  // 10. discover → CMD_KERNEL_TARGET_DISCOVER
  it('should parse discover command', () => {
    const result = string2FormatCommand('discover', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_KERNEL_TARGET_DISCOVER);
    expect(cmd.parameters).toBe('discover');
  });

  // 11. checkserver → CMD_CHECK_SERVER
  it('should parse checkserver command', () => {
    const result = string2FormatCommand('checkserver', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_CHECK_SERVER);
    expect(cmd.parameters).toBe('checkserver');
  });

  // 12. checkdevice → CMD_CHECK_DEVICE
  it('should parse checkdevice command with key', () => {
    const result = string2FormatCommand('checkdevice SERIAL123', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_CHECK_DEVICE);
    expect(cmd.parameters).toBe('checkdevice SERIAL123');
  });

  it('should reject checkdevice without key', () => {
    const result = string2FormatCommand('checkdevice', cmd);

    expect(cmd.bJumpDo).toBe(true);
    expect(result).toContain('Incorrect checkdevice command');
  });

  // 13. wait → CMD_WAIT_FOR
  it('should parse wait command', () => {
    const result = string2FormatCommand('wait', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_WAIT_FOR);
    expect(cmd.parameters).toBe('wait');
  });

  // 14. any → CMD_KERNEL_TARGET_ANY
  it('should parse any command', () => {
    const result = string2FormatCommand('any', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_KERNEL_TARGET_ANY);
    expect(cmd.parameters).toBe('any');
  });

  // 15. tconn → CMD_KERNEL_TARGET_CONNECT / CMD_KERNEL_TARGET_DISCONNECT
  it('should parse tconn connect via string2FormatCommand', () => {
    const result = string2FormatCommand('tconn 192.168.1.100:5555', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_KERNEL_TARGET_CONNECT);
    expect(cmd.bJumpDo).toBe(false);
  });

  it('should parse tconn -remove via string2FormatCommand', () => {
    const result = string2FormatCommand('tconn 192.168.1.100:5555 -remove', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_KERNEL_TARGET_DISCONNECT);
    expect(cmd.bJumpDo).toBe(false);
  });

  // 16. list targets → CMD_KERNEL_TARGET_LIST
  it('should parse list targets command', () => {
    const result = string2FormatCommand('list targets', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_KERNEL_TARGET_LIST);
    expect(cmd.parameters).toBe('list targets');
  });

  it('should parse list targets -v', () => {
    const result = string2FormatCommand('list targets -v', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_KERNEL_TARGET_LIST);
    expect(cmd.parameters).toBe('list targets -v');
  });

  // 17. start → CMD_SERVICE_START
  it('should parse start command', () => {
    const result = string2FormatCommand('start', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_SERVICE_START);
    expect(cmd.parameters).toBe('start');
  });

  it('should parse start -r', () => {
    const result = string2FormatCommand('start -r', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_SERVICE_START);
    expect(cmd.parameters).toBe('start -r');
  });
});

describe('TranslateCommand FileTransfer', () => {
  let cmd: FormatCommand;

  beforeEach(() => {
    cmd = createFormatCommand();
  });

  it('should parse file send with local and remote', () => {
    cmd.parameters = 'send /local/file.txt /remote/file.txt';
    const result = fileTransfer(cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_FILE_SEND);
    expect(cmd.bJumpDo).toBe(false);
    expect(cmd.parameters).toContain('/local/file.txt');
    expect(cmd.parameters).toContain('/remote/file.txt');
  });

  it('should parse file send with -a flag', () => {
    cmd.parameters = 'send -a /local/file.txt /remote/file.txt';
    const result = fileTransfer(cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_FILE_SEND);
    expect(cmd.parameters).toContain('-a');
  });

  it('should parse file send with -z flag', () => {
    cmd.parameters = 'send -z /local/file.txt /remote/file.txt';
    const result = fileTransfer(cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_FILE_SEND);
    expect(cmd.parameters).toContain('-z');
  });

  it('should parse file send with -sync flag', () => {
    cmd.parameters = 'send -sync /local/file.txt /remote/file.txt';
    const result = fileTransfer(cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_FILE_SEND);
    expect(cmd.parameters).toContain('-sync');
  });

  it('should parse file send with -m flag', () => {
    cmd.parameters = 'send -m /local/dir /remote/dir';
    const result = fileTransfer(cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_FILE_SEND);
    expect(cmd.parameters).toContain('-m');
  });

  it('should parse file send with all flags', () => {
    cmd.parameters = 'send -a -z -sync -m /local/dir /remote/dir';
    const result = fileTransfer(cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_FILE_SEND);
    expect(cmd.parameters).toContain('-a');
    expect(cmd.parameters).toContain('-z');
    expect(cmd.parameters).toContain('-sync');
    expect(cmd.parameters).toContain('-m');
  });

  it('should parse file recv', () => {
    cmd.parameters = 'recv /remote/file.txt /local/file.txt';
    const result = fileTransfer(cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_FILE_RECV);
    expect(cmd.bJumpDo).toBe(false);
  });

  it('should parse file recv with -a and -z flags', () => {
    cmd.parameters = 'recv -a -z /remote/file.txt /local/file.txt';
    const result = fileTransfer(cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_FILE_RECV);
    expect(cmd.parameters).toContain('-a');
    expect(cmd.parameters).toContain('-z');
  });

  it('should reject file command without subcommand', () => {
    cmd.parameters = '';
    const result = fileTransfer(cmd);

    expect(cmd.bJumpDo).toBe(true);
  });

  it('should reject file command with invalid subcommand', () => {
    cmd.parameters = 'invalid /local /remote';
    const result = fileTransfer(cmd);

    expect(cmd.bJumpDo).toBe(true);
    expect(result).toBe('Incorrect file command');
  });

  it('should reject file send with missing destination', () => {
    cmd.parameters = 'send /local/file.txt';
    const result = fileTransfer(cmd);

    expect(cmd.bJumpDo).toBe(true);
    expect(result).toContain('Incorrect file send command');
  });

  it('should reject file recv with missing destination', () => {
    cmd.parameters = 'recv /remote/file.txt';
    const result = fileTransfer(cmd);

    expect(cmd.bJumpDo).toBe(true);
    expect(result).toContain('Incorrect file recv command');
  });
});

describe('TranslateCommand FileTransfer via string2FormatCommand', () => {
  let cmd: FormatCommand;

  beforeEach(() => {
    cmd = createFormatCommand();
  });

  it('should parse file send via string2FormatCommand', () => {
    const result = string2FormatCommand('file send /local/file.txt /remote/file.txt', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_FILE_SEND);
    expect(cmd.bJumpDo).toBe(false);
  });

  it('should parse file recv via string2FormatCommand', () => {
    const result = string2FormatCommand('file recv /remote/file.txt /local/file.txt', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_FILE_RECV);
    expect(cmd.bJumpDo).toBe(false);
  });

  it('should parse file send with flags via string2FormatCommand', () => {
    const result = string2FormatCommand('file send -a -z /local/file.txt /remote/file.txt', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_FILE_SEND);
    expect(cmd.parameters).toContain('-a');
    expect(cmd.parameters).toContain('-z');
  });
});

describe('TranslateCommand parseFileTransferParams', () => {
  it('should parse flags from parameters string', () => {
    const result = parseFileTransferParams('-a,-z|/local/file.txt|/remote/file.txt');

    expect(result.holdTimestamp).toBe(true);
    expect(result.compress).toBe(true);
    expect(result.updateIfNew).toBe(false);
    expect(result.directoryMode).toBe(false);
    expect(result.localPath).toBe('/local/file.txt');
    expect(result.remotePath).toBe('/remote/file.txt');
  });

  it('should parse all flags', () => {
    const result = parseFileTransferParams('-a,-z,-sync,-m|/local/dir|/remote/dir');

    expect(result.holdTimestamp).toBe(true);
    expect(result.compress).toBe(true);
    expect(result.updateIfNew).toBe(true);
    expect(result.directoryMode).toBe(true);
    expect(result.localPath).toBe('/local/dir');
    expect(result.remotePath).toBe('/remote/dir');
  });

  it('should handle no flags', () => {
    const result = parseFileTransferParams('|/local/file.txt|/remote/file.txt');

    expect(result.holdTimestamp).toBe(false);
    expect(result.compress).toBe(false);
    expect(result.updateIfNew).toBe(false);
    expect(result.directoryMode).toBe(false);
    expect(result.localPath).toBe('/local/file.txt');
    expect(result.remotePath).toBe('/remote/file.txt');
  });

  it('should handle -sync flag only', () => {
    const result = parseFileTransferParams('-sync|/local/file.txt|/remote/file.txt');

    expect(result.holdTimestamp).toBe(false);
    expect(result.compress).toBe(false);
    expect(result.updateIfNew).toBe(true);
  });
});

// ============================================================================
// Install command parsing tests
// ============================================================================

describe('TranslateCommand InstallApp', () => {
  let cmd: FormatCommand;

  beforeEach(() => {
    cmd = createFormatCommand();
  });

  it('should parse install with package path', () => {
    cmd.parameters = '/path/to/app.hap';
    const result = installApp(cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_APP_INSTALL);
    expect(cmd.bJumpDo).toBe(false);
    expect(cmd.parameters).toContain('/path/to/app.hap');
  });

  it('should parse install with -r flag', () => {
    cmd.parameters = '-r /path/to/app.hap';
    const result = installApp(cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_APP_INSTALL);
    expect(cmd.bJumpDo).toBe(false);
    expect(cmd.parameters).toContain('r');
  });

  it('should parse install with -g flag', () => {
    cmd.parameters = '-g /path/to/app.hap';
    const result = installApp(cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_APP_INSTALL);
    expect(cmd.bJumpDo).toBe(false);
    expect(cmd.parameters).toContain('g');
  });

  it('should parse install with -d flag', () => {
    cmd.parameters = '-d /path/to/app.hap';
    const result = installApp(cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_APP_INSTALL);
    expect(cmd.bJumpDo).toBe(false);
    expect(cmd.parameters).toContain('d');
  });

  it('should parse install with all flags', () => {
    cmd.parameters = '-r -g -d /path/to/app.hap';
    const result = installApp(cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_APP_INSTALL);
    expect(cmd.bJumpDo).toBe(false);
    expect(cmd.parameters).toContain('r');
    expect(cmd.parameters).toContain('g');
    expect(cmd.parameters).toContain('d');
    expect(cmd.parameters).toContain('/path/to/app.hap');
  });

  it('should reject install without path', () => {
    cmd.parameters = '';
    const result = installApp(cmd);

    expect(cmd.bJumpDo).toBe(true);
    expect(result).toContain('Incorrect install command');
  });

  it('should reject install with unknown flag', () => {
    cmd.parameters = '-x /path/to/app.hap';
    const result = installApp(cmd);

    expect(cmd.bJumpDo).toBe(true);
    expect(result).toContain('Unknown install flag');
  });

  it('should reject install with flags but no path', () => {
    cmd.parameters = '-r -g';
    const result = installApp(cmd);

    expect(cmd.bJumpDo).toBe(true);
    expect(result).toContain('Incorrect install command');
  });
});

describe('TranslateCommand InstallApp via string2FormatCommand', () => {
  let cmd: FormatCommand;

  beforeEach(() => {
    cmd = createFormatCommand();
  });

  it('should parse install command via string2FormatCommand', () => {
    const result = string2FormatCommand('install /path/to/app.hap', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_APP_INSTALL);
    expect(cmd.bJumpDo).toBe(false);
  });

  it('should parse install with flags via string2FormatCommand', () => {
    const result = string2FormatCommand('install -r -g /path/to/app.hap', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_APP_INSTALL);
    expect(cmd.bJumpDo).toBe(false);
  });
});

// ============================================================================
// Uninstall command parsing tests
// ============================================================================

describe('TranslateCommand UninstallApp', () => {
  let cmd: FormatCommand;

  beforeEach(() => {
    cmd = createFormatCommand();
  });

  it('should parse uninstall with package name', () => {
    cmd.parameters = 'com.example.app';
    const result = uninstallApp(cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_APP_UNINSTALL);
    expect(cmd.bJumpDo).toBe(false);
    expect(cmd.parameters).toContain('com.example.app');
  });

  it('should parse uninstall with -k flag', () => {
    cmd.parameters = '-k com.example.app';
    const result = uninstallApp(cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_APP_UNINSTALL);
    expect(cmd.bJumpDo).toBe(false);
    expect(cmd.parameters).toContain('k');
  });

  it('should parse uninstall with -n module name', () => {
    cmd.parameters = '-n entry com.example.app';
    const result = uninstallApp(cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_APP_UNINSTALL);
    expect(cmd.bJumpDo).toBe(false);
    expect(cmd.parameters).toContain('-n entry');
    expect(cmd.parameters).toContain('com.example.app');
  });

  it('should parse uninstall with -m module name (alias)', () => {
    cmd.parameters = '-m feature com.example.app';
    const result = uninstallApp(cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_APP_UNINSTALL);
    expect(cmd.bJumpDo).toBe(false);
    expect(cmd.parameters).toContain('-n feature');
  });

  it('should parse uninstall with -v version', () => {
    cmd.parameters = '-v 1.0.0 com.example.app';
    const result = uninstallApp(cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_APP_UNINSTALL);
    expect(cmd.bJumpDo).toBe(false);
    expect(cmd.parameters).toContain('-v 1.0.0');
  });

  it('should parse uninstall with -u userId', () => {
    cmd.parameters = '-u 100 com.example.app';
    const result = uninstallApp(cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_APP_UNINSTALL);
    expect(cmd.bJumpDo).toBe(false);
    expect(cmd.parameters).toContain('-u 100');
  });

  it('should parse uninstall with all options', () => {
    cmd.parameters = '-k -n entry -v 1.0.0 -u 100 com.example.app';
    const result = uninstallApp(cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_APP_UNINSTALL);
    expect(cmd.bJumpDo).toBe(false);
    expect(cmd.parameters).toContain('k');
    expect(cmd.parameters).toContain('-n entry');
    expect(cmd.parameters).toContain('-v 1.0.0');
    expect(cmd.parameters).toContain('-u 100');
    expect(cmd.parameters).toContain('com.example.app');
  });

  it('should reject uninstall without package name', () => {
    cmd.parameters = '';
    const result = uninstallApp(cmd);

    expect(cmd.bJumpDo).toBe(true);
    expect(result).toContain('Incorrect uninstall command');
  });

  it('should reject uninstall with unknown flag', () => {
    cmd.parameters = '-x com.example.app';
    const result = uninstallApp(cmd);

    expect(cmd.bJumpDo).toBe(true);
    expect(result).toContain('Unknown uninstall flag');
  });

  it('should reject uninstall -n without value', () => {
    cmd.parameters = '-n';
    const result = uninstallApp(cmd);

    expect(cmd.bJumpDo).toBe(true);
    expect(result).toContain('Missing value for -n');
  });

  it('should reject uninstall -v without value', () => {
    cmd.parameters = '-v';
    const result = uninstallApp(cmd);

    expect(cmd.bJumpDo).toBe(true);
    expect(result).toContain('Missing value for -v');
  });

  it('should reject uninstall -u without value', () => {
    cmd.parameters = '-u';
    const result = uninstallApp(cmd);

    expect(cmd.bJumpDo).toBe(true);
    expect(result).toContain('Missing value for -u');
  });

  it('should reject uninstall -m without value', () => {
    cmd.parameters = '-m';
    const result = uninstallApp(cmd);

    expect(cmd.bJumpDo).toBe(true);
    expect(result).toContain('Missing value for -m');
  });
});

describe('TranslateCommand UninstallApp via string2FormatCommand', () => {
  let cmd: FormatCommand;

  beforeEach(() => {
    cmd = createFormatCommand();
  });

  it('should parse uninstall command via string2FormatCommand', () => {
    const result = string2FormatCommand('uninstall com.example.app', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_APP_UNINSTALL);
    expect(cmd.bJumpDo).toBe(false);
  });

  it('should parse uninstall with flags via string2FormatCommand', () => {
    const result = string2FormatCommand('uninstall -k -n entry com.example.app', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_APP_UNINSTALL);
    expect(cmd.bJumpDo).toBe(false);
  });
});

// ============================================================================
// Sideload command parsing tests
// ============================================================================

describe('TranslateCommand SideloadApp', () => {
  let cmd: FormatCommand;

  beforeEach(() => {
    cmd = createFormatCommand();
  });

  it('should parse sideload with path', () => {
    cmd.parameters = '/path/to/ota.zip';
    const result = sideloadApp(cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_APP_SIDELOAD);
    expect(cmd.bJumpDo).toBe(false);
    expect(cmd.parameters).toBe('/path/to/ota.zip');
  });

  it('should reject sideload without path', () => {
    cmd.parameters = '';
    const result = sideloadApp(cmd);

    expect(cmd.bJumpDo).toBe(true);
    expect(result).toContain('Incorrect sideload command');
  });

  it('should reject sideload with flag instead of path', () => {
    cmd.parameters = '-x';
    const result = sideloadApp(cmd);

    expect(cmd.bJumpDo).toBe(true);
    expect(result).toContain('unexpected flag');
  });
});

describe('TranslateCommand SideloadApp via string2FormatCommand', () => {
  let cmd: FormatCommand;

  beforeEach(() => {
    cmd = createFormatCommand();
  });

  it('should parse sideload command via string2FormatCommand', () => {
    const result = string2FormatCommand('sideload /path/to/ota.zip', cmd);

    expect(result).toBe('');
    expect(cmd.cmdFlag).toBe(CommandFlag.CMD_APP_SIDELOAD);
    expect(cmd.bJumpDo).toBe(false);
    expect(cmd.parameters).toBe('/path/to/ota.zip');
  });
});
