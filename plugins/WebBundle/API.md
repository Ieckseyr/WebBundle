# WebBundle API

> 本文件随 `plugins/WebBundle` 插件一起发布。

基础地址：

```text
http://服务器地址:19380/api/v1
```

独立网页端：

```text
http://服务器地址:8080/api/v1
```

独立端会把请求代理到内置端，因此路径和返回结构一致。

除以下认证接口外，请求需要登录会话 Cookie 或：

```http
Authorization: Bearer <web.token>
```

---

## 1. 认证

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/auth/status` | 是否已初始化、是否已登录、KDF 参数 |
| POST | `/auth/setup` | 首次创建管理员 |
| POST | `/auth/login` | 内置端 verifier 登录 |
| POST | `/auth/logout` | 退出并清除 Cookie |

内置端登录体：

```json
{
  "username": "admin",
  "verifier": "<PBKDF2-HMAC-SHA256 hex>"
}
```

首次设置体：

内置端：

```json
{
  "username": "admin",
  "salt": "<32 hex>",
  "iterations": 210000,
  "verifier": "<64 hex>",
  "webToken": "config.json 中的 web.token"
}
```

独立端：

```json
{
  "username": "admin",
  "password": "...",
  "confirm": "...",
  "webToken": "BDS config.json 中的 web.token"
}
```

首次设置必须提供 `webToken`，即 BDS `config.json` 的 `web.token`。

不接受：

- `external.token`
- 独立端 `pushToken`

令牌错误返回 403。

独立端登录体：

```json
{
  "username": "admin",
  "password": "明文只在本机/服务端内存中"
}
```

独立端在服务端完成 PBKDF2，浏览器不需要 WebCrypto。

首次设置必须输入 BDS `config.json` 中的 `web.token`；本机访问也不能跳过。

---

## 2. 读取接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/meta` | 服务端、账号、能力、限制 |
| GET | `/overview` | 总览统计 |
| GET | `/players` | 玩家列表 |
| GET | `/players/:xuid/inventory` | 当前背包 |
| GET | `/players/:xuid/inventory?at=<snapshotId>` | 指定备份背包 |
| GET | `/players/:xuid/snapshots` | 玩家备份索引 |
| GET | `/snapshots` | 全服备份元数据 |
| GET | `/snapshots/:id` | 单份备份 |
| GET | `/nbt/:hash` | 完整 SNBT 大对象 |
| GET | `/flow` | 物品去向 |
| GET | `/audit` | 操作记录 |
| GET | `/audit/verify` | 强制全量哈希链校验 |
| GET | `/tasks` | 任务列表 |
| GET | `/actions` | 动作清单 |
| GET | `/items/translations` | 物品译名表 |
| GET | `/items/search?q=` | 按 ID/译名搜索，最多 100 条 |
| GET | `/commands/history` | 网页指令历史 |
| GET | `/extensions` | 扩展侧边栏页面 |
| GET | `/last-moment` | 最后快照/关服统计 |
| GET | `/stream?since=` | 影子背包增量 JSON，不是 SSE |

### 2.1 全服备份元数据

```http
GET /api/v1/snapshots?limit=2000
```

每项字段：

```text
id
xuid
name
ts
minute
reason
batchId
batchAt
batchReason
hash
itemCount
containerCounts
```

前端按 `batchId` 合成“备份文件夹”。旧快照没有 `batchId` 时：

- 分钟备份按 `minute` 分组
- 其他备份按理由 + 5 秒窗口分组

`containerCounts` 可能为空，这是旧快照兼容行为。

### 2.2 单玩家备份索引

```http
GET /api/v1/players/:xuid/snapshots?limit=500
```

用于查包页右上角的玩家备份侧边栏。

---

## 3. 动作接口

```http
POST /api/v1/actions/:actionId
Content-Type: application/json
```

返回：

```json
{
  "ok": true,
  "data": {
    "taskId": "task-...",
    "state": "queued"
  }
}
```

任务状态：

```text
queued
running
succeeded
failed
queued_offline
```

### 3.1 当前动作

