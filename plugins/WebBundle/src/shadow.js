// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 WebBundle contributors

import { log } from "./core.js";
import { serializeItem, readPlayerSlots } from "./item.js";

class Shadow {
    constructor(app) {
        this.app = app;
        this.players = new Map();
        this.deltas = [];
        this.deltaSeq = 0;
        this.lastMinute = Math.floor(Date.now() / 60000);
    }

    fullOptions() {
        return {
            full: true,
            inlineMaxKB: this.app.config.nbt.inlineMaxKB,
            itemMaxKB: this.app.config.nbt.itemMaxKB,
            storeNbt: (hash, snbt) => this.app.store.putNbt(hash, snbt)
        };
    }

    seedPlayer(player) {
        const opt = this.fullOptions();
        const slots = readPlayerSlots(player, opt);
        const xuid = String(player.xuid);
        const playerName = String(player.name || player.realName || "");
        if (this.app.store.isBlockedName(playerName)) return null;
        const state = {
            xuid: xuid,
            uuid: String(player.uuid || ""),
            name: playerName,
            seq: 0,
            slots: slots,
            lastSeen: Date.now(),
            pos: player.pos ? { x: player.pos.x, y: player.pos.y, z: player.pos.z } : null,
            dim: player.pos ? player.pos.dimid : 0
        };
        this.players.set(xuid, state);
        this.app.state.playersMeta.set(xuid, {
            xuid: xuid,
            uuid: state.uuid,
            name: state.name,
            online: true,
            lastSeen: state.lastSeen,
            dim: state.dim,
            pos: state.pos
        });
        this.app.store.savePlayer(this.app.state.playersMeta.get(xuid));
        return state;
    }

    get(xuid) {
        return this.players.get(String(xuid)) || null;
    }

    view(xuid) {
        const state = this.get(xuid);
        if (state) {
            return {
                xuid: state.xuid,
                uuid: state.uuid,
                name: state.name,
                seq: state.seq,
                ts: state.lastSeen,
                source: "live",
                containers: state.slots,
                dim: state.dim,
                pos: state.pos
            };
        }
        const snapshot = this.app.store.latestSnapshot(xuid);
        if (!snapshot) return null;
        return {
            xuid: snapshot.xuid,
            uuid: snapshot.uuid,
            name: snapshot.name,
            seq: snapshot.seq,
            ts: snapshot.ts,
            source: "snapshot",
            containers: {
                inventory: snapshot.inventory || [],
                armor: snapshot.armor || [],
                offhand: snapshot.offhand || [],
                ender: snapshot.ender || []
            },
            dim: snapshot.dim,
            pos: snapshot.pos
        };
    }

    slot(xuid, container, slot) {
        const state = this.get(xuid);
        if (state) {
            const list = state.slots[container] || [];
            const entry = list.find((e) => Number(e.slot) === Number(slot));
            return entry ? entry.item : null;
        }
        const snapshot = this.app.store.latestSnapshot(xuid);
        if (!snapshot) return null;
        const list = snapshot[container] || [];
        const entry = list.find((e) => Number(e.slot) === Number(slot));
        return entry ? entry.item : null;
    }

    setSlot(xuid, container, slot, item, fullNbt) {
        const state = this.get(xuid);
        if (!state) return;
        const list = state.slots[container] || [];
        const filtered = list.filter((e) => Number(e.slot) !== Number(slot));
        const data = serializeItem(item, fullNbt ? {
            full: true,
            inlineMaxKB: this.app.config.nbt.inlineMaxKB,
            itemMaxKB: this.app.config.nbt.itemMaxKB,
            storeNbt: (hash, snbt) => this.app.store.putNbt(hash, snbt)
        } : { full: false });
        if (data) filtered.push({ slot: Number(slot), item: data });
        filtered.sort((a, b) => Number(a.slot) - Number(b.slot));
        state.slots[container] = filtered;
        state.seq += 1;
        state.lastSeen = Date.now();
        const delta = {
            id: ++this.deltaSeq,
            xuid: String(xuid),
            seq: state.seq,
            ts: state.lastSeen,
            changes: [{ container: container, slot: Number(slot), item: data }]
        };
        this.deltas.push(delta);
        if (this.deltas.length > 2000) this.deltas.splice(0, this.deltas.length - 2000);
    }

