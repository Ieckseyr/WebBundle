# WebBundle 插件层与链入 API

> 状态：v1.3（两种网页形态；新增完整 NBT、离线背包修改）
> 运行时：LegacyScriptEngine QuickJS（`lse-quickjs`）
> 上游：[00 v1 范围与探针](00-v1范围与运行时探针.md) / [01 总体架构](01-总体架构与设计决策.md) / [07 单独挂载网页端](07-单独挂载网页端与离线修改.md)
> 本文定义 qjs 插件的目录、生命周期、影子状态、缩小后的模块链入 API、两个内置模块、完整 NBT 与在线/离线背包写入。
> **形态 A：插件内置 `HttpServer`（BDS 运行时）。形态 B：单独挂载 `webbundle-web`（可选；没有它就没有离线查看）。v1 不开放第三方模块。**

---

## 1. 运行时与入口

### 1.1 插件清单

```json
{
  "name": "WebBundle",
  "entry": "index.js",
  "type": "lse-quickjs",
  "version": "0.2.0",
  "author": "WebBundle contributors",
  "description": "网页查包：背包实时视图、分钟备份、完整 NBT、离线修改、物品去向、网页动作",
  "dependencies": [
    { "name": "legacy-script-engine-quickjs" }
  ],
  "optionalDependencies": []
}
```

`legacy-script-engine-quickjs` 是硬依赖。v1 不依赖 MeowSync；跨服广播是 v2。

### 1.2 入口文件

QuickJS 的入口模块以服务器工作目录为基准解析相对导入。入口只负责组装与启动。

```js
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 WebBundle contributors

// 入口模块的基准目录是服务器根目录，不是插件目录。
// 这是 LSE QuickJS 的加载器行为，写成 ./src/app.js 会找不到文件。
import { createPlugin } from "./plugins/WebBundle/src/app.js";

export const INFO = {
    name: "WebBundle",
    version: [0, 2, 0],
    author: "WebBundle contributors"
};

const plugin = createPlugin();

plugin.start();
```

入口之后的所有模块都按标准 ES Module 规则使用相对路径。

### 1.3 目录结构

```
plugins/WebBundle/
├── index.js
├── manifest.json
├── config.default.json
├── LICENSE
├── README.md
├── src/
│   ├── app.js                  组装依赖、生命周期
│   ├── lifecycle.js            onLoad / onServerStarted / onUnload
│   ├── core/
│   │   ├── config.js
│   │   ├── logger.js
│   │   ├── metrics.js
│   │   ├── scheduler.js
│   │   ├── event-bus.js
│   │   ├── errors.js
│   │   ├── ids.js
│   │   └── time.js
│   ├── domain/
│   │   ├── item.js             物品规范化、NBT 摘要/大小
│   │   ├── inventory.js        槽位模型、备份、差异
│   │   ├── flow.js             物品去向事件与分类
│   │   ├── backup.js           分钟桶与保留策略
│   │   ├── command.js          命令校验与状态机
│   │   ├── action.js           动作校验/危险级别
│   │   ├── nbt.js              SNBT 校验、大小限制、变更摘要
│   │   ├── offline.js          离线背包模型、列表对齐
│   │   └── audit.js            审计记录规范化
│   ├── ports/
│   │   ├── hot-cache.js
│   │   ├── snapshot-store.js
│   │   ├── event-store.js
│   │   ├── command-store.js
│   │   ├── push-client.js      推送到 webbundle-web（形态 B，可选）
│   │   ├── action-source.js    本地队列 / webbundle-web 动作
│   │   └── clock.js
│   ├── adapters/
│   │   ├── lse/
│   │   │   ├── runtime.js      探测 mc/ll/network 能力
│   │   │   ├── player-source.js 进服全量读取、漂移校正
│   │   │   ├── event-hooks.js  mc.listen 注册与分发
│   │   │   ├── item-nbt.js     Item.getNbt/setNbt、SNBT
│   │   │   ├── player-nbt.js   getPlayerNbt/setPlayerNbtTags
│   │   │   ├── identity.js     xuid/name/uuid 映射
│   │   │   └── command-runner.js mc.runcmdEx
│   │   ├── store/
│   │   │   ├── memory.js       测试用
│   │   │   └── local-spool.js  推送失败暂存
│   │   ├── web/
│   │   │   ├── embedded-qjs.js LSE HttpServer（形态 A）
│   │   │   ├── router.js       精确路由表
│   │   │   └── static-assets.js 启动时载入、ETag、预压缩
│   │   ├── push/
│   │   │   ├── http-push.js    network.httpPost（形态 B）
│   │   │   └── action-poll.js  network.httpGet 异步轮询（形态 B）
│   ├── modules/
│   │   ├── host.js
│   │   ├── context.js
│   │   ├── permissions.js
│   │   ├── loader.js
│   │   ├── registry.js         构建期生成，只含内置模块
│   │   └── builtin/
│   │       ├── command/
│   │       │   ├── module.json
│   │       │   ├── index.js
│   │       │   ├── validate.js
│   │       │   └── queue.js
│   │       └── logistics/
│   │           ├── module.json
│   │           ├── index.js
│   │           ├── infer.js
│   │           ├── ledger.js
│   │           └── recipes.js
│   └── shared/
│       ├── item-catalog.js
│       ├── item-names.zh-CN.json
│       └── json.js
├── modules/                     第三方模块预留；v1 不加载
├── data/
│   ├── recipes.index.json
│   └── item-catalog.json
├── tools/
│   ├── build-recipes.mjs
│   ├── build-modules.mjs
│   ├── lint-comments.mjs
│   └── check-license.mjs
└── tests/
    ├── unit/
    ├── integration/
    ├── load/
    └── harness/
```

