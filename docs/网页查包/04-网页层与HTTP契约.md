# WebBundle 网页层与 HTTP 契约

> 状态：v1.3（两种网页形态；离线查看属于单独挂载网页端）
> 上游文档：[00 v1 范围](00-v1范围与运行时探针.md) / [01 总体架构](01-总体架构与设计决策.md) / [02 插件层](02-插件层与链入API.md) / [03 数据模型与存储](03-数据模型与v1存储.md) / [07 单独挂载网页端](07-单独挂载网页端与离线修改.md)
> 本文定义 v1 两种网页形态的页面、静态资源、鉴权、只读 API、动作契约、完整 NBT、冷查看与轮询。
> **形态 A：插件内置网页（BDS 运行时）。形态 B：单独挂载 `webbundle-web`（可选；没有它就没有离线查看）。**

---

## 1. 三条硬规则

1. **网页层只读。** 页面与只读 API 不提供“直接改背包/容器/数据库”的入口；所有写操作都是动作意图，由 qjs 插件在世界线程执行。
2. **网页层不碰 BDS。** 形态 A 的处理器只读备份/本地存储；形态 B 只读自己的库。任何 `mc.*`、`Player`、`Block` 调用都禁止出现在网页代码里。
3. **两种形态职责不重叠。** 形态 A 只在 BDS 运行时可用；形态 B 是单独挂载的独立组件，负责 BDS 停止后的冷查看。**没部署形态 B 就没有冷查看，没有兜底。**

---

## 2. 两种部署形态

### 2.1 形态 A：插件内置网页（embedded）

```
浏览器 ──HTTP──▶ 插件内 LSE HttpServer :19380
                   ├─ /                index.html
                   ├─ /assets/*        静态资源
                   ├─ /api/v1/*        只读 API + 动作
                   ├─ /api/v1/nbt/*    大 NBT
                   └─ /boot.js         运行时配置
```

- 只在 BDS 运行时可用；BDS 停止即不可用。
- 静态资源插件启动时载入；查询走热缓存/本地存储。
- 实时更新为 1 秒轮询；没有 WebSocket 服务端。

### 2.2 形态 B：单独挂载网页端（external）

```
浏览器 ──HTTPS──▶ webbundle-web（独立进程/独立库，可选部署）
                   ├─ /                index.html
                   ├─ /assets/*        同一份 dist/
                   ├─ /api/v1/*        只读 API + 动作
                   ├─ /api/v1/nbt/*    大 NBT
                   ├─ /boot.js
                   └─ /push/v1/*       插件推送（不暴露给浏览器）

BDS qjs 插件 ──HTTP──▶ webbundle-web
```

- 独立进程/独立部署；BDS 停止后仍可看最后数据。
- 未部署/未运行：BDS 停止后没有网页可用；这是预期边界。
- 可选部署在本机或另一台机器；v1 单服，多服是 v2。
- 实时更新 1 秒轮询；WebSocket/SSE 是 v2。

### 2.3 形态对照

| 能力 | 形态 A | 形态 B |
|---|---|---|
| 额外进程 | 无 | `webbundle-web` |
| BDS 运行时网页 | 有 | 有（独立） |
| BDS 停止后网页 | **无** | 有（冷查看） |
| 离线修改队列 | 无 | 有 |
| 多服聚合 | 无 | v2 |

---

## 3. 静态资源与启动引导

### 3.1 构建产物

```
dist/
├── index.html
├── boot.js                 由服务端动态生成（不落盘）
├── manifest.json           资源哈希表
├── assets/
│   ├── app.<hash>.js
│   ├── app.<hash>.js.gz
│   ├── base.<hash>.css
│   └── ...
├── modules/
│   └── logistics/
│       ├── index.html
│       └── page.<hash>.js
└── lang/
    ├── zh-CN.<hash>.json
    └── en-US.<hash>.json
```

- `index.html` 只引用带内容哈希的资源；哈希资源使用 `Cache-Control: public, max-age=31536000, immutable`。
- `index.html` 使用 `Cache-Control: no-cache`，每次校验。
- 文本资源（`.js/.css/.json/.html/.svg`）构建时生成 `.gz`；请求带 `Accept-Encoding: gzip` 时直接返回预压缩字节，并设 `Content-Encoding: gzip` 与 `Vary: Accept-Encoding`。
- 图片/字体保留原格式；不强制二次压缩。

### 3.2 启动引导

不使用内联脚本（避免 CSP nonce 复杂度）。服务端动态返回 `/boot.js`：

```js
// 由服务端拼装，不读磁盘
window.__WEBBUNDLE_BOOT__ = {
    mode: "embedded",
    serverId: "srv-1",
    serverName: "生存一区",
    serverOnline: true,
    dataAsOf: 1730000000000,
    apiBase: "/api/v1",
    live: { transport: "poll", intervalMs: 1000 },
    capabilities: ["inventory.live", "snapshot", "nbt", "nbt.edit", "offline.edit", "flow", "command", "actions"],
    timezoneOffset: 8,
    version: "0.2.0"
};
```

`index.html` 中：

```html
<script src="/boot.js"></script>
<script type="module" src="/assets/app.<hash>.js"></script>
```

`/boot.js` 使用 `Cache-Control: no-store`；其中不含令牌。

### 3.3 路由与静态资源

- 形态 A：qjs `HttpServer`，启动时载入 `dist`，精确路由表。
- 形态 B：`webbundle-web` 的 HTTP 服务，规则相同；静态资源可由它或反向代理提供。

```text
GET  /                      index.html
GET  /assets/*              带哈希静态资源（immutable）
GET  /api/v1/*              只读 API / 动作
GET  /api/v1/nbt/:ref       大 NBT
GET  /m/<module>/*          模块页面静态资源（如有）
GET  /boot.js               运行时配置
POST /api/v1/actions/*      动作
```

