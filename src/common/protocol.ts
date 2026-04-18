/**
 * HDC Protocol Constants
 *
 * Translated from: src/common/define.h, src/common/define_enum.h
 * Reference: OpenHarmony HDC C++ implementation
 */

// Protocol version
export const HDC_VERSION_NUMBER = 0x30200300; // 3.2.0d
export const HDC_VERSION_STRING = '3.2.0';

// Default ports
export const DEFAULT_PORT = 8710;
export const MAX_IP_PORT = 65535;

// Buffer sizes
export const BUF_SIZE_TINY = 64;
export const BUF_SIZE_SMALL = 256;
export const BUF_SIZE_MICRO = 16;
export const BUF_SIZE_MEDIUM = 512;
export const BUF_SIZE_DEFAULT = 1024;
export const MAX_SIZE_IOBUF = 511 * 1024; // 511KB

// Connection types
export enum ConnType {
  USB = 0,
  TCP = 1,
  SERIAL = 2,
  BT = 3,
  UNKNOWN = 4,
}

export const CONN_TYPE_NAMES = ['USB', 'TCP', 'UART', 'BT', 'UNKNOWN'] as const;

// Connection status
export enum ConnStatus {
  UNKNOWN = 0,
  READY = 1,
  CONNECTED = 2,
  OFFLINE = 3,
  UNAUTHORIZED = 4,
}

export const CONN_STATUS_NAMES = ['Unknown', 'Ready', 'Connected', 'Offline', 'Unauthorized'] as const;

// Message level
export enum MessageLevel {
  FAIL = 0,
  INFO = 1,
  OK = 2,
}

// Auth verify types
export enum AuthVerifyType {
  RSA_ENCRYPT = 0,
  RSA_3072_SHA512 = 1,
  PSK_TLS_AES_128_GCM_SHA256 = 2,
  UNKNOWN = 100,
}

// Command IDs - matching HdcCommand enum from define_enum.h
export enum CommandId {
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

  // App commands
  CMD_APP_INIT = 3500,
  CMD_APP_CHECK = 3501,
  CMD_APP_BEGIN = 3502,
  CMD_APP_DATA = 3503,
  CMD_APP_FINISH = 3504,
  CMD_APP_UNINSTALL = 3505,

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

  // Error codes
export enum ErrorCode {
  SUCCESS = 0,
  FAIL = -1,
  NO_SUPPORT = -2,
  PARAM_NULLPTR = -5,

  // IO errors (-14xxx range)
  IO_FAIL = -14000,
  IO_TIMEOUT = -14001,
  IO_SOFT_RESET = -14002,

  // Session errors (-15xxx range)
  SESSION_NOT_FOUND = -15000,
  SESSION_OFFLINE = -15001,
  SESSION_DEAD = -15002,

  // Handshake errors (-16xxx range)
  HANDSHAKE_MISMATCH = -16000,
  HANDSHAKE_CONNECTKEY_FAILED = -16001,
  HANDSHAKE_HANGUP_CHILD = -16002,

  // Socket errors (-17xxx range)
  SOCKET_FAIL = -17000,
  SOCKET_DUPLICATE = -17001,
}

// Protocol constants
export const HANDSHAKE_MESSAGE = 'OHOS HDC';
export const HANDSHAKE_FAILED = 'HS FAILED';
export const PACKET_FLAG = 'HW';

// Timeouts (milliseconds)
export const UV_DEFAULT_INTERVAL = 250;
export const DEVICE_CHECK_INTERVAL = 3000;
export const HEARTBEAT_INTERVAL = 5000;
export const SSL_HANDSHAKE_TIMEOUT = 300;

// Connect key constraints
export const MAX_CONNECTKEY_SIZE = 32;

// Session ID range
export const MIN_SESSION_ID = 1;
export const MAX_SESSION_ID = 0xFFFFFFFF;

// Packet header size
export const PACKET_HEADER_SIZE = 8; // flag(2) + version(2) + dataSize(4)

// Maximum payload size per packet
export const PKG_PAYLOAD_MAX_SIZE = MAX_SIZE_IOBUF;

/**
 * Check if a command ID is valid
 */
export function isValidCommandId(cmdId: number): boolean {
  return cmdId >= 0 && cmdId < 10000;
}

 /**
 * Get command name by ID
 */
export function getCommandName(cmdId: number): string {
  const entry = Object.entries(CommandId).find(([_, v]) => v === cmdId);
  return entry ? entry[0] : `Unknown`;
}