网页 `dist/` 由形态 A（内置）与形态 B（单独挂载）共用；本地存储/动作队列在插件，独立网页端的数据库/队列在它自己进程里。

---

## 2. 生命周期

### 2.1 启动

```
顶层执行：配置、日志、指标、事件注册
onServerStarted：
  1. 形态 A：启动内置 HttpServer（若启用）
  2. 形态 B：连接 webbundle-web（若配置）；register + 动作描述 + 玩家元数据
  3. 启动推送队列与动作轮询（仅形态 B）
  4. 启动调度器（分钟桶、合并器）
onUnload：
  1. 停止内置 Web
  2. 停止动作轮询/推送
  3. 刷出队列
  4. 回报未完成任务
  5. 关闭日志
```

### 2.2 两种形态的关系

- 形态 A 未启用：没有 BDS 运行时的内置页。
- 形态 B 未配置/不可达：进入 spool 模式；**没有离线查看**；插件不崩。
- 形态 B 恢复：按 `lastAckSeq` 续传；动作轮询恢复。
- BDS 停止：形态 A 消失；形态 B（若单独部署）继续提供冷查看。
- **未部署形态 B 时，BDS 停止后没有网页可用；这是预期边界，不是降级。**

### 2.3 关闭

- `onUnload` 必须幂等。
- 未完成动作在队列中标记 `failed`/`expired`；插件不重放。
- 推送队列刷出超时（默认 2 秒），剩余写 spool，下次启动续传。

---

## 3. 分层与依赖规则

```
adapters/lse  ──▶  ports  ◀──  app  ──▶  domain
     │                                  ▲
     └──────────── 实现 ────────────────┘
```

| 层 | 可以依赖 | 禁止依赖 |
|---|---|---|
| `domain/` | 纯 JS、`shared/` 值工具 | `mc`、`ll`、`network`、任何 adapter |
| `app/` | `domain/`、`ports/`、`core/` | `adapters/` 的具体实现 |
| `adapters/` | `ports/`、`domain/` 值类型、`core/` | 其他 adapter 的具体实现 |
| `modules/` | `ctx` 链入 API | 宿主内部文件、`adapters/` |

CI 用 `tools/check-layering.mjs` 扫描 import；`domain/` 出现 `mc.`/`ll.` 即失败。

---

## 4. 事件采集与影子状态

### 4.1 监听清单

| 事件 | 用途 | 约束 |
|---|---|---|
| `onJoin` | 建影子状态种子；延迟一次全量读取 | 读取一次，允许 |
| `onLeft` | 标记离线、刷最后一份、从热缓存移除 | 轻量 |
| `onInventoryChange` | 主背包槽位增量 | 只更新一个槽位；NBT 按需 |
| `onSetArmor` | 盔甲槽位增量 | 只更新一个槽位 |
| `onTakeItem` | 拾取物品去向事件 | 只记事件 |
| `onDropItem` | 丢弃物品去向事件 | 只记事件 |
| `onOpenContainer`/`onCloseContainer` | 末影箱/容器低频刷新 | 关闭时读一次 |
| `onContainerChange` | 容器物品去向（v2 可选） | v1 只记 unknown |
| `onPlayerDie` | 死亡标记 | 只打标记 |
| `onServerStarted`/`onUnload` | 生命周期 | 启动/关闭 |

事件回调只做：更新影子状态、递增版本、把增量放入合并队列。不得 `JSON.stringify` 整包、写盘、发 HTTP、查数据库。