规则：

- 静态资源查内存/磁盘映射表，拒绝 `..`、`\`、空字节。
- `GET /api/v1/*` 未命中返回 JSON 404，不回退 `index.html`。
- `GET /assets/*` 未命中返回 404；只有未知页面路径才回退 `index.html`。
- `OPTIONS` 只返回 CORS 头。
- 处理器不做 CPU 密集计算；大列表分页，图片/字体返回预载/缓存字节。
- 形态 B 中 BDS 停止时，`/api/v1/meta` 返回 `server.online=false`、`mode=cold`、`dataAsOf`；页面仍可用。形态 A 无此状态。

### 3.4 响应头

| 头 | 值 |
|---|---|
| `Content-Type` | 按资源；JSON 为 `application/json; charset=utf-8` |
| `Content-Length` | 显式设置，避免分块歧义 |
| `Cache-Control` | 静态哈希资源 immutable；`index.html` no-cache；API no-store |
| `ETag` | 备份类接口用 `"seq-<n>"`；静态用内容哈希 |
| `Vary` | `Accept-Encoding`（静态）、`Authorization`（API 若被代理缓存） |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `no-referrer` |
| `X-Frame-Options` | `DENY` |
| `Content-Security-Policy` | 见第 12 节 |
| `X-WebBundle-Mode` | `embedded` / `external` / `cold`（形态 B 且 BDS 停止） |
| `X-WebBundle-Trace` | 请求 traceId |

---

## 4. 页面地图

| 路径 | 页面 | 主要 API | 权限 |
|---|---|---|---|
| `#/` | 总览 | `/meta`、`/players?online=1`、`/flow/summary` | viewer |
| `#/players` | 玩家列表 | `/players` | viewer |
| `#/players/:xuid` | 玩家详情 | `/players/:xuid`、`/inventory`、`/snapshots` | viewer |
| `#/players/:xuid/inventory` | 背包实时/冷查看 + 物品 NBT 抽屉 | `/inventory`、`/items/:container/:slot`、`/nbt/:ref`、`/stream` | viewer |
| `#/players/:xuid/snapshots` | 备份历史/还原 | `/snapshots`、`/snapshots/:id`、`/actions/inventory.restore` | viewer（还原需 admin） |
| `#/flow` | 物品去向总览 | `/flow`、`/flow/summary` | flow.read |
| `#/flow/:itemKey` | 物品流向 | `/flow?item=`、`/flow/items/:itemKey` | flow.read |
| `#/tasks` | 动作/离线队列 | `/tasks`、`/tasks/:id` | 本人/admin |
| `#/commands` | 网页指令 | `/commands`、`/tasks/:id` | command.execute |
| `#/modules` | 模块状态 | `/modules`、`/modules/:id/health` | admin |
| `#/audit` | 审计 | `/audit`、`/audit/verify` | admin |
| `#/settings` | 设置 | 只读展示；修改走动作 | admin |

导航由 `/api/v1/meta` 返回的 `nav` 与模块 `pages` 合并生成；模块页的 `path` 以 `#/m/<moduleId>/...` 开头。

页面原则：

- 首屏只请求总览需要的数据；其他页面按需加载。
- 长列表使用游标分页 + 虚拟滚动；不做一次性全量渲染。
- 所有物品名、lore、自定义名按纯文本渲染，不拼 HTML。
- 危险动作使用二次确认；确认词由动作描述给出。

---

## 5. 鉴权与权限

### 5.1 鉴权方式

**形态 A（插件内置）：令牌**

- 格式：32 字节随机数的 base64url。
- 生成：形态 A 用 `system.randomUuid()` ×2（探针 D 验证）。禁止 `Math.random()`。
- 配置只存 `sha256:<hex>`；首次启动生成明文令牌并只在控制台打印一次，随后写入哈希。
- 校验：形态 A 用纯 JS SHA-256（限频）；常量时间比较。
- 传输：`Authorization: Bearer <token>`；不使用 URL 参数传令牌。
- 前端存 `sessionStorage`，关闭标签页即失效；不写 `localStorage`。

**形态 B（单独挂载）：账号密码 + 会话**

- 没有默认账号/密码，也不在控制台打印浏览器凭据。
- 首次 `/setup` 只允许本机访问；创建管理员后关闭。
- 密码只存 PBKDF2-SHA256（15 万次）哈希 + 16 字节随机盐。
- 登录成功后下发 `HttpOnly; SameSite=Strict; Path=/` 会话 Cookie；HTTPS 下加 `Secure`。
- 会话令牌只存在服务端内存；重启后需要重新登录。
- 登录失败按 IP 限速；密码/会话不写日志、不在页面回显。
- `pushToken` 是插件与网页端之间的机器令牌，与浏览器账号分离。

### 5.2 角色与权限

| 角色 | 默认权限 |
|---|---|
| `viewer` | `player.read`、`inventory.read`、`snapshot.read`、`flow.read` |
| `operator` | viewer + `command.execute`、`command.execute.restricted`、`command.read`、`backup.create` |
| `admin` | operator + `command.execute.dangerous`、`inventory.write`、`inventory.restore`、`backup.delete`、`module.manage`、`audit.read`、`auth.rotate` |

权限是字符串；模块可以声明新权限，配置映射到角色。动作和路由都按权限校验，不按角色硬编码。

| 权限 | 说明 | 默认角色 |
|---|---|---|
| `player.read` | 玩家列表与档案 | viewer |
| `inventory.read` | 背包/装备/末影箱 | viewer |
| `snapshot.read` | 历史备份 | viewer |
| `flow.read` | 物品去向备份历史与汇总 | viewer |
| `command.read` | 命令任务记录 | operator |
| `command.execute` | 提交安全命令 | operator |
| `command.execute.restricted` | 提交受限命令 | operator |
| `command.execute.dangerous` | 提交危险命令 | admin |
| `backup.create` | 手动备份 | operator |
| `backup.delete` | 删除手动备份 | admin |
| `inventory.write` | 添加/移除/改写物品 | admin |
| `inventory.restore` | 还原背包 | admin |
| `module.manage` | 启停模块 | admin |
| `audit.read` | 审计查询与校验 | admin |
| `auth.rotate` | 轮换令牌 | admin |

### 5.3 登录/验证

```http
POST /api/v1/session/verify
Content-Type: application/json

{ "token": "..." }
```

```json
{
  "ok": true,
  "data": {
    "role": "admin",
    "name": "console",
    "permissions": ["player.read", "inventory.read", "command.execute", "..."],
    "expiresAt": null
  },
  "traceId": "b7c3..."
}
```

- 失败返回 401，不区分“令牌不存在/错误”，避免枚举。
- 连续失败按 IP 限流：5 次/分钟，超过返回 429 并记录审计。
- 支持 `IP` 允许列表；不在列表内直接 403。

### 5.4 CSRF

默认 Bearer 令牌 + 同源请求，不依赖 Cookie，因此不需要 CSRF token。v1 不启用 Cookie 会话；如果 v2 引入，必须同时启用 `X-CSRF-Token` 校验与 `SameSite=Strict`。

---

## 6. API 约定

### 6.1 基础

- 前缀：`/api/v1`。
- 编码：UTF-8；请求/响应 `application/json`。
- 时间：Unix 毫秒；`from` 含、`to` 不含。
- 字段命名：`camelCase`；物品短键仅在热层/推送批次中使用，HTTP API 返回完整字段。
- 版本：路径主版本；新增字段不升版本；删除/改语义升 `/api/v2`。

### 6.2 成功响应

```json
{
  "ok": true,
  "data": {},
  "meta": {
    "cursor": null,
    "nextCursor": null,
    "asOf": 1730000000000
  },
  "traceId": "b7c3..."
}
```

- 列表接口必须有 `meta.nextCursor`；没有更多时为 `null`。
- `meta.asOf` 表示数据备份时间，便于前端显示“截止”。

### 6.3 错误响应

```json
{
  "ok": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "缺少权限 command.execute.dangerous",
    "details": { "permission": "command.execute.dangerous" }
  },
  "traceId": "b7c3..."
}
```

错误码：

| code | HTTP | 含义 |
|---|---|---|
| `UNAUTHORIZED` | 401 | 缺少/无效令牌 |
| `FORBIDDEN` | 403 | 权限不足或 IP 不允许 |
| `NOT_FOUND` | 404 | 资源不存在 |
| `VALIDATION` | 400 | 参数/JSON Schema 校验失败 |
| `CONFLICT` | 409 | 幂等键冲突、状态不允许 |
| `PAYLOAD_TOO_LARGE` | 413 | 请求体超限 |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | 非 JSON |
| `RATE_LIMITED` | 429 | 触发限流 |
| `UNAVAILABLE` | 503 | 存储/模块降级，暂不可用 |
| `TIMEOUT` | 504 | 下游查询超时 |
| `INTERNAL` | 500 | 未分类错误 |

- 生产响应不返回堆栈；`traceId` 用于对照服务端日志。
- 校验错误在 `details.fields` 给出字段路径与原因。

### 6.4 分页

- 游标是不透明字符串：base64url(`<ts>:<seq>:<id>`)，客户端不得解析。
- 排序稳定：`ts DESC, seq DESC`；同一时间戳用 `seq` 去重。
- `limit` 默认 50，最大 200；超限钳位而不是报错。
- 不使用 `OFFSET`；深分页不会随页数变慢。

### 6.5 幂等

- `POST /actions/*`、`POST /commands` 支持 `Idempotency-Key` 头；也接受 body 里的 `requestId`。
- 同一键 10 分钟内重复提交返回同一 `taskId` 与当前状态，不重复执行。
- 键冲突但参数不同返回 409 `CONFLICT`。

### 6.6 限流

| 范围 | 限制 | 窗口 |
|---|---|---|
| 登录验证 | 5 次/IP | 1 分钟 |
| 读接口 | 240 次/令牌 | 1 分钟 |
| 写动作 | 30 次/令牌 | 1 分钟 |
| 命令提交 | 10 次/令牌 | 1 分钟 |
| 危险动作 | 2 次/令牌 | 1 分钟 |

响应带 `X-RateLimit-Limit`、`X-RateLimit-Remaining`、`X-RateLimit-Reset`；超限返回 429 与 `Retry-After`。

### 6.7 CORS

- 内置网页默认同源，不返回 CORS 头。
- 如配置 `web.cors.allowOrigins`（例如把网页嵌到另一个管理站），按白名单返回；不允许 `*` 与 `Authorization` 组合。外部多服 CORS 是 v2。
- 预检只允许 `GET, POST, OPTIONS`，头允许 `Authorization, Content-Type, Idempotency-Key, If-None-Match`。
- 暴露头：`ETag, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-WebBundle-Trace`，否则浏览器脚本读不到限流与缓存信息。
- 禁止 `Access-Control-Allow-Credentials: true`，除非显式启用 Cookie 模式。

### 6.8 缓存

- 备份/背包/物品去向：`Cache-Control: no-store`。
- `GET /players/:xuid/inventory?live=1` 支持 `ETag`；`If-None-Match` 命中返回 304。
- `meta`、`actions`、`modules` 可短缓存 30 秒；带 `ETag`。
- 静态哈希资源长缓存；`index.html` no-cache。

---

## 7. 端点

### 7.1 元信息

```http
GET /api/v1/meta
```

```json
{
  "ok": true,
  "data": {
    "serverId": "srv-1",
    "serverName": "生存一区",
    "version": "0.2.0",
    "mode": "embedded",
    "server": { "online": true, "lastSeen": 1730000000000 },
    "dataAsOf": 1730000000000,
    "apiVersion": 1,
    "bdsVersion": "1.26.40",
    "startedAt": 1730000000000,
    "timezoneOffset": 8,
    "capabilities": ["inventory.live", "snapshot", "nbt", "nbt.edit", "offline.edit", "flow", "command", "actions", "modules"],
    "live": { "transport": "poll", "intervalMs": 1000 },
    "nav": [
      { "path": "/", "title": "总览", "order": 0 },
      { "path": "/players", "title": "玩家", "order": 10 },
      { "path": "/flow", "title": "物品去向", "order": 30 }
    ],
    "limits": { "pageSize": 200, "commandLength": 512 }
  },
  "traceId": "..."
}
```

### 7.2 玩家

```http
GET /api/v1/players?online=1&q=steve&cursor=&limit=50
```

```json
{
  "ok": true,
  "data": [
    {
      "xuid": "2535...",
      "name": "Steve",
      "online": true,
      "lastSeen": 1730000000000,
      "dim": 0,
      "pos": { "x": 128.5, "y": 64, "z": -32.5 },
      "inventorySeq": 1025,
      "persisted": true
    }
  ],
  "meta": { "nextCursor": "eyJ0cyI6..." },
  "traceId": "..."
}
```

- `online=1` 只返回在线；`q` 对名字前缀匹配（大小写不敏感），不做全表模糊扫描。
- 离线玩家从温层玩家索引读取；没有索引时降级为最近登录列表。

```http
GET /api/v1/players/:xuid
```

返回档案、最后位置、最后备份时间、在线状态、权限可见的字段。

### 7.3 背包

```http
GET /api/v1/players/:xuid/inventory?live=1
GET /api/v1/players/:xuid/inventory?at=<snapshotId>
```

```json
{
  "ok": true,
  "data": {
    "xuid": "2535...",
    "name": "Steve",
    "seq": 1025,
    "ts": 1730000000123,
    "source": "live",
    "persisted": true,
    "containers": {
      "inventory": [
        { "slot": 0, "item": { "t": "minecraft:stone", "c": 64 } }
      ],
      "armor": [],
      "offhand": [],
      "ender": []
    },
    "hash": "9a3c..."
  },
  "traceId": "..."
}
```

- `live=1` 读热层；未命中回源最新备份。
- `at` 读指定备份；不存在返回 404。
- `ETag` = `"seq-<seq>"`；支持 304。
- `source` 为 `live | snapshot | cold`；`persisted=false` 表示热层有、温层尚未落库。
- 物品可带 `nbt`（小 NBT 的 SNBT）、`nbtRef`（大 NBT）、`nbtSize`、`nbtOmitted`。
- 大 NBT 不塞进列表：`GET /api/v1/nbt/:ref` 返回 `{snbt, size, hash}`；ref 不存在 404。
- 单物品详情：`GET /api/v1/players/:xuid/items/:container/:slot?at=`，返回物品 + NBT 引用/摘要。

### 7.4 备份

```http
GET /api/v1/players/:xuid/snapshots?from=&to=&cursor=&limit=50
```

```json
{
  "ok": true,
  "data": [
    {
      "id": "srv-1:2535...:1024",
      "minute": 28833333,
      "ts": 1730000000000,
      "reason": "minute",
      "hash": "9a3c...",
      "dedup": false,
      "itemCount": 37
    }
  ],
  "meta": { "nextCursor": "..." },
  "traceId": "..."
}
```

```http
GET /api/v1/snapshots/:id
```

返回完整备份（含各容器槽位）与 `prevId` 解析后的实际来源。大备份可带 `?summary=1` 只返回元信息。

### 7.5 物品去向

```http
GET /api/v1/flow?xuid=&item=&kind=&direction=&from=&to=&cursor=&limit=50
GET /api/v1/players/:xuid/flow/items/:itemKey?from=&to=&cursor=
GET /api/v1/flow/summary?from=&to=&groupBy=item|player&xuid=
```

备份历史：

```json
{
  "ok": true,
  "data": [
    {
      "id": "srv-1:000000000123",
      "ts": 1730000000000,
      "xuid": "2535...",
      "name": "Steve",
      "kind": "drop",
      "direction": "out",
      "item": { "t": "minecraft:diamond", "a": 0 },
      "count": 1,
      "before": 64,
      "after": 63,
      "pos": { "x": 128.5, "y": 64, "z": -32.5 },
      "dim": 0,
      "ref": "drop:entity:123",
      "confidence": 1.0
    }
  ],
  "meta": { "nextCursor": "..." },
  "traceId": "..."
}
```

汇总：

```json
{
  "ok": true,
  "data": {
    "from": 1730000000000,
    "to": 1730086400000,
    "groups": [
      { "key": "minecraft:diamond", "in": 128, "out": 96, "net": 32, "events": 224 }
    ]
  },
  "meta": { "asOf": 1730086400000 },
  "traceId": "..."
}
```

- 汇总来自预聚合桶，不扫原始事件。
- `groupBy=player` 时 `key` 为 xuid，附带 `name`。

### 7.6 命令

```http
POST /api/v1/commands
Content-Type: application/json
Idempotency-Key: 4b1c...

{
  "command": "give Steve minecraft:diamond 1",
  "confirm": null,
  "requestId": "4b1c..."
}
```

```json
{
  "ok": true,
  "data": { "taskId": "01J...", "state": "queued" },
  "traceId": "..."
}
```

示例里的 `give` 属于 restricted，操作者必须同时具备 `command.execute.restricted` 与 `inventory.write`；否则返回 403。

状态：

```http
GET /api/v1/commands/:taskId
```

```json
{
  "ok": true,
  "data": {
    "taskId": "01J...",
    "state": "succeeded",
    "command": "give Steve minecraft:diamond 1",
    "operator": "admin",
    "createdAt": 1730000000000,
    "startedAt": 1730000000100,
    "finishedAt": 1730000000150,
    "result": { "success": true, "output": "已给予 Steve 1 个钻石" }
  },
  "traceId": "..."
}
```

列表与取消：

```http
GET  /api/v1/commands?status=queued&cursor=&limit=50
POST /api/v1/commands/:taskId/cancel
```

命令权限按 02 §7.3 的策略叠加：`restricted` 命令需要 `command.execute.restricted`；`give/clear/replaceitem/enchant` 还要求 `inventory.write`；`dangerous` 需要确认词。网页不因为走了命令通道就跳过这些校验。

### 7.7 动作

```http
GET /api/v1/actions
```

```json
{
  "ok": true,
  "data": [
    {
      "id": "inventory.restore",
      "module": "core",
      "title": "还原背包",
      "description": "把指定备份写回在线/离线玩家背包",
      "permission": "inventory.restore",
      "danger": "high",
      "confirm": { "type": "phrase", "text": "RESTORE" },
      "schema": {
        "type": "object",
        "required": ["xuid", "snapshotId", "scope"],
        "properties": {
          "xuid": { "type": "string" },
          "snapshotId": { "type": "string" },
          "scope": { "type": "array", "items": { "enum": ["inventory", "armor", "offhand", "ender"] } },
          "mode": { "enum": ["replace", "merge"] }
        }
      },
      "ui": { "page": "/players/:xuid/inventory", "button": "还原", "order": 20 }
    }
  ],
  "traceId": "..."
}
```

```http
POST /api/v1/actions/:actionId
Content-Type: application/json
Idempotency-Key: 9d2e...

{ "xuid": "2535...", "snapshotId": "srv-1:2535...:1024", "scope": ["inventory"], "mode": "replace", "confirm": "RESTORE" }
```

```json
{
  "ok": true,
  "data": { "taskId": "01J...", "state": "queued" },
  "traceId": "..."
}
```

- 所有动作默认异步，返回 202 风格载荷；前端轮询 `/tasks/:taskId`。
- 低风险动作可以实现为同步执行并直接返回结果，但接口仍返回 200 + `{taskId}`，保持一致性。
- 动作描述由插件层生成；网页不硬编码动作列表。内置动作包括 `inventory.add/remove/edit/restore`、`item.nbt.set/refresh`、`backup.create/delete`、`command.execute`、`module.enable/disable`、`auth.rotate`，见 02 §6.6。
- `item.nbt.set` 输入：`{xuid, container, slot, nbt, confirm}`；`nbt` 为 SNBT，由 qjs 插件解析/校验/写回。
- 形态 B 中 BDS 停止时，动作返回 `state: "queued_offline"`；页面显示“开服后执行”，可取消。形态 A 在 BDS 停止后不可用，没有队列。需要在线玩家的动作（如 `command.execute`）返回 503 或排队，取决于动作声明。
- 离线玩家修改在页面标注“下次进服生效”；不假装立即出现在游戏内。

### 7.8 任务

```http
GET /api/v1/tasks/:taskId
```

返回任务状态、进度、结果、错误。只有提交者本人或 `admin` 可读。

### 7.9 模块

```http
GET /api/v1/modules
GET /api/v1/modules/:id/health
```

```json
{
  "ok": true,
  "data": [
    {
      "id": "logistics",
      "name": "物品去向信息",
      "version": "1.0.0",
      "enabled": true,
      "healthy": true,
      "permissions": ["flow.read"],
      "pages": [{ "path": "/m/logistics", "title": "物品去向信息" }]
    }
  ],
  "traceId": "..."
}
```

模块启停是动作：`module.disable` / `module.enable`，权限 `module.manage`。

### 7.10 审计

```http
GET /api/v1/audit?from=&to=&operator=&action=&cursor=&limit=50
GET /api/v1/audit/verify?from=&to=
```

```json
{
  "ok": true,
  "data": {
    "from": 1730000000000,
    "to": 1730086400000,
    "count": 120,
    "valid": true,
    "firstSeq": 88421,
    "lastSeq": 88540
  },
  "traceId": "..."
}
```

### 7.11 实时

轮询（v1 唯一实时方式）：

```http
GET /api/v1/stream?since=1025&xuid=2535...&limit=200
```

```json
{
  "ok": true,
  "data": {
    "events": [
      {
        "type": "inventory.delta",
        "xuid": "2535...",
        "seq": 1026,
        "baseSeq": 1025,
        "changes": [{ "container": "inventory", "slot": 12, "item": null }]
      }
    ],
    "nextSeq": 1026,
    "reset": false,
    "hasMore": false
  },
  "traceId": "..."
}
```

- `since` 太旧或服务重启导致序号断层时返回 `reset: true` 与空事件，客户端重取全量。
- `limit` 最大 200；一次拉不完用 `nextSeq` 继续。
- 客户端只在页面可见时轮询；隐藏后暂停，恢复时先补拉。

WebSocket/SSE 是 v2；v1 只保留上面的轮询接口。v2 的 ticket、订阅、ping、断线补拉见 [06 §4](06-v2-外部模式与分布式.md)。

### 7.12 健康与指标

```http
GET /healthz          // 仅存活，不需要鉴权
GET /api/v1/health    // 依赖状态：hot、store、modules（v1 无 redis/kafka）
GET /api/v1/metrics   // Prometheus 文本，admin
```

`/api/v1/health`：

```json
{
  "ok": true,
  "data": {
    "status": "ok",
    "components": {
      "hot": { "status": "ok" },
      "store": { "status": "ok", "latencyMs": 2, "driver": "rocksdb" },
      "modules": { "status": "ok", "disabled": [] }
    },
    "uptimeSec": 3600
  },
  "traceId": "..."
}
```

### 7.13 冷查看（仅形态 B，BDS 停止）

仅在部署了单独挂载网页端 `webbundle-web` 时存在；形态 A 没有此状态。

```json
{
  "server": { "online": false, "lastSeen": 1730000000000 },
  "mode": "cold",
  "dataAsOf": 1730000000000
}
```

- `GET /inventory` 返回最后备份，`source="cold"`，不伪造实时。
- `/stream` 返回空事件与 `asOf`；不建立实时轮询。
- 写动作返回 `queued_offline`，开服后执行；需要在线玩家的动作可禁用。
- 页面顶部显示“服务器未运行 / 数据截止 <时间>”，不隐藏。
- 冷查看仍要鉴权，不因 BDS 停止而放宽权限。

---

## 8. 动作描述与通用表单

### 8.1 描述字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 是 | 唯一，点分命名，如 `inventory.restore` |
| `module` | 是 | 提供者 |
| `title` / `description` | 是 | 展示文案，可 i18n |
| `permission` | 是 | 执行所需权限 |
| `danger` | 是 | `safe / medium / high` |
| `confirm` | 高风险必填 | `{type:"phrase", text}` 或 `{type:"checkbox", text}` |
| `schema` | 是 | JSON Schema 子集 |
| `ui` | 否 | 页面、按钮、排序、字段控件提示 |
| `result` | 否 | `task`（默认）或 `sync` |

### 8.2 JSON Schema 子集

支持：

- 类型：`object`、`array`、`string`、`number`、`integer`、`boolean`。
- 约束：`required`、`properties`、`additionalProperties: false`、`enum`、`const`、`minimum`、`maximum`、`minLength`、`maxLength`、`pattern`、`items`、`minItems`、`maxItems`、`default`。
- 嵌套深度 ≤ 4；字段数 ≤ 40；字符串长度 ≤ 4096。

不支持：

- `$ref`、`oneOf`/`anyOf`/`allOf`（v1 保持表单可预测）、远程 schema。
- 文件上传；需要上传的动作单独实现流式端点，默认关闭。

### 8.3 通用表单

```
动作列表
  → 选择动作
  → 渲染字段（字符串/数字/布尔/枚举/数组）
  → 客户端校验
  → 危险动作弹确认层（输入确认词）
  → POST /actions/:id
  → 202 → 任务轮询
  → 成功/失败 toast + 操作记录链接
```

- 字段值不拼 HTML；下拉选项来自 `enum` 或 `ctx.data` 提供的候选。
- 玩家/物品选择器使用搜索接口，不一次性加载全量。
- 高风险动作按钮使用危险色，默认禁用直到确认通过。
- 表单草稿只存在内存；刷新即清空，避免误提交旧参数。

### 8.4 模块页面链接

模块可以通过 `pages.register` 注册独立页面。页面是 `dist/modules/<id>/index.html`，与主站同源，使用 `/shared/webbundle-api.js` 访问 `/api/v1` 与 `/m/<id>`。

信任模型：v1 只有内置模块页面，随发布包一起审核；页面仍受 CSP 与只读规则约束。未来第三方模块页面不得把令牌发送到外部域，也不得使用内联脚本或 `eval`。

---

## 9. 前端结构

### 9.1 技术选择

- 原生 ES Module + CSS，无框架、无构建时依赖（可选 esbuild 压缩）。
- 路由用 hash（`#/players/...`），避免内置服务器做 History fallback。
- 状态用小型 store：`{ meta, auth, players, inventory, flow, tasks }`，订阅式更新。
- 列表虚拟滚动；物品格用 CSS Grid；图表用 SVG/CSS，不引第三方图表库。
- 所有网络请求经 `api.js`，统一加令牌、traceId、超时、重试。

### 9.2 目录

```
web/
├── index.html
├── app.js
├── router.js
├── api.js
├── store.js
├── live.js
├── auth.js
├── i18n.js
├── components/
│   ├── item-grid.js
│   ├── item-tooltip.js
│   ├── timeline.js
│   ├── virtual-list.js
│   ├── modal.js
│   ├── confirm.js
│   ├── toast.js
│   └── pagination.js
├── pages/
│   ├── dashboard.js
│   ├── players.js
│   ├── inventory.js
│   ├── snapshots.js
│   ├── flow.js
│   ├── commands.js
│   ├── modules.js
│   ├── audit.js
│   └── settings.js
├── styles/
│   ├── base.css
│   ├── layout.css
│   ├── components.css
│   └── themes.css
└── lang/
    ├── zh-CN.json
    └── en-US.json
```

### 9.3 API 客户端

```js
async function api(path, options = {}) {
    const headers = Object.assign(
        { "Accept": "application/json" },
        options.body ? { "Content-Type": "application/json" } : {},
        token ? { "Authorization": "Bearer " + token } : {},
        options.headers || {}
    );
    const res = await fetch(boot.apiBase + path, {
        method: options.method || "GET",
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: options.signal
    });
    if (res.status === 304) return { notModified: true };
    const json = await res.json();
    if (!json.ok) throw new ApiError(json.error, json.traceId);
    return json;
}
```

- 401：清空令牌，跳登录。
- 429：按 `Retry-After` 退避，toast 提示。
- 503：显示降级横幅，保留只读页面。
- 网络错误：指数退避重试 2 次，仍失败则提示。

### 9.4 实时更新

`live.js`：

- 页面可见时每 1 秒 `GET /stream?since=...`；隐藏时暂停。
- 收到 delta 后按 `seq` 连续性应用；断层则重取当前页全量。
- 同一玩家多个 delta 合并后再渲染（`requestAnimationFrame`）。
- 页面切换时取消旧订阅，避免后台请求。
- v1 只有轮询；WebSocket 是 v2，不在 `live.js` 里预留分支。

### 9.5 渲染安全

- 物品名、lore、玩家名、命令输出一律 `textContent` 或转义后插入。
- 禁止 `innerHTML` 拼接来自 API 的字符串；确需富文本时使用白名单构造 DOM。
- 物品的 `§` 格式码按纯文本显示，不解释为 HTML。
- 外链一律 `rel="noopener noreferrer"`；禁止 `javascript:` URL。

### 9.6 性能

| 指标 | 目标 |
|---|---|
| 首屏 JS（gzip） | ≤ 150KB |
| 首屏 CSS（gzip） | ≤ 30KB |
| 首屏可交互 | ≤ 1.5s（局域网） |
| 列表滚动 | 60fps（1000 行虚拟滚动） |
| 轮询开销 | 可见时 ≤ 1 请求/秒，隐藏时 0 |

- 路由级懒加载：页面模块按需 `import()`。
- 搜索输入 200ms 防抖；请求可取消。
- 图片/图标按需加载；没有图标时显示物品类型首字母色块。

### 9.7 可访问性与国际化

- 键盘可达：Tab 顺序、Enter/Space 触发、Esc 关闭弹层、焦点陷阱。
- ARIA：`role="dialog"`、`aria-live="polite"` 用于任务状态。
- 对比度 ≥ 4.5:1；尊重 `prefers-reduced-motion`。
- 文案走 `lang/*.json`；日期/数字按 `timezoneOffset` 本地化。
- 中文为默认语言，英文为第二语言；缺失键回退中文并记录缺失。

### 9.8 前端风险验证（M1 退出标准）

“无框架原生 ES Module”是选择，不是信仰。M1 必须用真实页面原型验证，失败就换方案，不能拖到 M3。

原型范围：

1. 1000 行物品去向/备份列表，虚拟滚动；
2. 每秒 20 条 `inventory.delta`，按 `seq` 合并、`requestAnimationFrame` 批量渲染；
3. 故意制造序号断层，验证全量刷新；
4. 页面隐藏/恢复，验证暂停与补拉；
5. 背包 36 格 + 4 盔甲 + 1 副手 + 27 末影箱同时高亮变化。

测量：

- 滚动/更新时 FPS（目标 ≥ 60，p95 frame time ≤ 16.7ms）；
- 5 分钟运行内存增长（目标 ≤ 20%）；
- 主线程长任务（目标无 > 50ms）；
- 代码量：`live.js` + 虚拟列表 + store ≤ 1500 行，否则说明复杂度失控。

失败后的候选（按成本排序）：

| 方案 | 代价 | 适用 |
|---|---|---|
| 保留原生，改为分页而非实时全量 | 低 | 实时需求弱 |
| 引入轻量虚拟列表库（无框架） | 低 | 只是滚动问题 |
| 引入 Preact/Svelte 等编译型小框架 | 中 | 组件/状态复杂度失控 |
| 背包格用 Canvas 渲染 | 中 | 格子数量大、DOM 压力高 |

决策点在 M1 结束；M1 不通过就不进 M2。

### 9.9 NBT 查看/编辑器

- 物品详情抽屉：基本信息 + “完整 NBT”折叠区；小 NBT 直接显示，大 NBT 异步加载 `/api/v1/nbt/:ref`。
- SNBT 以等宽字体显示，支持复制/下载；编辑模式用文本域 + 语法高亮（可选），提交前本地做括号/类型粗检。
- 编辑提交必须带确认；由 qjs 插件的 `NBT.parseSNBT` 做权威校验，客户端/服务端只做粗检与转发。
- 编辑失败显示服务端错误码与字段；不把失败态当成功。
- 大 NBT 显示“大小/是否走 ref/是否超限”；超限时禁用编辑并说明原因。
- 所有 NBT 文本按纯文本渲染，禁止 `innerHTML`。

### 9.10 冷查看与离线队列 UI

- 顶部状态条：`服务器运行中` / `服务器未运行（数据截止 …）`；冷查看用不同颜色。
- 冷查看时隐藏/禁用“实时刷新”，保留历史浏览、NBT 查看、日志/审计。
- 写按钮仍显示，但提交后任务状态为 `queued_offline`；任务页可取消。
- 离线玩家背包页标注“离线 / 下次进服生效”；在线玩家标注“立即生效”。
- 任务页展示：排队中、开服后执行、执行中、成功、失败、过期；失败给 traceId。

---

## 10. 外部推送契约（v2）

v1 不实现。插件 → `webbundle-web` 的注册、心跳、备份/事件/审计推送、命令拉取、重放保护与 spool 见 [06 §3](06-v2-外部模式与分布式.md)。

---

## 11. 错误处理与降级展示

| 场景 | 页面表现 | API |
|---|---|---|
| 温层不可用 | 顶部黄色横幅“历史暂不可用”；实时视图仍可用 | 历史接口 503 `UNAVAILABLE` |
| 实时流断开 | 背包页显示“实时已断开，正在重连”；保留最后备份 | `/stream` 503；客户端退避 |
| 模块停用 | 模块页灰显，显示原因 | `/modules/:id/health` 返回 `disabled` |
| 令牌失效 | 跳登录页，清空本地令牌 | 401 |
| 限流 | toast“操作过于频繁”，按钮禁用倒计时 | 429 + `Retry-After` |
| 动作失败 | 任务卡片红色，显示错误码与 traceId | 任务 `state=failed` |
| BDS 停止 | 顶部“服务器未运行”；只读 + 队列；显示 `dataAsOf` | `meta.mode=cold` |
| 大 NBT 未内联 | 显示“NBT 过大，按需加载”；可单独下载/编辑 | `nbtOmitted=true`/`nbtRef` |
| 离线玩家修改 | 标注“下次进服生效”；任务状态可查 | `state=queued_offline`/`succeeded` |

降级不是静默：页面必须让管理员知道“现在看到的是什么级别的事实”。

---

## 12. 安全

### 12.1 CSP

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data:;
font-src 'self';
connect-src 'self';
frame-ancestors 'none';
base-uri 'none';
form-action 'self';
object-src 'none';
```

- v1 允许 `style-src 'unsafe-inline'`，因为组件会设置内联样式；后续可改为 CSS 变量/类。
- 不允许 `unsafe-eval`；不使用 `eval`/`new Function`。
- 模块页面同样受此 CSP 约束；不得加载外部脚本。

### 12.2 XSS

- 所有动态文本用 `textContent`；禁止把 API 字符串拼进 `innerHTML`。
- 物品 lore 可能包含格式码与特殊字符，按纯文本处理。
- 命令输出按 `<pre>` 文本显示，不解析颜色码为 HTML。
- URL 参数只用于路由与查询；不直接插入 DOM。

### 12.3 点击劫持与跨站

- `X-Frame-Options: DENY` + `frame-ancestors 'none'`。
- 所有写动作要求 Bearer 令牌；第三方站点无法静默提交。
- 外部模式的嵌入策略是 v2，见 06。

### 12.4 令牌与日志

- 令牌不写日志、不进 URL、不进 `Referer`。
- 前端 `sessionStorage`；关闭标签页清除。
- 服务端只存哈希；比较使用常量时间实现。
- 审计记录操作者名称与 IP，不记录令牌。

### 12.5 输入限制

| 输入 | 限制 |
|---|---|
| JSON 请求体 | 64KB |
| 命令 | 512 字符 |
| 查询字符串 | 2KB |
| 分页 limit | 200 |
| 动作 schema 深度 | 4 |
| 动作 schema 字段数 | 40 |
| SNBT 文本 | 512KB（单物品） |

---

## 13. 测试

### 13.1 契约测试

- 用固定 fixture 启动一个内存版宿主，逐条断言端点状态码、响应包、错误码。
- 覆盖：未授权、越权、分页、ETag/304、限流、幂等、危险动作确认、任务状态机。
- v1 跑 embedded 与 external 两种形态；多服/WebSocket/分布式是 v2，见 06。

### 13.2 前端测试

- 纯函数（格式化、游标、差异合并）单元测试。
- DOM 组件用轻量 DOM 实现或浏览器测试；重点测 XSS 转义与键盘操作。
- 端到端：登录、查看在线背包、切换玩家、打开备份、提交命令、确认危险动作、审计出现记录。
- NBT：小 NBT 内联、大 NBT ref 异步加载、编辑成功/失败、超限禁用。
- 冷查看（形态 B）：停止 BDS 后页面可开、`dataAsOf` 正确、写动作排队；未部署形态 B 时确认无网页。
- 离线修改：离线玩家编辑 → 开服后任务执行 → 玩家进服验证。
- M1 前端原型：按 §9.8 的 1000 行 + 实时 patch 场景测 FPS/内存/长任务；不达标先换方案，不进 M2。

### 13.3 性能测试

- 1000 名玩家列表虚拟滚动。
- 1 万条物品去向事件分页。
- 1 秒轮询持续 30 分钟，内存无增长。
- 背包页 1000 行 + 每秒 20 条 delta，60fps。
- 100 个带 NBT 物品的背包：小 NBT 内联、大 NBT ref 加载。
- BDS 停止后的冷查看首屏与历史分页。
- 并发 20 个读请求 + 2 个写动作，p95 在预算内。

---

## 14. 验收清单（网页层）

- [ ] 形态 A 在 BDS 停止后不可用；形态 B 未部署时同样不可用（无兜底）。
- [ ] 网页层没有任何 `mc.*`/`Player`/`Block` 调用。
- [ ] 所有写操作都是动作意图；没有直接写背包/数据库的端点。
- [ ] BDS 停止后网页仍可打开，显示最后备份与 `dataAsOf`；写动作排队。
- [ ] 物品完整 NBT 可查看；大 NBT 走 ref；超限不静默截断。
- [ ] 在线/离线玩家背包与 NBT 可修改；离线修改标注“下次进服生效”。
- [ ] 令牌只存 `sessionStorage`，不写 `localStorage`，不进 URL/日志。
- [ ] 所有动态文本按纯文本渲染；CSP 无 `unsafe-eval`。
- [ ] 分页全部游标化，limit 上限生效。
- [ ] ETag/304、幂等键、限流、错误码按契约工作。
- [ ] 危险动作有确认词与审计。
- [ ] 实时更新在页面隐藏时暂停，恢复时补拉；断层时全量刷新。
- [ ] 降级状态在页面上可见，不静默。
- [ ] 首屏 JS gzip ≤ 150KB，列表 1000 行滚动 60fps。
- [ ] M1 前端原型通过 §9.8 的实时 patch/内存/长任务门槛。
- [ ] 键盘可完成主要操作；对比度达标。
