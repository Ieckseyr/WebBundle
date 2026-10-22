# webbundle-web（单独挂载网页端）

BDS 停止后仍能查看最后备份的独立网页端。它不是插件的一部分；**不部署/不启动它，就没有离线查看**。

## 运行

```bash
node tools/webbundle-web/server.js
```

首次启动生成 `config.json`，**不生成默认账号密码**。用本机浏览器打开：

```
http://127.0.0.1:8080
```

打开 `/` 会直接渲染独立网页端画面：没有会话时显示页内登录，不会先重定向到插件或 BDS。

如果还没有管理员账号，打开 `/setup`。首次创建管理员必须填写 BDS `config.json` 的 `web.token`；独立端会通过 `bdsUrl/api/v1/meta` 验证，因此 BDS 需要在线。密码只保存 PBKDF2-SHA256 哈希和随机盐，不写入配置文件、不打印、不回显。登录后使用 HttpOnly + SameSite=Strict 的 Cookie。

```json
{
  "listen": "127.0.0.1:8080",
  "pushToken": "...",
  "dataPath": "./data/store.json",
  "staleMs": 15000,
  "bdsUrl": "http://127.0.0.1:19380"
}
```

- `listen`：网页监听地址；公网经反向代理 + TLS。
- `pushToken`：插件推送/拉取动作的机器令牌，与浏览器账号分开。
- `staleMs`：超过多久没有心跳就认为 BDS 离线，页面进入冷查看。

## 接入插件

在 `plugins/WebBundle/data/config.json`：

```json
"external": {
  "enabled": true,
  "url": "https://panel.example.com",
  "token": "<pushToken>",
  "pollSec": 2
}
```

插件会推送快照/心跳/审计，并轮询 `queued_offline` 动作。BDS 停止后网页仍能读 `data/store.json` 里的最后数据。

## 页面与 API

- 页面：总览、玩家背包、物流、指令、审计、任务、备份、设置；与内置页共用 `plugins/WebBundle/web/index.html`。
- `index` 直接渲染：不依赖插件启动，也不需要先请求 `/api/v1/meta`；无数据时显示空玩家/冷查看状态。
- 最后时刻：BDS 停止/心跳失效后，冷查看顶部出现「最后时刻」，显示关服时间、最后玩家、物品数和每人的最后快照；可直接进入最后背包。
- 入口：内置页检测到独立端在线时显示「独立网页 ↗」。
- 新增聚合接口：`GET /api/v1/overview`、`GET /api/v1/tasks`、`GET /api/v1/last-moment`。
- 推送新增 `POST /push/v1/shutdown`，用于立即标记关服；插件卸载时也会尝试推送最后快照。
- 附魔写入使用 `POST /api/v1/actions/item.enchants.set`，独立端只创建 `queued_offline` 任务，开服后由插件执行。
- 登录页使用 `/app.css` 的白底主题；`/style.css` 只作旧页面兼容保留。

## 安全边界

- 没有默认账号，没有默认密码，没有可被直接看到的初始凭据。
- 首次设置只允许本机；远程部署请用 SSH 隧道完成首次设置。
- 浏览器账号与 `pushToken` 分离；`pushToken` 只用于插件。
- 密码使用 PBKDF2-SHA256（15 万次）哈希，随机 16 字节盐；不存明文。
- 会话 Cookie：`HttpOnly`、`SameSite=Strict`、12 小时过期；HTTPS 下加 `Secure`。
- 登录失败按 IP 限速；5 分钟内 8 次失败后暂时拒绝。
- 它不直接改世界存档；动作排队，开服后由插件执行。
- 未启动它时，BDS 停止后没有任何网页可用，这是预期行为。

## 登录

独立端 `/login` 优先使用内置网页的账号密码：

- 向 `bdsUrl + /api/v1/auth/status` 读取盐与迭代次数
- 在 Node 端计算 PBKDF2 verifier
- 调用内置端 `/api/v1/auth/login`
- 成功后建立独立端自己的会话 Cookie

BDS 未运行时才回退到独立端本地账号。退出登录会清除独立端会话，`/` 会重新跳转到 `/login`。

```json
{
  "bdsUrl": "http://127.0.0.1:19380"
}
```