### 4.2 影子状态

```js
const SLOT_LAYOUT = Object.freeze({ inventory: 36, armor: 4, offhand: 1, ender: 27 });

const state = {
    xuid: "2535...",
    uuid: "2a30...",
    name: "Steve",
    seq: 1024,
    version: 88,
    slots: {
        inventory: new Array(SLOT_LAYOUT.inventory).fill(null),
        armor: new Array(SLOT_LAYOUT.armor).fill(null),
        offhand: new Array(SLOT_LAYOUT.offhand).fill(null),
        ender: new Array(SLOT_LAYOUT.ender).fill(null)
    },
    hash: "fnv1a64:...",
    dirty: true,
    lastSeen: 1730000000000,
    pos: { x: 0, y: 64, z: 0 },
    dim: 0
};
```

物品：

```js
{
    t: "minecraft:diamond_sword",
    c: 1,
    a: 0,
    n: "§6名字",
    l: ["第一行"],
    e: [[9, 5]],
    d: 12,
    h: "6f3a...",          // NBT 摘要
    nbt: null,              // 小 NBT 内联；null 表示未捕获/走 ref
    nbtRef: null,           // 大 NBT 引用
    nbtSize: 0,
    nbtOmitted: false       // 超限未内联，不伪造完整
}
```

- 不在影子状态长期保存 `Item` 对象（LSE 文档提示物品对象会释放）。
- 普通事件只更新 `t/c/a/...` 与 `h`；完整 NBT 不在此路径序列化。
- 完整 NBT 捕获时机见 §9。

### 4.3 进服种子与漂移

- 进服 `setTimeout(1500)` 后全量读取一次，填入 `SLOT_LAYOUT` 槽位；末影箱按配置决定是否读取。
- 容器实际 size 与 `SLOT_LAYOUT` 不一致时按实际 size 重建数组，不散落 36/4/1。
- 漂移校正：每 10 分钟最多 2 人，按 xuid 哈希轮转；不一致以游戏内为准，记 `drift`。

### 4.4 增量合并

```
pending: Map<xuid, { seq, changes: Map<container:slot, item|null> }>
```

合并窗口 100–250ms；flush 时：

1. 更新热缓存；
2. 生成 `inventory.delta`；
3. 推送到本地存储/`webbundle-web`（异步批量）；
4. 标记 dirty，分钟备份用。

### 4.5 末影箱、副手与容器

- 末影箱无稳定槽位事件：`onCloseContainer` 末影箱时读一次；分钟备份时若 dirty 再读一次；默认不进实时增量。
- 副手无独立事件：`onInventoryChange` 覆盖则更新，否则分钟备份/容器关闭时刷新；页面标“低频同步”。
- 容器物品去向 v1 不归因，标 `unknown`；v2 可选容器模块。

---

## 5. 调度器与预算

全局一个 1s 调度器 + tick 钩子；不允许每玩家一个定时器。

```js
const BUDGET = {
    backupPerTick: 8,
    backupMsPerTick: 0.3,
    actionsPerTick: 4,
    actionsMsPerTick: 0.5,
    driftPerTick: 1,
    nbtReadPerTick: 2       // 按需 NBT 读取
};
```

| 任务 | 频率 | 预算 |
|---|---|---|
| 分钟桶检查 | 1s | O(1) |
| 备份队列 | 每 tick | 8 人 / 0.3ms |
| 动作队列 | 每 tick | 4 个 / 0.5ms |
| 合并器 flush | 100–250ms | 按队列长度 |
| 按需 NBT 读取 | 每 tick | 2 个 |
| 漂移校正 | 10min | 1 人 / tick |
| 保留期清理 | 每天低峰 | 分批 200 条 |

### 5.1 反硬遍历规则

| 编号 | 规则 | 反例 | 正例 |
|---|---|---|---|
| R1 | 影子状态由事件维护，分钟备份不读全量 | 每分钟 `getAllItems()` | 槽位事件 + 影子 |
| R2 | 每 tick 不遍历在线玩家 | `for (player of online)` | dirty 集合 + 预算 |
| R3 | 查询必须有索引与上限 | `listKey()`、`SELECT *` | `Map`/RocksDB 前缀 + limit |
| R4 | 请求路径不做启动期工作 | 每次请求建配方索引 | 启动时建一次 |
| R5 | 列表游标分页 | `page=10000` | `nextCursor` |
| R6 | 汇总预聚合 | 每次扫 30 天事件 | 增量 `agg:*` |
| R7 | 队列按 key 合并 | 无界数组 | 按槽位合并，有上限 |
| R8 | 静态资源由形态 A 内置页/形态 B 网页端提供 | qjs 读目录 | 服务内存映射 |
| R9 | 模块查询受同一约束 | 模块返回全部玩家 | 分页读 `ctx.data` |
| R10 | 清理/迁移分批限速 | 启动删 30 天 | 玩家索引 + 每批 200 |

