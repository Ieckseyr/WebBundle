// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 WebBundle contributors

import { log, newId } from "./core.js";
import {
    serializeItem,
    deserializeItem,
    readOfflineSlots,
    writeOfflineSlots,
    applyOnlineSlots,
    containerOf,
    nbtValueToSnbt,
    ENCHANT_STR_TO_NUM
} from "./item.js";

class Actions {
    constructor(app) {
        this.app = app;
        this.queue = [];
        this.running = false;
    }

    create(type, payload, operator) {
        const taskId = newId("task");
        const task = {
            schema: 1,
            taskId: taskId,
            kind: type === "command.execute" ? "command" : "action",
            actionId: type,
            state: "queued",
            operator: operator || { name: "web", role: "admin", ip: "" },
            input: payload || {},
            result: null,
            error: null,
            createdAt: Date.now(),
            startedAt: null,
            finishedAt: null,
            traceId: taskId
        };
        this.app.store.putTask(task);
        this.queue.push(taskId);
        return task;
    }

    getTask(taskId) {
        return this.app.store.getTask(taskId);
    }

    list(limit, state) {
        return this.app.store.listTasks(limit, state);
    }

    update(task) {
        this.app.store.putTask(task);
    }

    tick() {
        if (this.running) return;
        this.running = true;
        try {
            let count = 0;
            while (this.queue.length && count < 4) {
                const taskId = this.queue.shift();
                const task = this.getTask(taskId);
                if (!task || task.state !== "queued") continue;
                this.execute(task);
                count += 1;
            }
        } finally {
            this.running = false;
        }
    }

    auditDetail(task) {
        const input = task && task.input ? task.input : {};
        const parts = [];
        if (input.container) parts.push(String(input.container));
        if (input.slot !== undefined && input.slot !== null) parts.push("槽位 " + Number(input.slot));
        if (Array.isArray(input.path) && input.path.length) parts.push("嵌套 " + input.path.join("/"));
        const item = input.item || {};
        if (item.t) parts.push(String(item.t));
        if (input.t) parts.push(String(input.t));
        if (input.command) parts.push("指令 " + String(input.command).slice(0, 220));
        return parts.join(" · ");
    }

    execute(task) {
        task.state = "running";
        task.startedAt = Date.now();
        this.update(task);
        try {
            const payload = task.input || {};
            let result = null;
            switch (task.actionId) {
                case "command.execute":
                    result = this.command(payload);
                    break;
                case "inventory.set":
                case "inventory.add":
                case "inventory.remove":
                case "inventory.edit":
                    result = this.editInventory(payload, task.actionId);
                    break;
                case "item.nbt.set":
                    result = this.setNbt(payload);
                    break;
                case "item.enchants.set":
                    result = this.setEnchants(payload);
                    break;
                case "item.lore.set":
                    result = this.setLoreTags(payload);
                    break;
                case "item.name.set":
                    result = this.setDisplayName(payload);
                    break;
                case "flow.craft":
                    result = this.recordCraft(payload);
                    break;
                case "item.nested.set":
                    result = this.setNested(payload);
                    break;
                case "item.nbt.refresh":
                    result = this.refreshNbt(payload);
                    break;
                case "inventory.restore":
                    result = this.restore(payload);
                    break;
                case "backup.create":
                    result = this.backup(payload);
                    break;
                case "offline.snapshot":
                    result = this.offlineSnapshot(payload);
                    break;
                default:
                    throw new Error("未知动作: " + task.actionId);
            }
            task.result = result;
            task.state = "succeeded";
        } catch (e) {
            task.error = e && e.message ? e.message : String(e);
            task.state = "failed";
            log("warn", "动作失败 " + task.actionId + ": " + task.error);
        } finally {
            task.finishedAt = Date.now();
            this.update(task);
            try {
                const entry = this.app.store.appendAudit({
                    operator: task.operator ? task.operator.name : "web",
                    action: task.actionId,
                    taskId: task.taskId,
                    target: task.input && task.input.xuid ? String(task.input.xuid) : "",
                    detail: this.auditDetail(task),
                    state: task.state,
                    error: task.error || ""
                });
                if (this.app.external && entry) this.app.external.pushAudit(entry);
            } catch (e) {
                log("warn", "审计写入失败: " + e.message);
            }
        }
    }

    recordCraft(payload) {
        const xuid = String(payload.xuid || "");
        const player = xuid ? mc.getPlayer(xuid) : null;
        if (!player) throw new Error("合成记录需要在线玩家");
        const module = this.app.modules ? this.app.modules.get("logistics") : null;
        if (!module || typeof module.craft !== "function") throw new Error("物品去向模块未加载");
        const toItem = (entry) => {
            if (!entry || !entry.t) return null;
            try { return deserializeItem(entry); } catch (e) { return null; }
        };
        const consumed = (Array.isArray(payload.consumed) ? payload.consumed : []).map(toItem).filter(Boolean);
        const gained = (Array.isArray(payload.gained) ? payload.gained : []).map(toItem).filter(Boolean);
        if (!consumed.length && !gained.length) throw new Error("缺少合成物品");
        const event = module.craft(player, consumed, gained);
        return { ok: true, id: event ? event.id : null };
    }

