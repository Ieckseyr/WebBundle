// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 WebBundle contributors

import { log } from "../core.js";

// 模块宿主只加载内置模块。模块之间不互相发现，统一通过 ctx 暴露的能力工作。
class ModuleHost {
    constructor(app) {
        this.app = app;
        this.modules = new Map();
        this.apis = new Map();
    }

    register(module) {
        if (!module || !module.id || typeof module.setup !== "function") {
            throw new Error("模块定义无效");
        }
        if (this.modules.has(module.id)) {
            throw new Error("模块重复注册: " + module.id);
        }
        this.modules.set(module.id, module);
        return this;
    }

    start() {
        for (const module of this.modules.values()) this.startModule(module);
    }

    startModule(moduleOrId) {
        const module = typeof moduleOrId === "string" ? this.modules.get(moduleOrId) : moduleOrId;
        if (!module) return null;
        try {
            const api = module.setup(this.context(module.id)) || {};
            this.apis.set(module.id, api);
            if (Array.isArray(module.web)) {
                for (const page of module.web) {
                    this.app.extensions.register(Object.assign({ module: module.id }, page));
                }
            }
            return api;
        } catch (e) {
            log("error", "模块启动失败 " + module.id + ": " + e.message);
            return null;
        }
    }

    get(id) {
        return this.apis.get(id) || null;
    }

    list() {
        const out = [];
        for (const module of this.modules.values()) {
            out.push({ id: module.id, name: module.name || module.id, version: module.version || "1.0.0" });
        }
        return out;
    }

    context(id) {
        const app = this.app;
        return {
            id: id,
            log: log,
            config: app.config,
            store: app.store,
            app: app,
            events: {
                on: (name, callback) => mc.listen(name, callback)
            },
            kv: {
                get: (key, fallback) => app.store.get("module:" + id + ":" + key, fallback),
                set: (key, value) => app.store.set("module:" + id + ":" + key, value)
            },
            web: {
                registerPage: (page) => app.extensions.register(Object.assign({ module: id }, page || {})),
                unregisterPage: (pageId) => app.extensions.unregister(id, pageId),
                extensions: app.extensions
            }
        };
    }
}

export { ModuleHost };
