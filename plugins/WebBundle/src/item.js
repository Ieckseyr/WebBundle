// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 WebBundle contributors

import { log, fnv1a, readJson, JSON_DIR } from "./core.js";
import { utf8Bytes } from "./sha256.js";

const CONTAINERS = ["inventory", "armor", "offhand", "ender"];
const META_WARNED = new Set();

function nbtOf(item) {
    try {
        if (!item || typeof item.getNbt !== "function") return null;
        const nbt = item.getNbt();
        if (!nbt) return null;
        const snbt = nbt.toSNBT();
        if (!snbt || snbt === "{}") return null;
        return snbt;
    } catch (e) {
        return null;
    }
}

const DURABILITY = {
    "minecraft:netherite_helmet": 407, "minecraft:netherite_chestplate": 592,
    "minecraft:netherite_leggings": 555, "minecraft:netherite_boots": 481,
    "minecraft:diamond_helmet": 363, "minecraft:diamond_chestplate": 528,
    "minecraft:diamond_leggings": 495, "minecraft:diamond_boots": 429,
    "minecraft:iron_helmet": 165, "minecraft:iron_chestplate": 240,
    "minecraft:iron_leggings": 225, "minecraft:iron_boots": 195,
    "minecraft:golden_helmet": 77, "minecraft:golden_chestplate": 112,
    "minecraft:golden_leggings": 105, "minecraft:golden_boots": 91,
    "minecraft:chainmail_helmet": 165, "minecraft:chainmail_chestplate": 240,
    "minecraft:chainmail_leggings": 225, "minecraft:chainmail_boots": 195,
    "minecraft:leather_helmet": 55, "minecraft:leather_chestplate": 80,
    "minecraft:leather_leggings": 75, "minecraft:leather_boots": 65,
    "minecraft:diamond_sword": 1561, "minecraft:netherite_sword": 2031,
    "minecraft:iron_sword": 250, "minecraft:golden_sword": 32,
    "minecraft:stone_sword": 131, "minecraft:wooden_sword": 59,
    "minecraft:diamond_pickaxe": 1561, "minecraft:netherite_pickaxe": 2031,
    "minecraft:iron_pickaxe": 250, "minecraft:golden_pickaxe": 32,
    "minecraft:stone_pickaxe": 131, "minecraft:wooden_pickaxe": 59,
    "minecraft:diamond_axe": 1561, "minecraft:netherite_axe": 2031,
    "minecraft:iron_axe": 250, "minecraft:golden_axe": 32,
    "minecraft:stone_axe": 131, "minecraft:wooden_axe": 59,
    "minecraft:diamond_shovel": 1561, "minecraft:netherite_shovel": 2031,
    "minecraft:iron_shovel": 250, "minecraft:golden_shovel": 32,
    "minecraft:stone_shovel": 131, "minecraft:wooden_shovel": 59,
    "minecraft:diamond_hoe": 1561, "minecraft:netherite_hoe": 2031,
    "minecraft:iron_hoe": 250, "minecraft:golden_hoe": 32,
    "minecraft:stone_hoe": 131, "minecraft:wooden_hoe": 59,
    "minecraft:bow": 384, "minecraft:crossbow": 465, "minecraft:trident": 250,
    "minecraft:shield": 336, "minecraft:elytra": 432,
    "minecraft:fishing_rod": 64, "minecraft:flint_and_steel": 64,
    "minecraft:carrot_on_a_stick": 25, "minecraft:warped_fungus_on_a_stick": 100
};

function plainText(value) {
    if (value === null || value === undefined) return "";
    const text = String(value);
    try {
        const obj = JSON.parse(text);
        if (obj && typeof obj === "object") return String(obj.text || obj.translate || text);
    } catch (e) {
    }
    return text;
}

const ENCHANT_STR_TO_NUM = {
    protection: 0, fire_protection: 1, feather_falling: 2, blast_protection: 3,
    projectile_protection: 4, thorns: 5, respiration: 6, depth_strider: 7,
    aqua_affinity: 8, sharpness: 9, smite: 10, bane_of_arthropods: 11,
    knockback: 12, fire_aspect: 13, looting: 14, efficiency: 15,
    silk_touch: 16, unbreaking: 17, fortune: 18, power: 19,
    punch: 20, flame: 21, infinity: 22, luck_of_the_sea: 23,
    lure: 24, frost_walker: 25, mending: 26, binding_curse: 27,
    vanishing_curse: 28, impaling: 29, riptide: 30, loyalty: 31,
    channeling: 32, multishot: 33, piercing: 34, quick_charge: 35,
    soul_speed: 36, swift_sneak: 37, wind_burst: 38, density: 39, breach: 40,
    lunge: 42
};
const ENCHANT_NUM_TO_STR = Object.fromEntries(Object.keys(ENCHANT_STR_TO_NUM).map((key) => [ENCHANT_STR_TO_NUM[key], key]));