评审三问：500 在线/30 天最坏碰多少条？是否在每 tick/每请求执行？数据翻十倍会变慢还是不可用？答不出上限不合并。

---

## 6. 模块链入 API（v1）

### 6.1 设计目标

- 模块只通过 `ctx` 访问宿主能力。
- **v1 只服务内置模块；第三方模块不开放**。
- v1 模块没有自定义 HTTP 路由；页面是静态资源 + 核心 `/api/v1`。
- API 先缩小，经过 `command`/`logistics` 一个版本再考虑扩展。

### 6.2 模块清单

`src/modules/builtin/<id>/module.json`：

```json
{
  "id": "logistics",
  "name": "物品去向信息",
  "version": "1.0.0",
  "api": 1,
  "entry": "index.js",
  "builtin": true,
  "description": "监听丢弃、拾取、实验性合成",
  "permissions": ["flow.read"],
  "dependencies": [],
  "config": {
    "enabled": true,
    "inferCraft": false
  }
}
```

- 启动时只读内置清单；`modules/` 第三方目录 v1 忽略。
- `api` 不匹配拒绝加载。
- 依赖拓扑排序；循环报错。
- 构建期生成 `registry.js`，静态导入；v1 不支持代码热替换。

### 6.3 `ctx` 表面

```js
const ctx = {
    api: 1,
    id: "logistics",
    version: "1.0.0",

    log: { debug, info, warn, error },

    config: { get(), onChange(fn) },

    events: { on(type, handler, options), once, off },

    data: {
        player(xuid),
        onlinePlayers(limit),          // ≤500；只用于页面选项，禁止每 tick
        inventory(xuid, options),      // { at: snapshotId | "live" }
        snapshots: { list(xuid, range, cursor), get(snapshotId) },
        flow: { query(filter, cursor), summary(filter), itemLedger(xuid, itemKey, range) }
    },

    actions: { register(descriptor, handler) },
    commands: { register(descriptor) },
    pages: { register(descriptor) },   // 只注册导航/静态页面元数据

    kv: {
        get(key, fallback),
        set(key, value, options),
        delete(key),
        scan(prefix, options)          // limit ≤100；1MB/分钟
    },

    metrics: { counter, gauge, histogram },

    tasks: {
        defer(fn, ms),                 // 最小 50ms
        every(ms, fn),                 // 最小 60000ms；每模块 ≤8 个
        cancel(handle)
    },

    permissions: { define(name, options), has(permission), require(permission) },
    auth: { operator(), role() },
    i18n: { t(key, params) },
    lifecycle: { onStart(fn), onStop(fn), onHealth(fn) }
};
```

v1 移除：

- `services.provide/consume`：模块之间不互相发现；
- `http.get/post`：模块没有自定义 HTTP 路由；
- `ctx.http.del`：不存在。

### 6.4 事件总线

| 事件 | 载荷 |
|---|---|
| `player.join/leave` | `{xuid,uuid,name,ts}` |
| `inventory.seeded` | `{xuid,hash}` |
| `inventory.delta` | `{xuid,seq,changes}` |
| `inventory.snapshot` | `{xuid,snapshotId,reason}` |
| `item.drop/pickup/craft` | `FlowEvent` |
| `flow.recorded` | `FlowEvent` |
| `command.queued/finished` | `{taskId,...}` |
| `backup.written` | `{xuid,minute,snapshotId,dedup}` |
| `nbt.refreshed` | `{xuid,container,slot,nbtRef}` |
| `offline.applied` | `{xuid,taskId,ok}` |
| `store.degraded` | `{layer,reason}` |
| `module.error` | `{id,error}` |
| `shutdown` | `{}` |

- 同步执行；单处理器预算 50µs；重活丢 `ctx.tasks.defer`。
- 异常被宿主捕获；连续失败自动停用模块。
- 事件只读；改数据必须走动作。

### 6.5 页面与 API 边界

v1 没有模块 HTTP 路由。模块页面是网页端发布的静态页：

- 页面通过核心 `/api/v1/*` 读数据；
- 通过 `POST /api/v1/actions/*` 提交动作；
- 模块只注册导航项、页面标题、所需权限；
- 模块不能把令牌发到外部域，不得使用内联脚本/`eval`。

