// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 WebBundle contributors

import { ensureDir, readJson, writeJson, log } from "./core.js";
import { sha256Hex } from "./sha256.js";

class MemoryDB {
    constructor() {
        this.map = new Map();
    }
    get(key) {
        return this.map.has(key) ? this.map.get(key) : null;
    }
    set(key, value) {
        this.map.set(key, value);
        return true;
    }
    delete(key) {
        this.map.delete(key);
        return true;
    }
}

class PagedIndex {
    constructor(store, base, pageSize, maxItems) {
        this.store = store;
        this.base = base;
        this.pageSize = Math.max(20, Number(pageSize || 200));
        this.maxItems = Math.max(this.pageSize, Number(maxItems || 5000));
        this.counter = 0;
    }

    pageKey(token) { return this.base + ":p:" + token; }

    newToken() {
        this.counter += 1;
        return Date.now().toString(36) + "-" + this.counter.toString(36) + "-" + Math.random().toString(36).slice(2, 6);
    }

    migrate() {
        const old = this.store.get(this.base, null);
        if (!Array.isArray(old)) return;
        if (!old.length) {
            try { this.store.db.delete(this.base); } catch (e) { /* 忽略 */ }
            return;
        }
        const tokens = [];
        for (let i = 0; i < old.length; i += this.pageSize) {
            const token = this.newToken();
            this.store.set(this.pageKey(token), old.slice(i, i + this.pageSize));
            tokens.push(token);
        }
        this.store.set(this.base + ":pages", tokens);
        try { this.store.db.delete(this.base); } catch (e) { /* 忽略 */ }
    }

    pages() {
        this.migrate();
        const list = this.store.get(this.base + ":pages", []);
        return Array.isArray(list) ? list : [];
    }

    read(limit) {
        const max = Math.max(1, Number(limit || this.maxItems));
        const out = [];
        for (const token of this.pages()) {
            const page = this.store.get(this.pageKey(token), []);
            if (!Array.isArray(page)) continue;
            for (const item of page) {
                out.push(item);
                if (out.length >= max) return out;
            }
        }
        return out;
    }

    unshift(item, onDrop) {
        let tokens = this.pages();
        if (!tokens.length) {
            const token = this.newToken();
            this.store.set(this.pageKey(token), [item]);
            this.store.set(this.base + ":pages", [token]);
            return;
        }
        let first = this.store.get(this.pageKey(tokens[0]), []);
        if (!Array.isArray(first)) first = [];
        if (first.length >= this.pageSize) {
            const token = this.newToken();
            this.store.set(this.pageKey(token), [item]);
            tokens.unshift(token);
        } else {
            first.unshift(item);
            this.store.set(this.pageKey(tokens[0]), first);
        }
        this.store.set(this.base + ":pages", tokens);
        const maxPages = Math.ceil(this.maxItems / this.pageSize);
        while (tokens.length > maxPages) {
            const droppedToken = tokens.pop();
            const dropped = this.store.get(this.pageKey(droppedToken), []);
            try { this.store.db.delete(this.pageKey(droppedToken)); } catch (e) { /* 忽略 */ }
            if (typeof onDrop === "function" && Array.isArray(dropped)) {
                for (const entry of dropped) onDrop(entry);
            }
            this.store.set(this.base + ":pages", tokens);
        }
    }

    clear() {
        for (const token of this.pages()) {
            try { this.store.db.delete(this.pageKey(token)); } catch (e) { /* 忽略 */ }
        }
        try { this.store.db.delete(this.base + ":pages"); } catch (e) { /* 忽略 */ }
        try { this.store.db.delete(this.base); } catch (e) { /* 忽略 */ }
    }
}

class Store {
    constructor(config) {
        this.config = config;
        this.dir = config.storage.dbPath || "plugins/WebBundle/data/db";
        this.driver = config.storage.driver || "kv";
        ensureDir(this.dir);
        if (this.driver === "memory") {
            this.db = new MemoryDB();
        } else {
            this.db = new KVDatabase(this.dir);
        }
        if (!this.db) throw new Error("存储打开失败: " + this.dir);
        this.indexLimit = Number(config.storage.indexLimit || 3000);
        this.flowIndex = new PagedIndex(this, "flow:index", 200, 5000);
        this.playerIndex = new PagedIndex(this, "player:index", 200, 10000);
        this.snapshotIndexes = new Map();
        this._playerSet = null;
    }

    snapshotIndex(xuid) {
        const key = String(xuid);
        if (!this.snapshotIndexes.has(key)) {
            this.snapshotIndexes.set(key, new PagedIndex(this, "idx:" + key, 200, this.indexLimit));
        }
        return this.snapshotIndexes.get(key);
    }

