// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 WebBundle contributors

import { log } from "./core.js";

class External {
    constructor(app) {
        this.app = app;
        this.enabled = false;
        this.base = "";
        this.token = "";
        this.lastPoll = 0;
        this.localTasks = new Map();
        this.spool = [];
        this.failures = 0;
        this.lastOk = 0;
        this.spoolFailures = 0;
        this.spoolBackoffUntil = 0;
        this.spoolFlushing = false;
        this.retryAt = 0;
        this.consecutiveFailures = 0;
        this.offlineWarned = false;
        this.lastWarnAt = 0;
        this.lastError = "";
    }

    start() {
        const cfg = this.app.config.external || {};
        if (!cfg.enabled || !cfg.url) return;
        this.enabled = true;
        this.base = String(cfg.url).replace(/\/+$/, "");
        this.token = String(cfg.token || "");
        this.pollSec = Math.max(1, Number(cfg.pollSec || 2));
        this.push("register", {
            serverId: this.app.config.serverId,
            name: this.app.config.serverName || "",
            version: "1.0.0",
            lastAckSeq: 0
        });
        this.pushExtensions();
        // 首次接入时补发每个已知玩家的最后备份，避免冷查看为空。
        setTimeout(() => {
            try {
                for (const meta of this.app.store.listPlayers()) {
                    const snap = this.app.store.latestSnapshot(meta.xuid);
                    if (snap) this.pushStoredSnapshot(snap);
                }
            } catch (e) {
                log("warn", "补发最后备份失败: " + e.message);
            }
        }, 1500);
        log("info", "外部网页推送已启用: " + this.base);
    }

    stop() {
        this.enabled = false;
    }

    status(req) {
        if (!this.enabled) return { enabled: false, url: "", online: false };
        const online = this.lastOk > 0 && (Date.now() - this.lastOk) < Math.max(10000, this.pollSec * 3000);
        const publicUrl = String((this.app.config.external && this.app.config.external.publicUrl) || "").trim().replace(/\/+$/, "");
        let url = publicUrl || this.base;
        if (publicUrl) return { enabled: true, url: url, online: online };
        try {
            const hostHeader = req && req.getHeader ? req.getHeader("X-Forwarded-Host") : null;
            const hostValue = hostHeader && hostHeader.length ? String(hostHeader[0]) : (req && req.getHeader ? String((req.getHeader("Host") || [""])[0] || "") : "");
            if (hostValue) {
                let host = hostValue.toLowerCase();
                if (host.startsWith("[")) host = host.slice(0, host.indexOf("]") + 1);
                else host = host.split(":")[0];
                const protoHeader = req && req.getHeader ? req.getHeader("X-Forwarded-Proto") : null;
                const proto = protoHeader && protoHeader.length && String(protoHeader[0]).toLowerCase() === "https" ? "https" : "http";
                const port = new URL(this.base).port;
                url = proto + "://" + host + (port ? ":" + port : "");
            }
        } catch (e) {
            url = this.base;
        }
        return { enabled: true, url: url, online: online };
    }

    shutdown() {
        if (!this.enabled) return;
        this.push("shutdown", { serverId: this.app.config.serverId, ts: Date.now() });
        for (const meta of this.app.store.listPlayers()) {
            const snap = this.app.store.latestSnapshot(meta.xuid);
            if (snap) this.pushStoredSnapshot(snap);
        }
    }

    headers() {
        const h = { "Content-Type": "application/json" };
        if (this.token) h["Authorization"] = "Bearer " + this.token;
        h["X-WebBundle-Server"] = this.app.config.serverId;
        return h;
    }

    queueSpool(kind, payload) {
        this.spool.push({ kind: kind, payload: payload, ts: Date.now() });
        if (this.spool.length > 500) this.spool.shift();
    }

    push(kind, payload, options) {
        if (!this.enabled) return;
        const opt = options || {};
        const noRequeue = ["heartbeat", "register", "shutdown", "actions/result"].indexOf(kind) >= 0;
        const requeue = opt.requeue !== undefined ? opt.requeue : !noRequeue;
        const done = (ok) => {
            if (typeof opt.onDone === "function") opt.onDone(ok);
        };
        // 独立端不可达时不要每个事件都打一条日志，也不要持续敲端口。
        if (Date.now() < this.retryAt) {
            if (requeue) this.queueSpool(kind, payload);
            return;
        }
        const body = JSON.stringify(payload);
        const url = this.base + "/push/v1/" + kind;
        const fail = (why) => {
            this.failures += 1;
            this.consecutiveFailures += 1;
            this.spoolFailures += 1;
            this.lastError = why;
            // 固定短退避：本地/内网独立端恢复后 5 秒内继续探活，同时避免每个事件刷一条日志。
            const delay = 5000;
            this.spoolBackoffUntil = Date.now() + delay;
            this.retryAt = this.spoolBackoffUntil;
            if (requeue) this.queueSpool(kind, payload);
            const now = Date.now();
            if (!this.offlineWarned || now - this.lastWarnAt > 300000) {
                log("warn", "推送失败 " + kind + " " + why + "；独立端不可达 " + this.base +
                    "，已缓存待推送数据（检查 standalone 是否启动、端口/防火墙和 external.url）");
                this.lastWarnAt = now;
                this.offlineWarned = true;
            }
            done(false);
        };
        try {
            network.httpPost(url, this.headers(), body, "application/json", (status, result) => {
                if (status >= 200 && status < 300) {
                    const recovered = this.offlineWarned;
                    this.lastOk = Date.now();
                    this.consecutiveFailures = 0;
                    this.spoolFailures = 0;
                    this.spoolBackoffUntil = 0;
                    this.retryAt = 0;
                    this.lastError = "";
                    this.offlineWarned = false;
                    if (recovered) log("info", "外部网页推送已恢复: " + this.base);
                    done(true);
                } else {
                    fail("status=" + status + " " + String(result || "").substring(0, 200));
                }
            });
        } catch (e) {
            fail("异常: " + e.message);
        }
    }