```js
ctx.pages.register({
    id: "logistics",
    path: "/logistics",
    title: "物品去向信息",
    icon: "flow",
    nav: { group: "观察", order: 30 },
    permission: "flow.read"
});
```

### 6.6 动作

```js
ctx.actions.register({
    id: "inventory.restore",
    title: "还原背包",
    description: "把指定备份写回玩家背包（在线/离线）",
    permission: "inventory.restore",
    danger: "high",
    confirm: { type: "phrase", text: "RESTORE" },
    schema: { /* JSON Schema 子集 */ },
    ui: { page: "/players/:xuid", button: "还原", order: 20 }
}, async (input, actionCtx) => {
    return restoreInventory(input, actionCtx);
});
```

内置动作：

| 动作 | 作用 | 危险 | 权限 |
|---|---|---|---|
| `inventory.add` | 添加物品 | medium | `inventory.write` |
| `inventory.remove` | 移除物品 | high | `inventory.write` |
| `inventory.edit` | 改数量/名称/lore/附魔/耐久 | high | `inventory.write` |
| `item.nbt.set` | 改物品完整 NBT | high | `inventory.write` |
| `item.nbt.refresh` | 重新捕获当前 NBT | safe | `inventory.read` |
| `inventory.restore` | 用历史备份覆盖/合并 | high | `inventory.restore` |
| `backup.create` | 手动备份 | safe | `backup.create` |
| `backup.delete` | 删除手动备份 | medium | `backup.delete` |
| `command.execute` | 网页命令 | 按命令级别 | `command.execute*` |
| `module.enable/disable` | 启停模块 | high | `module.manage` |
| `auth.rotate` | 轮换 Web 令牌 | high | `auth.rotate` |

动作约定：

- `actionCtx`：`{taskId, operator, traceId, progress, isCanceled}`。
- 执行前重新校验权限、目标在线状态、备份/NBT 存在。
- 危险动作必须确认；结果写任务/审计；幂等键 `taskId`/`Idempotency-Key`。
- 超过 50ms 的工作拆步；不长时间阻塞世界线程。

### 6.7 KV、指标、权限

- KV 键前缀 `m:<id>:`；单值 ≤64KB；单模块总量 ≤4MB；`scan` 单页 ≤100、1MB/分钟。
- 指标前缀 `webbundle_module_<id>_`；标签最多 8 个，禁止高基数。
- 权限按字符串；角色映射由宿主配置；动作/页面按权限校验。

### 6.8 隔离与故障

- 模块与宿主同一 QuickJS realm，**不是安全沙箱**；v1 只加载内置模块，按可信代码评审。
- 连续 5 次异常或单次页面处理器 >100ms → 停用模块，页面显示原因。
- 运行时配额：事件 p99 >500µs 连续 20 次告警；>5ms 连续 3 次停用；`tasks.every` ≥60s、≤8 个；`tasks.defer` ≥50ms、队列 ≤64；KV 超限 `QUOTA_EXCEEDED`。
- v1 没有 `http.post`，不存在模块网络入口。

### 6.9 版本

- `api: 1`；新增字段不升版本，删除/改语义升主版本。
- 未知字段忽略；缺失必填报错。
- 事件载荷只追加字段。

---

## 7. 内置子模块 1：网页指令执行

（入口为内置页/单独挂载网页端的动作队列。）

### 7.1 数据流

```
网页 POST /api/v1/commands
  → 网页端校验/入队
  → qjs 插件轮询动作
  → 世界线程 mc.runcmdEx
  → 结果回写网页端
```

### 7.2 策略

```js
const POLICY = {
    safe: ["say","tell","msg","title","tellraw","list","time","weather","gamerule",
           "tp","teleport","spawnpoint","effect","xp","gamemode","difficulty"],
    restricted: ["give","clear","replaceitem","enchant",
                 "fill","clone","setblock","structure","summon","execute","function","scoreboard"],
    dangerous: ["stop","op","deop","ban","ban-ip","pardon","whitelist","kick","reload","save",
                "ll","lse","script","plugins","module"]
};
```

- 默认拒绝不在白名单；`dangerous` 硬拒绝项不可删。
- `restricted` 需 `command.execute.restricted`；`give/clear/replaceitem/enchant` 还需 `inventory.write`。
- `dangerous` 需 admin + 确认词。
- 拒绝换行/控制字符/`;`；长度 ≤512。
- 队列上限 256；每操作者 8；全局 10/s；重启后 `queued` 标记 `expired`，不重放。
- 输出截断 4KB；结果写审计；单队列串行；SHA-256 形态 B 服务端代算，形态 A 纯 JS 降级，qjs 只排队。

