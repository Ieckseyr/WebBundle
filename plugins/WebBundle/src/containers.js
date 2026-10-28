// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 WebBundle contributors

import { fnv1a, log } from "./core.js";
import { serializeItem } from "./item.js";

class ContainerTracker {
    constructor(app) {
        this.app = app;
        this.started = false;
        this.lastObservation = new Map();
    }

    start() {
        if (this.started) return;
        this.started = true;
        mc.listen("onOpenContainer", (player, block) => this.capture(player, block, "open"));
        mc.listen("onCloseContainer", (player, block) => this.capture(player, block, "close"));
        mc.listen("onContainerChange", (player, block) => this.capture(player, block, "change"));
        mc.listen("onBlockChanged", (before, after) => this.onBlockChanged(before, after));
        log("info", "容器地图采集已启用");
    }

    posOf(block) {
        const pos = block && block.pos;
        if (!pos) return null;
        return {
            dim: Number(pos.dimid || 0),
            x: Math.floor(Number(pos.x || 0)),
            y: Math.floor(Number(pos.y || 0)),
            z: Math.floor(Number(pos.z || 0))
        };
    }

    playerOf(player) {
        if (!player) return null;
        return { xuid: String(player.xuid || ""), name: String(player.name || player.realName || "") };
    }

    readItems(container) {
        const size = Math.max(0, Math.min(256, Number(container.size || 0)));
        const items = [];
        for (let i = 0; i < size; i++) {
            let item = null;
            try { item = container.getItem(i); } catch (e) { item = null; }
            if (!item) continue;
            const data = serializeItem(item, {
                full: true,
                inlineMaxKB: this.app.config.nbt.inlineMaxKB,
                itemMaxKB: this.app.config.nbt.itemMaxKB,
                storeNbt: (hash, snbt) => this.app.store.putNbt(hash, snbt)
            });
            if (data) items.push({ slot: i, item: data });
        }
        let count = 0;
        for (const entry of items) count += Number(entry.item && entry.item.c || 1);
        return { size: size, items: items, itemCount: count };
    }

    pairOf(block) {
        try {
            const be = block.getBlockEntity ? block.getBlockEntity() : null;
            const nbt = be && be.getNbt ? be.getNbt() : null;
            if (!nbt) return null;
            let obj = null;
            try { obj = nbt.toObject ? nbt.toObject() : null; } catch (e) { obj = null; }
            if (!obj) return null;
            const pairX = Number(obj.pairx);
            const pairZ = Number(obj.pairz);
            if (!Number.isFinite(pairX) || !Number.isFinite(pairZ)) return null;
            return { x: pairX, z: pairZ, lead: !!Number(obj.pairlead), axis: pairX !== Number(block.pos.x) ? "x" : (pairZ !== Number(block.pos.z) ? "z" : "") };
        } catch (e) {
            return null;
        }
    }

    facingOf(block) {
        try {
            const nbt = block.getNbt();
            const state = nbt && nbt.getTag ? nbt.getTag("states") : null;
            const obj = state && state.toObject ? state.toObject() : (block.getBlockState() || {});
            const raw = obj["minecraft:facing_direction"] != null ? obj["minecraft:facing_direction"] : obj["facing_direction"];
            if (raw != null) {
                const map = ["down", "up", "north", "south", "west", "east"];
                const value = Number(raw);
                if (Number.isFinite(value) && map[value]) return map[value];
            }
            const cardinal = obj["minecraft:cardinal_direction"] || obj["cardinal_direction"];
            return cardinal ? String(cardinal).toLowerCase() : "";
        } catch (e) {
            return "";
        }
    }

    capture(player, block, reason) {
        if (!block || typeof block.hasContainer !== "function" || !block.hasContainer()) return null;
        const p = this.posOf(block);
        if (!p) return null;
        let container = null;
        try { container = block.getContainer(); } catch (e) { container = null; }
        if (!container) return null;

        const now = Date.now();
        const content = this.readItems(container);
        const pair = this.pairOf(block);
        const id = this.app.store.containerId(p.dim, p.x, p.y, p.z);
        const hash = fnv1a(JSON.stringify(content.items));
        const previous = this.lastObservation.get(id);
        if (reason !== "close" && previous && previous.hash === hash && now - previous.at < 800) return null;
        if (previous && reason === "change" && now - previous.at < 700) return null;

        const existing = this.app.store.getContainer(id);
        const record = existing || {
            schema: 1,
            id: id,
            dim: p.dim,
            x: p.x,
            y: p.y,
            z: p.z,
            type: String(block.type || "minecraft:container"),
            name: String(block.name || block.type || "容器"),
            generation: 1,
            firstSeen: now,
            lastSeen: now,
            removedAt: 0,
            state: "present",
            observations: [],
            dayKeys: []
        };
        record.type = String(block.type || record.type);
        record.name = String(block.name || record.name);
        record.size = Number(content.size || record.size || 0);
        record.facing = this.facingOf(block);
        if (pair) {
            record.pairX = pair.x;
            record.pairZ = pair.z;
            record.pairLead = pair.lead;
            record.doubleAxis = pair.axis;
        }
        record.lastSeen = now;
        const observation = {
            schema: 1,
            id: "obs-" + now.toString(36) + "-" + Math.random().toString(36).slice(2, 7),
            containerId: id,
            at: now,
            reason: reason,
            player: this.playerOf(player),
            type: record.type,
            dim: p.dim,
            x: p.x,
            y: p.y,
            z: p.z,
            size: content.size,
            facing: this.facingOf(block),
            pairX: pair ? pair.x : undefined,
            pairZ: pair ? pair.z : undefined,
            pairLead: pair ? pair.lead : undefined,
            items: content.items,
            itemCount: content.itemCount,
            containerCounts: { slots: content.size, filled: content.items.length },
            contentHash: hash
        };
        this.app.store.putContainerObservation(record, observation);
        this.lastObservation.set(id, { hash: hash, at: now, reason: reason });
        if (this.app.external && typeof this.app.external.pushContainer === "function") {
            this.app.external.pushContainer(record, observation);
        }
        return observation;
    }

    onBlockChanged(before, after) {
        if (!before || typeof before.hasContainer !== "function" || !before.hasContainer()) return;
        const p = this.posOf(before);
        if (!p) return;
        const afterHas = !!(after && typeof after.hasContainer === "function" && after.hasContainer());
        if (afterHas && String(after.type || "") === String(before.type || "")) return;
        this.app.store.markContainerRemoved(p.dim, p.x, p.y, p.z, String(before.type || ""));
    }
}

export { ContainerTracker };
