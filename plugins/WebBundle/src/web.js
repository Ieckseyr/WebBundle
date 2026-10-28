// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 WebBundle contributors

import { log, readJson, JSON_DIR } from "./core.js";
import { sha256Hex } from "./sha256.js";
import { validUsername } from "./auth.js";

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml"
};

function blockFacing(dim, x, y, z) {
    try {
        const block = mc.getBlock(Number(x), Number(y), Number(z), Number(dim));
        if (!block) return "";
        let state = {};
        try {
            const nbt = block.getNbt ? block.getNbt() : null;
            const states = nbt && nbt.getTag ? nbt.getTag("states") : null;
            state = states && states.toObject ? states.toObject() : (block.getBlockState() || {});
        } catch (e) {
            state = block.getBlockState ? (block.getBlockState() || {}) : {};
        }
        const raw = state["minecraft:facing_direction"] != null ? state["minecraft:facing_direction"] :
            (state.facing_direction != null ? state.facing_direction :
            (state["minecraft:cardinal_direction"] || state.cardinal_direction || state.direction));
        const value = String(raw == null ? "" : raw).toLowerCase();
        if (value === "north" || value === "south" || value === "east" || value === "west" || value === "up" || value === "down") return value;
        const numeric = Number(value);
        return ["down", "up", "north", "south", "west", "east"][numeric] || "";
    } catch (e) {  }
    return "";
}

function blockPair(dim, x, y, z) {
    try {
        const block = mc.getBlock(Number(x), Number(y), Number(z), Number(dim));
        const be = block && block.getBlockEntity ? block.getBlockEntity() : null;
        const nbt = be && be.getNbt ? be.getNbt() : null;
        const obj = nbt && nbt.toObject ? nbt.toObject() : null;
        if (!obj) return null;
        const pairX = Number(obj.pairx);
        const pairZ = Number(obj.pairz);
        if (!Number.isFinite(pairX) || !Number.isFinite(pairZ)) return null;
        return { x: pairX, z: pairZ, lead: !!Number(obj.pairlead), axis: pairX !== Number(x) ? "x" : (pairZ !== Number(z) ? "z" : "") };
    } catch (e) { return null; }
}

class Web {
    constructor(app) {
        this.app = app;
        this.server = null;
        this.assets = new Map();
        this.sessions = new Map();
        this.loginFails = new Map();
        this.account = app.store.get("auth:account", null);
        const storedAccounts = app.store.get("auth:accounts", null);
        this.accounts = Array.isArray(storedAccounts) ? storedAccounts.slice() : (this.account ? [Object.assign({}, this.account, { owner: true })] : []);
        if (this.accounts.length && !this.accounts.some((entry) => entry.owner)) this.accounts[0].owner = true;
        this._overviewCache = null;
    }

    loadAssets() {
        const files = ["index.html", "app.js", "app.css", "style.css", "pbkdf2.js", "textures/items-map.json", "vendor/three.min.js", "vendor/OrbitControls.js"];
        for (const name of files) {
            const path = "plugins/WebBundle/web/" + name;
            try {
                if (File.exists(path)) {
                    this.assets.set("/" + name, { body: File.readFrom(path), type: MIME["." + name.split(".").pop()] || "text/plain" });
                }
            } catch (e) {
                log("warn", "读取静态资源失败: " + path + " " + e.message);
            }
        }
    }