### 7.3 入口

| 入口 | 路径 | 权限 |
|---|---|---|
| 网页提交 | `POST /api/v1/commands` | `command.execute` |
| 查询 | `GET /api/v1/commands/:taskId` | 本人/admin |
| 列表 | `GET /api/v1/commands?status=` | `command.read` |
| 取消 | `POST /api/v1/commands/:taskId/cancel` | 本人/admin |
| 游戏内 | `/webbundle cmd <command>` | GameMasters |

---

## 8. 内置子模块 2：物品去向信息

### 8.1 三渠道事实

| 渠道 | 事件 | 可靠性 |
|---|---|---|
| 丢弃 | `onDropItem(player,item)` | 高 |
| 拾取 | `onTakeItem(player,entity,item)` | 高 |
| 合成 | 无直接事件 | 实验性，槽位差 + 配方索引 |

`onInventoryChange` 是账本底稿；直接事件负责归因。

### 8.2 FlowEvent

```js
{
    id: "srv-1:00000123",
    ts: 1730000000000,
    xuid, name,
    kind: "drop" | "pickup" | "craft" | "unknown",
    direction: "in" | "out" | "neutral",
    item: { t, a, h },
    count, slot, container, pos, dim,
    before, after,
    ref, txId, confidence, traceId
}
```

- `id` 的 `seq` 是服务器级事件序号，与玩家备份 `seq` 分开。
- v1 完整归因 drop/pickup；craft 实验性；其他 `unknown`。
- 同一 `eventId` 只入账一次。

### 8.3 丢弃/拾取

- `onDropItem`：记 `out`；最近丢弃环形缓冲（512 条）。
- `onTakeItem`：记 `in`；按同物品/5 秒/2 格关联 `drop`。
- `before/after` 由随后的槽位差补齐，不在事件里提前写死。

### 8.4 合成（实验性，默认关闭）

- 默认 `inferCraft=false`；只覆盖工作台配方命中项。
- 熔炉/酿造/铁砧/附魔/交易/挖矿/漏斗等一律 `unknown`，页面明示。
- 同 tick（可延后 1 tick）的 removed/added 多重集查配方索引；命中 confidence 0.7；未命中 `unknown`。
- 探针 B 不可靠则不发布合成。

### 8.5 去重

- 槽位差是唯一数量来源；直接事件先入 `pendingCauses`。
- 同 tick 可解释的槽位差不额外生成 `inventory_delta`；无法解释才 `unknown`；合成消费标记 `claimed`。
- 按 `xuid` 短生命周期上下文，tick 结束/50ms 结算。

### 8.6 汇总与索引

- `agg:p:<xuid>:<day>:<item>`、`agg:i:<item>:<day>`、`agg:h:<xuid>:<hour>` 增量更新。
- 备份历史走 `e/`/`i/` 索引；汇总直接读 `agg`；不扫原始事件。
- 玩家账本 `GET /api/v1/players/:xuid/flow/items/:itemKey`。

### 8.7 边界

- 容器取放 v2 可选；末影箱不参与实时物品去向。
- 死亡/命令/漏斗/发射器先 `unknown`。
- 不承诺“追踪所有来路”。

---

## 9. 完整 NBT 与离线背包修改

### 9.1 完整 NBT 模型

- 物品 NBT 用 SNBT 文本表示；`NBT.parseSNBT(snbt)` 解析，`nbt.toSNBT()` 序列化。
- 影子物品字段：`h`（摘要）、`nbt`（小 NBT 内联）、`nbtRef`（大 NBT）、`nbtSize`、`nbtOmitted`。
- 小 NBT 阈值默认 64KB；单物品上限 512KB；单备份总 NBT 上限 8MB。
- 超限不静默截断：`nbtOmitted=true`，页面显示“NBT 过大”；大 NBT 存 `nbt` 列族并由 `nbtRef` 取。

### 9.2 捕获时机

1. **种子/分钟备份**：读取占用槽位的 NBT；小内联、大 ref。
2. **按需刷新**：`item.nbt.refresh` 动作读取当前槽位 NBT，回写本地存储/网页端。
3. **编辑前必读**：任何 NBT 编辑先读当前 NBT，基于最新值修改，避免覆盖并发变化。

不在每次 `onInventoryChange` 里 `toSNBT()`；事件只更新摘要/短字段。

### 9.3 查看