    pushExtensions() {
        if (!this.enabled || !this.app.extensions) return;
        this.push("extensions", { serverId: this.app.config.serverId, items: this.app.extensions.list() });
    }

    pushStoredSnapshot(snapshot) {
        const refs = {};
        for (const group of ["inventory", "armor", "offhand", "ender"]) {
            for (const entry of snapshot[group] || []) {
                const item = entry.item;
                if (!item || !item.nbtRef || item.nbt) continue;
                const snbt = this.app.store.getNbt(item.nbtRef);
                if (snbt) refs[item.nbtRef] = snbt;
            }
        }
        this.pushSnapshot(snapshot, refs);
    }

    pushSnapshot(snapshot, nbtRefs) {
        if (!this.enabled || !snapshot) return;
        const copy = Object.assign({}, snapshot);
        if (nbtRefs && Object.keys(nbtRefs).length) copy.nbtRefs = nbtRefs;
        this.push("snapshot", { serverId: this.app.config.serverId, items: [copy] });
    }

    pushPlayer(meta) {
        if (!this.enabled || !meta) return;
        this.push("player", { serverId: this.app.config.serverId, items: [meta] });
    }

    pushFlow(event) {
        if (!this.enabled || !event) return;
        this.push("flow", { serverId: this.app.config.serverId, items: [event] });
    }

    pushAudit(record) {
        if (!this.enabled || !record) return;
        this.push("audit", { serverId: this.app.config.serverId, items: [record] });
    }

    tick() {
        if (!this.enabled) return;
        const now = Date.now();
        if (now - this.lastPoll < this.pollSec * 1000) return;
        this.lastPoll = now;
        if (now < this.retryAt) return;
        // 先探活，只有心跳成功才继续刷队列/拉动作，避免断线时并发打满。
        this.push("heartbeat", { ts: now, serverId: this.app.config.serverId }, {
            onDone: (ok) => {
                if (!ok) return;
                this.flushSpool();
                this.pollActions();
            }
        });
        this.collectResults();
    }

    flushSpool() {
        if (!this.spool.length || this.spoolFlushing) return;
        if (Date.now() < this.retryAt) return;
        this.spoolFlushing = true;
        const batch = this.spool.splice(0, 10);
        let pending = batch.length;
        const failed = [];
        const finish = () => {
            pending -= 1;
            if (pending > 0) return;
            if (failed.length) {
                this.spool.unshift(...failed);
                if (this.spool.length > 500) this.spool.length = 500;
            }
            this.spoolFlushing = false;
        };
        for (const item of batch) {
            this.push(item.kind, item.payload, {
                requeue: false,
                onDone: (ok) => {
                    if (!ok) failed.push(item);
                    finish();
                }
            });
        }
    }

    pollActions() {
        const url = this.base + "/push/v1/actions/pending?serverId=" +
            encodeURIComponent(this.app.config.serverId) + "&limit=8";
        try {
            network.httpGet(url, this.headers(), (status, result) => {
                if (status !== 200 || !result) return;
                let body = null;
                try {
                    body = JSON.parse(result);
                } catch (e) {
                    return;
                }
                const items = body && body.data ? body.data : [];
                for (const item of items) {
                    if (!item || !item.taskId || !item.actionId) continue;
                    if (this.localTasks.has(item.taskId)) continue;
                    const local = this.app.actions.create(item.actionId, item.input || {}, {
                        name: item.operator || "web",
                        role: "admin",
                        ip: ""
                    });
                    this.localTasks.set(item.taskId, { localId: local.taskId, created: Date.now() });
                }
            });
        } catch (e) {
            log("warn", "拉取外部动作失败: " + e.message);
        }
    }

    collectResults() {
        for (const [externalId, entry] of Array.from(this.localTasks.entries())) {
            const task = this.app.actions.getTask(entry.localId);
            if (!task) continue;
            if (task.state === "queued" || task.state === "running") continue;
            this.push("actions/result", {
                serverId: this.app.config.serverId,
                taskId: externalId,
                state: task.state,
                result: task.result,
                error: task.error
            });
            this.localTasks.delete(externalId);
        }
    }
}

export { External };
