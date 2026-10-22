// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 WebBundle contributors

import { loadConfig, log, readJson, JSON_DIR } from "./core.js";
import { Store } from "./store.js";
import { Recorder } from "./snapshot.js";
import { Shadow } from "./shadow.js";
import { Actions } from "./actions.js";
import { ModuleHost } from "./modules/host.js";
import { ExtensionRegistry } from "./extensions.js";
import { commandModule } from "./modules/command.js";
import { logisticsModule } from "./modules/logistics.js";
import { Web } from "./web.js";
import { External } from "./external.js";

function createApp() {
    const app = {
        config: null,
        store: null,
        recorder: null,
        shadow: null,
        actions: null,
        modules: null,
        extensions: null,
        logistics: null,
        web: null,
        external: null,
        state: {
            players: new Map(),
            playersMeta: new Map(),
            flow: []
        },
        started: false
    };

    app.start = function () {
        if (app.started) return;
        app.started = true;
        app.config = loadConfig();
        if (app.config.web.tokenIsNew) {
            log("info", "首次启动，Web 令牌: " + app.config.web.token);
            log("info", "令牌已写入 " + "plugins/WebBundle/data/config.json，请妥善保存");
        }
        app.store = new Store(app.config);
        app.itemTranslations = () => readJson(JSON_DIR + "/item-translations.json", {});
        try {
            const purged = app.store.purgePlayerNames(app.config.purgePlayers);
            if (purged) log("info", "已清理测试玩家记录: " + purged);
        } catch (e) {
            log("warn", "清理测试玩家失败: " + e.message);
        }
        app.recorder = new Recorder(app);
        app.extensions = new ExtensionRegistry(app);
        app.modules = new ModuleHost(app);
        app.modules.register(commandModule);
        app.modules.register(logisticsModule);
        app.modules.start();
        app.logistics = app.modules.get("logistics");
        app.shadow = new Shadow(app);
        app.actions = new Actions(app);
        app.web = new Web(app);
        app.external = new External(app);

        app.web.start();
        app.external.start();
        try {
            if (typeof ll !== "undefined" && ll && typeof ll.onUnload === "function") {
                ll.onUnload(() => app.shutdown());
            }
        } catch (e) {
            log("warn", "注册卸载钩子失败: " + e.message);
        }
        app.bindEvents();
        log("info", "已加载，serverId=" + app.config.serverId + "，Web=" +
            (app.config.web.enabled ? app.config.web.host + ":" + app.config.web.port : "off"));
    };

    app.bindEvents = function () {
        mc.listen("onJoin", (player) => {
            app.shadow.onJoin(player);
            try {
                if (app.logistics && typeof app.logistics.onJoin === "function") app.logistics.onJoin(player);
            } catch (e) { /* 合成缓存初始化失败不影响背包 */ }
        });

        mc.listen("onLeft", (player) => {
            app.shadow.onLeft(player);
            try {
                if (app.logistics && typeof app.logistics.onLeft === "function") app.logistics.onLeft(player);
            } catch (e) { /* 清理合成缓存失败不影响退服 */ }
        });

        mc.listen("onInventoryChange", (player, slot, oldItem, newItem) => {
            app.shadow.onInventoryChange(player, slot, oldItem, newItem);
            try {
                if (app.logistics && typeof app.logistics.onInventoryChange === "function") {
                    app.logistics.onInventoryChange(player, slot, oldItem, newItem);
                }
            } catch (e) { /* 合成事件检查失败不影响背包 */ }
        });

        mc.listen("onSetArmor", (player, slot, item) => {
            app.shadow.onSetArmor(player, slot, item);
        });

        mc.listen("onDropItem", (player, item) => {
            app.logistics.drop(player, item);
        });

        mc.listen("onTakeItem", (player, entity, item) => {
            app.logistics.pickup(player, entity, item);
        });

        mc.listen("onTick", () => {
            try {
                app.shadow.tick();
                app.actions.tick();
                app.external.tick();
            } catch (e) {
                log("error", "tick 异常: " + e.message);
            }
        });

        mc.listen("onServerStarted", () => {
            log("info", "服务器已启动，开始采集");
            setTimeout(() => {
                for (const player of mc.getOnlinePlayers()) {
                    app.shadow.onJoin(player);
                    try {
                        if (app.logistics && typeof app.logistics.onJoin === "function") app.logistics.onJoin(player);
                    } catch (e) { /* 合成缓存初始化失败 */ }
                }
            }, 1500);
        });
    };

    app.shutdown = function () {
        if (!app.started) return;
        try {
            app.recorder.captureAll("shutdown");
            log("info", "关服前最后备份已写入");
        } catch (e) {
            log("warn", "关服备份失败: " + e.message);
        }
        try {
            if (app.external) app.external.shutdown();
        } catch (e) {
            log("warn", "关服推送失败: " + e.message);
        }
    };

    app.findPlayer = function (xuid) {
        try {
            return mc.getPlayer(String(xuid)) || null;
        } catch (e) {
            return null;
        }
    };

    return app;
}

export { createApp };