- 物品详情返回 `nbt`/`nbtRef`/`nbtSize`/`nbtOmitted`。
- 大 NBT 通过 `GET /api/v1/nbt/<ref>` 单独取；ref 不存在返回 404，不返回空 NBT。
- 只读权限 `inventory.read`；NBT 可能含敏感文本，按权限显示。

### 9.4 编辑

```
网页提交 SNBT
  → NBT.parseSNBT 语法/类型/大小校验
  → 权限 + 危险级别 + 确认
  → 读当前 NBT（在线/离线）
  → item.setNbt 或离线 NBT 写回
  → 重新读取校验
  → pre-edit 备份 + 审计
```

- 只允许改背包/盔甲/副手/末影箱内物品 NBT；不允许改玩家 NBT 其他顶层标签。
- 解析失败 400；不写半成品；超限拒绝。
- 审计记录 NBT 哈希/大小，不默认记录完整敏感文本。

### 9.5 在线/离线目标

| 目标 | 路径 |
|---|---|
| 在线 | `Player.getInventory()/getArmor()/getOffHand()/getEnderChest()` |
| 离线（BDS 开） | `data.xuid2uuid(xuid)` → `mc.getPlayerNbt(uuid)` → 改 `Inventory`/`Armor`/`Offhand`/`EnderChestInventory` → `mc.setPlayerNbtTags(uuid, nbt, tags)` |
| BDS 关 | 形态 B 队列 `queued_offline`；开服后执行 |

### 9.6 离线写入约束

- 写入前检查玩家是否在线；已在线改走在线路径，避免离线 NBT 覆盖在线状态。
- 写入后重新读取校验；失败不重试覆盖。
- 用 `setPlayerNbtTags` 只覆盖背包相关标签，不整份覆盖玩家 NBT。
- 写前 `pre-edit` 备份；失败可回滚。
- 离线修改需 `inventory.write` + 确认；默认 admin。
- 复杂物品（潜影盒）按 SNBT 整体替换；不做部分字段合并。
- 玩家下次进服生效，页面提示。

### 9.7 BDS 关闭时的队列（仅形态 B）

- 只有在部署了单独挂载网页端 `webbundle-web` 时才存在；形态 A 没有 BDS 关闭后的网页，也没有队列。
- 动作状态 `queued_offline`；页面显示“开服后执行”。
- 插件 `onServerStarted` 从 `webbundle-web` 拉取队列；目标在线走在线路径，离线走 NBT 路径。
- 结果回写；TTL 24 小时；可取消；过期 `expired`。
- 不在网页端直接改世界存档。

### 9.8 冲突与回滚

- 每玩家一把逻辑锁；离线写入前后检查在线状态。
- 玩家在写入期间进服 → 任务失败/转在线重试；不覆盖在线。
- `pre-edit` 备份存 `reason=pre-edit`；回滚用同一动作。
- 所有离线修改审计；页面可见任务与结果。

### 9.9 外部链入 API（RemoteCall，v2）

v1 不对外导出 RemoteCall；其他插件读数据走网页 API 或等 v2。v2 计划：`apiVersion/getOnlinePlayers/getInventory/queryFlow/submitCommand/getTask`，JSON 字符串，只读备份，按插件计量 QPS。

---

## 10. 代码风格、许可证与注释

### 10.1 许可证

- 项目整体 `GPL-3.0-or-later`；每个源文件 SPDX 头。
- 前端、文档、构建脚本同许可证；第三方依赖 `NOTICE`。
- v1 依赖：RocksDB、cpp-httplib（内置页/网页端）、Zstandard、Protobuf、SQLite（可选）。
- v2 候选：librdkafka、hiredis、MongoDB C Driver、axum/tokio/serde。

```js
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 WebBundle contributors
```

### 10.2 注释

- 解释约束/坑/取舍，不复述代码。
- 中文为主；专有名词保留英文。
- 不使用对话式、工具生成痕迹或非技术性措辞。
- 不写对话式客套；TODO 必须带负责人/issue。
- 不保留大段注释掉的旧代码。

CI：`tools/lint-comments.mjs` 扫禁用词与 SPDX 头。

### 10.3 代码约定

| 项 | 约定 |
|---|---|
| 缩进 | 4 空格（qjs）；前端 2 空格 |
| 行宽 | 100 |
| 分号 | 必写 |
| 命名 | camelCase / PascalCase / UPPER_SNAKE |
| 模块 | 单文件 ≤400 行，单函数 ≤60 行 |
| 错误 | 不空吞；记录或返回错误码 |
| 日志 | 结构化字段；敏感字段脱敏 |
| 时间 | 领域层注入 clock |
| 随机 | 领域层注入；不用 Math.random 生成令牌 |

