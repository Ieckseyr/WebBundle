/* SPDX-License-Identifier: GPL-3.0-or-later */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);

  const players = [
    { index: "001", xuid: "2535416158535227", name: "Steve", state: "online", seq: 1088 },
    { index: "002", xuid: "2535416158535228", name: "Alex", state: "online", seq: 1042 },
    { index: "003", xuid: "2535416158535229", name: "Notch", state: "offline", seq: 912 }
  ];

  const items = {
    sword: {
      type: "minecraft:diamond_sword", count: 1, name: "耐久之刃",
      enchants: [{ id: "sharpness", name: "锋利", level: 5 }, { id: "unbreaking", name: "耐久", level: 3 }],
      durCur: 1420, durMax: 1561, lore: "为长夜里的第一缕光而锻造。",
      nbt: "{display:{Name:'{\"text\":\"耐久之刃\",\"color\":\"gold\"}',Lore:['{\"text\":\"为长夜里的第一缕光而锻造。\",\"color\":\"gray\",\"italic\":true}']},Damage:141,ench:[{id:9s,lvl:5s},{id:17s,lvl:3s}]}"
    },
    apple: { type: "minecraft:golden_apple", count: 16, name: "金苹果" },
    stone: { type: "minecraft:stone", count: 64, name: "石头" },
    book: {
      type: "minecraft:enchanted_book", count: 1, name: "经验修补",
      enchants: [{ id: "mending", name: "经验修补", level: 1 }],
      nbt: "{StoredEnchantments:[{id:9s,lvl:5s}],display:{Name:'{\"text\":\"经验修补\"}'}}"
    },
    shulker: {
      type: "minecraft:shulker_box", count: 1, name: "战利品箱",
      containerItems: [{ type: "minecraft:diamond", count: 32 }, { type: "minecraft:emerald", count: 16 }],
      nbt: "{BlockEntityTag:{Items:[{Slot:0b,id:\"minecraft:diamond\",Count:32b},{Slot:1b,id:\"minecraft:emerald\",Count:16b}]},display:{Name:'{\"text\":\"战利品箱\"}'}}"
    },
    pearl: { type: "minecraft:ender_pearl", count: 16, name: "末影珍珠" },
    bread: { type: "minecraft:bread", count: 8, name: "面包" },
    helmet: { type: "minecraft:netherite_helmet", count: 1, name: "下界合金头盔" },
    chest: { type: "minecraft:netherite_chestplate", count: 1, name: "下界合金胸甲" },
    shield: { type: "minecraft:shield", count: 1, name: "盾牌" },
    diamond: { type: "minecraft:diamond", count: 32, name: "钻石" },
    emerald: { type: "minecraft:emerald", count: 16, name: "绿宝石" }
  };

  const ENCHANTS = [
    { id: "sharpness", name: "锋利", max: 5 },
    { id: "smite", name: "亡灵杀手", max: 5 },
    { id: "bane_of_arthropods", name: "节肢杀手", max: 5 },
    { id: "unbreaking", name: "耐久", max: 3 },
    { id: "efficiency", name: "效率", max: 5 },
    { id: "fortune", name: "时运", max: 3 },
    { id: "mending", name: "经验修补", max: 1 },
    { id: "protection", name: "保护", max: 4 },
    { id: "feather_falling", name: "摔落保护", max: 4 },
    { id: "thorns", name: "荆棘", max: 3 },
    { id: "respiration", name: "水下呼吸", max: 3 },
    { id: "aqua_affinity", name: "水下速掘", max: 1 },
    { id: "depth_strider", name: "深海探索者", max: 3 },
    { id: "frost_walker", name: "冰霜行者", max: 2 },
    { id: "soul_speed", name: "灵魂疾行", max: 3 },
    { id: "looting", name: "抢夺", max: 3 },
    { id: "fire_aspect", name: "火焰附加", max: 2 },
    { id: "knockback", name: "击退", max: 2 },
    { id: "power", name: "力量", max: 5 },
    { id: "punch", name: "冲击", max: 2 },
    { id: "flame", name: "火矢", max: 1 },
    { id: "infinity", name: "无限", max: 1 },
    { id: "binding_curse", name: "绑定诅咒", max: 1 },
    { id: "vanishing_curse", name: "消失诅咒", max: 1 }
  ];

  const inventory = new Map([
    [0, items.sword], [1, items.apple], [5, items.stone], [9, items.book],
    [12, items.shulker], [22, items.pearl], [31, items.bread]
  ]);
  const armor = new Map([[0, items.helmet], [1, items.chest]]);
  const offhand = new Map([[0, items.shield]]);
  const ender = new Map([[0, items.diamond], [1, items.emerald]]);

  const flowRows = [
    { time: "12:59:12", player: "Steve", xuid: "1001", dir: "in", type: "minecraft:diamond", name: "钻石", count: 3, source: "拾取", confidence: "100%" },
    { time: "12:58:40", player: "Alex", xuid: "1002", dir: "out", type: "minecraft:bread", name: "面包", count: 2, source: "丢弃", confidence: "100%" },
    { time: "12:57:06", player: "Steve", xuid: "1001", dir: "in", type: "minecraft:ender_pearl", name: "末影珍珠", count: 1, source: "拾取", confidence: "100%" },
    { time: "12:54:22", player: "Alex", xuid: "1002", dir: "out", type: "minecraft:stone", name: "石头", count: 16, source: "丢弃", confidence: "100%" },
    { time: "12:51:08", player: "Notch", xuid: "1003", dir: "in", type: "minecraft:emerald", name: "绿宝石", count: 4, source: "拾取", confidence: "100%" },
    { time: "12:47:33", player: "Notch", xuid: "1003", dir: "out", type: "minecraft:stone", name: "石头", count: 32, source: "丢弃", confidence: "100%" },
    { time: "12:45:10", player: "Steve", xuid: "1001", dir: "in", type: "minecraft:golden_apple", name: "金苹果", count: 2, source: "拾取", confidence: "100%" },
    { time: "12:42:56", player: "Alex", xuid: "1002", dir: "in", type: "minecraft:enchanted_book", name: "附魔书", count: 1, source: "拾取", confidence: "100%" },
    { time: "12:38:07", player: "Steve", xuid: "1001", dir: "out", type: "minecraft:bread", name: "面包", count: 4, source: "丢弃", confidence: "100%" }
  ];

  const auditRows = [
    { time: "12:48:02", operator: "admin", action: "还原背包", target: "Steve", state: "成功", hash: "9f8e7d6c5b4a39281706f5e4d3c2b1a0" },
    { time: "12:41:17", operator: "admin", action: "执行指令", target: "服务器", state: "成功", hash: "1a2b3c4d5e6f708192a3b4c5d6e7f809" },
    { time: "12:22:45", operator: "admin", action: "修改附魔", target: "Steve", state: "成功", hash: "abcdef0123456789abcdef0123456789" },
    { time: "12:18:03", operator: "admin", action: "执行指令", target: "服务器", state: "成功", hash: "00112233445566778899aabbccddeeff" },
    { time: "12:09:51", operator: "admin", action: "手动备份", target: "Steve", state: "成功", hash: "fedcba9876543210fedcba9876543210" }
  ];

  const taskRows = [
    { id: "01J7K2", title: "还原背包", target: "Steve", state: "succeeded", time: "12:48", detail: "inventory / armor / offhand" },
    { id: "01J7K1", title: "执行指令", target: "服务器", state: "succeeded", time: "12:41", detail: "say 服务器将在 10 分钟后维护" },
    { id: "01J7JZ", title: "修改附魔", target: "Steve", state: "queued", time: "12:39", detail: "离线排队 / 开服后执行" },
    { id: "01J7JY", title: "读取离线背包背包", target: "Notch", state: "failed", time: "12:31", detail: "玩家 UUID 不存在" },
    { id: "01J7JX", title: "手动备份", target: "Steve", state: "succeeded", time: "12:09", detail: "9 件物品 / 1 个大对象" },
    { id: "01J7JW", title: "执行指令", target: "服务器", state: "succeeded", time: "11:58", detail: "save hold" }
  ];

  const snapshotRows = [
    { time: "12:58:31", reason: "minute", count: 9, hash: "a1b2c3d4", id: "demo:1001:1088" },
    { time: "12:57:31", reason: "minute", count: 9, hash: "e5f6a7b8", id: "demo:1001:1087" },
    { time: "12:56:31", reason: "manual", count: 8, hash: "c9d0e1f2", id: "demo:1001:1086" },
    { time: "12:52:10", reason: "join", count: 7, hash: "12345678", id: "demo:1001:1085" },
    { time: "12:31:44", reason: "pre-restore", count: 9, hash: "778899aa", id: "demo:1001:1084" },
    { time: "12:18:31", reason: "minute", count: 9, hash: "55667788", id: "demo:1001:1083" },
    { time: "12:09:51", reason: "manual", count: 9, hash: "33445566", id: "demo:1001:1082" },
    { time: "11:58:31", reason: "minute", count: 8, hash: "11223344", id: "demo:1001:1081" }
  ];

  let selectedPlayer = players[0];
  let activeItem = null;
  let enchantDraft = [];

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function icon(type) {
    return "/textures/items/" + String(type || "").replace("minecraft:", "") + ".png?v=4";
  }

  function shortType(type) {
    return String(type || "").replace("minecraft:", "");
  }

  function renderPlayers() {
    const q = $("player-search").value.trim().toLowerCase();
    const list = players.filter((p) => !q || p.name.toLowerCase().includes(q) || p.xuid.includes(q));
    $("player-list").innerHTML = list.map((p) => `
      <button class="player-row ${p === selectedPlayer ? "active" : ""}" data-xuid="${esc(p.xuid)}">
        <span class="player-index">${esc(p.index)}</span>
        <span><span class="player-name">${esc(p.name)}</span><span class="player-xuid">${esc(p.xuid)}</span></span>
        <span class="player-state ${p.state === "online" ? "" : "offline"}"></span>
      </button>
    `).join("");
    $("player-list").querySelectorAll(".player-row").forEach((row) => {
      row.addEventListener("click", () => selectPlayer(row.dataset.xuid));
    });
  }

  function selectPlayer(xuid) {
    const found = players.find((p) => p.xuid === xuid);
    if (!found) return;
    selectedPlayer = found;
    $("player-name").textContent = found.name;
    $("player-xuid").textContent = "XUID " + found.xuid;
    $("player-seq").textContent = found.seq;
    $("player-state").textContent = document.body.classList.contains("cold") ? "离线" : (found.state === "online" ? "在线" : "离线");
    $("player-state").style.color = document.body.classList.contains("cold") || found.state !== "online" ? "var(--alert)" : "var(--ok)";
    renderPlayers();
  }

  function renderGrid(id, size, map) {
    const el = $(id);
    let html = "";
    for (let i = 0; i < size; i++) {
      const item = map.get(i);
      if (!item) {
        html += '<button class="slot empty" data-slot="' + i + '" aria-label="空槽位"></button>';
        continue;
      }
      const nbt = item.nbt ? '<span class="nbt-dot"></span>' : "";
      const count = item.count > 1 ? '<span class="count">' + item.count + "</span>" : "";
      const ench = item.enchants && item.enchants.length ? '<span class="ench"></span>' : "";
      let dur = "";
      if (item.durMax) {
        const pct = Math.max(0, Math.min(100, item.durCur / item.durMax * 100));
        dur = '<span class="dur ' + (pct <= 20 ? "low" : pct <= 50 ? "mid" : "") + '" style="width:' + pct + '%"></span>';
      }
      html += '<button class="slot" data-slot="' + i + '" data-item="' + esc(item.name) + '">' +
        '<img loading="lazy" src="' + icon(item.type) + '" alt="' + esc(item.name) + '" onerror="this.style.display=\'none\'">' +
        nbt + count + ench + dur + "</button>";
    }
    el.innerHTML = html;
    el.querySelectorAll(".slot").forEach((slot) => {
      const index = Number(slot.dataset.slot);
      const item = map.get(index);
      if (!item) return;
      slot.addEventListener("mouseenter", (event) => showTip(event, item));
      slot.addEventListener("mousemove", moveTip);
      slot.addEventListener("mouseleave", hideTip);
      slot.addEventListener("click", () => openDrawer(item));
    });
  }

  function showTip(event, item) {
    hideTip();
    const tip = document.createElement("div");
    tip.className = "item-tip";
    let html = '<div class="tip-name">' + esc(item.name || item.type) + '</div>' +
      '<div class="tip-type">' + esc(item.type) + '</div>';
    if (item.count > 1) html += '<div class="tip-line">数量 x' + item.count + "</div>";
    if (item.enchants) {
      item.enchants.forEach((e) => { html += '<div class="tip-ench">' + esc(e.name) + " " + e.level + "</div>"; });
    }
    if (item.durMax) html += '<div class="tip-line">耐久 ' + item.durCur + " / " + item.durMax + "</div>";
    if (item.containerItems) html += '<div class="tip-line">内含 ' + item.containerItems.length + " 种物品</div>";
    if (item.lore) html += '<div class="tip-lore">' + esc(item.lore) + "</div>";
    html += '<div class="tip-hint">点击查看 / 编辑 NBT</div>';
    tip.innerHTML = html;
    document.body.appendChild(tip);
    tip._x = event.clientX;
    tip._y = event.clientY;
    moveTip(event);
  }

  function moveTip(event) {
    const tip = document.querySelector(".item-tip");
    if (!tip) return;
    const pad = 14;
    const x = Math.min(event.clientX + pad, innerWidth - tip.offsetWidth - 8);
    const y = Math.min(event.clientY + pad, innerHeight - tip.offsetHeight - 8);
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  }

  function hideTip() {
    const tip = document.querySelector(".item-tip");
    if (tip) tip.remove();
  }

  function switchDrawerTab(tab) {
    document.querySelectorAll(".dtab").forEach((button) => {
      button.classList.toggle("active", button.dataset.dtab === tab);
    });
    $("drawer-detail").classList.toggle("hidden", tab !== "detail");
    $("drawer-enchant").classList.toggle("hidden", tab !== "enchant");
    if (tab === "enchant") renderEnchantDraft();
  }

  function openDrawer(item, tab) {
    activeItem = item;
    enchantDraft = (item.enchants || []).map((e) => Object.assign({}, e));
    $("drawer-img").src = icon(item.type);
    $("drawer-img").alt = item.name || item.type;
    $("drawer-name").textContent = item.name || item.type;
    $("drawer-type").textContent = item.type;
    $("drawer-offline").style.display = document.body.classList.contains("cold") ? "" : "none";
    const rows = [
      ["数量", "x" + (item.count || 1)],
      ["耐久", item.durMax ? item.durCur + " / " + item.durMax : "—"],
      ["附魔", item.enchants ? item.enchants.length : "0"],
      ["NBT", item.nbt ? "存在" : "—"]
    ];
    $("drawer-meta").innerHTML = rows.map((r) =>
      '<div class="meta-row"><span class="micro">' + r[0] + "</span><b>" + esc(r[1]) + "</b></div>"
    ).join("");
    $("drawer-nbt").textContent = item.nbt || "{ /* 该物品没有额外 NBT */ }";
    document.body.classList.add("drawer-open");
    switchDrawerTab(tab || "detail");
  }

  function closeDrawer(keepItem) {
    document.body.classList.remove("drawer-open");
    switchDrawerTab("detail");
    if (keepItem !== true) activeItem = null;
  }

  function toRoman(n) {
    const map = [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
    let out = "";
    let value = Number(n) || 1;
    for (const [v, s] of map) {
      while (value >= v) { out += s; value -= v; }
    }
    return out;
  }

  function renderEnchantDraft() {
    const count = String(enchantDraft.length).padStart(2, "0");
    $("ench-count").textContent = count;
    $("ench-count-2").textContent = count;
    if (!enchantDraft.length) {
      $("ench-list").innerHTML = '<div class="ench-empty">当前没有附魔。从下方选择附魔并添加。</div>';
      return;
    }
    $("ench-list").innerHTML = enchantDraft.map((e, index) => `
      <div class="ench-row">
        <span class="ench-name">${esc(e.name)}</span>
        <span class="ench-id">${esc(e.id)}</span>
        <span class="ench-roman">${toRoman(e.level)}</span>
        <button class="ench-step" data-step="${index}" data-delta="-1" title="降低一级">−</button>
        <button class="ench-step" data-step="${index}" data-delta="1" title="提高一级">+</button>
        <button class="ench-remove" data-remove="${index}" title="移除">移除</button>
      </div>
    `).join("");
    $("ench-list").querySelectorAll("[data-step]").forEach((button) => {
      button.addEventListener("click", () => {
        const index = Number(button.dataset.step);
        const delta = Number(button.dataset.delta);
        const entry = enchantDraft[index];
        if (!entry) return;
        const meta = ENCHANTS.find((x) => x.id === entry.id);
        entry.level = Math.max(1, Math.min(entry.level + delta, meta ? meta.max : 255));
        renderEnchantDraft();
      });
    });
    $("ench-list").querySelectorAll("[data-remove]").forEach((button) => {
      button.addEventListener("click", () => {
        enchantDraft.splice(Number(button.dataset.remove), 1);
        renderEnchantDraft();
      });
    });
  }

  function addEnchantDraft() {
    const id = $("ench-select").value;
    if (!id) return;
    const meta = ENCHANTS.find((e) => e.id === id);
    const level = Math.max(1, Math.min(Number($("ench-level").value) || 1, meta ? meta.max : 255));
    const existing = enchantDraft.find((e) => e.id === id);
    if (existing) {
      existing.level = level;
      existing.name = meta ? meta.name : id;
    } else {
      enchantDraft.push({ id: id, name: meta ? meta.name : id, level: level });
    }
    renderEnchantDraft();
  }

  function saveEnchants() {
    if (!activeItem) return;
    activeItem.enchants = enchantDraft.map((e) => Object.assign({}, e));
    renderGrid("inventory-grid", 36, inventory);
    renderGrid("armor-grid", 4, armor);
    renderGrid("offhand-grid", 1, offhand);
    renderGrid("ender-grid", 27, ender);
    openDrawer(activeItem, "enchant");
    toast("预览 / 附魔已更新（未接后端）");
  }

  function drawContours() {
    const group = $("contour-lines");
    if (!group) return;
    const ns = "http://www.w3.org/2000/svg";
    const steps = [-140, 250, 610, 970, 1330, 1580];
    for (let band = 0; band < 20; band++) {
      const base = 28 + band * 54 + (Math.random() * 18 - 9);
      const lines = 3 + (Math.random() > 0.5 ? 1 : 0);
      for (let line = 0; line < lines; line++) {
        let y = base + line * (7 + Math.random() * 9);
        let d = "M " + steps[0] + " " + y.toFixed(1);
        for (let i = 1; i < steps.length; i++) {
          const prevX = steps[i - 1];
          const nextX = steps[i];
          const nextY = y + (Math.random() * 54 - 27);
          const c1x = prevX + (nextX - prevX) * 0.34;
          const c2x = prevX + (nextX - prevX) * 0.68;
          const c1y = y + (Math.random() * 42 - 21);
          const c2y = nextY + (Math.random() * 42 - 21);
          d += " C " + c1x.toFixed(0) + " " + c1y.toFixed(1) + ", " +
            c2x.toFixed(0) + " " + c2y.toFixed(1) + ", " + nextX + " " + nextY.toFixed(1);
          y = nextY;
        }
        const path = document.createElementNS(ns, "path");
        path.setAttribute("d", d);
        path.setAttribute("vector-effect", "non-scaling-stroke");
        path.setAttribute("stroke-width", (0.8 + Math.random() * 0.55).toFixed(2));
        path.setAttribute("opacity", (0.28 + Math.random() * 0.36).toFixed(2));
        group.appendChild(path);
      }
    }
  }

  function renderOverview() {
    $("overview-players").innerHTML = players.map((p) => `
      <div class="player-row">
        <span class="player-index">${esc(p.index)}</span>
        <span><span class="player-name">${esc(p.name)}</span><span class="player-xuid">${esc(p.xuid)}</span></span>
        <span class="row-seq">序号 ${esc(p.seq)}</span>
        <span class="player-state ${p.state === "online" ? "" : "offline"}"></span>
      </div>
    `).join("");
    $("overview-flow").innerHTML = flowRows.slice(0, 4).map((f) => `
      <div class="compact-row">
        <img src="${icon(f.type)}" alt="" onerror="this.style.display='none'">
        <span class="grow">${esc(f.player)} · ${esc(f.name)} ×${f.count}</span>
        <span class="dir ${f.dir}">${f.dir === "in" ? "拾取" : "丢弃"}</span>
        <span class="dir">${esc(f.time)}</span>
      </div>
    `).join("");
    const levels = [2, 3, 2, 2, 1, 3, 2, 2, 2, 3, 1, 2, 3, 2, 2, 1, 2, 3, 3, 2, 2, 2, 1, 3, 2, 2, 3, 2, 2, 3];
    $("backup-heat").innerHTML = levels.map((n, i) => `<i class="${i === 17 ? "miss" : "l" + n}"></i>`).join("");
    $("overview-audit").innerHTML = auditRows.slice(0, 3).map((row) => `
      <div class="compact-row">
        <span class="mono">${esc(row.time)}</span>
        <span class="audit-action">${esc(row.operator)} · ${esc(row.action)} · ${esc(row.target)}</span>
        <span class="audit-hash">${esc(row.hash.slice(0, 10))}…</span>
        <span class="ok">${esc(row.state)}</span>
      </div>
    `).join("");
  }

  function renderFlow(filter, query) {
    const f = filter || "all";
    const q = String(query || "").toLowerCase();
    const list = flowRows.filter((row) => {
      if (f !== "all" && row.dir !== (f === "drop" ? "out" : "in")) return false;
      if (q && !(row.player.toLowerCase().includes(q) || row.type.includes(q) || row.name.includes(q))) return false;
      return true;
    });
    $("flow-count").textContent = list.length + " 条";
    $("flow-rows").innerHTML = list.map((row) => `
      <div class="table-row">
        <span class="mono">${esc(row.time)}</span>
        <span>${esc(row.player)}</span>
        <span class="dir ${row.dir}">${row.dir === "in" ? "拾取" : "丢弃"}</span>
        <span class="item-cell"><img src="${icon(row.type)}" alt="" onerror="this.style.display='none'"><span>${esc(row.name)}</span></span>
        <span>×${row.count}</span>
        <span>${esc(row.source)}</span>
        <span>${esc(row.confidence)}</span>
      </div>
    `).join("") || '<div class="ench-empty">没有匹配的物品去向事件。</div>';
  }

  function renderAudit() {
    $("audit-rows").innerHTML = auditRows.map((row) => `
      <div class="table-row">
        <span class="mono">${esc(row.time)}</span>
        <span>${esc(row.operator)}</span>
        <span>${esc(row.action)}</span>
        <span>${esc(row.target)}</span>
        <span class="ok">${esc(row.state)}</span>
        <code>${esc(row.hash.slice(0, 16))}…</code>
      </div>
    `).join("");
  }

  function renderTasks(filter) {
    const f = filter || "all";
    const list = taskRows.filter((row) => f === "all" || row.state === f);
    $("task-count").textContent = list.length + " 个任务";
    $("task-rows").innerHTML = list.map((row) => `
      <div class="task-item">
        <div><div class="task-title">${esc(row.title)}</div><div class="task-id">${esc(row.id)}</div></div>
        <div class="task-target">${esc(row.target)}</div>
        <span class="state-badge ${row.state}">${esc(row.state === "succeeded" ? "成功" : row.state === "failed" ? "失败" : row.state === "queued" ? "排队" : "执行中")}</span>
        <div class="mono">${esc(row.time)}</div>
        <div class="task-target">${esc(row.detail)}</div>
      </div>
    `).join("") || '<div class="ench-empty">没有匹配的任务。</div>';
  }

  function renderSnapshots() {
    const reasonLabel = { minute: "分钟", manual: "手动", join: "加入", "pre-restore": "还原前" };
    $("snapshot-timeline").innerHTML = snapshotRows.map((row) => `
      <div class="snap-item">
        <span class="snap-time">${esc(row.time)}</span>
        <span class="snap-reason">${esc(reasonLabel[row.reason] || row.reason)}</span>
        <span class="snap-meta">${row.count} 件 · ${esc(row.id)} · ${esc(row.hash)}</span>
        <button class="restore" data-snapshot="${esc(row.id)}">还原</button>
      </div>
    `).join("");
    $("snapshot-timeline").querySelectorAll("[data-snapshot]").forEach((button) => {
      button.addEventListener("click", () => toast("预览 / 还原 " + button.dataset.snapshot + " 未接后端"));
    });
  }

  function switchView(view) {
    document.querySelectorAll(".view").forEach((el) => {
      el.classList.toggle("active", el.id === "view-" + view);
    });
    document.querySelectorAll(".rail-btn[data-view]").forEach((el) => {
      el.classList.toggle("active", el.dataset.view === view);
    });
    if (view !== "players") closeDrawer();
    if (view === "overview") renderOverview();
    if (view === "flow") renderFlow("all", $("flow-search").value);
    if (view === "audit") renderAudit();
    if (view === "tasks") renderTasks("all");
    if (view === "snapshots") renderSnapshots();
    const url = new URL(location.href);
    url.searchParams.set("view", view);
    history.replaceState(null, "", url);
  }

  function runCommand() {
    const input = $("command-input");
    const cmd = input.value.trim();
    if (!cmd) return;
    const out = $("command-output");
    out.textContent = "> /" + cmd + "\n执行中...";
    setTimeout(() => {
      out.textContent = "> /" + cmd + "\n[任务 01J7M0] 已提交\n结果: 成功\n输出: 指令已执行，操作记录记录已写入。";
      toast("预览 / 指令执行未接后端");
    }, 450);
  }

  function toast(message) {
    const el = $("toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove("show"), 1600);
  }

  function setCold(cold) {
    document.body.classList.toggle("cold", cold);
    $("online-state").classList.toggle("offline", cold);
    $("online-state").querySelector("span").textContent = cold ? "未运行" : "在线";
    $("stat-status").textContent = cold ? "离线" : "在线";
    $("player-state").textContent = cold ? "离线" : (selectedPlayer.state === "online" ? "在线" : "离线");
    $("player-state").style.color = cold ? "var(--alert)" : (selectedPlayer.state === "online" ? "var(--ok)" : "var(--alert)");
    document.querySelectorAll(".player-row").forEach((row) => {
      const p = players.find((x) => x.xuid === row.dataset.xuid);
      const dot = row.querySelector(".player-state");
      if (!p || !dot) return;
      dot.classList.toggle("offline", cold || p.state !== "online");
    });
    if (cold) {
      $("cold-time").textContent = "数据截止 " + $("data-time").textContent;
    }
  }

  function bind() {
    $("player-search").addEventListener("input", renderPlayers);
    $("cold-toggle").addEventListener("click", () => setCold(!document.body.classList.contains("cold")));
    $("drawer-close").addEventListener("click", closeDrawer);
    $("scrim").addEventListener("click", closeDrawer);
    document.querySelectorAll(".dtab").forEach((button) => {
      button.addEventListener("click", () => switchDrawerTab(button.dataset.dtab));
    });
    $("ench-cancel").addEventListener("click", () => switchDrawerTab("detail"));
    $("ench-add").addEventListener("click", addEnchantDraft);
    $("ench-save").addEventListener("click", saveEnchants);
    $("ench-level-minus").addEventListener("click", () => {
      $("ench-level").value = Math.max(1, Number($("ench-level").value) - 1);
    });
    $("ench-level-plus").addEventListener("click", () => {
      $("ench-level").value = Math.min(255, Number($("ench-level").value) + 1);
    });
    $("ench-select").innerHTML = '<option value="">选择附魔...</option>' + ENCHANTS.map((e) =>
      '<option value="' + e.id + '">' + e.name + " / 最高 " + e.max + " 级</option>"
    ).join("");
    $("copy-nbt").addEventListener("click", async () => {
      if (!activeItem) return;
      try {
        await navigator.clipboard.writeText(activeItem.nbt || "");
        toast("SNBT 已复制");
      } catch (e) {
        toast("复制失败");
      }
    });
    document.querySelectorAll("[data-demo]").forEach((button) => {
      button.addEventListener("click", () => {
        const labels = { save: "保存物品", nbt: "保存 NBT", clear: "清空槽位", backup: "手动备份", offline: "读取离线背包", history: "历史备份" };
        toast("预览 / " + (labels[button.dataset.demo] || "操作") + " 未接后端");
      });
    });
    document.querySelectorAll(".rail-btn[data-view], [data-view].link").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        switchView(button.dataset.view);
      });
    });
    document.querySelectorAll("[data-flow-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll("[data-flow-filter]").forEach((b) => b.classList.remove("active"));
        button.classList.add("active");
        renderFlow(button.dataset.flowFilter, $("flow-search").value);
      });
    });
    $("flow-search").addEventListener("input", () => {
      const active = document.querySelector("[data-flow-filter].active");
      renderFlow(active ? active.dataset.flowFilter : "all", $("flow-search").value);
    });
    document.querySelectorAll("[data-task-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll("[data-task-filter]").forEach((b) => b.classList.remove("active"));
        button.classList.add("active");
        renderTasks(button.dataset.taskFilter);
      });
    });
    $("audit-verify").addEventListener("click", () => {
      const button = $("audit-verify");
      button.textContent = "校验中...";
      setTimeout(() => {
        button.textContent = "哈希链完整 · 3 条";
        toast("预览 / 哈希链校验通过");
      }, 500);
    });
    $("command-run").addEventListener("click", runCommand);
    $("command-input").addEventListener("keydown", (event) => {
      if (event.key === "Enter") runCommand();
    });
    document.querySelectorAll("[data-cmd]").forEach((button) => {
      button.addEventListener("click", () => {
        $("command-input").value = button.dataset.cmd;
        $("command-input").focus();
      });
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeDrawer();
    });
  }

  function boot() {
    drawContours();
    renderPlayers();
    renderGrid("inventory-grid", 36, inventory);
    renderGrid("armor-grid", 4, armor);
    renderGrid("offhand-grid", 1, offhand);
    renderGrid("ender-grid", 27, ender);
    bind();
    renderOverview();
    renderFlow("all", "");
    renderAudit();
    renderTasks("all");
    renderSnapshots();
    const initialView = params.get("view");
    if (initialView && document.getElementById("view-" + initialView)) switchView(initialView);
    if (params.get("cold") === "1") setCold(true);
    if (params.get("drawer") === "1" || params.get("enchants") === "1") {
      document.body.classList.add("drawer-instant");
      openDrawer(items.sword, params.get("enchants") === "1" ? "enchant" : "detail");
    }
  }

  boot();
})();