    start() {
        if (!this.app.config.web.enabled) return;
        this.loadAssets();
        this.server = new HttpServer();
        this.server.onOptions("/(.*)", (req, res) => {
            res.status = 204;
            this.cors(res);
            res.write("");
        });
        this.server.onGet("/api/v1/(.*)", (req, res) => this.handleApi(req, res));
        this.server.onPost("/api/v1/(.*)", (req, res) => this.handleApi(req, res));
        this.server.onPost("/api/(.*)", (req, res) => {
            const path = String(req.path || "").replace(/\?.*$/, "");
            if (path === "/api/logout") return this.authLogout(req, res);
            if (path === "/api/login") return this.sendJson(res, 400, { ok: false, error: { code: "USE_V1", message: "请使用 /api/v1/auth/login" } });
            if (path === "/api/setup") return this.sendJson(res, 400, { ok: false, error: { code: "USE_V1", message: "请使用 /api/v1/auth/setup" } });
            return this.sendJson(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "未知接口" } });
        });
        this.server.onGet("/(.*)", (req, res) => this.staticFile(req, res));
        this.server.onException((req, res, msg) => {
            log("error", "Web 异常: " + msg);
            this.sendJson(res, 500, { ok: false, error: { code: "INTERNAL", message: String(msg) } });
        });
        try {
            this.server.listen(this.app.config.web.host, Number(this.app.config.web.port));
            log("info", "内置网页监听 " + this.app.config.web.host + ":" + this.app.config.web.port);
        } catch (e) {
            log("error", "内置网页启动失败: " + e.message);
        }
    }

    stop() {
        const server = this.server;
        this.server = null;
        try {
            if (server && server.isRunning()) server.stop();
        } catch (e) {
        }
    }

    cors(res) {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    }

    sendJson(res, status, body) {
        res.status = status;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("X-Frame-Options", "DENY");
        res.setHeader("Referrer-Policy", "no-referrer");
        res.write(JSON.stringify(body));
    }

    cookie(req, name) {
        try {
            const values = req.getHeader("Cookie");
            if (!values || !values.length) return "";
            const text = Array.isArray(values) ? values.join("; ") : String(values);
            for (const part of text.split(";")) {
                const index = part.indexOf("=");
                if (index < 0) continue;
                if (part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
            }
        } catch (e) {
        }
        return "";
    }

    sessionFor(req) {
        const sid = this.cookie(req, "wb_web_session");
        if (!sid) return null;
        const session = this.sessions.get(sid);
        if (!session) return null;
        if (session.expires <= Date.now()) {
            this.sessions.delete(sid);
            return null;
        }
        session.seen = Date.now();
        return { sid: sid, name: session.name, role: session.role, owner: !!session.owner };
    }

    accountByName(name) {
        return this.accounts.find((entry) => String(entry.username || "") === String(name || "")) || null;
    }

    ownerAccount() {
        return this.accounts.find((entry) => entry.owner) || this.accounts[0] || null;
    }

    isOwner(identity) {
        if (!identity) return false;
        const account = this.accountByName(identity.name);
        return !!(account && account.owner);
    }

    publicAccount(account) {
        return {
            username: account.username,
            role: account.role || "viewer",
            owner: !!account.owner,
            createdAt: Number(account.createdAt || 0)
        };
    }

    identity(req) {
        const token = String(this.app.config.web.token || "");
        const header = req.getHeader("Authorization");
        const value = header && header.length ? String(header[0]) : "";
        if (token && value === "Bearer " + token) {
            const role = String(this.app.config.web.role || "admin");
            return { name: "web-" + role, role: role };
        }
        const session = this.sessionFor(req);
        if (session) return { name: session.name || "admin", role: session.role, owner: !!session.owner, cookie: true };
        return null;
    }

    newSession(name, role) {
        const now = Date.now();
        for (const [sid, session] of Array.from(this.sessions.entries())) {
            if (session.expires <= now) this.sessions.delete(sid);
        }
        const sid = "wb_" + sha256Hex(now + ":" + Math.random() + ":" + Math.random() + ":" + this.sessions.size).slice(0, 40);
        const account = this.accountByName(name);
        this.sessions.set(sid, {
            name: String(name || "web"),
            role: String(role || this.app.config.web.role || "admin"),
            owner: !!(account && account.owner),
            created: now, seen: now, expires: now + 12 * 60 * 60 * 1000
        });
        return sid;
    }

    cookieHeader(req, sid) {
        let secure = "";
        try {
            const proto = req.getHeader("X-Forwarded-Proto");
            if (proto && String(proto[0] || "").toLowerCase() === "https") secure = "; Secure";
        } catch (e) {
            secure = "";
        }
        return "wb_web_session=" + sid + "; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200" + secure;
    }

    isLocal(req) {
        try {
            const addr = String(req.remoteAddr || "");
            if (["127.0.0.1", "::1", "::ffff:127.0.0.1"].indexOf(addr) < 0) return false;
            for (const key of ["X-Forwarded-For", "X-Real-IP", "Forwarded"]) {
                const value = req.getHeader(key);
                if (value && value.length) return false;
            }
            const host = req.getHeader("Host");
            const text = host && host.length ? String(host[0]) : "";
            return /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(text);
        } catch (e) {
            return false;
        }
    }

    safeEqual(a, b) {
        const left = String(a || "");
        const right = String(b || "");
        if (!left || left.length !== right.length) return false;
        let diff = 0;
        for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
        return diff === 0;
    }

    authStatus(req, res) {
        const session = this.sessionFor(req);
        const owner = this.ownerAccount();
        this.sendJson(res, 200, { ok: true, data: {
            setupRequired: !this.accounts.length,
            authenticated: !!session,
            username: session ? session.name : "",
            role: session ? session.role : "viewer",
            owner: !!(session && session.owner),
            accounts: this.accounts.length,
            salt: owner ? owner.salt : "",
            iterations: owner ? Number(owner.iterations || 210000) : 210000,
            algo: "pbkdf2-sha256-client"
        } });
    }

    authSalt(req, res) {
        const username = String(this.query(req, "username", "") || "").trim();
        const account = this.accountByName(username);
        if (!account) {
            this.sendJson(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "账号不存在" } });
            return;
        }
        this.sendJson(res, 200, { ok: true, data: { username: account.username, salt: account.salt, iterations: Number(account.iterations || 210000) } });
    }

    authSetup(req, res) {
        if (this.accounts.length) {
            this.sendJson(res, 409, { ok: false, error: { code: "CONFLICT", message: "管理员账号已存在" } });
            return;
        }
        let body = {};
        try { body = req.body ? JSON.parse(req.body) : {}; } catch (e) { body = {}; }
        const configured = String(this.app.config.web.token || "");
        const provided = String(body.webToken || "");
        if (!configured || !provided || !this.safeEqual(provided, configured)) {
            this.sendJson(res, 403, { ok: false, error: { code: "SETUP_TOKEN", message: "请输入 config.json 中的 web.token" } });
            return;
        }
        const username = String(body.username || "").trim();
        const salt = String(body.salt || "").toLowerCase();
        const verifier = String(body.verifier || "").toLowerCase();
        const iterations = Number(body.iterations || 210000);
        if (!validUsername(username)) {
            this.sendJson(res, 400, { ok: false, error: { code: "VALIDATION", message: "用户名 3-32 位，仅字母数字 _ . -" } });
            return;
        }
        if (!/^[0-9a-f]{32}$/.test(salt) || !/^[0-9a-f]{64}$/.test(verifier)) {
            this.sendJson(res, 400, { ok: false, error: { code: "VALIDATION", message: "密码校验参数无效" } });
            return;
        }
        if (!Number.isFinite(iterations) || iterations < 100000 || iterations > 500000) {
            this.sendJson(res, 400, { ok: false, error: { code: "VALIDATION", message: "KDF 参数无效" } });
            return;
        }
        const record = {
            schema: 2,
            username: username,
            role: String(this.app.config.web.role || "admin"),
            algo: "pbkdf2-sha256-client",
            salt: salt,
            iterations: iterations,
            verifierHash: sha256Hex("webbundle-verifier-v1:" + verifier),
            owner: true,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        this.app.store.set("auth:account", record);
        this.account = record;
        this.accounts = [record];
        this.app.store.set("auth:accounts", this.accounts);
        const sid = this.newSession(username, record.role);
        res.setHeader("Set-Cookie", this.cookieHeader(req, sid));
        this.sendJson(res, 200, { ok: true, data: { username: username, role: record.role, cookie: true } });
    }

    authLogin(req, res) {
        let body = {};
        try { body = req.body ? JSON.parse(req.body) : {}; } catch (e) { body = {}; }
        const ip = String(req.remoteAddr || "");
        const fail = this.loginFails.get(ip);
        if (fail && Date.now() - fail.ts < 5 * 60 * 1000 && fail.count >= 8) {
            this.sendJson(res, 429, { ok: false, error: { code: "RATE_LIMIT", message: "尝试次数过多，请稍后再试" } });
            return;
        }
        const username = String(body.username || "").trim();
        const verifier = String(body.verifier || "").toLowerCase();
        const account = this.accountByName(username);
        const expected = account ? account.verifierHash : "";
        const actual = verifier ? sha256Hex("webbundle-verifier-v1:" + verifier) : "";
        if (!account || !this.safeEqual(expected, actual)) {
            this.loginFails.set(ip, { count: (fail && Date.now() - fail.ts < 5 * 60 * 1000 ? fail.count : 0) + 1, ts: Date.now() });
            this.sendJson(res, 401, { ok: false, error: { code: "UNAUTHORIZED", message: "用户名或密码错误" } });
            return;
        }
        const name = account.username;
        const role = account.role || String(this.app.config.web.role || "admin");
        this.loginFails.delete(ip);
        const sid = this.newSession(name, role);
        res.setHeader("Set-Cookie", this.cookieHeader(req, sid));
        this.sendJson(res, 200, { ok: true, data: { username: name, role: role, cookie: true } });
    }

    authLogout(req, res) {
        const sid = this.cookie(req, "wb_web_session");
        if (sid) this.sessions.delete(sid);
        res.setHeader("Set-Cookie", "wb_web_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
        this.sendJson(res, 200, { ok: true });
    }

    can(identity, permission) {
        const rank = { viewer: 1, operator: 2, admin: 3 };
        const need = {
            "inventory.read": 1, "snapshot.read": 1, "flow.read": 1,
            "map.read": 1, "container.read": 1,
            "inventory.write": 2, "inventory.restore": 2,
            "command.execute": 3, "audit.read": 3, "accounts.manage": 3
        };
        const have = rank[identity && identity.role] || 0;
        return have >= (need[permission] || 3);
    }

    query(req, name, fallback) {
        const v = req.query ? req.query[name] : undefined;
        if (v === undefined) return fallback;
        return Array.isArray(v) ? v[0] : v;
    }

    timeMs(value, fallback) {
        if (value === undefined || value === null || value === "") return fallback;
        const n = Number(value);
        if (Number.isFinite(n) && n > 0) return n;
        const parsed = Date.parse(String(value));
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    flowFilter(req) {
        const now = Date.now();
        let from = this.timeMs(this.query(req, "from", ""), now - 30 * 24 * 3600 * 1000);
        let to = this.timeMs(this.query(req, "to", ""), now);
        if (from > to) {
            const swap = from;
            from = to;
            to = swap;
        }
        return {
            from: from,
            to: to,
            xuid: String(this.query(req, "xuid", "") || ""),
            kind: String(this.query(req, "kind", "") || ""),
            direction: String(this.query(req, "direction", "") || ""),
            item: String(this.query(req, "item", "") || ""),
            q: String(this.query(req, "q", "") || "").trim()
        };
    }

    handleApi(req, res) {
        if (req.method === "OPTIONS") {
            res.status = 204;
            this.cors(res);
            res.write("");
            return;
        }
        const apiPath = String(req.path || "").replace(/^\/api\/v1/, "");
        if (req.method === "GET" && apiPath === "/auth/status") {
            this.authStatus(req, res);
            return;
        }
        if (req.method === "GET" && apiPath === "/auth/salt") {
            this.authSalt(req, res);
            return;
        }
        if (req.method === "POST" && apiPath === "/auth/setup") {
            this.authSetup(req, res);
            return;
        }
        if (req.method === "POST" && apiPath === "/auth/login") {
            this.authLogin(req, res);
            return;
        }
        if (req.method === "POST" && apiPath === "/auth/logout") {
            this.authLogout(req, res);
            return;
        }
        const identity = this.identity(req);
        if (!identity) {
            this.sendJson(res, 401, { ok: false, error: { code: "UNAUTHORIZED", message: "缺少或无效令牌" } });
            return;
        }
        const path = String(req.path || "").replace(/^\/api\/v1/, "");
        try {
            if (req.method === "GET") this.apiGet(path, req, res, identity);
            else if (req.method === "POST") this.apiPost(path, req, res, identity);
            else this.sendJson(res, 405, { ok: false, error: { code: "METHOD", message: "不支持的方法" } });
        } catch (e) {
            log("error", "API 异常 " + path + ": " + e.message);
            this.sendJson(res, 500, { ok: false, error: { code: "INTERNAL", message: e.message } });
        }
    }

    apiGet(path, req, res, identity) {
        const app = this.app;
        if (path === "/meta" || path === "/health") {
            const data = {
                ok: true,
                data: {
                    serverId: app.config.serverId,
                    serverName: app.config.serverName || "BDS",
                    version: "1.1.0",
                    mode: "embedded",
                    server: { online: true, lastSeen: Date.now() },
                    dataAsOf: Date.now(),
                    apiVersion: 1,
                    role: identity ? identity.role : "viewer",
                    user: identity ? identity.name : "",
                    owner: this.isOwner(identity),
                    accounts: this.accounts.length,
                    auth: identity && identity.cookie ? "cookie" : (identity ? "token" : ""),
                    capabilities: ["inventory.live", "snapshot", "nbt", "flow", "command", "actions", "audit", "extensions"],
                    external: app.external ? app.external.status(req) : { enabled: false, url: "", online: false },
                    live: { transport: "poll", intervalMs: 1000 },
                    limits: { pageSize: 200, nbtInlineKB: app.config.nbt.inlineMaxKB }
                }
            };
            this.sendJson(res, 200, data);
            return;
        }

        if (path === "/extensions") {
            if (!this.can(identity, "inventory.read")) { this.sendJson(res, 403, { ok: false, error: { code: "FORBIDDEN", message: "缺少 inventory.read" } }); return; }
            const module = String(this.query(req, "module", "") || "");
            const list = app.extensions ? app.extensions.list() : [];
            this.sendJson(res, 200, { ok: true, data: module ? list.filter((page) => page.module === module) : list });
            return;
        }

        if (path === "/last-moment") {
            if (!this.can(identity, "snapshot.read")) {
                this.sendJson(res, 403, { ok: false, error: { code: "FORBIDDEN", message: "缺少 snapshot.read" } });
                return;
            }
            const players = [];
            let at = 0;
            let totalItems = 0;
            for (const meta of app.store.listPlayers()) {
                const snap = app.store.latestSnapshot(meta.xuid);
                const ts = snap ? Number(snap.ts || 0) : Number(meta.lastSeen || 0);
                at = Math.max(at, ts);
                const itemCount = snap ? Number(snap.itemCount || 0) : 0;
                totalItems += itemCount;
                players.push({
                    xuid: meta.xuid,
                    name: meta.name || "",
                    online: false,
                    lastSeen: meta.lastSeen || 0,
                    snapshotId: snap ? snap.id : "",
                    ts: ts,
                    reason: snap ? (snap.reason || "") : "",
                    itemCount: itemCount
                });
            }
            players.sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0));
            this.sendJson(res, 200, { ok: true, data: {
                at: at,
                server: { id: app.config.serverId, name: app.config.serverName || "BDS" },
                players: players,
                totalItems: totalItems
            } });
            return;
        }

        if (path === "/overview") {
            this.sendJson(res, 200, { ok: true, data: this.overviewData(identity) });
            return;
        }

        if (path === "/tasks") {
            const state = String(this.query(req, "state", "") || "");
            const limit = Number(this.query(req, "limit", 100));
            this.sendJson(res, 200, { ok: true, data: app.actions.list(limit, state) });
            return;
        }

        if (path === "/players") {
            if (!this.can(identity, "inventory.read")) { this.sendJson(res, 403, { ok: false, error: { code: "FORBIDDEN", message: "缺少 inventory.read" } }); return; }
            const online = mc.getOnlinePlayers();
            const map = new Map();
            for (const p of online) {
                const playerName = String(p.name || p.realName || "");
                if (app.store.isBlockedName(playerName)) continue;
                map.set(String(p.xuid), {
                    xuid: String(p.xuid),
                    name: playerName,
                    online: true,
                    lastSeen: Date.now(),
                    dim: p.pos ? p.pos.dimid : 0,
                    pos: p.pos ? { x: p.pos.x, y: p.pos.y, z: p.pos.z } : null
                });
            }
            for (const meta of app.store.listPlayers()) {
                if (!map.has(meta.xuid)) {
                    map.set(meta.xuid, {
                        xuid: meta.xuid,
                        name: meta.name || "",
                        online: false,
                        lastSeen: meta.lastSeen || 0,
                        dim: meta.dim || 0,
                        pos: meta.pos || null
                    });
                }
            }
            const q = String(this.query(req, "q", "") || "").toLowerCase();
            const list = [];
            for (const item of map.values()) {
                if (q && item.name.toLowerCase().indexOf(q) < 0 && item.xuid.indexOf(q) < 0) continue;
                list.push(item);
            }
            list.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "zh-CN") ||
                String(a.xuid).localeCompare(String(b.xuid)));
            this.sendJson(res, 200, { ok: true, data: list });
            return;
        }

        let m = path.match(/^\/players\/([^/]+)\/inventory$/);
        if (m) {
            if (!this.can(identity, "inventory.read")) { this.sendJson(res, 403, { ok: false, error: { code: "FORBIDDEN", message: "缺少 inventory.read" } }); return; }
            const xuid = decodeURIComponent(m[1]);
            const at = this.query(req, "at", "");
            let data = null;
            if (at) {
                const snap = app.store.getSnapshot(at);
                if (snap) {
                    data = {
                        xuid: snap.xuid,
                        name: snap.name,
                        seq: snap.seq,
                        ts: snap.ts,
                        source: "snapshot",
                        containers: {
                            inventory: snap.inventory || [],
                            armor: snap.armor || [],
                            offhand: snap.offhand || [],
                            ender: snap.ender || []
                        }
                    };
                }
            } else {
                data = app.shadow.view(xuid);
            }
            if (!data) {
                this.sendJson(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "没有该玩家数据" } });
                return;
            }
            this.sendJson(res, 200, { ok: true, data: data });
            return;
        }

        m = path.match(/^\/players\/([^/]+)\/snapshots$/);
        if (m) {
            if (!this.can(identity, "snapshot.read")) { this.sendJson(res, 403, { ok: false, error: { code: "FORBIDDEN", message: "缺少 snapshot.read" } }); return; }
            const xuid = decodeURIComponent(m[1]);
            const list = app.store.listSnapshots(xuid, Number(this.query(req, "limit", 100)));
            this.sendJson(res, 200, { ok: true, data: list });
            return;
        }

        if (path === "/snapshots") {
            if (!this.can(identity, "snapshot.read")) { this.sendJson(res, 403, { ok: false, error: { code: "FORBIDDEN", message: "缺少 snapshot.read" } }); return; }
            const limit = Number(this.query(req, "limit", 500));
            const list = app.store.listAllSnapshots(limit);
            this.sendJson(res, 200, { ok: true, data: list });
            return;
        }

        m = path.match(/^\/snapshots\/([^/]+)$/);
        if (m) {
            if (!this.can(identity, "snapshot.read")) { this.sendJson(res, 403, { ok: false, error: { code: "FORBIDDEN", message: "缺少 snapshot.read" } }); return; }
            const snap = app.store.getSnapshot(decodeURIComponent(m[1]));
            if (!snap) {
                this.sendJson(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "备份不存在" } });
                return;
            }
            this.sendJson(res, 200, { ok: true, data: snap });
            return;
        }

        if (path === "/items/translations") {
            const table = app.itemTranslations ? app.itemTranslations() : readJson(JSON_DIR + "/item-translations.json", {});
            this.sendJson(res, 200, { ok: true, data: table || {} });
            return;
        }

        if (path === "/items/search") {
            const query = String(this.query(req, "q", "") || "").trim().toLowerCase();
            const table = app.itemTranslations ? app.itemTranslations() : readJson(JSON_DIR + "/item-translations.json", {});
            const items = table && table.items ? table.items : {};
            const out = [];
            for (const [id, name] of Object.entries(items)) {
                if (query && !id.toLowerCase().includes(query) && !String(name).toLowerCase().includes(query)) continue;
                out.push({ id: "minecraft:" + id, name: name, english: table.english && table.english[id] || "" });
                if (out.length >= 100) break;
            }
            this.sendJson(res, 200, { ok: true, data: out });
            return;
        }

        m = path.match(/^\/nbt\/([^/]+)$/);
        if (m) {
            if (!this.can(identity, "inventory.read")) { this.sendJson(res, 403, { ok: false, error: { code: "FORBIDDEN", message: "缺少 inventory.read" } }); return; }
            const snbt = app.store.getNbt(decodeURIComponent(m[1]));
            if (!snbt) {
                this.sendJson(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "NBT 不存在" } });
                return;
            }
            this.sendJson(res, 200, { ok: true, data: { snbt: snbt, size: snbt.length } });
            return;
        }

        if (path === "/flow" || path === "/flow/summary") {
            if (!this.can(identity, "flow.read")) { this.sendJson(res, 403, { ok: false, error: { code: "FORBIDDEN", message: "缺少 flow.read" } }); return; }
            const filter = this.flowFilter(req);
            if (path === "/flow/summary") {
                this.sendJson(res, 200, { ok: true, data: app.logistics.summary(filter) });
                return;
            }
            const page = Number(this.query(req, "page", 1));
            const pageSize = Number(this.query(req, "pageSize", this.query(req, "limit", app.store.flowPageSize)));
            this.sendJson(res, 200, { ok: true, data: app.logistics.page(filter, { page: page, pageSize: pageSize }) });
            return;
        }

        if (path === "/map/meta") {
            if (!this.can(identity, "map.read")) { this.sendJson(res, 403, { ok: false, error: { code: "FORBIDDEN", message: "缺少 map.read" } }); return; }
            let mapConfig = {};
            try { mapConfig = readJson("plugins/ZXDash/map_config.json", {}); } catch (e) { mapConfig = {}; }
            this.sendJson(res, 200, { ok: true, data: {
                tileUrl: "/api/v1/map/tiles/{dim}/{zoom}/{tx}/{ty}",
                zoomIn: Number(mapConfig.zoomIn || 2),
                zoomOut: Number(mapConfig.zoomOut || -7),
                lastRender: Number(mapConfig.lastRender || 0),
                dimensions: [
                    { id: 0, tile: "overworld", name: "主世界" },
                    { id: 1, tile: "nether", name: "下界" },
                    { id: 2, tile: "the_end", name: "末地" }
                ],
                clusterRadius: Number((app.config.container && app.config.container.clusterRadius) || 4),
                retentionDays: app.store.containerRetentionDays
            } });
            return;
        }

        if (path === "/map/players") {
            if (!this.can(identity, "map.read")) { this.sendJson(res, 403, { ok: false, error: { code: "FORBIDDEN", message: "缺少 map.read" } }); return; }
            const list = [];
            try {
                for (const p of mc.getOnlinePlayers()) {
                    const name = String(p.name || p.realName || "");
                    if (app.store.isBlockedName(name)) continue;
                    list.push({ xuid: String(p.xuid), name: name, dim: Number(p.pos && p.pos.dimid || 0), x: Number(p.pos && p.pos.x || 0), y: Number(p.pos && p.pos.y || 0), z: Number(p.pos && p.pos.z || 0) });
                }
            } catch (e) {  }
            list.sort((a, b) => String(a.name).localeCompare(String(b.name), "zh-CN"));
            this.sendJson(res, 200, { ok: true, data: list });
            return;
        }

        if (path === "/map/containers") {
            if (!this.can(identity, "container.read")) { this.sendJson(res, 403, { ok: false, error: { code: "FORBIDDEN", message: "缺少 container.read" } }); return; }
            const dim = Number(this.query(req, "dim", 0));
            const at = Number(this.query(req, "at", 0)) || 0;
            const day = String(this.query(req, "day", "") || "");
            const bboxRaw = String(this.query(req, "bbox", "") || "");
            let bbox = null;
            if (bboxRaw) {
                const values = bboxRaw.split(",").map((v) => Number(v));
                if (values.length === 4 && values.every((v) => Number.isFinite(v))) bbox = values;
            }
            let summaries = app.store.listContainerSummaries(dim, {
                at: at,
                day: day,
                includeRemoved: !!at || !!day,
                bbox: bbox
            });
            const limit = Math.max(1, Math.min(2000, Number(this.query(req, "limit", 1000)) || 1000));
            const cx = Number(this.query(req, "cx", NaN));
            const cz = Number(this.query(req, "cz", NaN));
            if (Number.isFinite(cx) && Number.isFinite(cz)) {
                summaries.sort((a, b) => {
                    const da = (a.x - cx) * (a.x - cx) + (a.z - cz) * (a.z - cz);
                    const db = (b.x - cx) * (b.x - cx) + (b.z - cz) * (b.z - cz);
                    return da - db;
                });
            }
            summaries = summaries.slice(0, limit);
            const enriched = summaries.map((entry) => {
                const obsId = entry.observationId || entry.currentObservationId;
                const obs = obsId ? app.store.getContainerObservation(obsId) : null;
                const preview = obs && Array.isArray(obs.items) ? obs.items.slice(0, 5).map((slot) => ({
                    t: slot.item && slot.item.t || "",
                    n: slot.item && (slot.item.meta && slot.item.meta.name || slot.item.n) || "",
                    c: Number(slot.item && slot.item.c || 1)
                })) : [];
                const kind = String(entry.type || "").toLowerCase();
                if (!entry.facing || (kind.indexOf("hopper") >= 0 || kind.indexOf("dispenser") >= 0 || kind.indexOf("dropper") >= 0 || kind.indexOf("barrel") >= 0)) {
                    const actualFacing = blockFacing(entry.dim, entry.x, entry.y, entry.z);
                    if (actualFacing) entry.facing = actualFacing;
                }
                if (Number(entry.size || 0) > 27 && entry.pairX == null) {
                    const pair = blockPair(entry.dim, entry.x, entry.y, entry.z);
                    if (pair) {
                        entry.pairX = pair.x;
                        entry.pairZ = pair.z;
                        entry.pairLead = pair.lead;
                        entry.doubleAxis = pair.axis;
                    }
                }
                return Object.assign({}, entry, { preview: preview, previewMore: obs && obs.items ? Math.max(0, obs.items.length - preview.length) : 0 });
            });
            this.sendJson(res, 200, { ok: true, data: {
                at: at, day: day, items: enriched, clusters: []
            } });
            return;
        }

        m = path.match(/^\/map\/tiles\/([^/]+)\/(\d+)\/(-?\d+)\/(-?\d+)$/);
        if (m) {
            if (!this.can(identity, "map.read")) { this.sendJson(res, 403, { ok: false, error: { code: "FORBIDDEN", message: "缺少 map.read" } }); return; }
            const folder = m[1] === "nether" ? "nether" : (m[1] === "the_end" ? "the_end" : "overworld");
            const zoom = Math.max(0, Math.min(20, Number(m[2])));
            const file = "plugins/ZXDash/unmined-web/tiles/" + folder + "/" + zoom + "/" + m[3] + "_" + m[4] + ".png";
            try {
                if (!File.exists(file)) { res.status = 404; res.write(""); return; }
                const data = File.readFrom(file, true);
                res.status = 200;
                res.setHeader("Content-Type", "image/png");
                res.setHeader("Cache-Control", "public, max-age=3600");
                res.write(data);
            } catch (e) {
                res.status = 404;
                res.write("");
            }
            return;
        }

        m = path.match(/^\/containers\/([^/]+)\/history$/);
        if (m) {
            if (!this.can(identity, "container.read")) { this.sendJson(res, 403, { ok: false, error: { code: "FORBIDDEN", message: "缺少 container.read" } }); return; }
            const data = app.store.listContainerHistory(decodeURIComponent(m[1]));
            if (!data) { this.sendJson(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "容器不存在" } }); return; }
            this.sendJson(res, 200, { ok: true, data: data });
            return;
        }

        m = path.match(/^\/containers\/([^/]+)$/);
        if (m) {
            if (!this.can(identity, "container.read")) { this.sendJson(res, 403, { ok: false, error: { code: "FORBIDDEN", message: "缺少 container.read" } }); return; }
            const id = decodeURIComponent(m[1]);
            const record = app.store.getContainer(id);
            if (!record) { this.sendJson(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "容器不存在" } }); return; }
            const at = Number(this.query(req, "at", 0)) || 0;
            let obsId = record.currentObservationId || "";
            if (at) {
                const found = (record.observations || []).find((entry) => Number(entry.at || 0) <= at);
                obsId = found ? found.id : "";
            }
            const observation = obsId ? app.store.getContainerObservation(obsId) : null;
            this.sendJson(res, 200, { ok: true, data: {
                id: record.id, dim: record.dim, x: record.x, y: record.y, z: record.z,
                type: record.type, name: record.name || record.type,
                facing: record.facing || (observation && observation.facing) || blockFacing(record.dim, record.x, record.y, record.z),
                pairX: record.pairX != null ? record.pairX : (blockPair(record.dim, record.x, record.y, record.z) || {}).x,
                pairZ: record.pairZ != null ? record.pairZ : (blockPair(record.dim, record.x, record.y, record.z) || {}).z,
                pairLead: record.pairLead != null ? record.pairLead : (blockPair(record.dim, record.x, record.y, record.z) || {}).lead,
                doubleAxis: record.doubleAxis || (blockPair(record.dim, record.x, record.y, record.z) || {}).axis,
                size: Number(record.size || (observation && observation.size) || 0),
                firstSeen: record.firstSeen, lastSeen: record.lastSeen,
                removedAt: record.removedAt || 0, state: record.removedAt ? "removed" : "present",
                observation: observation
            } });
            return;
        }

        if (path === "/audit/verify") {
            if (!this.can(identity, "audit.read")) {
                this.sendJson(res, 403, { ok: false, error: { code: "FORBIDDEN", message: "缺少 audit.read" } });
                return;
            }
            this.sendJson(res, 200, { ok: true, data: app.store.verifyAudit(true) });
            return;
        }

        if (path === "/audit") {
            if (!this.can(identity, "audit.read")) {
                this.sendJson(res, 403, { ok: false, error: { code: "FORBIDDEN", message: "缺少 audit.read" } });
                return;
            }
            this.sendJson(res, 200, { ok: true, data: app.store.listAudit(Number(this.query(req, "limit", 100))) });
            return;
        }

        if (path === "/modules") {
            this.sendJson(res, 200, { ok: true, data: app.modules ? app.modules.list() : [] });
            return;
        }

        if (path === "/stream") {
            const since = Number(this.query(req, "since", 0));
            this.sendJson(res, 200, { ok: true, data: app.shadow.stream(since) });
            return;
        }

        m = path.match(/^\/tasks\/([^/]+)$/);
        if (m) {
            const task = app.actions.getTask(decodeURIComponent(m[1]));
            if (!task) {
                this.sendJson(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "任务不存在" } });
                return;
            }
            this.sendJson(res, 200, { ok: true, data: task });
            return;
        }

        if (path === "/commands/history") {
            const items = app.actions.list(200)
                .filter((task) => task.actionId === "command.execute")
                .slice(0, 30)
                .map((task) => ({
                    taskId: task.taskId,
                    command: String(task.input && task.input.command || ""),
                    operator: task.operator || "",
                    state: task.state || "",
                    ts: task.createdAt || task.startedAt || task.finishedAt || 0,
                    output: task.result && task.result.output ? String(task.result.output).slice(0, 4000) : "",
                    error: task.error || ""
                }));
            this.sendJson(res, 200, { ok: true, data: items });
            return;
        }

        if (path === "/accounts") {
            if (!this.isOwner(identity)) {
                this.sendJson(res, 403, { ok: false, error: { code: "FORBIDDEN", message: "只有初始管理员可以管理账号" } });
                return;
            }
            this.sendJson(res, 200, { ok: true, data: this.accounts.map((account) => this.publicAccount(account)) });
            return;
        }

        if (path === "/actions") {
            this.sendJson(res, 200, { ok: true, data: this.actionList() });
            return;
        }

        this.sendJson(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "未知接口" } });
    }

    apiPost(path, req, res, identity) {
        let body = {};
        try {
            body = req.body ? JSON.parse(req.body) : {};
        } catch (e) {
            this.sendJson(res, 400, { ok: false, error: { code: "VALIDATION", message: "JSON 无效" } });
            return;
        }
        const app = this.app;
        if (path === "/accounts") {
            if (!this.isOwner(identity)) {
                this.sendJson(res, 403, { ok: false, error: { code: "FORBIDDEN", message: "只有初始管理员可以添加账号" } });
                return;
            }
            const username = String(body.username || "").trim();
            const salt = String(body.salt || "").toLowerCase();
            const verifier = String(body.verifier || "").toLowerCase();
            const iterations = Number(body.iterations || 210000);
            const role = ["viewer", "operator", "admin"].indexOf(String(body.role || "viewer")) >= 0 ? String(body.role || "viewer") : "viewer";
            if (!validUsername(username)) {
                this.sendJson(res, 400, { ok: false, error: { code: "VALIDATION", message: "用户名 3-32 位，仅字母数字 _ . -" } });
                return;
            }
            if (this.accountByName(username)) {
                this.sendJson(res, 409, { ok: false, error: { code: "CONFLICT", message: "账号已存在" } });
                return;
            }
            if (!/^[0-9a-f]{32}$/.test(salt) || !/^[0-9a-f]{64}$/.test(verifier) || !Number.isFinite(iterations) || iterations < 100000 || iterations > 500000) {
                this.sendJson(res, 400, { ok: false, error: { code: "VALIDATION", message: "密码校验参数无效" } });
                return;
            }
            const record = {
                schema: 2, username: username, role: role,
                algo: "pbkdf2-sha256-client", salt: salt, iterations: iterations,
                verifierHash: sha256Hex("webbundle-verifier-v1:" + verifier),
                owner: false, createdAt: Date.now(), updatedAt: Date.now()
            };
            this.accounts.push(record);
            app.store.set("auth:accounts", this.accounts);
            this.sendJson(res, 200, { ok: true, data: this.publicAccount(record) });
            return;
        }
        if (path === "/commands") {
            if (!this.can(identity, "command.execute")) {
                this.sendJson(res, 403, { ok: false, error: { code: "FORBIDDEN", message: "缺少 command.execute" } });
                return;
            }
            if (!body.command) {
                this.sendJson(res, 400, { ok: false, error: { code: "VALIDATION", message: "缺少 command" } });
                return;
            }
            const task = app.actions.create("command.execute", { command: String(body.command), confirm: body.confirm === true }, { name: identity.name, role: identity.role, ip: "" });
            this.sendJson(res, 200, { ok: true, data: { taskId: task.taskId, state: task.state } });
            return;
        }
        const m = path.match(/^\/actions\/([^/]+)$/);
        if (m) {
            const actionId = decodeURIComponent(m[1]);
            const action = this.actionList().find((a) => a.id === actionId);
            if (!action) {
                this.sendJson(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "未知动作" } });
                return;
            }
            if (!this.can(identity, action.permission)) {
                this.sendJson(res, 403, { ok: false, error: { code: "FORBIDDEN", message: "缺少 " + action.permission } });
                return;
            }
            const task = app.actions.create(actionId, body, { name: identity.name, role: identity.role, ip: "" });
            this.sendJson(res, 200, { ok: true, data: { taskId: task.taskId, state: task.state } });
            return;
        }
        this.sendJson(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "未知接口" } });
    }

    overviewData(identity) {
        const app = this.app;
        const now = Date.now();
        const cacheKey = String(identity && identity.role || "") + ":" + (this.can(identity, "audit.read") ? "audit" : "basic");
        if (this._overviewCache && this._overviewCache.key === cacheKey && now - this._overviewCache.at < 3000) {
            return this._overviewCache.data;
        }
        const midnight = new Date();
        midnight.setHours(0, 0, 0, 0);
        const start = midnight.getTime();
        let flow = [];
        try { flow = app.logistics ? app.logistics.list({}, 500) : []; } catch (e) { flow = []; }
        const todayFlow = flow.filter((event) => Number(event.ts || 0) >= start);
        let players = [];
        let totalPlayers = 0;
        try {
            const online = mc.getOnlinePlayers();
            const onlinePlayers = [];
            for (const p of online) {
                const playerName = String(p.name || p.realName || "");
                if (app.store.isBlockedName(playerName)) continue;
                onlinePlayers.push({
                    xuid: String(p.xuid),
                    name: playerName,
                    online: true,
                    lastSeen: now,
                    dim: p.pos ? p.pos.dimid : 0
                });
            }
            onlinePlayers.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "zh-CN"));
            players = onlinePlayers;
            const onlineXuids = new Set(onlinePlayers.map((p) => String(p.xuid)));
            totalPlayers = onlinePlayers.length;
            for (const meta of app.store.listPlayers()) {
                if (!onlineXuids.has(String(meta.xuid))) totalPlayers += 1;
            }
        } catch (e) {
            players = [];
            totalPlayers = app.store.listPlayers().length;
        }
        let audit = [];
        let verify = { valid: false, count: 0, firstSeq: null, lastSeq: null };
        if (this.can(identity, "audit.read")) {
            try { audit = app.store.listAudit(5); } catch (e) { audit = []; }
            try { verify = app.store.verifyAudit(); } catch (e) {  }
        }
        let tasks = [];
        try { tasks = app.actions.list(200); } catch (e) { tasks = []; }
        const queued = tasks.filter((task) => task.state === "queued" || task.state === "running").length;
        let heat = [];
        try { heat = app.store.snapshotHeat(30); } catch (e) { heat = new Array(30).fill(0); }
        const data = {
            server: {
                id: app.config.serverId,
                name: app.config.serverName || "BDS",
                online: true,
                version: "1.1.0"
            },
            counts: {
                playersOnline: players.length,
                playersTotal: totalPlayers,
                snapshotsToday: app.store.countSnapshotsSince(start),
                flowToday: todayFlow.length,
                flowIn: todayFlow.filter((e) => e.direction === "in").length,
                flowOut: todayFlow.filter((e) => e.direction === "out").length,
                tasksQueued: queued,
                auditCount: verify.count || 0
            },
            players: players,
            flow: flow.slice(0, 5),
            audit: audit,
            auditVerify: verify,
            backupHeat: heat,
            system: {
                storage: "本地键值库",
                external: !!(app.config.external && app.config.external.enabled),
                nbtObjects: 0,
                auditQueue: 0
            },
            dataAsOf: now
        };
        this._overviewCache = { key: cacheKey, at: now, data: data };
        return data;
    }

    actionList() {
        return [
            { id: "inventory.set", title: "设置槽位", permission: "inventory.write" },
            { id: "inventory.add", title: "添加物品", permission: "inventory.write" },
            { id: "inventory.remove", title: "清空槽位", permission: "inventory.write" },
            { id: "item.nbt.set", title: "设置物品 NBT", permission: "inventory.write" },
            { id: "item.enchants.set", title: "设置物品附魔", permission: "inventory.write" },
            { id: "item.lore.set", title: "设置 Lore 与物品标签", permission: "inventory.write" },
                { id: "item.name.set", title: "设置物品显示名称", permission: "inventory.write" },
                { id: "flow.craft", title: "记录合成物品", permission: "inventory.write" },


            { id: "item.nested.set", title: "修改容器内物品", permission: "inventory.write" },
            { id: "item.nbt.refresh", title: "刷新物品 NBT", permission: "inventory.read" },
            { id: "inventory.restore", title: "还原背包", permission: "inventory.write" },
            { id: "backup.create", title: "立即备份", permission: "inventory.read" },
            { id: "offline.snapshot", title: "读取离线背包", permission: "inventory.write" }
        ];
    }

    staticFile(req, res) {
        const route = String(req.path || "");
        if (route === "/login" || route === "/login.html" || route === "/setup" || route === "/setup.html") {
            res.status = 302;
            res.setHeader("Location", "/");
            res.write("");
            return;
        }
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("X-Frame-Options", "DENY");
        res.setHeader("Referrer-Policy", "no-referrer");
        let path = String(req.path || "/");
        if (path === "/" || path === "") path = "/index.html";
        if (path.indexOf("..") >= 0 || path.indexOf("\\") >= 0) {
            res.status = 400;
            res.write("bad path");
            return;
        }
        if ((path.indexOf("/textures/items/") === 0 || path.indexOf("/textures/custom/") === 0) && /\.(png|webp)$/i.test(path)) {
            const full = "plugins/WebBundle/web" + path;
            try {
                if (File.exists(full)) {
                    const data = File.readFrom(full, true);
                    res.status = 200;
                    res.setHeader("Content-Type", path.toLowerCase().endsWith(".png") ? "image/png" : "image/webp");
                    res.setHeader("Cache-Control", "public, max-age=86400");
                    res.write(data);
                    return;
                }
            } catch (e) {
                log("warn", "读取物品图标失败: " + path + " " + e.message);
            }
            res.status = 404;
            res.write("not found");
            return;
        }
        const asset = this.assets.get(path);
        if (asset) {
            res.status = 200;
            res.setHeader("Content-Type", asset.type);
            res.setHeader("Cache-Control", path === "/index.html" ? "no-cache" : "public, max-age=3600");
            res.write(asset.body);
            return;
        }
        const index = this.assets.get("/index.html");
        if (index) {
            res.status = 200;
            res.setHeader("Content-Type", MIME[".html"]);
            res.setHeader("Cache-Control", "no-cache");
            res.write(index.body);
            return;
        }
        res.status = 404;
        res.write("not found");
    }
}

export { Web };
