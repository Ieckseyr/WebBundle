// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 WebBundle contributors

import { loadConfig, log, readJson, JSON_DIR } from "./core.js";
import { Store } from "./store.js";
import { Recorder } from "./snapshot.js";
import { ContainerTracker } from "./containers.js";
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
        app.containers = new ContainerTracker(app);
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
        setTimeout(() => {
            try {
                app.store.pruneFlow();
                app.store.pruneContainers();
            } catch (e) {
                log("warn", "物品去向保留期清理失败: " + e.message);
            }
        }, 5000);
        try {
            if (typeof ll !== "undefined" && ll && typeof ll.onUnload === "function") {
                ll.onUnload(() => app.dispose());
                log("info", "卸载钩子已注册");
            } else {
                log("warn", "ll.onUnload 不可用: " + (typeof ll !== "undefined" ? typeof ll.onUnload : "no ll"));
            }
        } catch (e) {
            log("warn", "注册卸载钩子失败: " + e.message);
        }
        app.bindEvents();
        app.containers.start();
        log("info", "已加载，serverId=" + app.config.serverId + "，Web=" +
            (app.config.web.enabled ? app.config.web.host + ":" + app.config.web.port : "off"));
    };

    app.bindEvents = function () {
        mc.listen("onJoin", (player) => {
            app.shadow.onJoin(player);
            try {
                if (app.logistics && typeof app.logistics.onJoin === "function") app.logistics.onJoin(player);
            } catch (e) {  }
        });

        mc.listen("onLeft", (player) => {
            app.shadow.onLeft(player);
            try {
                if (app.logistics && typeof app.logistics.onLeft === "function") app.logistics.onLeft(player);
            } catch (e) {  }
        });

        mc.listen("onInventoryChange", (player, slot, oldItem, newItem) => {
            app.shadow.onInventoryChange(player, slot, oldItem, newItem);
            try {
                if (app.logistics && typeof app.logistics.onInventoryChange === "function") {
                    app.logistics.onInventoryChange(player, slot, oldItem, newItem);
                }
            } catch (e) {  }
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
                    } catch (e) {  }
                }
            }, 1500);
        });
    };

    app.dispose = function () {
        try {
            if (app.external) app.external.stop();
        } catch (e) {  }
        try {
            if (app.web) app.web.stop();
        } catch (e) {  }
        try {
            app.shutdown();
        } catch (e) {
            log("warn", "关服清理失败: " + e.message);
        }
    };

    app.shutdown = function () {
        if (!app.started) return;
        app.started = false;
        log("info", "关服清理开始：停止网页、推送并落盘");
        try {
            if (app.external) app.external.stop();
        } catch (e) {
            log("warn", "停止外部推送失败: " + e.message);
        }
        try {
            if (app.web) app.web.stop();
        } catch (e) {
            log("warn", "停止内置网页失败: " + e.message);
        }
        try {
            app.recorder.captureAll("shutdown");
            log("info", "关服前最后备份已写入");
        } catch (e) {
            log("warn", "关服备份失败: " + e.message);
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
