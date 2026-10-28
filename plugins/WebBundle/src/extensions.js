// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 WebBundle contributors

import { log } from "./core.js";

function text(value, max) {
    return String(value == null ? "" : value).slice(0, max);
}

function keyPart(value) {
    const raw = String(value || "").trim();
    return /^[A-Za-z0-9_.-]{1,48}$/.test(raw) ? raw : "";
}

class ExtensionRegistry {
    constructor(app) {
        this.app = app;
        this.pages = new Map();
    }

    register(definition) {
        const def = definition && typeof definition === "object" ? definition : {};
        const module = keyPart(def.module || def.moduleId || "external");
        const id = keyPart(def.id || def.page || "");
        if (!module || !id) throw new Error("扩展页面需要 module 和 id");
        const key = module + ":" + id;
        const page = {
            key: key,
            module: module,
            id: id,
            label: text(def.label || def.name || id, 32) || id,
            title: text(def.title || def.label || id, 80) || id,
            icon: text(def.icon || "", 4096),
            html: text(def.html || "", 1024 * 1024),
            css: text(def.css || "", 512 * 1024),
            script: text(def.script || "", 1024 * 1024),
            order: Number.isFinite(Number(def.order)) ? Number(def.order) : 1000
        };
        this.pages.set(key, page);
        log("info", "扩展页面已注册: " + key + " (" + page.label + ")");
        try { if (this.app.external && this.app.external.enabled) this.app.external.pushExtensions(); } catch (e) {  }
        return page;
    }

    unregister(module, id) {
        return this.pages.delete(String(module || "") + ":" + String(id || ""));
    }

    get(key) {
        return this.pages.get(String(key || "")) || null;
    }

    list() {
        return Array.from(this.pages.values()).sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
    }
}

export { ExtensionRegistry };