function enchantMeta(list) {
    if (!list || !Array.isArray(list)) return [];
    const out = [];
    for (const entry of list) {
        if (!entry) continue;
        const rawId = entry.id !== undefined ? entry.id : (entry.Id !== undefined ? entry.Id : "");
        const numeric = Number(rawId);
        const id = String(rawId).trim();
        out.push({
            id: Number.isFinite(numeric) && String(numeric) === id.trim() ? ("minecraft:" + (ENCHANT_NUM_TO_STR[numeric] || ("enchant_" + numeric))) : id,
            level: Number(entry.lvl || entry.level || entry.Level || 1)
        });
    }
    return out;
}

function nbtValueToSnbt(value) {
    if (value === null || value === undefined) return "\"\"";
    if (Array.isArray(value)) return "[" + value.map(nbtValueToSnbt).join(",") + "]";
    if (typeof value === "object") {
        return "{" + Object.keys(value).map((key) => JSON.stringify(key) + ":" + nbtValueToSnbt(value[key])).join(",") + "}";
    }
    if (typeof value === "string") return JSON.stringify(value);
    if (typeof value === "boolean") return value ? "1b" : "0b";
    return String(value);
}

function tagValue(value) {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) return value.map(tagValue);
    if (typeof value === "object") {
        try { if (typeof value.get === "function") return tagValue(value.get()); } catch (e) {  }
        try {
            if (typeof value.toArray === "function") return value.toArray().map(tagValue);
            if (typeof value.getSize === "function" && typeof value.getTag === "function") {
                const out = [];
                for (let i = 0; i < Number(value.getSize()); i++) out.push(tagValue(value.getTag(i)));
                return out;
            }
        } catch (e) {  }
    }
    return value;
}

function customTagsOf(root) {
    const list = (value) => {
        const data = tagValue(value);
        return Array.isArray(data) ? data.map(String) : [];
    };
    const tag = root && root.tag && typeof root.tag === "object" ? root.tag : (root || {});
    const canPlaceOn = tagValue(tag["minecraft:can_place_on"]);
    const canDestroy = tagValue(tag["minecraft:can_destroy"]);
    const itemLock = tagValue(tag["minecraft:item_lock"]);
    const rawLock = tagValue(tag["minecraft:item_lock"]);
    const numericLock = Number(rawLock);
    const lockMode = numericLock === 1 ? "lock_in_slot" : (numericLock === 2 ? "lock_in_inventory" : "");
    return {
        canPlaceOn: list(root && root.CanPlaceOn).length ? list(root.CanPlaceOn) : list(canPlaceOn && canPlaceOn.blocks),
        canDestroy: list(root && root.CanDestroy).length ? list(root.CanDestroy) : list(canDestroy && canDestroy.blocks),
        keepOnDeath: Number(tagValue(tag["minecraft:keep_on_death"] || tag.KeepOnDeath || 0)) !== 0,
        itemLock: lockMode || (itemLock && itemLock.mode ? String(tagValue(itemLock.mode)) : String(tagValue(tag.ItemLock) || ""))
    };
}

function nestedItem(entry, options, depth) {
    if (!entry) return null;
    const stack = entry.item && typeof entry.item === "object" ? entry.item : entry;
    const type = String(stack.Name || stack.name || stack.id || stack.t || "minecraft:air");
    if (type === "minecraft:air" || type === "air") return null;
    const count = Math.max(1, Number(stack.Count || stack.count || stack.c || 1));
    const tag = stack.tag && typeof stack.tag === "object" ? stack.tag : null;
    let pseudo = null;
    try {
        pseudo = mc.newItem(type, count);
        if (pseudo && tag && pseudo.setNbt) {
            const parsed = NBT.parseSNBT(nbtValueToSnbt(tag));
            if (parsed) pseudo.setNbt(parsed);
        }
    } catch (e) {
        pseudo = null;
    }
    if (pseudo) {
        return serializeItem(pseudo, Object.assign({}, options, { depth: depth, meta: true, full: !!options.full }));
    }
    return {
        t: type,
        c: count,
        a: Number(stack.Damage !== undefined ? stack.Damage : (stack.aux || 0)),
        nbt: tag ? nbtValueToSnbt(tag) : "",
        meta: { name: "", lore: [], enchants: [], storedEnchants: [], containerItems: [] }
    };
}

