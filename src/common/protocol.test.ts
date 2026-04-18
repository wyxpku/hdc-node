/**
 * Protocol Constants Tests
 */

import { describe, it, expect } from 'vitest';
import {
  HDC_VERSION_NUMBER,
  HDC_VERSION_STRING,
  DEFAULT_PORT,
  MAX_IP_PORT,
  MAX_SIZE_IOBUF,
  ConnType,
  ConnStatus,
  MessageLevel,
  CommandId,
  ErrorCode,
  HANDSHAKE_MESSAGE,
  PACKET_FLAG,
  isValidCommandId,
  getCommandName,
} from './protocol.js';

describe('Protocol Constants', () => {
  it('should have correct version', () => {
    expect(HDC_VERSION_NUMBER).toBe(0x30200300);
    expect(HDC_VERSION_STRING).toBe('3.2.0');
  });

  it('should have correct default port', () => {
    expect(DEFAULT_PORT).toBe(8710);
  });

  it('should have max port limit', () => {
    expect(MAX_IP_PORT).toBe(65535);
  });

  it('should have buffer size constants', () => {
    expect(MAX_SIZE_IOBUF).toBe(511 * 1024);
  });
});

describe('ConnType enum', () => {
  it('should have correct connection types', () => {
    expect(ConnType.USB).toBe(0);
    expect(ConnType.TCP).toBe(1);
    expect(ConnType.SERIAL).toBe(2);
    expect(ConnType.BT).toBe(3);
    expect(ConnType.UNKNOWN).toBe(4);
  });
});

describe('ConnStatus enum', () => {
  it('should have correct connection statuses', () => {
    expect(ConnStatus.UNKNOWN).toBe(0);
    expect(ConnStatus.READY).toBe(1);
    expect(ConnStatus.CONNECTED).toBe(2);
    expect(ConnStatus.OFFLINE).toBe(3);
    expect(ConnStatus.UNAUTHORIZED).toBe(4);
  });
});

describe('MessageLevel enum', () => {
  it('should have correct message levels', () => {
    expect(MessageLevel.FAIL).toBe(0);
    expect(MessageLevel.INFO).toBe(1);
    expect(MessageLevel.OK).toBe(2);
  });
});

describe('CommandId enum', () => {
  it('should have kernel commands', () => {
    expect(CommandId.CMD_KERNEL_HELP).toBe(0);
    expect(CommandId.CMD_KERNEL_HANDSHAKE).toBe(1);
    expect(CommandId.CMD_KERNEL_CHANNEL_CLOSE).toBe(2);
    expect(CommandId.CMD_KERNEL_TARGET_DISCOVER).toBe(4);
  });

  it('should have unity commands', () => {
    expect(CommandId.CMD_UNITY_EXECUTE).toBe(1001);
    expect(CommandId.CMD_UNITY_REBOOT).toBe(1003);
    expect(CommandId.CMD_UNITY_RUNMODE).toBe(1004);
  });

  it('should have forward commands', () => {
    expect(CommandId.CMD_FORWARD_INIT).toBe(2500);
    expect(CommandId.CMD_FORWARD_LIST).toBe(2507);
    expect(CommandId.CMD_FORWARD_REMOVE).toBe(2508);
  });

  it('should have file commands', () => {
    expect(CommandId.CMD_FILE_INIT).toBe(3000);
    expect(CommandId.CMD_FILE_BEGIN).toBe(3002);
    expect(CommandId.CMD_FILE_DATA).toBe(3003);
  });

  it('should have app commands', () => {
    expect(CommandId.CMD_APP_INIT).toBe(3500);
    expect(CommandId.CMD_APP_BEGIN).toBe(3502);
    expect(CommandId.CMD_APP_UNINSTALL).toBe(3505);
  });
});

describe('ErrorCode enum', () => {
  it('should have success code', () => {
    expect(ErrorCode.SUCCESS).toBe(0);
  });

  it('should have failure code', () => {
    expect(ErrorCode.FAIL).toBe(-1);
  });

  it('should have session errors', () => {
    expect(ErrorCode.SESSION_NOT_FOUND).toBe(-15000);
    expect(ErrorCode.SESSION_OFFLINE).toBe(-15001);
  });

  it('should have IO errors', () => {
    expect(ErrorCode.IO_FAIL).toBe(-14000);
    expect(ErrorCode.IO_TIMEOUT).toBe(-14001);
  });
});

describe('isValidCommandId function', () => {
  it('should return true for valid command IDs', () => {
    expect(isValidCommandId(CommandId.CMD_KERNEL_HELP)).toBe(true);
    expect(isValidCommandId(CommandId.CMD_SHELL_INIT)).toBe(true);
    expect(isValidCommandId(CommandId.CMD_FORWARD_LIST)).toBe(true);
  });

  it('should return false for invalid command IDs', () => {
    expect(isValidCommandId(-1)).toBe(false);
    expect(isValidCommandId(99999)).toBe(false);
  });
});

describe('getCommandName function', () => {
  it('should return correct name for known commands', () => {
    expect(getCommandName(CommandId.CMD_KERNEL_HELP)).toBe('CMD_KERNEL_HELP');
    expect(getCommandName(CommandId.CMD_SHELL_INIT)).toBe('CMD_SHELL_INIT');
  });

  it('should return Unknown for unknown commands', () => {
    expect(getCommandName(999)).toBe('Unknown');
  });
});

describe('Protocol Strings', () => {
  it('should have correct handshake message', () => {
    expect(HANDSHAKE_MESSAGE).toBe('OHOS HDC');
    expect(HANDSHAKE_MESSAGE.length).toBe(8);
  });

  it('should have correct packet flag', () => {
    expect(PACKET_FLAG).toBe('HW');
    expect(PACKET_FLAG.length).toBe(2);
  });
});
