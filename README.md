![WebBundle](plugins/WebBundle/WebBundle.svg)

# WebBundle

BDS 26.x + LeviLamina + LegacyScriptEngine QuickJS 的网页查包工具。

- 在线/离线背包、装备、副手、末影箱
- 完整 NBT、Lore、附魔、耐久
- 分钟/手动/进服/退服/关服备份
- 备份时间带完整日期
- 全服备份文件夹、玩家备份侧边栏
- 物品去向保留 30 天、分页、时间范围查询
- 全服玩家流动总结、同物品合并
- 容器地图、邻近合并、3D 分层视图、历史容器
- 地图最多 100 个标点，优先显示视野中心附近
- 网页指令、操作审计
- 扩展侧边栏页面
- 内置网页 + 独立 Node.js 网页端

## 目录

```text
plugins/WebBundle/            BDS 插件与内置网页
plugins/WebBundle/standalone/ 独立网页端
docs/网页查包/                设计与开发文档
```

## 快速开始

1. 将 `plugins/WebBundle/` 放到服务器 `plugins/`。
2. 启动 BDS。
3. 打开 `http://服务器IP:19380/`。
4. 首次创建管理员时填写 `plugins/WebBundle/data/config.json` 的 `web.token`。

独立网页端：

```bash
cp plugins/WebBundle/standalone/config.example.json plugins/WebBundle/standalone/config.json
node plugins/WebBundle/standalone/server.js
```

打开 `http://服务器IP:8080/`。

## 文档

- [插件 README](plugins/WebBundle/README.md)
- [配置](plugins/WebBundle/CONFIG.md)
- [API](plugins/WebBundle/API.md)
- [文档索引](docs/网页查包/README.md)

## 许可证

GPL-3.0-or-later，见 [LICENSE](LICENSE)。

运行时的 `data/`、数据库、Token、玩家数据和日志不纳入仓库。