    get(key, fallback) {
        try {
            const raw = this.db.get(key);
            if (raw === null || raw === undefined) return fallback;
            if (typeof raw === "string") return JSON.parse(raw);
            return raw;
        } catch (e) {
            return fallback;
        }
    }

    set(key, value) {
        try {
            this.db.set(key, JSON.stringify(value));
            return true;
        } catch (e) {
            log("error", "写入存储失败: " + key + " " + e.message);
            return false;
        }
    }

    putNbt(hash, snbt) {
        return this.set("nbt:" + hash, snbt);
    }

    getNbt(hash) {
        try {
            return this.db.get("nbt:" + hash) || null;
        } catch (e) {
            return null;
        }
    }

    savePlayer(meta) {
        if (!meta || !meta.xuid) return;
        const existing = this.getPlayer(meta.xuid) || {};
        this.set("player:" + meta.xuid, Object.assign({}, existing, meta));
        if (!this._playerSet) this._playerSet = new Set(this.playerIndex.read(10000));
        if (!this._playerSet.has(String(meta.xuid))) {
            this._playerSet.add(String(meta.xuid));
            this.playerIndex.unshift(String(meta.xuid));
        }
    }

    purgePlayerNames(names) {
        this.blockedNames = new Set((Array.isArray(names) ? names : []).map((name) => String(name || "").toLowerCase()).filter(Boolean));
        const blockedXuids = new Set();
        const removedRefs = new Set();
        const index = this.playerIndex.read(10000);
        const keep = [];
        for (const xuid of index) {
            const meta = this.getPlayer(xuid);
            const name = String(meta && meta.name || "").toLowerCase();
            if (meta && this.blockedNames.has(name)) {
                blockedXuids.add(String(xuid));
                const snapshots = this.snapshotIndex(xuid).read(this.indexLimit);
                for (const entry of snapshots) {
                    const snap = this.getSnapshot(entry.id);
                    if (snap) {
                        for (const group of ["inventory", "armor", "offhand", "ender"]) {
                            for (const slot of snap[group] || []) {
                                const item = slot.item;
                                if (item && item.nbtRef) removedRefs.add(item.nbtRef);
                            }
                        }
                        if (snap.nbtRefs) for (const ref of Object.keys(snap.nbtRefs)) removedRefs.add(ref);
                    }
                    try { this.db.delete("snap:" + entry.id); } catch (e) { /* 忽略 */ }
                }
                this.snapshotIndex(xuid).clear();
                try { this.db.delete("player:" + xuid); } catch (e) { /* 忽略 */ }
            } else {
                keep.push(xuid);
            }
        }
        this.playerIndex.clear();
        for (const xuid of keep) this.playerIndex.unshift(xuid);
        this._playerSet = new Set(keep.map(String));
        const flowIndex = this.flowIndex.read(5000);
        const keepFlow = [];
        for (const id of flowIndex) {
            const event = this.get("flow:" + id, null);
            const name = String(event && event.name || "").toLowerCase();
            const xuid = String(event && event.xuid || "");
            if (event && (this.blockedNames.has(name) || blockedXuids.has(xuid))) {
                try { this.db.delete("flow:" + id); } catch (e) { /* 忽略 */ }
            } else {
                keepFlow.push(id);
            }
        }
        this.flowIndex.clear();
        for (const id of keepFlow) this.flowIndex.unshift(id);
        // 只删除没有任何保留快照引用的 NBT，避免共享大对象被误删。
        for (const ref of removedRefs) {
            let used = false;
            for (const xuid of keep) {
                for (const entry of this.snapshotIndex(xuid).read(this.indexLimit)) {
                    const snap = this.getSnapshot(entry.id);
                    if (!snap) continue;
                    if (snap.nbtRefs && snap.nbtRefs[ref]) { used = true; break; }
                    for (const group of ["inventory", "armor", "offhand", "ender"]) {
                        for (const slot of snap[group] || []) {
                            if (slot.item && slot.item.nbtRef === ref) { used = true; break; }
                        }
                        if (used) break;
                    }
                    if (used) break;
                }
                if (used) break;
            }
            if (!used) {
                try { this.db.delete("nbt:" + ref); } catch (e) { /* 忽略 */ }
            }
        }
        this._statsCache = null;
        this._auditVerifyCache = null;
        return blockedXuids.size;
    }

    isBlockedName(name) {
        return !!(this.blockedNames && this.blockedNames.has(String(name || "").toLowerCase()));
    }

    getPlayer(xuid) {
        return this.get("player:" + xuid, null);
    }

