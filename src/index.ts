/**
 * HDC (OpenHarmony Device Connector) - Node.js Implementation
 *
 * This module provides a Node.js implementation of the HDC protocol
 * for connecting and debugging OpenHarmony devices.
 */

export const VERSION = '0.0.1';
export const HDC_PORT = 8710;
export const HDC_UDS_PATH = '/tmp/hdc';

export interface HdcDevice {
  connectKey: string;
  connType: ConnType;
}

export enum ConnType {
  USB = 0,
  TCP = 1,
  SERIAL = 2,
  BT = 3,
  UNKNOWN = 4,
}

// CommandFlag merges all official CommandId values from protocol.ts
// with additional high-level aliases used by the translate module.
// Official command IDs match the HdcCommand enum in define_enum.h.
export enum CommandFlag {
  // Kernel commands
  CMD_KERNEL_HELP = 0,
  CMD_KERNEL_HANDSHAKE = 1,
  CMD_KERNEL_CHANNEL_CLOSE = 2,
  CMD_KERNEL_TARGET_DISCOVER = 4,
  CMD_KERNEL_TARGET_LIST = 5,
  CMD_KERNEL_TARGET_ANY = 6,
  CMD_KERNEL_TARGET_CONNECT = 7,
  CMD_KERNEL_TARGET_DISCONNECT = 8,
  CMD_KERNEL_ECHO = 9,
  CMD_KERNEL_ECHO_RAW = 10,
  CMD_KERNEL_ENABLE_KEEPALIVE = 11,
  CMD_KERNEL_WAKEUP_SLAVETASK = 12,
  CMD_CHECK_SERVER = 13,
  CMD_CHECK_DEVICE = 14,
  CMD_WAIT_FOR = 15,
  CMD_SERVER_KILL = 16,
  CMD_SERVICE_START = 17,
  CMD_SSL_HANDSHAKE = 20,

  // Unity commands
  CMD_UNITY_COMMAND_HEAD = 1000,
  CMD_UNITY_EXECUTE = 1001,
  CMD_UNITY_REMOUNT = 1002,
  CMD_UNITY_REBOOT = 1003,
  CMD_UNITY_RUNMODE = 1004,
  CMD_UNITY_HILOG = 1005,
  CMD_UNITY_ROOTRUN = 1007,
  CMD_JDWP_LIST = 1008,
  CMD_JDWP_TRACK = 1009,
  CMD_UNITY_COMMAND_TAIL = 1010,
  CMD_UNITY_BUGREPORT_INIT = 1011,
  CMD_UNITY_BUGREPORT_DATA = 1012,
  CMD_UNITY_EXECUTE_EX = 1200,

  // Shell commands
  CMD_SHELL_INIT = 2000,
  CMD_SHELL_DATA = 2001,

  // Forward commands
  CMD_FORWARD_INIT = 2500,
  CMD_FORWARD_CHECK = 2501,
  CMD_FORWARD_CHECK_RESULT = 2502,
  CMD_FORWARD_ACTIVE_SLAVE = 2503,
  CMD_FORWARD_ACTIVE_MASTER = 2504,
  CMD_FORWARD_DATA = 2505,
  CMD_FORWARD_FREE_CONTEXT = 2506,
  CMD_FORWARD_LIST = 2507,
  CMD_FORWARD_REMOVE = 2508,
  CMD_FORWARD_SUCCESS = 2509,

  // File commands
  CMD_FILE_INIT = 3000,
  CMD_FILE_CHECK = 3001,
  CMD_FILE_BEGIN = 3002,
  CMD_FILE_DATA = 3003,
  CMD_FILE_FINISH = 3004,
  CMD_APP_SIDELOAD = 3005,
  CMD_FILE_MODE = 3006,
  CMD_DIR_MODE = 3007,

  // High-level aliases used by translate module
  CMD_FILE_SEND = 3000,
  CMD_FILE_RECV = 3001,

  // App commands
  CMD_APP_INIT = 3500,
  CMD_APP_CHECK = 3501,
  CMD_APP_BEGIN = 3502,
  CMD_APP_DATA = 3503,
  CMD_APP_FINISH = 3504,
  CMD_APP_UNINSTALL = 3505,

  // High-level aliases used by translate module
  CMD_APP_INSTALL = 3500,
  CMD_APP_MULTIPLE_INSTALL = 3500,

  // Flash commands
  CMD_FLASHD_UPDATE_INIT = 4000,
  CMD_FLASHD_FLASH_INIT = 4001,
  CMD_FLASHD_CHECK = 4002,
  CMD_FLASHD_BEGIN = 4003,
  CMD_FLASHD_DATA = 4004,
  CMD_FLASHD_FINISH = 4005,
  CMD_FLASHD_ERASE = 4006,
  CMD_FLASHD_FORMAT = 4007,
  CMD_FLASHD_PROGRESS = 4008,

  // Heartbeat
  CMD_HEARTBEAT_MSG = 5000,
}
