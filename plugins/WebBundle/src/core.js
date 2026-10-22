// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 WebBundle contributors

const PLUGIN = "WebBundle";
const PLUGIN_DIR = "plugins/WebBundle";
const DATA_DIR = PLUGIN_DIR + "/data";
const JSON_DIR = PLUGIN_DIR + "/src/json";
const LEGACY_DIR = "WebBundleData";
const LEGACY_CONFIG = LEGACY_DIR + "/config.json";
const CONFIG_PATH = DATA_DIR + "/config.json";

const DEFAULT_CONFIG = {
    serverId: "auto",
    serverName: "",
    purgePlayers: ["ProbeBot"],
    web: {
        enabled: true,
        host: "0.0.0.0",
        port: 19380,
        token: "",
        role: "admin"
    },
    storage: {
        driver: "kv",
        dbPath: DATA_DIR + "/db",
        indexLimit: 3000
    },
    external: {
        enabled: false,
        url: "",
        token: "",
        pollSec: 2
    },
    nbt: {
        inlineMaxKB: 256,
        itemMaxKB: 4096
    },
    command: {
        deny: ["stop", "op", "deop", "ban", "ban-ip", "whitelist", "ll"]
    }
};

function log(level, msg) {
    const line = "[" + PLUGIN + "] " + msg;
    try {
        if (level === "error" && typeof logger !== "undefined" && logger.error) logger.error(line);
        else if (level === "warn" && typeof logger !== "undefined" && logger.warn) logger.warn(line);
        else if (typeof logger !== "undefined" && logger.info) logger.info(line);
        else if (typeof log === "function") log(line);
    } catch (e) {
        // 日志失败不影响主流程
    }
}

function ensureDir(path) {
    try {
        if (!File.exists(path)) File.mkdir(path);
    } catch (e) {
        log("warn", "创建目录失败: " + path + " " + e.message);
    }
}

function readJson(path, fallback) {
    try {
        if (!File.exists(path)) return fallback;
        const text = File.readFrom(path);
        if (!text) return fallback;
        return JSON.parse(text);
    } catch (e) {
        log("warn", "读取 JSON 失败: " + path + " " + e.message);
        return fallback;
    }
}

function writeJson(path, value) {
    try {
        const dir = path.substring(0, path.lastIndexOf("/"));
        if (dir) ensureDir(dir);
        File.writeTo(path, JSON.stringify(value, null, 2));
        return true;
    } catch (e) {
        log("error", "写入 JSON 失败: " + path + " " + e.message);
        return false;
    }
}

function merge(defaults, saved) {
    const out = {};
    for (const key of Object.keys(defaults)) {
        const d = defaults[key];
        const s = saved ? saved[key] : undefined;
        if (d && typeof d === "object" && !Array.isArray(d) && s && typeof s === "object" && !Array.isArray(s)) {
            out[key] = merge(d, s);
        } else {
            out[key] = s === undefined ? d : s;
        }
    }
    if (saved) {
        for (const key of Object.keys(saved)) {
            if (!(key in out)) out[key] = saved[key];
        }
    }
    return out;
}

function loadConfig() {
    ensureDir(DATA_DIR);
    if (!File.exists(CONFIG_PATH) && File.exists(LEGACY_CONFIG)) {
        const legacy = readJson(LEGACY_CONFIG, null);
        if (legacy && legacy.storage && legacy.storage.dbPath === LEGACY_DIR + "/db") {
            legacy.storage.dbPath = DATA_DIR + "/db";
        }
        if (legacy) writeJson(CONFIG_PATH, legacy);
    }
    const saved = readJson(CONFIG_PATH, null);
    const config = merge(DEFAULT_CONFIG, saved || {});
    if (!config.serverId || config.serverId === "auto") {
        config.serverId = "srv-" + String(system.randomUuid()).replace(/-/g, "").substring(0, 8);
    }
    if (!config.web.token) {
        config.web.token = String(system.randomUuid()).replace(/-/g, "") +
            String(system.randomUuid()).replace(/-/g, "").substring(0, 16);
        config.web.tokenIsNew = true;
    } else {
        config.web.tokenIsNew = false;
    }
    const persisted = JSON.parse(JSON.stringify(config));
    delete persisted.web.tokenIsNew;
    writeJson(CONFIG_PATH, persisted);
    return config;
}

function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ("00000000" + h.toString(16)).slice(-8);
}

function itemKey(item) {
    if (!item) return "";
    return (item.t || "?") + ":" + (item.a || 0) + ":" + (item.h || "");
}

function cloneJson(value) {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch (e) {
        return null;
    }
}

function newId(prefix) {
    return prefix + "-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 0xffff).toString(36);
}

export {
    PLUGIN,
    PLUGIN_DIR,
    DATA_DIR,
    JSON_DIR,
    CONFIG_PATH,
    DEFAULT_CONFIG,
    log,
    ensureDir,
    readJson,
    writeJson,
    loadConfig,
    fnv1a,
    itemKey,
    cloneJson,
    newId
};