let ITEM_TRANSLATIONS = null;

function translationTable() {
    if (ITEM_TRANSLATIONS === null) {
        try {
            const data = readJson(JSON_DIR + "/item-translations.json", null);
            ITEM_TRANSLATIONS = data && typeof data === "object" ? data : {};
        } catch (e) {
            ITEM_TRANSLATIONS = {};
        }
    }
    return ITEM_TRANSLATIONS;
}

function translatedItemName(type) {
    const short = String(type || "").replace("minecraft:", "");
    const table = translationTable();
    const language = typeof ll !== "undefined" && ll.language ? String(ll.language) : "";
    if (short && table) {
        if (/^en/i.test(language) && table.english && table.english[short]) return String(table.english[short]);
        if (table.items && table.items[short]) return String(table.items[short]);
    }
    try {
        const api = typeof VaillanI18n !== "undefined" ? VaillanI18n : (typeof VanillaI18n !== "undefined" ? VanillaI18n : null);
        if (!api || typeof api.translate !== "function") return "";
        if (!short) return "";
        const keys = ["item." + short + ".name", "item." + short, "item.minecraft." + short + ".name", "item.minecraft." + short];
        for (const key of keys) {
            let value = "";
            try {
                value = language ? api.translate(key, [], language) : api.translate(key);
            } catch (e) {
                value = "";
            }
            value = String(value || "").trim();
            if (value && value !== key && value.indexOf("item.") !== 0) return value;
        }
    } catch (e) {
        return "";
    }
    return "";
}

function nestedEntriesOf(tag) {
    if (!tag || typeof tag !== "object") return null;
    const candidates = [
        tag.BlockEntityTag && tag.BlockEntityTag.Items,
        tag.Items,
        tag.storage_item_component_content,
        tag.StorageItemComponentContent,
        tag["storage_item_component_content"],
        tag.bundle_content,
        tag.BundleContent
    ];
    let fallback = null;
    for (const candidate of candidates) {
        if (Array.isArray(candidate)) {
            if (candidate.length) return candidate;
            fallback = fallback || candidate;
        } else if (candidate && typeof candidate === "object") {
            if (Array.isArray(candidate.items) && candidate.items.length) return candidate.items;
            if (Array.isArray(candidate.Items) && candidate.Items.length) return candidate.Items;
        }
    }
    return fallback;
}

function metaOf(item, snbt, options) {
    const opt = options || {};
    const depth = Number(opt.depth || 0);
    const meta = { name: "", lore: [], enchants: [], storedEnchants: [], containerItems: [] };
    if (!item) return meta;
    try {
        if (item.lore && item.lore.length) meta.lore = item.lore.map(plainText);
    } catch (e) {
    }
    try {
        let nbt = item.getNbt ? item.getNbt() : null;
        if (!nbt && snbt) nbt = NBT.parseSNBT(snbt);
        if (!nbt) return meta;
        let obj = null;
        try { obj = JSON.parse(nbt.toString()); } catch (e) { obj = null; }
        if (!obj && nbt.toObject) obj = nbt.toObject();
        if (!obj) return meta;
        const tag = obj.tag && typeof obj.tag === "object" ? obj.tag : obj;
        const display = tag.display && typeof tag.display === "object" ? tag.display : null;
        if (display) {
            if (display.Name) {
                meta.customName = plainText(display.Name);
                meta.name = meta.customName;
            }
            if (display.Lore && Array.isArray(display.Lore)) meta.lore = display.Lore.map(plainText);
        }
        if (!meta.name) meta.name = translatedItemName(item.type);
        if (!meta.name) {
            try { if (item.name) meta.name = String(item.name); } catch (e) {  }
        }
        meta.enchants = enchantMeta(tag.ench || tag.Enchantments || tag.enchantments);
        meta.storedEnchants = enchantMeta(tag.StoredEnchantments || tag.stored_enchantments);
        meta.tags = customTagsOf(obj);
        const max = DURABILITY[String(item.type || "")] || 0;
        if (max > 0) {
            meta.durMax = max;
            meta.durCur = Math.max(0, max - Number(tag.Damage || 0));
        }
        const nested = nestedEntriesOf(tag);
        if (nested && Array.isArray(nested) && depth < 64) {
            meta.containerItems = nested.slice(0, 256).map((entry, index) => {
                const child = nestedItem(entry, opt, depth + 1);
                if (child) child.slot = Number(entry.Slot !== undefined ? entry.Slot : (entry.slot !== undefined ? entry.slot : index));
                return child;
            }).filter(Boolean);
        }
    } catch (e) {
        try {
            const key = String(item && item.type || "?");
            if (META_WARNED.size < 50 && !META_WARNED.has(key)) {
                META_WARNED.add(key);
                log("warn", "物品元数据解析失败 " + key + ": " + e.message);
            }
        } catch (ignored) {  }
    }
    return meta;
}

