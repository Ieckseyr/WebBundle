![WebBundle](WebBundle.svg)

# WebBundle 网页查包

> 随 `plugins/WebBundle` 发布 · `app.css?v=122` / `app.js?v=122`

BDS 背包查验、备份、还原、物品去向、网页指令和操作审计。

```text
内置网页：BDS + 插件 + LSE HttpServer
          http://服务器IP:19380/

独立网页：BDS ──推送──▶ webbundle-web（Node.js）
          http://服务器IP:8080/
```

内置网页随 BDS 停止而不可用；独立端可查看最后一次同步数据。

---

## 安装

1. 将源码中的 `plugins/WebBundle/` 复制到服务器 `plugins/`。
2. 启动 BDS。
3. 打开 `http://服务器IP:19380/`。
4. 首次创建管理员时，填写 `config.json` 中的 `web.token`。

独立端：

```bash
plugins/WebBundle/web/StartStandalone.bat
```

打开 `http://服务器IP:8080/`。

端口：`19380`、`8080`。

---

## 配置

| 文件 | 说明 |
| --- | --- |
| `plugins/WebBundle/data/config.json` | 内置端 |
| `plugins/WebBundle/standalone/config.json` | 独立端 |

完整字段、端口、路径和首次设置说明见：

[CONFIG.md](CONFIG.md)

---

## 功能

- 在线/离线背包、装备、副手、末影箱
- 物品图标、Lore、附魔、耐久、完整 NBT
- 在线/离线修改与还原
- 分钟/手动/进服/退服/关服备份
- 备份时间带完整日期，全服备份按文件夹分组
- 全服备份文件夹与玩家备份侧边栏
- 物品去向保留 30 天、分页、时间范围查询
- 全服玩家流动总结与同物品合并
- 网页指令、操作审计
- 扩展侧边栏页面
- 移动端布局

快照查看只读；修改前先还原到实时背包。

---

## 文档

- [CONFIG.md](CONFIG.md)：完整配置
- [API.md](API.md)：HTTP API、动作、鉴权、扩展接口