| actionId | 权限 | 说明 |
| --- | --- | --- |
| `inventory.set` | inventory.write | 写入槽位 |
| `inventory.add` | inventory.write | 添加物品 |
| `inventory.remove` | inventory.write | 清空槽位 |
| `inventory.restore` | inventory.write | 还原备份 |
| `item.nbt.set` | inventory.write | 覆盖完整 SNBT |
| `item.enchants.set` | inventory.write | 写入附魔 |
| `item.lore.set` | inventory.write | 写入 Lore 与标签 |
| `item.name.set` | inventory.write | 写入显示名称 |
| `item.nested.set` | inventory.write | 修改容器内物品 |
| `item.nbt.refresh` | inventory.read | 重新读取完整物品 |
| `flow.craft` | inventory.write | 记录合成 |
| `backup.create` | inventory.read | 创建备份 |
| `offline.snapshot` | inventory.write | 读取离线背包并生成快照 |

### 3.2 容器

```text
inventory | armor | offhand | ender
```

### 3.3 还原

```json
{
  "xuid": "2535416158535227",
  "snapshotId": "srv:2535...:22:...",
  "scope": ["inventory", "armor", "offhand", "ender"]
}
```

### 3.4 容器内物品

```json
{
  "xuid": "...",
  "container": "inventory",
  "slot": 0,
  "path": [0, 14],
  "item": { "t": "minecraft:stone", "c": 1 }
}
```

`path` 从外到内。

### 3.5 原版标签

```json
{
  "lore": ["第一行", "第二行"],
  "tags": {
    "canPlaceOn": ["minecraft:stone"],
    "canDestroy": ["minecraft:dirt"],
    "keepOnDeath": true,
    "itemLock": "lock_in_slot"
  }
}
```

实际 NBT：

```text
根节点 CanPlaceOn
根节点 CanDestroy
tag.minecraft:keep_on_death = 1b
tag.minecraft:item_lock = 1b | 2b
```

---

## 4. 快照查看

快照查看是只读的。

前端流程：

1. `GET /players/:xuid/inventory?at=<snapshotId>` 加载备份
2. 显示历史快照横幅
3. 用户点击还原
4. `inventory.restore` 写回玩家
5. 清除 `at` 状态，重新加载实时背包

不提供直接修改快照内容的 HTTP 动作。

---

## 5. 插件导出 API

只导出扩展页面/模块能力，不导出物品写入：

| 导出 | 说明 |
| --- | --- |
| `getPlayers()` | 本地玩家记录 |
| `getItemTranslations()` | 物品译名表 |
| `translateItem(type)` | 单个物品 ID 翻译 |
| `registerWebPage(definition)` | 注册侧边栏页面 |
| `unregisterWebPage(moduleId, pageId)` | 注销页面 |
| `registerModule(module)` | 注册并启动模块 |

页面定义：

```js
const registerWebPage = ll.import("WebBundle", "registerWebPage");

registerWebPage({
  module: "my_module",
  id: "dashboard",
  label: "我的面板",
  title: "我的面板",
  icon: '<svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/></svg>',
  order: 100,
  html: '<div class="ext-block">...</div>',
  css: '.ext-block { padding: 18px; }',
  script: 'document.querySelector(".ext-block").textContent = "Hello";'
});
```

页面脚本可用：

```js
window.WebBundle.api("/players")
window.WebBundle.page
window.WebBundle.toast("消息")
```

模块也可以使用：

```js
export const myModule = {
  id: "my_module",
  name: "我的模块",
  setup(ctx) {
    ctx.web.registerPage({
      id: "dashboard",
      label: "我的面板",
      title: "我的面板",
      html: "<div>...</div>"
    });
  },
  web: [
    { id: "about", label: "关于", html: "<p>...</p>" }
  ]
};
```

---

## 6. 账号角色

```text
viewer    只读
operator  背包修改、还原、指令
admin     账号/权限管理
```

当前只有单管理员账号和角色等级，多账号 UI 仍未完成。

---

## 7. 错误结构

```json
{
  "ok": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "缺少 inventory.write"
  }
}
```

常见状态码：

```text
400 VALIDATION
401 UNAUTHORIZED
403 FORBIDDEN
404 NOT_FOUND
409 CONFLICT
429 RATE_LIMIT
500 INTERNAL
```
