// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 WebBundle contributors

import { fnv1a, log } from "./core.js";
import { readPlayerSlots } from "./item.js";

class Recorder {
    constructor(app) {
        this.app = app;
        this.seq = new Map();
    }

    nextSeq(xuid) {
        let n = this.seq.get(xuid);
        if (n === undefined) {
            n = 0;
            try {
                const index = this.app.store.listSnapshotIndex(xuid, this.app.store.indexLimit);
                for (const entry of index) {
                    const byMeta = Number(entry.seq || 0);
                    const byId = Number(String(entry.id || "").split(":").pop());
                    n = Math.max(n, Number.isFinite(byMeta) ? byMeta : 0, Number.isFinite(byId) ? byId : 0);
                }
            } catch (e) {  }
        }
        n += 1;
        this.seq.set(xuid, n);
        return n;
    }

    snapshotId(xuid, seq, ts) {
        return this.app.config.serverId + ":" + xuid + ":" + seq + ":" + Number(ts || Date.now()).toString(36);
    }

    newBatch(reason) {
        const at = Date.now();
        return {
            id: this.app.config.serverId + ":batch:" + at.toString(36) + "-" + Math.random().toString(36).slice(2, 8),
            at: at,
            reason: reason || "manual"
        };
    }

    buildSnapshot(meta, slots, reason, batch) {
        const seq = this.nextSeq(meta.xuid);
        const now = Date.now();
        const batchInfo = batch || this.newBatch(reason);
        const id = this.snapshotId(meta.xuid, seq, now);
        let itemCount = 0;
        const containerCounts = {};
        for (const name of ["inventory", "armor", "offhand", "ender"]) {
            containerCounts[name] = (slots[name] || []).length;
            itemCount += containerCounts[name];
        }
        const compact = {
            inventory: slots.inventory || [],
            armor: slots.armor || [],
            offhand: slots.offhand || [],
            ender: slots.ender || []
        };
        return {
            schema: 1,
            id: id,
            serverId: this.app.config.serverId,
            xuid: meta.xuid,
            uuid: meta.uuid || "",
            name: meta.name || "",
            seq: seq,
            ts: now,
            minute: Math.floor(now / 60000),
            reason: reason || "manual",
            batchId: batchInfo.id,
            batchAt: batchInfo.at,
            batchReason: batchInfo.reason,
            hash: fnv1a(JSON.stringify(compact)),
            itemCount: itemCount,
            containerCounts: containerCounts,
            dim: meta.dim || 0,
            pos: meta.pos || null,
            inventory: compact.inventory,
            armor: compact.armor,
            offhand: compact.offhand,
            ender: compact.ender
        };
    }

    capturePlayer(player, reason, batch) {
        if (!player) return null;
        const playerName = String(player.name || player.realName || "");
        if (this.app.store.isBlockedName(playerName)) return null;
        const meta = {
            xuid: String(player.xuid),
            uuid: String(player.uuid || ""),
            name: playerName,
            dim: player.pos ? player.pos.dimid : 0,
            pos: player.pos ? { x: player.pos.x, y: player.pos.y, z: player.pos.z } : null
        };
        const opt = {
            full: true,
            inlineMaxKB: this.app.config.nbt.inlineMaxKB,
            itemMaxKB: this.app.config.nbt.itemMaxKB,
            storeNbt: (hash, snbt) => this.app.store.putNbt(hash, snbt)
        };
        const slots = readPlayerSlots(player, opt);
        const snapshot = this.buildSnapshot(meta, slots, reason, batch || this.newBatch(reason));
        const nbtRefs = this.collectNbtRefs(snapshot);
        this.app.store.putSnapshot(snapshot);
        if (this.app.external) this.app.external.pushSnapshot(snapshot, nbtRefs);
        this.app.state.playersMeta.set(meta.xuid, Object.assign({}, this.app.state.playersMeta.get(meta.xuid) || {}, meta, {
            online: true,
            lastSeen: snapshot.ts,
            latestSnapshotId: snapshot.id
        }));
        return snapshot;
    }

    collectNbtRefs(snapshot) {
        const refs = {};
        for (const group of ["inventory", "armor", "offhand", "ender"]) {
            for (const entry of snapshot[group] || []) {
                const item = entry.item;
                if (!item || !item.nbtRef || item.nbt) continue;
                const snbt = this.app.store.getNbt(item.nbtRef);
                if (snbt) refs[item.nbtRef] = snbt;
            }
        }
        return refs;
    }

    captureOffline(xuid, reason, slots, meta, batch) {
        const m = meta || this.app.store.getPlayer(xuid) || { xuid: xuid, name: "", uuid: "" };
        const snapshot = this.buildSnapshot({
            xuid: xuid,
            uuid: m.uuid || "",
            name: m.name || "",
            dim: m.dim || 0,
            pos: m.pos || null
        }, slots || { inventory: [], armor: [], offhand: [], ender: [] }, reason, batch || this.newBatch(reason));
        const nbtRefs = this.collectNbtRefs(snapshot);
        snapshot.online = false;
        this.app.store.putSnapshot(snapshot);
        if (this.app.external) this.app.external.pushSnapshot(snapshot, nbtRefs);
        return snapshot;
    }

    captureAll(reason) {
        const list = mc.getOnlinePlayers();
        const batch = this.newBatch(reason);
        for (const player of list) {
            try {
                this.capturePlayer(player, reason, batch);
            } catch (e) {
                log("warn", "备份玩家失败: " + player.name + " " + e.message);
            }
        }
    }

    latestFor(xuid) {
        return this.app.store.latestSnapshot(xuid);
    }
}

export { Recorder };