    listPlayers() {
        const index = this.playerIndex.read(10000);
        const out = [];
        for (const xuid of index) {
            const meta = this.getPlayer(xuid);
            if (meta && !this.isBlockedName(meta.name)) out.push(meta);
        }
        return out;
    }

    putSnapshot(snapshot) {
        if (!snapshot || !snapshot.id) return false;
        if (this.isBlockedName(snapshot.name)) return false;
        if (this.get("snap:" + snapshot.id, null)) {
            log("warn", "快照 ID 已存在，拒绝覆盖: " + snapshot.id);
            return false;
        }
        this.set("snap:" + snapshot.id, snapshot);
        const xuid = snapshot.xuid;
        const meta = {
            id: snapshot.id,
            xuid: xuid,
            seq: Number(snapshot.seq || 0),
            ts: snapshot.ts,
            minute: snapshot.minute,
            reason: snapshot.reason,
            batchId: snapshot.batchId || "",
            batchAt: Number(snapshot.batchAt || 0),
            batchReason: snapshot.batchReason || snapshot.reason,
            hash: snapshot.hash,
            itemCount: Number(snapshot.itemCount || 0),
            containerCounts: snapshot.containerCounts || null
        };
        this.snapshotIndex(xuid).unshift(meta, (entry) => {
            try { this.db.delete("snap:" + entry.id); } catch (e) { /* 忽略 */ }
        });
        this._statsCache = null;
        this.savePlayer({
            xuid: xuid,
            uuid: snapshot.uuid || "",
            name: snapshot.name || "",
            online: snapshot.online !== false,
            lastSeen: snapshot.ts,
            latestSnapshotId: snapshot.id,
            latestMinute: snapshot.minute
        });
        return true;
    }

    getSnapshot(id) {
        return this.get("snap:" + id, null);
    }

