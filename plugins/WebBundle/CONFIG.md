# WebBundle 配置

本文随 `plugins/WebBundle` 发布。

修改配置后需要重启 BDS 或独立网页端。

---

## 1. 内置端配置

文件：

```text
plugins/WebBundle/data/config.json
```

首次启动自动生成，`web.token` 会自动生成。

示例：

```json
{
  "serverId": "srv-a1b2c3d4",
  "serverName": "BDS",
  "purgePlayers": ["ProbeBot"],
  "web": {
    "enabled": true,
    "host": "0.0.0.0",
    "port": 19380,
    "token": "<自动生成的管理员 Token>",
    "role": "admin"
  },
  "storage": {
    "driver": "kv",
    "dbPath": "plugins/WebBundle/data/db",
    "indexLimit": 3000
  },
  "external": {
    "enabled": true,
    "url": "http://127.0.0.1:8080",
    "token": "<推送 Token>",
    "pollSec": 2,
    "publicUrl": ""
  },
  "nbt": {
    "inlineMaxKB": 256,
    "itemMaxKB": 4096
  },
  "command": {
    "deny": ["stop", "op", "deop", "ban", "ban-ip", "whitelist", "ll", "script", "plugins"]
  }
}
```

### web

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `enabled` | boolean | 是否启动内置网页 |
| `host` | string | 监听地址，对外访问用 `0.0.0.0` |
| `port` | number | 内置网页端口，默认 `19380` |
| `token` | string | 管理员 API Token，首次创建管理员必须输入 |
| `role` | string | 默认角色：`admin` / `operator` / `viewer` |

首次创建管理员：

- 打开 `http://服务器IP:19380/`
- 输入 `config.json` 中的 `web.token`
- 本机访问也不能跳过

### storage

| 字段 | 说明 |
| --- | --- |
| `driver` | `kv`（LevelDB）或 `memory` |
| `dbPath` | 数据库路径 |
| `indexLimit` | 每个玩家的快照索引上限 |

### external

| 字段 | 说明 |
| --- | --- |
| `enabled` | 是否推送到独立网页端 |
| `url` | 独立端内部地址，同机用 `http://127.0.0.1:8080` |
| `token` | 推送 Token，必须与独立端 `pushToken` 一致 |
| `pollSec` | 心跳/拉取动作间隔秒数 |
| `publicUrl` | 浏览器访问独立端的地址，可留空自动推导 |

日志出现 `推送失败 status=-1` 表示 BDS 无法连接 `external.url`，通常是独立端没启动、端口不对或防火墙拦截；不是 Token 错误。

### nbt

| 字段 | 说明 |
| --- | --- |
| `inlineMaxKB` | 小于该大小的 NBT 直接内联 |
| `itemMaxKB` | 单物品 NBT 上限，超过后省略详情 |

### command

`command.deny` 是网页指令拒绝列表，默认包含：

```text
stop op deop ban ban-ip whitelist ll script plugins
```

---

## 2. 独立网页端配置

文件：

```text
plugins/WebBundle/standalone/config.json
```

首次启动自动生成，`pushToken` 会自动生成。

示例：

```json
{
  "listen": "0.0.0.0:8080",
  "pushToken": "<推送 Token>",
  "dataPath": "./data/store.json",
  "staleMs": 15000,
  "bdsUrl": "http://127.0.0.1:19380"
}
```

| 字段 | 说明 |
| --- | --- |
| `listen` | 独立端监听地址，默认 `0.0.0.0:8080` |
| `pushToken` | 接收 BDS 推送的 Token，必须与内置端 `external.token` 一致 |
| `dataPath` | 独立端 JSON 数据文件；相对路径以 standalone 目录为基准 |
| `staleMs` | 超过该毫秒数未收到心跳则判定 BDS 离线 |
| `bdsUrl` | 内置端内部地址 |

独立端首次创建管理员：

1. 确认 BDS 在线。
2. 打开 `http://服务器IP:8080/setup`。
3. 输入 BDS `plugins/WebBundle/data/config.json` 中的 `web.token`。
4. 创建独立的独立端管理员账号。

独立端只接受 BDS 的 `web.token`，不接受 `external.token` 或 `pushToken`。

---

## 3. 端口

| 服务 | 默认端口 |
| --- | --- |
| 内置网页 | `19380` |
| 独立网页 | `8080` |

---

## 4. 运行时路径

```text
插件配置：plugins/WebBundle/data/config.json
插件数据库：plugins/WebBundle/data/db/
网页静态文件：plugins/WebBundle/web/
静态 JSON：plugins/WebBundle/src/json/

独立端配置：plugins/WebBundle/standalone/config.json
独立端数据：plugins/WebBundle/standalone/data/store.json
```

---

## 5. 修改后的操作

- 修改内置端配置：重启 BDS
- 修改独立端配置：重启独立端进程
- 修改 `web.token`：已登录会话仍有效，下一次首次设置/API 使用新值
- 修改端口：同时调整防火墙、反向代理和前端访问地址