    command(payload) {
        const api = this.app.modules ? this.app.modules.get("command") : null;
        if (!api || typeof api.execute !== "function") throw new Error("command 模块未加载");
        return api.execute(payload);
    }

    editInventory(payload, actionId) {
        const xuid = String(payload.xuid || "");
        const container = String(payload.container || "inventory");
        const slot = Number(payload.slot || 0);
        if (!xuid) throw new Error("缺少 xuid");
        if (["inventory", "armor", "offhand", "ender"].indexOf(container) < 0) throw new Error("非法容器");
        const player = mc.getPlayer(xuid);
        const data = actionId === "inventory.remove" ? null : (payload.item || null);
        if (data) {
            if (payload.durability !== undefined && payload.durability !== null) data.durability = Number(payload.durability);
            if (payload.durMax !== undefined && payload.durMax !== null) data.durMax = Number(payload.durMax);
        }
        if (!data && actionId !== "inventory.remove") throw new Error("缺少物品");
        if (player) return this.editOnline(player, xuid, container, slot, data);
        return this.editOffline(xuid, container, slot, data);
    }

    editOnline(player, xuid, container, slot, data) {
        if (container === "offhand") {
            if (typeof player.setOffHand !== "function") throw new Error("当前 LSE 版本不支持写副手槽");
            if (!data) {
                // 副手清空必须走 setOffHand(null)，只改 getOffHand() 对象不会删除槽位。
                player.setOffHand(null);
                this.app.shadow.setSlot(xuid, "offhand", 0, null, true);
                try { if (typeof player.refreshItems === "function") player.refreshItems(); } catch (e) { /* 刷新失败 */ }
                return { ok: true, target: "online" };
            }
            const item = deserializeItem(Object.assign({}, data, { __nbtLoader: (h) => this.app.store.getNbt(h) }));
            if (!item) throw new Error("副手物品反序列化失败");
            if (data.durability !== undefined && data.durMax) {
                const nbt = item.getNbt ? item.getNbt() : null;
                if (nbt) {
                    nbt.setShort("Damage", Math.max(0, Number(data.durMax) - Number(data.durability)));
                    item.setNbt(nbt);
                }
            }
            player.setOffHand(item);
            this.app.shadow.setSlot(xuid, "offhand", 0, item, true);
            try { if (typeof player.refreshItems === "function") player.refreshItems(); } catch (e) { /* 刷新失败 */ }
            return { ok: true, target: "online" };
        }
        const ct = containerOf(player, container);
        if (!ct) throw new Error("容器不存在");
        let item = null;
        if (data) item = deserializeItem(Object.assign({}, data, { __nbtLoader: (h) => this.app.store.getNbt(h) }));
        if (item) {
            if (data && data.durability !== undefined && data.durMax) {
                const nbt = item.getNbt ? item.getNbt() : null;
                if (nbt) {
                    nbt.setShort("Damage", Math.max(0, Number(data.durMax) - Number(data.durability)));
                    item.setNbt(nbt);
                }
            }
            ct.setItem(slot, item);
        } else ct.removeItem(slot, 999999);
        this.app.shadow.setSlot(xuid, container, slot, item, true);
        try { if (player && typeof player.refreshItems === "function") player.refreshItems(); } catch (e) { /* 刷新失败不影响数据 */ }
        return { ok: true, target: "online" };
    }

    editOffline(xuid, container, slot, itemData) {
        let uuid = null;
        try {
            uuid = data.xuid2uuid(xuid);
        } catch (e) {
            uuid = null;
        }
        if (!uuid) throw new Error("找不到离线玩家 UUID: " + xuid);
        const slots = readOfflineSlots(uuid, { full: true }) || { inventory: [], armor: [], offhand: [], ender: [] };
        const list = slots[container] || [];
        const filtered = list.filter((entry) => Number(entry.slot) !== Number(slot));
        if (itemData) {
            if (itemData.durability !== undefined && itemData.durMax) {
                try {
                    const nbt = itemData.nbt ? NBT.parseSNBT(itemData.nbt) : NBT.parseSNBT("{}");
                    nbt.setShort("Damage", Math.max(0, Number(itemData.durMax) - Number(itemData.durability)));
                    itemData.nbt = nbt.toSNBT();
                } catch (e) { /* 保留原样 */ }
            }
            filtered.push({ slot: Number(slot), item: itemData });
        }
        filtered.sort((a, b) => Number(a.slot) - Number(b.slot));
        slots[container] = filtered;
        const res = writeOfflineSlots(uuid, slots, [container]);
        if (!res.ok) throw new Error(res.error || "离线写入失败");
        return { ok: true, target: "offline", uuid: uuid, tags: res.tags };
    }