JSDoc + `tsc --noEmit --checkJs` 静态检查。

---

## 11. 测试

### 11.0 运行时探针（先于实现）

按 [00 §3](00-v1范围与运行时探针.md) 跑 A–H：

- A 推送/轮询对 tick；
- B onInventoryChange；
- C listKey（Lite）；
- D 令牌随机性；
- E 完整 NBT 成本；
- F 离线 NBT 读写；
- G 冷查看/动作队列；
- H 网页端静态+并发。

### 11.1 单元测试

- `domain/` 在 Node 22 下运行，不加载 BDS。
- 覆盖：物品规范化、槽位差、分钟桶、命令状态机、NBT 校验/大小、离线列表对齐、审计。
- 属性测试：任意槽位变化序列，影子状态等于逐步应用结果。

### 11.2 集成测试

- `tests/harness/lse-mock.js` 模拟 `mc.listen`、`ll`、`network`、NBT API。
- 假玩家驱动事件，断言推送、动作队列、备份、NBT 捕获。
- 离线 NBT 测试：mock `getPlayerNbt/setPlayerNbtTags`，覆盖在线/离线/冲突。
- 模块 API 契约：fixture 模块注册动作/页面/事件/KV，宿主加载/隔离/卸载。

### 11.3 负载测试

- 500 玩家 × 2 次槽位变化/秒 × 10 分钟。
- 100 玩家 × 分钟备份 + 20% 变化。
- 100 个带 NBT 物品的备份；大 NBT ref。
- 冷查看并发 + 推送写入。
- 断言：事件 p99、tick 预算、内存、队列、备份覆盖率、NBT 延迟。

### 11.4 测试不做什么

- 不在单元测试启动 BDS。
- 不 mock 领域规则。
- 不用“跑通就算过”的手工脚本替代断言。

---

## 12. 扩展点与限制

| 扩展点 | 方式 | 限制 |
|---|---|---|
| 新增页面 | `ctx.pages.register` + 网页端静态资源 | 需重新构建前端 |
| 新增只读 API | 核心 `/api/v1`（不允许模块自定义） | v1 无模块 HTTP |
| 新增写操作 | `ctx.actions.register` | 必须 schema/权限/危险级别 |
| 新增游戏内命令 | `ctx.commands.register` | 走宿主权限/审计 |
| 新增物品去向归因 | 监听事件，宿主用例汇总 | v1 不开放模块服务 |
| 新增存储后端 | 本地/网页端适配器 | v1 只 RocksDB/Lite |
| 新增通知渠道 | 监听事件 + 网页端 | 不得阻塞事件 |

已知限制：

- v1 不开放第三方模块；代码更新需重建注册表并重启。
- 形态 A 内置页只在 BDS 运行时；形态 B 才提供 BDS 关闭后的冷查看。
- 大 NBT 走 ref；超限拒绝，不静默截断。
- 离线修改在 BDS 关闭时只排队，不直接改存档。
- 末影箱/副手低频；合成实验性。
- v1 不做外部 Web/多服/Redis/Mongo/Kafka；见 06。

---

## 13. 验收清单（插件层）

- [ ] 探针 A–H 有结论；依赖假设的段落已修订。
- [ ] 入口能在 LSE QuickJS 下加载；`onServerStarted` 前不访问 `Player`；`onUnload` 幂等。
- [ ] 插件不监听 HTTP；推送到本地存储/`webbundle-web`；动作轮询异步，不卡 tick。
- [ ] 影子状态由槽位事件维护；分钟备份不读全量背包。
- [ ] 完整 NBT 捕获/查看/编辑；大 NBT ref；不静默截断。
- [ ] 在线背包/NBT 修改成功；离线玩家（BDS 开）修改成功；BDS 关时排队、开服执行。
- [ ] 离线修改有 pre-edit 备份、权限、确认、审计、冲突检查。
- [ ] 模块 API 缩小：无 `services`、无模块 HTTP、第三方不加载；配额生效。
- [ ] 命令白名单/危险级别/确认/幂等/审计生效；`give/clear/replaceitem/enchant` 需 `inventory.write`。
- [ ] 物品去向 drop/pickup 可归因；合成默认关闭/实验性；其他 `unknown`。
- [ ] 审计单队列；服务端/纯 JS 哈希；断链/积压告警。
- [ ] 单文件 ≤400 行、单函数 ≤60 行；domain 覆盖率 ≥80%。
- [ ] 所有源文件 SPDX；注释扫描通过。