function serializeItem(item, options) {
    if (!item) return null;
    const type = String(item.type || "");
    if (type === "minecraft:air" || type === "air" || Number(item.count || 0) <= 0) return null;
    const opt = options || {};
    const out = {
        t: String(item.type || "minecraft:air"),
        c: Number(item.count || 0),
        a: Number(item.aux || 0),
        h: ""
    };
    try {
        if (item.name) out.n = String(item.name);
        if (item.lore && item.lore.length) out.l = item.lore.map(String);
    } catch (e) {
    }

    if (opt.meta !== false) out.meta = metaOf(item, null, opt);
    const snbt = nbtOf(item);
    if (snbt) {
        out.h = fnv1a(snbt);
        const bytes = utf8Bytes(snbt).length;
        out.nbtSize = bytes;
        if (opt.full) {
            const inlineMax = (opt.inlineMaxKB || 64) * 1024;
            const itemMax = (opt.itemMaxKB || 512) * 1024;
            if (bytes > itemMax) {
                out.nbtOmitted = true;
            } else if (bytes <= inlineMax) {
                out.nbt = snbt;
            } else {
                out.nbtRef = out.h;
                if (opt.storeNbt) opt.storeNbt(out.h, snbt);
            }
        }
    }
    return out;
}

function deserializeItem(data) {
    if (!data || !data.t) return null;
    try {
        let nbtText = data.nbt || null;
        if (!nbtText && data.nbtRef && data.__nbtLoader) {
            nbtText = data.__nbtLoader(data.nbtRef);
        }
        if (nbtText) {
            const nbt = NBT.parseSNBT(nbtText);
            try {
                nbt.setString("Name", String(data.t));
                nbt.setByte("Count", Math.max(1, Math.min(255, Number(data.c || 1))));
            } catch (e) {  }
            const item = mc.newItem(nbt);
            if (item && typeof item.getNbt === "function") return item;
            const typed = mc.newItem(String(data.t), Math.max(1, Number(data.c || 1)));
            if (typed && typeof typed.setNbt === "function") typed.setNbt(nbt);
            return typed;
        }
        return mc.newItem(String(data.t), Math.max(1, Number(data.c || 1)));
    } catch (e) {
        log("warn", "反序列化物品失败: " + (data.t || "?") + " " + e.message);
        try {
            return mc.newItem(String(data.t), Math.max(1, Number(data.c || 1)));
        } catch (e2) {
            return null;
        }
    }
}

function containerOf(player, name) {
    try {
        if (name === "inventory") return player.getInventory();
        if (name === "armor") return player.getArmor();
        if (name === "ender") return player.getEnderChest();
    } catch (e) {
        return null;
    }
    return null;
}

function readContainer(container, name, options) {
    const out = [];
    if (!container) return out;
    let size = 0;
    try {
        size = Number(container.size || 0);
    } catch (e) {
        size = 0;
    }
    for (let i = 0; i < size; i++) {
        let item = null;
        try {
            item = container.getItem(i);
        } catch (e) {
            item = null;
        }
        const data = serializeItem(item, options);
        if (data) out.push({ slot: i, item: data });
    }
    return out;
}