    setNbt(payload) {
        const xuid = String(payload.xuid || "");
        const container = String(payload.container || "inventory");
        const slot = Number(payload.slot || 0);
        const snbt = String(payload.nbt || "");
        if (!snbt) throw new Error("NBT 为空");
        const maxBytes = Number(this.app.config.nbt.itemMaxKB || 512) * 1024;
        if (snbt.length > maxBytes) throw new Error("NBT 超过单物品上限");
        const player = mc.getPlayer(xuid);
        if (player) {
            const ct = container === "offhand" ? null : containerOf(player, container);
            const item = container === "offhand" ? player.getOffHand() : (ct ? ct.getItem(slot) : null);
            if (!item) throw new Error("槽位没有物品");
            const nbt = NBT.parseSNBT(snbt);
            if (!item.setNbt(nbt)) throw new Error("setNbt 失败");
            if (ct) ct.setItem(slot, item);
            this.app.shadow.setSlot(xuid, container, container === "offhand" ? 0 : slot, item, true);
            try { if (typeof player.refreshItems === "function") player.refreshItems(); } catch (e) { /* 刷新失败不影响数据 */ }
            return { ok: true, target: "online" };
        }
        let uuid = null;
        try {
            uuid = data.xuid2uuid(xuid);
        } catch (e) {
            uuid = null;
        }
        if (!uuid) throw new Error("找不到离线玩家 UUID");
        const slots = readOfflineSlots(uuid, { full: true }) || { inventory: [], armor: [], offhand: [], ender: [] };
        const list = slots[container] || [];
        const entry = list.find((e) => Number(e.slot) === Number(slot));
        if (!entry) throw new Error("槽位没有物品");
        entry.item.nbt = snbt;
        const res = writeOfflineSlots(uuid, slots, [container]);
        if (!res.ok) throw new Error(res.error || "离线写入失败");
        return { ok: true, target: "offline", uuid: uuid };
    }

    setNested(payload) {
        const xuid = String(payload.xuid || "");
        const container = String(payload.container || "inventory");
        const slot = Number(payload.slot || 0);
        const path = Array.isArray(payload.path) ? payload.path.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 0).slice(0, 64) : [];
        if (!xuid || !path.length) throw new Error("缺少嵌套路径");
        if (["inventory", "armor", "offhand", "ender"].indexOf(container) < 0) throw new Error("非法容器");