    stream(since) {
        const start = Number(since || 0);
        const events = [];
        for (const delta of this.deltas) {
            if (delta.id > start) events.push(delta);
        }
        return {
            events: events.slice(0, 200),
            nextSeq: events.length ? events[Math.min(events.length, 200) - 1].id : start,
            reset: start > 0 && events.length === 0
        };
    }

    onJoin(player) {
        const xuid = String(player.xuid);
        try {
            // onJoin 事件到达时立即读取一次，避免合成/查包依赖 1.5 秒延迟。
            const state = this.seedPlayer(player);
            if (!state) return;
            this.app.recorder.capturePlayer(player, "join");
            log("info", "种子完成: " + state.name + " (" + xuid + ")");
        } catch (e) {
            log("error", "进服种子失败: " + player.name + " " + e.message);
        }
    }

    onLeft(player) {
        try {
            this.app.recorder.capturePlayer(player, "leave");
        } catch (e) {
            log("warn", "退服备份失败: " + player.name + " " + e.message);
        }
        const xuid = String(player.xuid);
        this.players.delete(xuid);
        const meta = this.app.state.playersMeta.get(xuid);
        if (meta) meta.online = false;
        this.app.store.savePlayer(meta || { xuid: xuid, name: player.name, online: false, lastSeen: Date.now() });
    }

    onInventoryChange(player, slotNum, oldItem, newItem) {
        try {
            const state = this.get(player.xuid);
            if (!state) return;
            const data = newItem ? serializeItem(newItem, this.fullOptions()) : null;
            const list = state.slots.inventory || [];
            const filtered = list.filter((e) => Number(e.slot) !== Number(slotNum));
            if (data) filtered.push({ slot: Number(slotNum), item: data });
            filtered.sort((a, b) => Number(a.slot) - Number(b.slot));
            state.slots.inventory = filtered;
            state.seq += 1;
            state.lastSeen = Date.now();
            const delta = {
                id: ++this.deltaSeq,
                xuid: String(player.xuid),
                seq: state.seq,
                ts: state.lastSeen,
                changes: [{ container: "inventory", slot: Number(slotNum), item: data }]
            };
            this.deltas.push(delta);
            if (this.deltas.length > 2000) this.deltas.splice(0, this.deltas.length - 2000);
        } catch (e) {
            log("warn", "背包增量失败: " + e.message);
        }
    }

    onSetArmor(player, slotNum, item) {
        try {
            const state = this.get(player.xuid);
            if (!state) return;
            const data = item ? serializeItem(item, this.fullOptions()) : null;
            const list = state.slots.armor || [];
            const filtered = list.filter((e) => Number(e.slot) !== Number(slotNum));
            if (data) filtered.push({ slot: Number(slotNum), item: data });
            filtered.sort((a, b) => Number(a.slot) - Number(b.slot));
            state.slots.armor = filtered;
            state.seq += 1;
            state.lastSeen = Date.now();
        } catch (e) {
            log("warn", "盔甲增量失败: " + e.message);
        }
    }

    tick() {
        const minute = Math.floor(Date.now() / 60000);
        if (minute === this.lastMinute) return;
        this.lastMinute = minute;
        const batch = this.app.recorder.newBatch("minute");
        for (const state of this.players.values()) {
            const player = mc.getPlayer(state.xuid);
            if (!player) continue;
            try {
                this.app.recorder.capturePlayer(player, "minute", batch);
            } catch (e) {
                log("warn", "分钟备份失败: " + state.name + " " + e.message);
            }
        }
    }
}

export { Shadow };