function readPlayerSlots(player, options) {
    const opt = options || {};
    const result = {
        inventory: readContainer(containerOf(player, "inventory"), "inventory", opt),
        armor: readContainer(containerOf(player, "armor"), "armor", opt),
        offhand: [],
        ender: readContainer(containerOf(player, "ender"), "ender", opt)
    };
    try {
        const off = player.getOffHand();
        if (off) {
            const data = serializeItem(off, opt);
            if (data) result.offhand.push({ slot: 0, item: data });
        }
    } catch (e) {
    }
    return result;
}

function nbtCompoundToSlot(comp, container, options) {
    if (!comp) return null;
    let obj = null;
    try {
        obj = comp.toObject();
    } catch (e) {
        obj = null;
    }
    if (!obj) return null;
    const data = {
        t: String(obj.Name || obj.name || "minecraft:air"),
        c: Number(obj.Count || obj.count || 1),
        a: Number(obj.Damage || obj.damage || 0),
        h: ""
    };
    try {
        const snbt = comp.toSNBT();
        data.h = fnv1a(snbt);
        data.nbtSize = utf8Bytes(snbt).length;
        if (options && options.full) data.nbt = snbt;
    } catch (e) {
    }
    return { slot: obj.Slot !== undefined ? Number(obj.Slot) : 0, item: data, container: container };
}

function nbtListToSlots(list, container, options) {
    const out = [];
    if (!list) return out;
    if (typeof list.getSize !== "function") {
        const single = nbtCompoundToSlot(list, container, options);
        if (single) out.push(single);
        return out;
    }
    let size = 0;
    try {
        size = Number(list.getSize ? list.getSize() : (list.size || 0));
    } catch (e) {
        size = 0;
    }
    for (let i = 0; i < size; i++) {
        let comp = null;
        try {
            comp = list.getTag(i);
        } catch (e) {
            comp = null;
        }
        if (!comp) continue;
        let obj = null;
        try {
            obj = comp.toObject();
        } catch (e) {
            obj = null;
        }
        if (!obj) continue;
        const data = {
            t: String(obj.Name || obj.name || "minecraft:air"),
            c: Number(obj.Count || obj.count || 1),
            a: Number(obj.Damage || obj.damage || 0),
            h: ""
        };
        try {
            const snbt = comp.toSNBT();
            data.h = fnv1a(snbt);
            data.nbtSize = utf8Bytes(snbt).length;
            if (options && options.full) data.nbt = snbt;
        } catch (e) {
        }
        const slot = obj.Slot !== undefined ? Number(obj.Slot) : i;
        out.push({ slot: slot, item: data, container: container });
    }
    return out;
}

function readOfflineSlots(uuid, options) {
    const opt = options || {};
    let playerNbt = null;
    try {
        playerNbt = mc.getPlayerNbt(uuid);
    } catch (e) {
        return null;
    }
    if (!playerNbt) return null;
    const result = { inventory: [], armor: [], offhand: [], ender: [] };
    try {
        const inv = playerNbt.getData("Inventory");
        result.inventory = nbtListToSlots(inv, "inventory", opt);
    } catch (e) {
        result.inventory = [];
    }
    try {
        const armor = playerNbt.getData("Armor");
        result.armor = nbtListToSlots(armor, "armor", opt);
    } catch (e) {
        result.armor = [];
    }
    try {
        const ender = playerNbt.getData("EnderChestInventory");
        result.ender = nbtListToSlots(ender, "ender", opt);
    } catch (e) {
        result.ender = [];
    }
    try {
        const off = playerNbt.getData("Offhand");
        if (off) {
            const slots = nbtListToSlots(off, "offhand", opt);
            result.offhand = slots;
        }
    } catch (e) {
        result.offhand = [];
    }
    return result;
}