        const mutate = (outer) => {
            if (!outer || typeof outer !== "object") throw new Error("无法读取父物品 NBT");
            let current = outer.tag && typeof outer.tag === "object" ? outer.tag : outer;
            let target = null;
            for (const wanted of path) {
                let items = current.BlockEntityTag && current.BlockEntityTag.Items
                    ? current.BlockEntityTag.Items
                    : (current.Items || current.storage_item_component_content || current.StorageItemComponentContent || current["storage_item_component_content"] || current.bundle_content || current.BundleContent);
                if (items && !Array.isArray(items) && Array.isArray(items.items)) items = items.items;
                if (items && !Array.isArray(items) && Array.isArray(items.Items)) items = items.Items;
                if (Array.isArray(items) && !items.length) {
                    const alt = current.storage_item_component_content || current.StorageItemComponentContent || current["storage_item_component_content"];
                    if (Array.isArray(alt)) items = alt;
                    else if (alt && Array.isArray(alt.items)) items = alt.items;
                    else if (alt && Array.isArray(alt.Items)) items = alt.Items;
                }
                if (Array.isArray(items) && !items.length) {
                    const alt = current.storage_item_component_content || current.StorageItemComponentContent || current["storage_item_component_content"];
                    if (Array.isArray(alt)) items = alt;
                    else if (alt && Array.isArray(alt.items)) items = alt.items;
                    else if (alt && Array.isArray(alt.Items)) items = alt.Items;
                }
                if (!Array.isArray(items)) throw new Error("嵌套路径不存在");
                target = items.find((entry) => Number(entry.Slot !== undefined ? entry.Slot : entry.slot) === wanted);
                if (!target && items[wanted]) target = items[wanted];
                if (!target) throw new Error("嵌套槽位不存在");
                const nestedTarget = target.item && typeof target.item === "object" ? target.item : target;
                target = nestedTarget;
                current = nestedTarget.tag && typeof nestedTarget.tag === "object" ? nestedTarget.tag : nestedTarget;
            }
            if (!target) throw new Error("嵌套目标不存在");
            const item = payload.item && typeof payload.item === "object" ? payload.item : {};
            if (item.t && String(item.t).trim()) target.Name = String(item.t).trim();
            if (item.c !== undefined) target.Count = Math.max(1, Math.min(255, Number(item.c || 1)));
            let tag = target.tag && typeof target.tag === "object" ? target.tag : {};
            if (payload.nbt || item.nbt) {
                try {
                    const parsed = NBT.parseSNBT(String(payload.nbt || item.nbt));
                    const obj = parsed && parsed.toObject ? parsed.toObject() : null;
                    if (!obj) throw new Error("empty");
                    tag = obj.tag && typeof obj.tag === "object" ? obj.tag : obj;
                } catch (e) {
                    throw new Error("嵌套 SNBT 无效");
                }
            }
            if (payload.displayName !== undefined) {
                const displayName = String(payload.displayName || "").trim().slice(0, 128);
                if (!tag.display || typeof tag.display !== "object") tag.display = {};
                if (displayName) tag.display.Name = displayName;
                else delete tag.display.Name;
            }
            if (payload.lore !== undefined) {
                const lore = (Array.isArray(payload.lore) ? payload.lore : []).map((line) => String(line || "").slice(0, 256)).filter(Boolean).slice(0, 64);
                if (!tag.display || typeof tag.display !== "object") tag.display = {};
                if (lore.length) tag.display.Lore = lore;
                else delete tag.display.Lore;
            }
            if (payload.tags && typeof payload.tags === "object") {
                const list = (value) => (Array.isArray(value) ? value : []).map((v) => String(v || "").trim()).filter((v) => /^[a-z0-9_:.\-]{1,128}$/i.test(v)).map((v) => v.indexOf(":") >= 0 ? v : "minecraft:" + v).slice(0, 64);
                const place = list(payload.tags.canPlaceOn);
                const destroy = list(payload.tags.canDestroy);
                // 基岩版实际存储：方块白名单在物品根节点，锁定/死亡在 tag 内且为 byte。
                delete target.CanPlaceOn;
                delete target.CanDestroy;
                if (place.length) target.CanPlaceOn = place;
                if (destroy.length) target.CanDestroy = destroy;
                delete tag["minecraft:can_place_on"];
                delete tag["minecraft:can_destroy"];
                delete tag.KeepOnDeath;
                delete tag["minecraft:keep_on_death"];
                if (payload.tags.keepOnDeath) tag["minecraft:keep_on_death"] = 1;
                delete tag.ItemLock;
                delete tag["minecraft:item_lock"];
                if (payload.tags.itemLock) tag["minecraft:item_lock"] = String(payload.tags.itemLock) === "lock_in_slot" ? 1 : 2;
            }
            if (Array.isArray(payload.enchants)) {
                const key = String(item.t || target.Name || "") === "minecraft:enchanted_book" ? "StoredEnchantments" : "ench";
                if (payload.enchants.length) {
                    tag[key] = payload.enchants.map((entry) => {
                        const raw = String(entry.id || "").replace(/^minecraft:/i, "").replace(/^enchant_/i, "");
                        let numeric = ENCHANT_STR_TO_NUM[raw];
                        if (numeric === undefined) numeric = Number(raw);
                        if (!Number.isInteger(numeric) || numeric < 0 || numeric > 255) throw new Error("未知附魔: " + entry.id);
                        return { id: numeric, lvl: Math.max(1, Math.min(32767, Number(entry.level || 1))) };
                    });
                } else {
                    delete tag[key];
                }
            }
            if (payload.durability !== undefined && payload.durability !== null && payload.durMax) {
                tag.Damage = Math.max(0, Math.min(Number(payload.durMax), Number(payload.durMax) - Number(payload.durability)));
            }
            if (payload.durability !== undefined && payload.durability !== null && payload.durMax) {
                tag.Damage = Math.max(0, Math.min(Number(payload.durMax), Number(payload.durMax) - Number(payload.durability)));
            }
            target.tag = tag;
            return outer;
        };

        const player = mc.getPlayer(xuid);
        if (player) {
            const ct = container === "offhand" ? null : containerOf(player, container);
            const item = container === "offhand" ? player.getOffHand() : (ct ? ct.getItem(slot) : null);
            if (!item) throw new Error("父物品不存在");
            if (/shulker_box/i.test(String(item.type || ""))) throw new Error("潜影盒内容仅支持查看，禁止修改");
            let nbt = item.getNbt ? item.getNbt() : null;
            if (!nbt) nbt = NBT.parseSNBT("{}");
            const obj = nbt.toObject ? nbt.toObject() : null;
            const outer = mutate(obj);
            const parsed = NBT.parseSNBT(nbtValueToSnbt(outer));
            if (!parsed || !item.setNbt(parsed)) throw new Error("父物品 NBT 写入失败");
            if (ct) ct.setItem(slot, item);
            this.app.shadow.setSlot(xuid, container, container === "offhand" ? 0 : slot, item, true);
            try { if (typeof player.refreshItems === "function") player.refreshItems(); } catch (e) { /* 刷新失败 */ }
            return { ok: true, target: "online", path: path };
        }