    listAllSnapshots(limit) {
        const max = Math.max(1, Math.min(Number(limit || 500), 5000));
        const out = [];
        for (const player of this.listPlayers()) {
            const entries = this.snapshotIndex(player.xuid).read(Math.min(this.indexLimit, max));
            for (const entry of entries) {
                out.push(Object.assign({ name: player.name || "" }, entry));
            }
        }
        out.sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0));
        return out.slice(0, max);
    }

    listSnapshots(xuid, limit) {
        return this.snapshotIndex(xuid).read(Math.max(1, Math.min(Number(limit || 100), 500)));
    }

    listSnapshotIndex(xuid, limit) {
        return this.snapshotIndex(xuid).read(Math.max(1, Number(limit || this.indexLimit)));
    }

    latestSnapshot(xuid) {
        const list = this.listSnapshots(xuid, 1);
        if (!list.length) return null;
        return this.getSnapshot(list[0].id);
    }

    putTask(task) {
        this.set("task:" + task.taskId, task);
        const index = this.get("task:index", []);
        if (index.indexOf(task.taskId) < 0) {
            index.unshift(task.taskId);
            if (index.length > 2000) index.length = 2000;
            this.set("task:index", index);
        }
        return true;
    }

    listTasks(limit, state) {
        const max = Math.max(1, Math.min(Number(limit || 100), 500));
        const index = this.get("task:index", []);
        const out = [];
        for (const id of index) {
            const task = this.getTask(id);
            if (!task) continue;
            if (state && task.state !== state) continue;
            out.push(task);
            if (out.length >= max) break;
        }
        return out;
    }

    getTask(taskId) {
        return this.get("task:" + taskId, null);
    }

    snapshotHeat(days) {
        const count = Math.max(1, Math.min(Number(days || 30), 90));
        const cacheKey = "heat:" + count;
        const cached = this._statsCache;
        if (cached && Date.now() - cached.at < 30000 && cached[cacheKey]) return cached[cacheKey].slice();
        const buckets = new Array(count).fill(0);
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const dayMs = 24 * 60 * 60 * 1000;
        for (const player of this.listPlayers()) {
            const index = this.snapshotIndex(player.xuid).read(this.indexLimit);
            for (const meta of index) {
                const diff = Math.floor((Number(meta.ts || 0) - start) / dayMs);
                // 今天 diff=0，昨天 diff=-1；只统计最近 count 天。
                if (diff <= 0 && diff > -count) buckets[count - 1 + diff] += 1;
            }
        }
        this._statsCache = Object.assign({ at: Date.now() }, this._statsCache || {}, { [cacheKey]: buckets.slice() });
        return buckets;
    }

    countSnapshotsSince(ts) {
        const cacheKey = "count:" + Number(ts || 0);
        const cached = this._statsCache;
        if (cached && Date.now() - cached.at < 30000 && cached[cacheKey] !== undefined) return Number(cached[cacheKey]);
        let total = 0;
        for (const player of this.listPlayers()) {
            const index = this.snapshotIndex(player.xuid).read(this.indexLimit);
            for (const meta of index) {
                if (Number(meta.ts || 0) >= ts) total += 1;
            }
        }
        this._statsCache = Object.assign({ at: Date.now() }, this._statsCache || {}, { [cacheKey]: total });
        return total;
    }

    appendAudit(record) {
        const seq = Number(this.get("audit:seq", 0)) + 1;
        const prevHash = String(this.get("audit:last", "") || "");
        const base = {
            schema: 1,
            seq: seq,
            ts: Date.now(),
            operator: record.operator || "",
            action: record.action || "",
            taskId: record.taskId || "",
            target: record.target || "",
            detail: record.detail || "",
            state: record.state || "",
            error: record.error || "",
            prevHash: prevHash
        };
        base.hash = sha256Hex(JSON.stringify(base));
        this.set("audit:" + seq, base);
        this.set("audit:seq", seq);
        this.set("audit:last", base.hash);
        const index = this.get("audit:index", []);
        index.unshift(seq);
        if (index.length > 5000) {
            const removed = index.splice(5000);
            for (const old of removed) {
                try {
                    this.db.delete("audit:" + old);
                } catch (e) {
                    // 忽略
                }
            }
            const oldest = this.get("audit:" + index[index.length - 1], null);
            this.set("audit:anchor", oldest ? oldest.prevHash : "");
        }
        this.set("audit:index", index);
        this._auditVerifyCache = null;
        return base;
    }

    listAudit(limit) {
        const max = Math.max(1, Math.min(Number(limit || 100), 500));
        const index = this.get("audit:index", []);
        const out = [];
        for (const seq of index) {
            const entry = this.get("audit:" + seq, null);
            if (entry) out.push(entry);
            if (out.length >= max) break;
        }
        return out;
    }

    verifyAudit(force) {
        const index = this.get("audit:index", []);
        const cacheKey = index.length + ":" + String(index[0] || "") + ":" + String(index[index.length - 1] || "") + ":" +
            String(this.get("audit:seq", "")) + ":" + String(this.get("audit:last", "")) + ":" + String(this.get("audit:anchor", ""));
        if (!force && this._auditVerifyCache && this._auditVerifyCache.key === cacheKey &&
            Date.now() - Number(this._auditVerifyCache.at || 0) < 10000) {
            return this._auditVerifyCache.value;
        }
        const seqs = index.slice().sort((a, b) => Number(a) - Number(b));
        let prevHash = String(this.get("audit:anchor", "") || "");
        let valid = true;
        let count = 0;
        let firstSeq = null;
        let lastSeq = null;
        for (const seq of seqs) {
            const entry = this.get("audit:" + seq, null);
            if (!entry) continue;
            count += 1;
            if (firstSeq === null) firstSeq = seq;
            lastSeq = seq;
            if (entry.prevHash !== prevHash) valid = false;
            const recompute = {
                schema: entry.schema,
                seq: entry.seq,
                ts: entry.ts,
                operator: entry.operator,
                action: entry.action,
                taskId: entry.taskId,
                target: entry.target,
                detail: entry.detail,
                state: entry.state,
                error: entry.error,
                prevHash: entry.prevHash
            };
            if (sha256Hex(JSON.stringify(recompute)) !== entry.hash) valid = false;
            prevHash = entry.hash;
        }
        const value = { valid: valid, count: count, firstSeq: firstSeq, lastSeq: lastSeq };
        this._auditVerifyCache = { key: cacheKey, at: Date.now(), value: value };
        return value;
    }

    appendFlow(event) {
        this.set("flow:" + event.id, event);
        this.flowIndex.unshift(event.id, (id) => {
            try { this.db.delete("flow:" + id); } catch (e) { /* 忽略 */ }
        });
    }

    putFlow(event) {
        if (!event || !event.id) return false;
        this.set("flow:" + event.id, event);
        const recent = this.flowIndex.read(5000);
        if (recent.indexOf(event.id) < 0) this.flowIndex.unshift(event.id);
        return true;
    }

    listFlow(filter, limit) {
        const f = filter || {};
        const index = this.flowIndex.read(5000);
        const out = [];
        const max = Math.max(1, Math.min(Number(limit || 100), 500));
        for (const id of index) {
            const event = this.get("flow:" + id, null);
            if (!event) continue;
            if (f.xuid && event.xuid !== f.xuid) continue;
            if (f.kind && event.kind !== f.kind) continue;
            if (f.direction && event.direction !== f.direction) continue;
            if (f.item && event.item && event.item.t !== f.item) continue;
            out.push(event);
            if (out.length >= max) break;
        }
        return out;
    }
}

export { Store };
