// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 WebBundle contributors

// LSE QuickJS 的入口模块以服务器根目录解析相对导入。
// 入口只做组装，具体逻辑在 src/app.js。
import { createApp } from "./plugins/WebBundle/src/app.js";

export const INFO = {
    name: "WebBundle",
    version: [1, 0, 0],
    author: "WebBundle contributors"
};

const app = createApp();
app.start();

export function getPlayers() {
    try { return app.store.listPlayers(); } catch (e) { return []; }
}

export function getItemTranslations() {
    try { return app.itemTranslations ? app.itemTranslations() : {}; } catch (e) { return {}; }
}

export function translateItem(type) {
    try {
        const short = String(type || "").replace("minecraft:", "");
        const table = getItemTranslations();
        return (table.items && table.items[short]) || (table.english && table.english[short]) || "";
    } catch (e) {
        return "";
    }
}

export function registerWebPage(definition) {
    if (!app.extensions) throw new Error("WebBundle 尚未启动");
    return app.extensions.register(definition);
}

export function unregisterWebPage(moduleId, pageId) {
    if (!app.extensions) return false;
    return app.extensions.unregister(moduleId, pageId);
}

export function registerModule(module) {
    if (!app.modules) throw new Error("WebBundle 尚未启动");
    app.modules.register(module);
    return app.modules.startModule(module);
}


// LSE 生命周期：先停网页/推送并落盘，避免 QuickJS 回调在运行时释放后销毁。
export function onServerStop() {
    try { app.shutdown(); } catch (e) { }
}

export function onUnload() {
    try { app.shutdown(); } catch (e) { }
}
