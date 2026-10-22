// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 WebBundle contributors

import { serializeItem, nbtValueToSnbt } from "../item.js";
import { log } from "../core.js";

export const logisticsModule = {
    id: "logistics",
    name: "物品去向记录",
    version: "1.0.0",
    setup(ctx) {
        const app = ctx.app;
        let seq = 0;
        const uiCraftState = new Map();
        const inventoryCache = new Map();
        const uiCraftTimer = setInterval(() => pollAllCraftingUi(), 30000);

        function nextId() {
            seq += 1;
            return app.config.serverId + ":flow:" + Date.now().toString(36) + "-" + seq.toString(36) + "-" + Math.random().toString(36).slice(2, 6);
        }

        function record(player, kind, direction, item, entity, extra) {
            if (!player || !item) return null;
            const data = serializeItem(item, { full: false });
            if (!data) return null;
            const pos = player.pos || null;
            const event = {
                schema: 1,
                id: nextId(),
                ts: Date.now(),
                serverId: app.config.serverId,
                xuid: String(player.xuid),
                name: String(player.name || player.realName || ""),
                kind: kind,
                direction: direction,
                item: data,
                count: Number(item.count || data.c || 1),
                slot: -1,
                container: "inventory",
                pos: pos ? { x: pos.x, y: pos.y, z: pos.z } : null,
                dim: pos ? pos.dimid : 0,
                before: null,
                after: null,
                ref: entity ? "entity:" + String(entity.id || "") : null,
                txId: null,
                confidence: 1.0,
                traceId: app.config.serverId + ":" + Date.now()
            };
            if (extra && typeof extra === "object") Object.assign(event, extra);
            app.store.appendFlow(event);
            if (app.external) app.external.pushFlow(event);
            app.state.flow.unshift(event);
            if (app.state.flow.length > 2000) app.state.flow.length = 2000;
            return event;
        }

        function craftImpl(player, consumed, gained) {
            const outputs = Array.isArray(gained) ? gained.filter(Boolean) : [];
            const inputs = Array.isArray(consumed) ? consumed.filter(Boolean) : [];
            const output = outputs[0] || null;
            const consumedKey = inputs.map((item) => String(item.type || "") + "x" + Number(item.count || 0)).sort().join(",");
            const gainedKey = outputs.map((item) => String(item.type || "") + "x" + Number(item.count || 0)).sort().join(",");
            // UI 轮询和手动 flow.craft 可能同时上报同一次合成，2 秒内同内容只保留一条。
            const existing = app.state.flow.find((event) => event.kind === "craft" &&
                String(event.xuid) === String(player.xuid) &&
                Number(event.ts || 0) > Date.now() - 2000 &&
                String(event.consumedKey || "") === consumedKey &&
                String(event.gainedKey || "") === gainedKey);
            if (existing) return existing;
            const event = record(player, "craft", "in", output || inputs[0], null, {
                consumed: inputs.map((item) => serializeItem(item, { full: false })).filter(Boolean),
                gained: outputs.map((item) => serializeItem(item, { full: false })).filter(Boolean),
                consumedKey: consumedKey,
                gainedKey: gainedKey,
                craft: true
            });
        }

        function uiItem(entry) {
            if (!entry || !entry.Name) return null;
            try {
                const item = mc.newItem(String(entry.Name), Math.max(1, Number(entry.Count || 1)));
                if (item && entry.tag && typeof entry.tag === "object" && item.setNbt) {
                    item.setNbt(NBT.parseSNBT(nbtValueToSnbt(entry.tag)));
                }
                return item;
            } catch (e) {
                return null;
            }
        }

        function readInventoryCounts(player) {
            const counts = Object.create(null);
            const inv = player.getInventory ? player.getInventory() : null;
            if (inv) {
                for (let i = 0; i < 36; i++) {
                    const item = inv.getItem(i);
                    if (!item || !item.type) continue;
                    const type = String(item.type);
                    if (!counts[type]) counts[type] = 0;
                    counts[type] += Number(item.count || 0);
                }
            }
            return counts;
        }

        function refreshInventoryCache(player) {
            const counts = readInventoryCounts(player);
            inventoryCache.set(String(player.xuid), counts);
            return counts;
        }

        function adjustInventoryCache(player, slot, oldItem, newItem) {
            const xuid = String(player.xuid);
            let counts = inventoryCache.get(xuid);
            if (!counts) { counts = refreshInventoryCache(player); return counts; }
            const remove = (item) => {
                if (!item || !item.type) return;
                const type = String(item.type);
                counts[type] = Math.max(0, Number(counts[type] || 0) - Number(item.count || 0));
                if (!counts[type]) delete counts[type];
            };
            const add = (item) => {
                if (!item || !item.type) return;
                const type = String(item.type);
                counts[type] = Number(counts[type] || 0) + Number(item.count || 0);
            };
            remove(oldItem);
            add(newItem);
            return counts;
        }

        function inventoryCounts(player, cursor) {
            const xuid = String(player.xuid);
            let cached = inventoryCache.get(xuid);
            if (!cached) cached = refreshInventoryCache(player);
            const counts = Object.assign(Object.create(null), cached);
            if (cursor && cursor.Name) {
                const type = String(cursor.Name);
                if (!counts[type]) counts[type] = 0;
                counts[type] += Number(cursor.Count || 1);
            }
            return counts;
        }

        function pollAllCraftingUi() {
            const players = mc.getOnlinePlayers ? mc.getOnlinePlayers() : [];
            for (const player of players) {
                try { refreshInventoryCache(player); } catch (e) { /* 单个玩家 */ }
            }
            pollCraftingUi();
        }

        function pollCraftingUi(onlyPlayers) {
            try {
                const players = onlyPlayers || (mc.getOnlinePlayers ? mc.getOnlinePlayers() : []);
                for (const player of players) {
                    try {
                        const nbt = player.getNbt ? player.getNbt() : null;
                        const list = nbt && nbt.getTag ? nbt.getTag("PlayerUIItems") : null;
                        if (!list) continue;
                        let entries = [];
                        if (typeof list.toArray === "function") entries = list.toArray();
                        else if (typeof list.getSize === "function") {
                            const size = Number(list.getSize() || 0);
                            for (let i = 0; i < size; i++) {
                                const entry = list.getTag(i);
                                if (entry) entries.push(typeof entry.toObject === "function" ? entry.toObject() : entry);
                            }
                        }
                        const inputs = [];
                        let cursor = null;
                        for (const entry of entries) {
                            const data = entry && typeof entry.toObject === "function" ? entry.toObject() : entry;
                            const slot = Number(data && data.Slot);
                            if (slot >= 28 && slot <= 40) inputs.push(data);
                            else if (slot === 0) cursor = data;
                        }
                        const inputCount = inputs.reduce((n, entry) => n + Number(entry.Count || 1), 0);
                        const counts = inventoryCounts(player, cursor);
                        const previous = uiCraftState.get(String(player.xuid));
                        let pending = previous && previous.pending ? previous.pending : null;
                        // 合成栏材料减少：先挂起，等产物真正进入背包/光标后再记账。
                        if (previous && previous.inputCount > inputCount) {
                            pending = { inputs: previous.inputs, counts: previous.counts, ts: Date.now() };
                            // log("info", "合成栏变化: " + String(player.name || "") + " " + previous.inputs.map((entry) => entry.Name + "x" + entry.Count).join("+") + " -> " + inputCount);
                        }
                        if (pending && Date.now() - pending.ts < 1800) {
                            const inputTypes = new Set((pending.inputs || []).map((entry) => String(entry.Name || "")));
                            const gained = [];
                            for (const type of Object.keys(counts)) {
                                // 关闭合成界面时材料会原样回到背包，不能当成合成产物。
                                if (inputTypes.has(type)) continue;
                                const delta = Number(counts[type] || 0) - Number(pending.counts[type] || 0);
                                if (delta > 0) gained.push({ type: type, count: delta });
                            }
                            if (gained.length) {
                                const consumed = pending.inputs.map(uiItem).filter(Boolean);
                                const outputs = gained.map((entry) => mc.newItem(entry.type, entry.count)).filter(Boolean);
                                if (consumed.length && outputs.length) {
                                    craftImpl(player, consumed, outputs);
                                    pending = null;
                                }
                            }
                        }
                        if (pending && Date.now() - pending.ts >= 1800) pending = null;
                        uiCraftState.set(String(player.xuid), {
                            inputs: inputs.slice(0, 9),
                            inputCount: inputCount,
                            counts: counts,
                            pending: pending
                        });
                    } catch (e) {
                        // 单个玩家的 UI 数据异常不影响其他玩家
                    }
                }
            } catch (e) {
                // 忽略轮询异常
            }
        }

        return {
            record: record,
            onJoin: (player) => {
                refreshInventoryCache(player);
                pollCraftingUi([player]);
                setTimeout(() => {
                    try {
                        if (mc.getPlayer && mc.getPlayer(String(player.xuid))) {
                            refreshInventoryCache(player);
                            pollCraftingUi([player]);
                        }
                    } catch (e) { /* 玩家已离开 */ }
                }, 1500);
            },
            onLeft: (player) => {
                const xuid = String(player.xuid);
                inventoryCache.delete(xuid);
                uiCraftState.delete(xuid);
            },
            onInventoryChange: (player, slot, oldItem, newItem) => {
                const index = Number(slot);
                if (index >= 0 && index < 36) adjustInventoryCache(player, slot, oldItem, newItem);
                pollCraftingUi([player]);
            },
            drop: (player, item) => record(player, "drop", "out", item, null),
            pickup: (player, entity, item) => record(player, "pickup", "in", item, entity),
            craft: craftImpl,
            list: (filter, limit) => app.store.listFlow(filter, limit)
        };
    }
};
