// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 WebBundle contributors

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


export function onServerStop() {
    try { app.dispose(); } catch (e) { }
}

export function onUnload() {
    try { app.dispose(); } catch (e) { }
}
