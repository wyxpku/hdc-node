# hdc-node

Node.js implementation of [OpenHarmony HDC](https://gitcode.com/openharmony/developtools_hdc.git) (Host Device Connector) — the debugging and file transfer tool for HarmonyOS / OpenHarmony devices.

## Install

```bash
npm install -g hdc-node
```

After installation, the `hdc` command is available:

```bash
hdc list targets
```

**Requirements:** Node.js >= 18. For USB device discovery, the official [HDC SDK](https://developer.huawei.com/consumer/en/download/) should also be installed (hdc-node auto-detects and uses it).

## CLI Usage

```bash
# List connected devices
hdc list targets

# Interactive shell on device
hdc shell

# Run a one-shot command
hdc shell ls -la /data/local/tmp

# File transfer
hdc file send ./local.txt /data/local/tmp/
hdc file recv /data/local/tmp/remote.txt        # defaults to current dir
hdc file recv /data/local/tmp/remote.txt ./

# Port forwarding
hdc fport tcp:8080 tcp:8080
hdc fport ls
hdc fport rm tcp:8080 tcp:8080

# Install / uninstall apps
hdc install /path/to/app.hap
hdc uninstall com.example.app

# View device logs
hdc hilog

# Server management
hdc start          # start server
hdc kill           # kill server
hdc kill -r        # kill and restart
```

## Programmatic API

```typescript
import { HdcClient } from 'hdc-node';

const client = new HdcClient({ host: '127.0.0.1', port: 8710 });
await client.connect();

const result = await client.executeCommand('shell ls /data/local/tmp');
console.log(result);

await client.disconnect();
```

## Supported Commands

| Command | Description |
|---------|-------------|
| `shell [cmd]` | Interactive or one-shot shell |
| `list targets` | List connected devices |
| `file send/recv` | File transfer |
| `install/uninstall` | App management |
| `fport/rport` | Port forwarding |
| `hilog` | Device log viewer |
| `tconn` | TCP device connection |
| `tmode` | Switch USB/TCP mode |
| `smode` | Toggle root mode |
| `target boot` | Reboot device |
| `keygen` | Generate RSA keypair |
| `start/kill` | Server lifecycle |

## How It Works

hdc-node follows the same client-server architecture as the official HDC tool:

```
[hdc CLI] --TCP channel--> [HDC Server] --USB/TCP session--> [Device Daemon]
```

- **Client** (`hdc` command) connects to the server via TCP on port 8710
- **Server** discovers USB devices and maintains sessions with device daemons
- When the official `hdc` binary is in PATH, hdc-node auto-starts the official server for USB device discovery

## Related

- **Original C++ implementation**: <https://gitcode.com/openharmony/developtools_hdc.git>
- **This project**: <https://github.com/wyxpku/hdc>

## License

Apache-2.0

---

## 中文说明

[OpenHarmony HDC](https://gitcode.com/openharmony/developtools_hdc.git) (Harmony Device Connector) 的 Node.js 实现 —— HarmonyOS / OpenHarmony 设备的调试与文件传输工具。

### 安装

```bash
npm install -g hdc-node
```

安装后即可使用 `hdc` 命令：

```bash
hdc list targets
```

**前置条件：** Node.js >= 18。USB 设备发现需要同时安装官方 [HDC SDK](https://developer.huawei.com/consumer/cn/download/)（hdc-node 会自动检测并使用）。

### 常用命令

```bash
hdc list targets              # 列出已连接设备
hdc shell                     # 交互式 Shell
hdc shell ls /data/local/tmp  # 执行单条命令
hdc file send ./app.hap /data/local/tmp/  # 推送文件
hdc file recv /data/log.txt               # 拉取文件到当前目录
hdc file recv /data/log.txt ./            # 指定本地路径
hdc install /path/to/app.hap  # 安装应用
hdc hilog                     # 查看设备日志
hdc start                     # 启动服务端
hdc kill                      # 停止服务端
```

### 编程接口

```typescript
import { HdcClient } from 'hdc-node';

const client = new HdcClient({ host: '127.0.0.1', port: 8710 });
await client.connect();

const result = await client.executeCommand('shell ls /data/local/tmp');
console.log(result);

await client.disconnect();
```

### 许可证

Apache-2.0