function itemSnbtForSlot(data, slot) {
    if (!data) return null;
    let comp = null;
    if (data.nbt) {
        try {
            comp = NBT.parseSNBT(data.nbt);
        } catch (e) {
            comp = null;
        }
    }
    if (!comp) {
        const name = String(data.t || "minecraft:air").replace(/"/g, "");
        comp = NBT.parseSNBT("{Name:\"" + name + "\",Count:" + Math.max(1, Number(data.c || 1)) + "b}");
    }
    try {
        comp.setString("Name", String(data.t || "minecraft:air"));
        comp.setByte("Count", Math.max(1, Number(data.c || 1)));
        comp.setByte("Slot", slot);
        if (comp.hasTag && !comp.hasTag("Damage")) comp.setShort("Damage", Number(data.a || 0));
    } catch (e) {
    }
    return comp.toSNBT();
}

function makeListSnbt(items) {
    const parts = [];
    for (const entry of items) {
        const snbt = itemSnbtForSlot(entry.item, entry.slot);
        if (snbt) parts.push(snbt);
    }
    return "[" + parts.join(",") + "]";
}

function writeOfflineSlots(uuid, slots, scope) {
    let playerNbt = null;
    try {
        playerNbt = mc.getPlayerNbt(uuid);
    } catch (e) {
        return { ok: false, error: "getPlayerNbt failed: " + e.message };
    }
    if (!playerNbt) return { ok: false, error: "player nbt not found" };
    const tags = [];
    const wanted = scope && scope.length ? scope : CONTAINERS;
    try {
        if (wanted.indexOf("inventory") >= 0) {
            playerNbt.setTag("Inventory", NBT.parseSNBT(makeListSnbt(slots.inventory || [])));
            tags.push("Inventory");
        }
        if (wanted.indexOf("armor") >= 0) {
            playerNbt.setTag("Armor", NBT.parseSNBT(makeListSnbt(slots.armor || [])));
            tags.push("Armor");
        }
        if (wanted.indexOf("ender") >= 0) {
            playerNbt.setTag("EnderChestInventory", NBT.parseSNBT(makeListSnbt(slots.ender || [])));
            tags.push("EnderChestInventory");
        }
        if (wanted.indexOf("offhand") >= 0) {
            const off = slots.offhand && slots.offhand[0];
            if (off) playerNbt.setTag("Offhand", NBT.parseSNBT(itemSnbtForSlot(off.item, 0)));
            else playerNbt.removeTag("Offhand");
            tags.push("Offhand");
        }
    } catch (e) {
        return { ok: false, error: "build nbt failed: " + e.message };
    }
    if (!tags.length) return { ok: true, tags: [] };
    let ok = false;
    try {
        ok = mc.setPlayerNbtTags(uuid, playerNbt, tags);
    } catch (e) {
        return { ok: false, error: "setPlayerNbtTags failed: " + e.message };
    }
    return ok ? { ok: true, tags: tags } : { ok: false, error: "setPlayerNbtTags returned false" };
}

function applyOnlineSlots(player, slots, scope, options) {
    const opt = options || {};
    const wanted = scope && scope.length ? scope : CONTAINERS;
    const nbtLoader = opt.nbtLoader;
    for (const name of wanted) {
        if (name === "offhand") {
            const entry = slots.offhand && slots.offhand[0];
            try {
                if (!entry) {
                    if (typeof player.setOffHand === "function") player.setOffHand(null);
                } else {
                    const data = entry.item || {};
                    const item = deserializeItem(Object.assign({}, data, { __nbtLoader: nbtLoader }));
                    if (item && typeof player.setOffHand === "function") player.setOffHand(item);
                    else {
                        const current = player.getOffHand();
                        if (current && String(current.type) === String(data.t || "")) {
                            if (item && item.getNbt) current.setNbt(item.getNbt());
                            current.setCount(Math.max(1, Number(data.c || 1)));
                        }
                    }
                }
                if (typeof player.refreshItems === "function") player.refreshItems();
            } catch (e) {
                log("warn", "副手还原失败: " + e.message);
            }
            continue;
        }
        const ct = containerOf(player, name);
        if (!ct) continue;
        let size = 0;
        try {
            size = Number(ct.size || 0);
        } catch (e) {
            size = 0;
        }
        for (let i = 0; i < size; i++) {
            try {
                ct.removeItem(i, 999999);
            } catch (e) {
            }
        }
        const list = slots[name] || [];
        for (const entry of list) {
            if (!entry || !entry.item) continue;
            const item = deserializeItem(Object.assign({}, entry.item, { __nbtLoader: nbtLoader }));
            if (!item) continue;
            try {
                ct.setItem(Number(entry.slot), item);
            } catch (e) {
            }
        }
    }
    try { if (typeof player.refreshItems === "function") player.refreshItems(); } catch (e) {  }
}

export {
    CONTAINERS,
    ENCHANT_STR_TO_NUM,
    ENCHANT_NUM_TO_STR,
    serializeItem,
    nbtValueToSnbt,
    deserializeItem,
    readPlayerSlots,
    readOfflineSlots,
    writeOfflineSlots,
    applyOnlineSlots,
    containerOf,
    nbtOf
};