        let uuid = null;
        try { uuid = data.xuid2uuid(xuid); } catch (e) { uuid = null; }
        if (!uuid) throw new Error("找不到离线玩家 UUID");
        const slots = readOfflineSlots(uuid, { full: true }) || { inventory: [], armor: [], offhand: [], ender: [] };
        const list = slots[container] || [];
        const parent = list.find((entry) => Number(entry.slot) === Number(slot));
        if (!parent || !parent.item) throw new Error("父物品不存在");
        if (/shulker_box/i.test(String(parent.item.t || ""))) throw new Error("潜影盒内容仅支持查看，禁止修改");
        let nbt = null;
        try { nbt = parent.item.nbt ? NBT.parseSNBT(parent.item.nbt) : NBT.parseSNBT("{}"); } catch (e) { nbt = NBT.parseSNBT("{}"); }
        const outer = mutate(nbt.toObject ? nbt.toObject() : {});
        parent.item.nbt = nbtValueToSnbt(outer);
        const res = writeOfflineSlots(uuid, slots, [container]);
        if (!res.ok) throw new Error(res.error || "离线写入失败");
        return { ok: true, target: "offline", path: path };
    }

    setLoreTags(payload) {
        const xuid = String(payload.xuid || "");
        const container = String(payload.container || "inventory");
        const slot = Number(payload.slot || 0);
        if (!xuid) throw new Error("缺少 xuid");
        if (["inventory", "armor", "offhand", "ender"].indexOf(container) < 0) throw new Error("非法容器");
        const lore = (Array.isArray(payload.lore) ? payload.lore : [])
            .map((line) => String(line || "").slice(0, 256))
            .filter((line) => line.length > 0)
            .slice(0, 64);
        const rawTags = payload.tags && typeof payload.tags === "object" ? payload.tags : {};
        const tagList = (value) => (Array.isArray(value) ? value : [])
            .map((line) => String(line || "").trim())
            .filter((line) => /^[a-z0-9_:.\-]{1,128}$/i.test(line))
            .map((line) => line.indexOf(":") >= 0 ? line : "minecraft:" + line)
            .slice(0, 64);
        const canPlaceOn = tagList(rawTags.canPlaceOn);
        const canDestroy = tagList(rawTags.canDestroy);
        const keepOnDeath = !!rawTags.keepOnDeath;
        const itemLock = String(rawTags.itemLock || "").trim();
        if (itemLock && ["lock_in_slot", "lock_in_inventory"].indexOf(itemLock) < 0) throw new Error("非法 ItemLock");

        const apply = (nbt, withLore) => {
            let target = nbt;
            let itemRoot = null;
            try {
                const wrapper = nbt.getTag("tag");
                if (wrapper && typeof wrapper.setTag === "function") {
                    target = wrapper;
                    itemRoot = nbt;
                } else if (nbt.getTag("Name")) {
                    // 没有 tag 时创建标准物品 tag，组件必须写在 tag 内。
                    target = new NbtCompound();
                    nbt.setTag("tag", target);
                    itemRoot = nbt;
                }
            } catch (e) {
                target = nbt;
            }
            let display = null;
            try { display = target.getTag("display"); } catch (e) { display = null; }
            if (!display) {
                display = new NbtCompound();
                target.setTag("display", display);
            }
            if (withLore !== false) {
                if (lore.length) {
                    const list = new NbtList();
                    for (const line of lore) list.addTag(new NbtString(line));
                    display.setTag("Lore", list);
                } else {
                    try { display.removeTag("Lore"); } catch (e) { /* 不存在 */ }
                }
            }
            const writeBlockList = (key, values) => {
                if (itemRoot) {
                    try { itemRoot.removeTag(key); } catch (e) { /* 不存在 */ }
                    if (values.length) {
                        const list = new NbtList();
                        for (const value of values) list.addTag(new NbtString(value));
                        itemRoot.setTag(key, list);
                    }
                }
                // 清理旧版错误的 tag 内组件写法。
                try { target.removeTag(key); } catch (e) { /* 不存在 */ }
            };
            writeBlockList("CanPlaceOn", canPlaceOn);
            writeBlockList("CanDestroy", canDestroy);
            try { target.removeTag("minecraft:can_place_on"); } catch (e) { /* 不存在 */ }
            try { target.removeTag("minecraft:can_destroy"); } catch (e) { /* 不存在 */ }
            try { target.removeTag("KeepOnDeath"); } catch (e) { /* 不存在 */ }
            if (keepOnDeath) target.setByte("minecraft:keep_on_death", 1);
            else {
                try { target.removeTag("minecraft:keep_on_death"); } catch (e) { /* 不存在 */ }
            }
            try { target.removeTag("ItemLock"); } catch (e) { /* 旧格式 */ }
            try { target.removeTag("minecraft:item_lock"); } catch (e) { /* 清掉旧 compound（如果存在） */ }
            if (itemLock) target.setByte("minecraft:item_lock", itemLock === "lock_in_slot" ? 1 : 2);
            if (target !== nbt) nbt.setTag("tag", target);
            return nbt;
        };

        const player = mc.getPlayer(xuid);
        if (player) {
            const ct = container === "offhand" ? null : containerOf(player, container);
            let item = container === "offhand" ? player.getOffHand() : (ct ? ct.getItem(slot) : null);
            if (!item) throw new Error("槽位没有物品");
            let nbt = item.getNbt ? item.getNbt() : null;
            if (!nbt) nbt = NBT.parseSNBT("{}");
            // 不调用 setLore：部分 LSE 版本会重建 NBT，把刚写入的组件一起清掉。
            // 直接写 display.Lore、CanPlaceOn/CanDestroy、item_lock 和 keep_on_death。
            apply(nbt, true);
            if (!item.setNbt(nbt)) throw new Error("Lore/组件 NBT 写入失败");
            if (ct) ct.setItem(slot, item);
            this.app.shadow.setSlot(xuid, container, container === "offhand" ? 0 : slot, item, true);
            try { if (typeof player.refreshItems === "function") player.refreshItems(); } catch (e) { /* 刷新失败不影响数据 */ }
            return { ok: true, target: "online", lore: lore, tags: payload.tags };
        }

        let uuid = null;
        try { uuid = data.xuid2uuid(xuid); } catch (e) { uuid = null; }
        if (!uuid) throw new Error("找不到离线玩家 UUID");
        const slots = readOfflineSlots(uuid, { full: true }) || { inventory: [], armor: [], offhand: [], ender: [] };
        const list = slots[container] || [];
        const entry = list.find((e) => Number(e.slot) === Number(slot));
        if (!entry || !entry.item) throw new Error("槽位没有物品");
        let nbt = null;
        try { nbt = entry.item.nbt ? NBT.parseSNBT(entry.item.nbt) : NBT.parseSNBT("{}"); } catch (e) { nbt = NBT.parseSNBT("{}"); }
        apply(nbt);
        entry.item.nbt = nbt.toSNBT();
        const res = writeOfflineSlots(uuid, slots, [container]);
        if (!res.ok) throw new Error(res.error || "离线写入失败");
        return { ok: true, target: "offline", uuid: uuid, lore: lore, tags: payload.tags };
    }

    setDisplayName(payload) {
        const xuid = String(payload.xuid || "");
        const container = String(payload.container || "inventory");
        const slot = Number(payload.slot || 0);
        const name = String(payload.name || "").trim().slice(0, 128);
        if (!xuid) throw new Error("缺少 xuid");
        if (["inventory", "armor", "offhand", "ender"].indexOf(container) < 0) throw new Error("非法容器");

        const player = mc.getPlayer(xuid);
        if (player) {
            const ct = container === "offhand" ? null : containerOf(player, container);
            const item = container === "offhand" ? player.getOffHand() : (ct ? ct.getItem(slot) : null);
            if (!item) throw new Error("槽位没有物品");
            if (typeof item.setDisplayName === "function") {
                if (!item.setDisplayName(name)) throw new Error("setDisplayName 失败");
            } else {
                const nbt = item.getNbt ? item.getNbt() : null;
                if (!nbt) throw new Error("物品没有 NBT");
                let tag = nbt;
                try {
                    const wrapper = nbt.getTag("tag");
                    if (wrapper && typeof wrapper.setTag === "function") tag = wrapper;
                } catch (e) { tag = nbt; }
                let display = null;
                try { display = tag.getTag("display"); } catch (e) { display = null; }
                if (!display) {
                    display = new NbtCompound();
                    tag.setTag("display", display);
                }
                if (name) display.setString("Name", name);
                else { try { display.removeTag("Name"); } catch (e) { /* 不存在 */ } }
                if (tag !== nbt) nbt.setTag("tag", tag);
                if (!item.setNbt(nbt)) throw new Error("setNbt 失败");
            }
            if (ct) ct.setItem(slot, item);
            this.app.shadow.setSlot(xuid, container, container === "offhand" ? 0 : slot, item, true);
            try { if (typeof player.refreshItems === "function") player.refreshItems(); } catch (e) { /* 刷新失败 */ }
            return { ok: true, target: "online", name: name };
        }

        let uuid = null;
        try { uuid = data.xuid2uuid(xuid); } catch (e) { uuid = null; }
        if (!uuid) throw new Error("找不到离线玩家 UUID");
        const slots = readOfflineSlots(uuid, { full: true }) || { inventory: [], armor: [], offhand: [], ender: [] };
        const list = slots[container] || [];
        const entry = list.find((e) => Number(e.slot) === Number(slot));
        if (!entry || !entry.item) throw new Error("槽位没有物品");
        let nbt = null;
        try { nbt = entry.item.nbt ? NBT.parseSNBT(entry.item.nbt) : NBT.parseSNBT("{}"); } catch (e) { nbt = NBT.parseSNBT("{}"); }
        let tag = nbt;
        try {
            const wrapper = nbt.getTag("tag");
            if (wrapper && typeof wrapper.setTag === "function") tag = wrapper;
        } catch (e) { tag = nbt; }
        let display = null;
        try { display = tag.getTag("display"); } catch (e) { display = null; }
        if (!display) { display = new NbtCompound(); tag.setTag("display", display); }
        if (name) display.setString("Name", name);
        else { try { display.removeTag("Name"); } catch (e) { /* 不存在 */ } }
        if (tag !== nbt) nbt.setTag("tag", tag);
        entry.item.nbt = nbt.toSNBT();
        const res = writeOfflineSlots(uuid, slots, [container]);
        if (!res.ok) throw new Error(res.error || "离线写入失败");
        return { ok: true, target: "offline", name: name };
    }

    setEnchants(payload) {
        const xuid = String(payload.xuid || "");
        const container = String(payload.container || "inventory");
        const slot = Number(payload.slot || 0);
        if (!xuid) throw new Error("缺少 xuid");
        if (["inventory", "armor", "offhand", "ender"].indexOf(container) < 0) throw new Error("非法容器");
        const source = Array.isArray(payload.enchants) ? payload.enchants : [];
        if (source.length > 32) throw new Error("附魔数量过多");
        const enchants = [];
        for (const raw of source) {
            const id = String(raw && raw.id ? raw.id : "").trim();
            if (!/^[a-z0-9_]+(:[a-z0-9_]+)?$/i.test(id)) throw new Error("非法附魔 ID: " + id);
            const short = id.replace(/^minecraft:/i, "").replace(/^enchant_/i, "");
            let numeric = ENCHANT_STR_TO_NUM[short];
            if (numeric === undefined) numeric = Number(short);
            if (!Number.isInteger(numeric) || numeric < 0 || numeric > 255) throw new Error("未知附魔: " + id);
            const level = Math.max(1, Math.min(32767, Number(raw.level || 1)));
            enchants.push({ id: id.indexOf(":") >= 0 ? id : "minecraft:" + id, numeric: numeric, level: level });
        }
        const isBook = (type) => String(type || "") === "minecraft:enchanted_book";
        const apply = (nbt, type) => {
            const key = isBook(type) ? "StoredEnchantments" : "ench";
            let target = nbt;
            try {
                const wrapper = nbt.getTag("tag");
                if (wrapper && typeof wrapper.setTag === "function") target = wrapper;
            } catch (e) {
                target = nbt;
            }
            if (!enchants.length) {
                try { target.removeTag(key); } catch (e) { /* 可能本来就不存在 */ }
            } else {
                const list = new NbtList();
                for (const ench of enchants) {
                    const one = new NbtCompound();
                    // 基岩版附魔 NBT 的 id 必须是数字 short，不能写 "minecraft:sharpness"。
                    one.setShort("id", ench.numeric);
                    one.setShort("lvl", ench.level);
                    list.addTag(one);
                }
                target.setTag(key, list);
            }
            if (target !== nbt) nbt.setTag("tag", target);
            return nbt;
        };

        const player = mc.getPlayer(xuid);
        if (player) {
            const ct = container === "offhand" ? null : containerOf(player, container);
            const item = container === "offhand" ? player.getOffHand() : (ct ? ct.getItem(slot) : null);
            if (!item) throw new Error("槽位没有物品");
            let nbt = item.getNbt ? item.getNbt() : null;
            if (!nbt) nbt = NBT.parseSNBT("{}");
            apply(nbt, item.type);
            if (!item.setNbt(nbt)) throw new Error("setNbt 失败");
            if (ct) ct.setItem(slot, item);
            this.app.shadow.setSlot(xuid, container, container === "offhand" ? 0 : slot, item, true);
            try { if (typeof player.refreshItems === "function") player.refreshItems(); } catch (e) { /* 刷新失败不影响数据 */ }
            return { ok: true, target: "online", enchants: enchants };
        }

        let uuid = null;
        try {
            uuid = data.xuid2uuid(xuid);
        } catch (e) {
            uuid = null;
        }
        if (!uuid) throw new Error("找不到离线玩家 UUID");
        const slots = readOfflineSlots(uuid, { full: true }) || { inventory: [], armor: [], offhand: [], ender: [] };
        const list = slots[container] || [];
        const entry = list.find((e) => Number(e.slot) === Number(slot));
        if (!entry || !entry.item) throw new Error("槽位没有物品");
        let nbt = null;
        try { nbt = entry.item.nbt ? NBT.parseSNBT(entry.item.nbt) : NBT.parseSNBT("{}"); } catch (e) { nbt = NBT.parseSNBT("{}"); }
        apply(nbt, entry.item.t);
        entry.item.nbt = nbt.toSNBT();
        const res = writeOfflineSlots(uuid, slots, [container]);
        if (!res.ok) throw new Error(res.error || "离线写入失败");
        return { ok: true, target: "offline", uuid: uuid, enchants: enchants };
    }

    refreshNbt(payload) {
        const xuid = String(payload.xuid || "");
        const container = String(payload.container || "inventory");
        const slot = Number(payload.slot || 0);
        const player = mc.getPlayer(xuid);
        if (player) {
            let item = null;
            if (container === "offhand") item = player.getOffHand();
            else {
                const ct = containerOf(player, container);
                item = ct ? ct.getItem(slot) : null;
            }
            if (!item) throw new Error("槽位没有物品");
            const full = serializeItem(item, {
                full: true,
                inlineMaxKB: this.app.config.nbt.inlineMaxKB,
                itemMaxKB: this.app.config.nbt.itemMaxKB,
                storeNbt: (hash, snbt) => this.app.store.putNbt(hash, snbt)
            });
            this.app.shadow.setSlot(xuid, container, container === "offhand" ? 0 : slot, item, true);
            return { ok: true, item: full };
        }
        let uuid = null;
        try {
            uuid = data.xuid2uuid(xuid);
        } catch (e) {
            uuid = null;
        }
        if (!uuid) throw new Error("找不到离线玩家 UUID");
        const slots = readOfflineSlots(uuid, { full: true });
        const list = slots[container] || [];
        const entry = list.find((e) => Number(e.slot) === Number(slot));
        return { ok: true, item: entry ? entry.item : null };
    }

    restore(payload) {
        const xuid = String(payload.xuid || "");
        const snapshotId = String(payload.snapshotId || "");
        const scope = payload.scope && payload.scope.length ? payload.scope : ["inventory", "armor", "offhand"];
        const snapshot = this.app.store.getSnapshot(snapshotId);
        if (!snapshot) throw new Error("备份不存在");
        if (String(snapshot.xuid) !== xuid) throw new Error("备份不属于该玩家");
        const player = mc.getPlayer(xuid);
        const slots = {
            inventory: snapshot.inventory || [],
            armor: snapshot.armor || [],
            offhand: snapshot.offhand || [],
            ender: snapshot.ender || []
        };
        if (player) {
            applyOnlineSlots(player, slots, scope, { nbtLoader: (h) => this.app.store.getNbt(h) });
            this.app.shadow.seedPlayer(player);
            return { ok: true, target: "online", scope: scope };
        }
        let uuid = null;
        try {
            uuid = data.xuid2uuid(xuid);
        } catch (e) {
            uuid = null;
        }
        if (!uuid) throw new Error("找不到离线玩家 UUID");
        const res = writeOfflineSlots(uuid, slots, scope);
        if (!res.ok) throw new Error(res.error || "离线恢复失败");
        return { ok: true, target: "offline", uuid: uuid, scope: scope };
    }

    backup(payload) {
        if (payload && payload.xuid) {
            const player = mc.getPlayer(String(payload.xuid));
            if (player) {
                const snap = this.app.recorder.capturePlayer(player, "manual");
                return { ok: true, snapshotId: snap.id };
            }
            const snapshot = this.app.store.latestSnapshot(String(payload.xuid));
            if (!snapshot) throw new Error("没有可备份的在线玩家");
            return { ok: true, snapshotId: snapshot.id, note: "offline uses latest snapshot" };
        }
        this.app.recorder.captureAll("manual");
        return { ok: true };
    }

    offlineSnapshot(payload) {
        const xuid = String(payload.xuid || "");
        if (!xuid) throw new Error("缺少 xuid");
        let uuid = null;
        try {
            uuid = data.xuid2uuid(xuid);
        } catch (e) {
            uuid = null;
        }
        if (!uuid) throw new Error("找不到离线玩家 UUID");
        const slots = readOfflineSlots(uuid, { full: true });
        if (!slots) throw new Error("读取离线 NBT 失败");
        const meta = this.app.store.getPlayer(xuid) || { xuid: xuid, name: "", uuid: uuid };
        const snapshot = this.app.recorder.captureOffline(xuid, "manual", slots, Object.assign({}, meta, { uuid: uuid }));
        return { ok: true, snapshotId: snapshot.id, source: "offline" };
    }
}

export { Actions };
