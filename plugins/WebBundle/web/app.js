/* SPDX-License-Identifier: GPL-3.0-or-later */
(function () {
  "use strict";

  const COOKIE_AUTH = !!window.WB_COOKIE_AUTH;
  const VIEW_ORDER = ["overview", "players", "snapshots", "flow", "map", "command", "audit", "settings", "last"];
  const FILE_MODE = location.protocol === "file:";
  const STANDALONE = !!window.WB_STANDALONE;
  const AUTHED = window.WB_AUTHED !== false;
  const EMBEDDED = !STANDALONE && !FILE_MODE;
  let setupRequired = !!window.WB_SETUP_REQUIRED;
  let cookieSession = COOKIE_AUTH;
  const $ = (id) => document.getElementById(id);
  const state = {
    token: "",
    meta: null,
    role: "viewer",
    players: [],
    current: null,
    inventory: null,
    activeItem: null,
    activeNbt: "",
    nestedReadOnly: false,
    enchantDraft: [],
    flow: [],
    flowPage: 1,
    flowPageSize: 50,
    flowHasMore: false,
    flowSummary: null,
    flowSearchTimer: null,
    map: {
      meta: null,
      mode: "live",
      dim: 0,
      day: "",
      at: 0,
      clusters: [],
      containers: [],
      players: [],
      center: { x: 0, z: 0 },
      scale: 0.5,
      initialized: false,
      dragging: false,
      dragStart: null,
      hover: null,
      three: null
    },
    audit: [],
    auditPage: 1,
    auditPageSize: 25,
    auditFilter: "all",
    tasks: [],
    owner: false,
    accounts: [],
    snapshots: [],
    snapshotPage: 1,
    snapshotPageSize: 10,
    snapshotKey: "",
    globalSnapshots: [],
    globalSnapshotsKey: "",
    expandedBatches: new Set(),
    lastMoment: null,
    modules: [],
    extensions: [],
    commandHistory: [],
    view: "players",
    authSalt: "",
    authIterations: 210000,
    textureMap: {},
    textureMapLoaded: false,
    itemCatalog: [],
    itemCatalogLoaded: false,
    pollTimer: null,
    polling: false,
    nbtLoading: false
  };

  const externalProbe = { url: "", at: 0, online: false };
  const CONTAINER_SIZE = { inventory: 36, armor: 4, offhand: 1, ender: 27 };
  const CONTAINER_LABEL = { inventory: "背包", armor: "装备", offhand: "副手", ender: "末影箱" };
  const ACTION_TITLE = {
    "command.execute": "执行指令",
    "inventory.set": "设置槽位",
    "inventory.add": "添加物品",
    "inventory.remove": "清空槽位",
    "item.nbt.set": "设置 NBT",
    "item.nbt.refresh": "刷新 NBT",
    "item.enchants.set": "设置附魔",
    "item.lore.set": "设置 Lore 与标签",
    "item.name.set": "设置物品名称",
    "flow.craft": "记录合成物品",

    "item.nested.set": "修改容器内物品",
    "inventory.restore": "还原背包",
    "backup.create": "创建备份",
    "offline.snapshot": "读取离线背包"
  };
  const TEXTURE_ALIASES = {
    golden_apple: "apple_golden",
    enchanted_golden_apple: "apple_golden",
    golden_carrot: "carrot_golden",
    glistering_melon_slice: "melon_speckled",
    cooked_beef: "beef_cooked",
    cooked_chicken: "chicken_cooked",
    cooked_mutton: "mutton_cooked",
    cooked_porkchop: "porkchop_cooked",
    cooked_rabbit: "rabbit_cooked",
    cooked_salmon: "fish_salmon_cooked",
    cooked_cod: "fish_cooked",
    baked_potato: "potato_baked",
    poisonous_potato: "potato_poisonous",
    raw_beef: "beef_raw",
    raw_chicken: "chicken_raw",
    raw_mutton: "mutton_raw",
    raw_porkchop: "porkchop_raw",
    raw_rabbit: "rabbit_raw",
    raw_salmon: "fish_salmon_raw",
    egg: "egg_chicken"
  };

  const ITEM_NAMES = {
    "minecraft:diamond_sword": "钻石剑", "minecraft:netherite_sword": "下界合金剑",
    "minecraft:iron_sword": "铁剑", "minecraft:golden_sword": "金剑",
    "minecraft:stone_sword": "石剑", "minecraft:wooden_sword": "木剑",
    "minecraft:bow": "弓", "minecraft:crossbow": "弩", "minecraft:trident": "三叉戟",
    "minecraft:shield": "盾牌", "minecraft:elytra": "鞘翅",
    "minecraft:diamond": "钻石", "minecraft:emerald": "绿宝石", "minecraft:gold_ingot": "金锭",
    "minecraft:iron_ingot": "铁锭", "minecraft:netherite_ingot": "下界合金锭",
    "minecraft:golden_apple": "金苹果", "minecraft:enchanted_golden_apple": "附魔金苹果",
    "minecraft:apple": "苹果", "minecraft:bread": "面包", "minecraft:cooked_beef": "牛排",
    "minecraft:ender_pearl": "末影珍珠", "minecraft:ender_eye": "末影之眼",
    "minecraft:enchanted_book": "附魔书", "minecraft:book": "书",
    "minecraft:shulker_box": "潜影盒", "minecraft:undyed_shulker_box": "潜影盒",
    "minecraft:netherite_helmet": "下界合金头盔", "minecraft:netherite_chestplate": "下界合金胸甲",
    "minecraft:netherite_leggings": "下界合金护腿", "minecraft:netherite_boots": "下界合金靴",
    "minecraft:diamond_helmet": "钻石头盔", "minecraft:diamond_chestplate": "钻石胸甲",
    "minecraft:diamond_leggings": "钻石护腿", "minecraft:diamond_boots": "钻石靴",
    "minecraft:iron_helmet": "铁头盔", "minecraft:iron_chestplate": "铁胸甲",
    "minecraft:iron_leggings": "铁护腿", "minecraft:iron_boots": "铁靴",
    "minecraft:stone": "石头", "minecraft:cobblestone": "圆石",
    "minecraft:oak_log": "橡木原木", "minecraft:oak_planks": "橡木木板",
    "minecraft:grass_block": "草方块", "minecraft:dirt": "泥土",
    "minecraft:sand": "沙子", "minecraft:gravel": "沙砾", "minecraft:coal": "煤炭",
    "minecraft:raw_iron": "粗铁", "minecraft:raw_gold": "粗金",
    "minecraft:redstone": "红石", "minecraft:lapis_lazuli": "青金石",
    "minecraft:quartz": "下界石英", "minecraft:amethyst_shard": "紫水晶碎片",
    "minecraft:totem_of_undying": "不死图腾", "minecraft:firework_rocket": "烟花火箭"
  };
  const ENCHANT_NAMES = {
    sharpness: "锋利", smite: "亡灵杀手", bane_of_arthropods: "节肢杀手",
    unbreaking: "耐久", efficiency: "效率", fortune: "时运", mending: "经验修补",
    protection: "保护", fire_protection: "火焰保护", feather_falling: "摔落保护",
    blast_protection: "爆炸保护", projectile_protection: "弹射物保护",
    thorns: "荆棘", respiration: "水下呼吸", aqua_affinity: "水下速掘",
    depth_strider: "深海探索者", frost_walker: "冰霜行者", soul_speed: "灵魂疾行",
    looting: "抢夺", fire_aspect: "火焰附加", knockback: "击退",
    power: "力量", punch: "冲击", flame: "火矢",
    infinity: "无限", loyalty: "忠诚", impaling: "穿刺", riptide: "激流",
    channeling: "引雷", multishot: "多重射击", quick_charge: "快速装填",
    piercing: "穿透", binding_curse: "绑定诅咒", vanishing_curse: "消失诅咒",
    swift_sneak: "迅捷潜行", silk_touch: "精准采集", luck_of_the_sea: "海之眷顾",
    lure: "饵钓", wind_burst: "风爆", density: "密度", breach: "破甲", lunge: "突刺"
  };
  const ENCHANTS = Object.keys(ENCHANT_NAMES).map((id) => ({
    id: id,
    name: ENCHANT_NAMES[id],
    max: { mending: 1, infinity: 1, aqua_affinity: 1, flame: 1, channeling: 1,
      binding_curse: 1, vanishing_curse: 1, swift_sneak: 3, efficiency: 5,
      sharpness: 5, smite: 5, bane_of_arthropods: 5, power: 5, protection: 4,
      fire_protection: 4, blast_protection: 4, projectile_protection: 4,
      feather_falling: 4, fortune: 3, looting: 3, thorns: 3, respiration: 3,
      depth_strider: 3, soul_speed: 3, unbreaking: 3, lunge: 3 }[id] || 3
  }));

  function bytesToHex(bytes) {
    return Array.from(bytes).map((b) => ("0" + b.toString(16)).slice(-2)).join("");
  }

  function hexToBytes(hex) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
  }

  function randomSalt() {
    const bytes = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    return bytesToHex(bytes);
  }

  async function deriveVerifier(password, saltHex, iterations) {
    if (window.crypto && window.crypto.subtle) {
      try {
        const key = await window.crypto.subtle.importKey(
          "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]
        );
        const bits = await window.crypto.subtle.deriveBits({
          name: "PBKDF2",
          salt: hexToBytes(saltHex),
          iterations: Number(iterations || 210000),
          hash: "SHA-256"
        }, key, 256);
        return bytesToHex(new Uint8Array(bits));
      } catch (e) {
      }
    }
    if (window.WBPBKDF2 && typeof window.WBPBKDF2.deriveHex === "function") {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return await window.WBPBKDF2.deriveHexAsync(password, saltHex, Number(iterations || 210000), (ratio) => {
        const button = $("login-submit");
        if (button) button.textContent = "验证中 " + Math.floor(Number(ratio) * 100) + "%";
      });
    }
    throw new Error("浏览器不支持 WebCrypto，且 PBKDF2 后备脚本未加载");
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function textureBase(type) {
    return String(type || "").replace("minecraft:", "");
  }

  function textureName(type) {
    const base = textureBase(type);
    return (state.textureMap && state.textureMap[base]) || TEXTURE_ALIASES[base] || base;
  }

  async function loadTextureMap() {
    if (state.textureMapLoaded) return;
    state.textureMapLoaded = true;
    try {
      const res = await fetch("textures/items-map.json?v=4", { cache: "force-cache" });
      if (!res.ok) return;
      const data = await res.json();
      if (data && typeof data === "object") {
        state.textureMap = data;
      }
    } catch (e) {
      state.textureMap = {};
    }
  }

  async function loadItemCatalog() {
    if (state.itemCatalogLoaded) return;
    state.itemCatalogLoaded = true;
    try {
      const table = await api("/items/translations");
      const items = table && table.items ? table.items : {};
      state.itemCatalog = Object.keys(items).map((id) => ({
        id: id.indexOf(":") >= 0 ? id : "minecraft:" + id,
        name: String(items[id] || ""),
        english: String(table.english && table.english[id] || "")
      })).sort((a, b) => a.id.localeCompare(b.id));
    } catch (e) {
      state.itemCatalog = Object.keys(ITEM_NAMES).map((id) => ({ id: id, name: ITEM_NAMES[id], english: "" }));
    }
  }

  function hideItemSuggest() {
    const box = $("item-suggest");
    if (box) box.classList.add("hidden");
  }

  function showItemSuggest() {
    const input = $("drawer-type-input");
    const box = $("item-suggest");
    if (!input || !box) return;
    const query = String(input.value || "").trim().toLowerCase();
    const source = state.itemCatalog.length
      ? state.itemCatalog
      : Object.keys(ITEM_NAMES).map((id) => ({ id: id, name: ITEM_NAMES[id], english: "" }));
    const matches = source.filter((entry) => !query || entry.id.toLowerCase().includes(query) || entry.name.toLowerCase().includes(query) || entry.english.toLowerCase().includes(query)).slice(0, 24);
    if (!matches.length) { hideItemSuggest(); return; }
    const rect = input.getBoundingClientRect();
    box.style.left = Math.max(8, Math.min(window.innerWidth - 330, rect.left)) + "px";
    box.style.top = (rect.bottom + 4) + "px";
    box.style.width = Math.max(260, Math.min(420, rect.width)) + "px";
    box.innerHTML = matches.map((entry) => `<button type="button" class="item-suggest-row" data-item-id="${esc(entry.id)}"><img src="${icon(entry.id)}" alt=""><span><b>${esc(entry.name || entry.english || entry.id)}</b><small>${esc(entry.id)}</small></span></button>`).join("");
    box.classList.remove("hidden");
    box.querySelectorAll("[data-item-id]").forEach((button) => {
      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
        $("drawer-type-input").value = button.dataset.itemId;
        hideItemSuggest();
      });
    });
  }

  function icon(type) {
    return "textures/items/" + textureName(type) + ".png?v=7";
  }

  function iconFallback(type) {
    return "textures/items/" + textureBase(type) + ".png?v=7";
  }

  function iconImg(type, alt, lazy) {
    return `<img draggable="false"${lazy ? ' loading="lazy"' : ""} src="${icon(type)}" data-fallback="${iconFallback(type)}" alt="${esc(alt || "")}" onerror="if(this.dataset.fallback){this.src=this.dataset.fallback;this.dataset.fallback='';}else{this.style.display='none'}">`;
  }

  function shortType(type) {
    return String(type || "").replace("minecraft:", "").replace(/_/g, " ");
  }

  function itemName(item) {
    if (!item) return "空气";
    if (item.meta && item.meta.name) return item.meta.name;
    if (item.n) return item.n;
    return ITEM_NAMES[item.t] || shortType(item.t);
  }

  function enchantName(id) {
    const key = String(id || "").replace("minecraft:", "");
    return ENCHANT_NAMES[key] || key;
  }

  function itemEnchants(item) {
    if (!item || !item.meta) return [];
    const list = (item.meta.enchants && item.meta.enchants.length) ? item.meta.enchants : (item.meta.storedEnchants || []);
    return list.map((e) => ({
      id: String(e.id || ""),
      name: enchantName(e.id),
      level: Number(e.level || 1)
    }));
  }

  function fmtTime(ts) {
    if (!ts) return "--";
    try { return new Date(ts).toLocaleTimeString("zh-CN", { hour12: false }); } catch (e) { return "--"; }
  }

  function fmtDate(ts) {
    if (!ts) return "--";
    try { return new Date(ts).toLocaleString("zh-CN", { hour12: false }); } catch (e) { return "--"; }
  }

  function fmtDateOnly(ts) {
    if (!ts) return "--";
    try {
      const d = new Date(ts);
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    } catch (e) { return "--"; }
  }

  function fmtDateTimeInput(ts) {
    if (!ts) return "";
    const d = new Date(Number(ts));
    if (isNaN(d.getTime())) return "";
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }

  function fmtRangeLabel(from, to) {
    if (!from || !to) return "全部记录";
    return fmtDateOnly(from) + " " + fmtTime(from).slice(0, 5) + " ~ " + fmtDateOnly(to) + " " + fmtTime(to).slice(0, 5);
  }

  function enableContourFallback(canvas) {
    if (canvas) canvas.style.display = "none";
    document.body.classList.add("no-webgl-contours");
  }

  function initContours() {
    const canvas = $("contour-canvas");
    if (!canvas) return;
    let gl = null;
    try {
      gl = canvas.getContext("webgl", { antialias: false, alpha: false, depth: false });
    } catch (e) {
      gl = null;
    }
    if (!gl || !gl.getExtension("OES_standard_derivatives")) {
      enableContourFallback(canvas);
      return;
    }
    const vertexSource = `
      attribute vec2 a_position;
      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `;
    const fragmentSource = `
      #extension GL_OES_standard_derivatives : enable
      precision highp float;
      uniform vec2 u_resolution;
      uniform float u_time;
      vec4 permute(vec4 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
      vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
      float snoise(vec3 v) {
        const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
        const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
        vec3 i = floor(v + dot(v, C.yyy));
        vec3 x0 = v - i + dot(i, C.xxx);
        vec3 g = step(x0.yzx, x0.xyz);
        vec3 l = 1.0 - g;
        vec3 i1 = min(g.xyz, l.zxy);
        vec3 i2 = max(g.xyz, l.zxy);
        vec3 x1 = x0 - i1 + C.xxx;
        vec3 x2 = x0 - i2 + 2.0 * C.xxx;
        vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
        i = mod(i, 289.0);
        vec4 p = permute(permute(permute(
          i.z + vec4(0.0, i1.z, i2.z, 1.0)) +
          i.y + vec4(0.0, i1.y, i2.y, 1.0)) +
          i.x + vec4(0.0, i1.x, i2.x, 1.0));
        float n_ = 1.0 / 7.0;
        vec3 ns = n_ * D.wyz - D.xzx;
        vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
        vec4 x_ = floor(j * ns.z);
        vec4 y_ = floor(j - 7.0 * x_);
        vec4 x = x_ * ns.x + ns.yyyy;
        vec4 y = y_ * ns.x + ns.yyyy;
        vec4 h = 1.0 - abs(x) - abs(y);
        vec4 b0 = vec4(x.xy, y.xy);
        vec4 b1 = vec4(x.zw, y.zw);
        vec4 s0 = floor(b0) * 2.0 + 1.0;
        vec4 s1 = floor(b1) * 2.0 + 1.0;
        vec4 sh = -step(h, vec4(0.0));
        vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
        vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
        vec3 p0 = vec3(a0.xy, h.x);
        vec3 p1 = vec3(a0.zw, h.y);
        vec3 p2 = vec3(a1.xy, h.z);
        vec3 p3 = vec3(a1.zw, h.w);
        vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
        p0 *= norm.x;
        p1 *= norm.y;
        p2 *= norm.z;
        p3 *= norm.w;
        vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
        m = m * m;
        return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
      }
      void main() {
        vec2 uv = gl_FragCoord.xy / min(u_resolution.x, u_resolution.y);
        float speed = u_time * 0.012;
        float scale = 1.0;
        float density = 32.0;
        float n = snoise(vec3(uv * scale, speed));
        n += 0.16 * snoise(vec3(uv * scale * 2.4, speed * 1.2));
        n = n * 0.5 + 0.5;
        float relief = 0.5 + (n - 0.5) * 1.65;
        float cap = 0.84;
        float height = min(relief, cap);
        float plateau = smoothstep(cap - 0.012, cap + 0.002, relief);
        float band = fract(height * density);
        float edge = min(band, 1.0 - band);
        float gradient = fwidth(height * density);
        float width = max(gradient, 0.0008);
        float line = (1.0 - smoothstep(0.0, width, edge)) * smoothstep(0.00002, 0.00008, gradient);
        line = line * (1.0 - plateau);
        vec3 paper = vec3(0.995, 0.995, 0.992);
        vec3 ink = vec3(0.74, 0.74, 0.76);
        vec3 color = mix(paper, ink, line * 0.86);
        color = mix(color, vec3(0.972, 0.972, 0.968), plateau * 0.55);
        gl_FragColor = vec4(color, 1.0);
      }
    `;
    function compile(type, source) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    }
    const vertex = compile(gl.VERTEX_SHADER, vertexSource);
    const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
    if (!vertex || !fragment) {
      enableContourFallback(canvas);
      return;
    }
    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      enableContourFallback(canvas);
      return;
    }
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 1, -1, -1, 1,
      -1, 1, 1, -1, 1, 1
    ]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const resolution = gl.getUniformLocation(program, "u_resolution");
    const time = gl.getUniformLocation(program, "u_time");
    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(window.innerWidth * dpr));
      canvas.height = Math.max(1, Math.floor(window.innerHeight * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(resolution, canvas.width, canvas.height);
    }
    window.addEventListener("resize", resize);
    resize();
    const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();
    let frame = 0;
    let running = true;
    function draw(now) {
      if (!running) return;
      gl.uniform1f(time, reduced ? 0 : (now - start) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      if (!reduced) frame = requestAnimationFrame(draw);
    }
    function pause() {
      running = false;
      if (frame) cancelAnimationFrame(frame);
    }
    function resume() {
      if (running || reduced) return;
      running = true;
      frame = requestAnimationFrame(draw);
    }
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) pause();
      else resume();
    });
    draw(performance.now());
  }

  function toast(message) {
    const el = $("toast");
    if (!el) return;
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove("show"), 2200);
  }

  function applyLoginMode() {
    const account = $("account-block");
    const setup = $("setup-block");
    const submit = $("login-submit");
    const confirm = $("login-confirm");
    const confirmLabel = $("confirm-label");
    if (!account || !setup || !submit) return;
    confirm.classList.toggle("hidden", !(EMBEDDED && setupRequired));
    if (confirmLabel) confirmLabel.classList.toggle("hidden", !(EMBEDDED && setupRequired));
    const webTokenInput = $("setup-token");
    const webTokenLabel = $("setup-token-label");
    if (webTokenInput) webTokenInput.classList.toggle("hidden", !setupRequired);
    if (webTokenLabel) webTokenLabel.classList.toggle("hidden", !setupRequired);
    if (setupRequired && STANDALONE) {
      account.classList.add("hidden");
      setup.classList.remove("hidden");
      submit.classList.add("hidden");
      $("login-hint").textContent = "独立网页端尚未创建管理员账号。";
      $("login-foot").innerHTML = '请打开 /setup，并填写 BDS config.json 的 web.token。';
      return;
    }
    account.classList.remove("hidden");
    setup.classList.add("hidden");
    submit.classList.remove("hidden");
    if (setupRequired) {
      submit.textContent = "创建管理员";
      $("login-hint").textContent = "首次运行需创建管理员账号，并填写 config.json 的 web.token。";
      $("login-foot").innerHTML = 'Web Token 位于 config.json 的 web.token。用户名 3-32 位，密码至少 10 位。';
    } else if (STANDALONE) {
      submit.textContent = "登录";
      $("login-hint").textContent = "登录独立网页端。BDS 停止后可查看备份。";
      $("login-foot").innerHTML = '未创建账号时，请先完成 <a href="/setup">本机设置</a>。';
    } else {
      submit.textContent = "登录";
      $("login-hint").textContent = "登录 WebBundle 管理账号。";
      $("login-foot").innerHTML = '账号由首次运行创建，后续使用该账号登录。';
    }
  }

  function showLogin(message) {
    document.body.classList.add("login-active");
    $("login").classList.remove("hidden");
    applyLoginMode();
    $("login-error").textContent = message || "";
  }

  function hideLogin() {
    document.body.classList.remove("login-active");
    $("login").classList.add("hidden");
  }

  function authFail(message) {
    if (COOKIE_AUTH) {
      location.href = "/login";
      return;
    }
    state.token = "";
    sessionStorage.removeItem("webbundle.token");
    cookieSession = false;
    showLogin(message || "会话已失效，请重新登录。");
  }

  async function api(path, options) {
    const opt = options || {};
    const headers = Object.assign({ "Content-Type": "application/json" }, opt.headers || {});
    const res = await fetch("/api/v1" + path, {
      method: opt.method || "GET",
      headers: headers,
      credentials: "same-origin",
      body: opt.body ? JSON.stringify(opt.body) : undefined
    });
    let body = null;
    try { body = await res.json(); } catch (e) { body = null; }
    if (res.status === 401) {
      authFail("登录已失效，请重新登录。");
      const err = new Error("UNAUTHORIZED");
      err.auth = true;
      throw err;
    }
    if (!res.ok || !body || body.ok === false) {
      const message = body && body.error ? body.error.message : ("HTTP " + res.status);
      throw new Error(message);
    }
    return body.data;
  }

  function canWrite() {
    return state.role === "admin" || state.role === "operator";
  }

  function setOnline(online, label) {
    const node = $("online-state");
    node.classList.toggle("offline", !online);
    node.querySelector("span").textContent = label || (online ? "在线" : "已停止");
    $("stat-status").textContent = state.current ? (online ? "在线" : "离线") : "未连接";
  }

  function browserExternalUrl(raw) {
    const value = String(raw || "").trim();
    if (!value) return "";
    try {
      const u = new URL(value, location.href);
      if (u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "::1") {
        u.hostname = location.hostname;
      }
      return u.href.replace(/\/+$/, "");
    } catch (e) {
      return value.replace(/\/+$/, "");
    }
  }

  function updateTop(meta) {
    if (!meta) return;
    state.meta = meta;
    state.role = meta.role || "viewer";
    state.owner = !!meta.owner;
    $("server-name").textContent = meta.serverName || meta.serverId || "BDS";
    $("server-id").textContent = meta.serverId || "SRV-01";
    $("page-as-of").textContent = fmtDate(meta.dataAsOf || Date.now());
    $("data-time").textContent = fmtDate(meta.dataAsOf || Date.now());
    const external = meta.external || {};
    const externalUrl = browserExternalUrl(external.url);
    const link = $("external-link");
    if (link) {
      if (!externalUrl) {
        link.classList.add("hidden");
      } else {
        link.href = externalUrl;
        if (external.online) {
          link.classList.remove("hidden");
          externalProbe.url = externalUrl;
          externalProbe.at = Date.now();
          externalProbe.online = true;
        } else {
          probeExternal(externalUrl);
        }
      }
    }
    const online = !!(meta.server && meta.server.online);
    setOnline(online);
    document.body.classList.toggle("cold", !online);
    if (online) $("cold-banner").classList.add("hidden");
    else {
      $("cold-banner").classList.remove("hidden");
      $("cold-time").textContent = "数据截止 " + fmtDate(meta.server && meta.server.shutdownAt || meta.server && meta.server.lastSeen || meta.dataAsOf);
    }
    const lastButton = $("last-moment-btn");
    if (lastButton) lastButton.style.display = online ? "none" : "";
    applyRole();
    renderSettings();
  }

  async function probeExternal(url) {
    const normalized = browserExternalUrl(url);
    if (!normalized) return;
    const link = $("external-link");
    if (externalProbe.url === normalized && Date.now() - externalProbe.at < 10000) {
      if (link) link.classList.toggle("hidden", !externalProbe.online);
      return;
    }
    externalProbe.url = normalized;
    externalProbe.at = Date.now();
    externalProbe.online = false;
    if (link) link.classList.add("hidden");
    try {
      const res = await fetch(normalized + "/health", { method: "GET", mode: "cors", cache: "no-store" });
      externalProbe.online = res.ok;
    } catch (e) {
      externalProbe.online = false;
    }
    if (link) {
      link.href = normalized;
      link.classList.toggle("hidden", !externalProbe.online);
    }
  }

  function applyRole() {
    const admin = state.role === "admin";
    const command = document.querySelector('.rail-btn[data-view="command"]');
    const audit = document.querySelector('.rail-btn[data-view="audit"]');
    if (command) command.style.display = admin ? "" : "none";
    if (audit) audit.style.display = admin ? "" : "none";
    if (!admin && (state.view === "command" || state.view === "audit")) switchView("players");
  }

  function renderFlowPlayers() {
    const select = $("flow-player");
    if (!select) return;
    const current = select.value;
    select.innerHTML = '<option value="">全服玩家</option>' + state.players.map((p) =>
      `<option value="${esc(p.xuid)}">${esc(p.name || p.xuid)}</option>`).join("");
    if (current && state.players.some((p) => String(p.xuid) === String(current))) select.value = current;
  }

  async function loadPlayers() {
    const list = await api("/players");
    state.players = Array.isArray(list) ? list : [];
    renderFlowPlayers();
    const q = ($("player-search").value || "").trim().toLowerCase();
    const filtered = state.players.filter((p) => !q || (p.name || "").toLowerCase().includes(q) || String(p.xuid).includes(q));
    document.querySelector(".manifest-head strong").textContent = String(state.players.length).padStart(2, "0");
    if (!filtered.length) {
      $("player-list").innerHTML = '<div class="ench-empty">无玩家数据。</div>';
      if (!state.players.length) renderEmptyPlayer();
      return;
    }
    const rowMarkup = (p, i) => `
      <button class="player-row ${state.current && String(state.current.xuid) === String(p.xuid) ? "active" : ""}" data-xuid="${esc(p.xuid)}">
        <span class="player-index">${String(i + 1).padStart(3, "0")}</span>
        <span><span class="player-name">${esc(p.name || p.xuid)}</span><span class="player-xuid">${esc(p.xuid)}</span></span>
        <span class="player-state ${p.online ? "" : "offline"}"></span>
      </button>`;
    const online = filtered.filter((p) => p.online);
    const offline = filtered.filter((p) => !p.online);
    let cursor = 0;
    const groupMarkup = (label, list) => {
      if (!list.length) return "";
      const rows = list.map((p) => rowMarkup(p, cursor++)).join("");
      return `<div class="player-group"><div class="player-group-head"><span>${label}</span><b>${list.length}</b></div>${rows}</div>`;
    };
    $("player-list").innerHTML = groupMarkup("在线", online) + groupMarkup("离线", offline);
    $("player-list").querySelectorAll(".player-row").forEach((row) => {
      row.addEventListener("click", () => selectPlayer(row.dataset.xuid));
    });
  }

  function renderEmptyPlayer() {
    state.current = null;
    state.inventory = null;
    $("player-name").textContent = "无玩家数据";
    $("player-xuid").textContent = "尚未连接 BDS";
    $("player-state").textContent = "未连接";
    $("player-state").style.color = "var(--muted)";
    $("player-seq").textContent = "--";
    $("history-count").textContent = "0";
    const manifestCount = document.querySelector(".manifest-head strong");
    if (manifestCount) manifestCount.textContent = "00";
    $("inventory-count").textContent = "已用 00";
    $("armor-count").textContent = "00";
    $("offhand-count").textContent = "00";
    $("ender-count").textContent = "00";
    const stats = document.querySelectorAll(".stat");
    if (stats[0]) stats[0].querySelector("i").textContent = "已用 0";
    if (stats[1]) stats[1].querySelector("b").textContent = "00";
    if (stats[1]) stats[1].querySelector("i").textContent = "尚无数据";
    if (stats[2]) stats[2].querySelector("b").textContent = "--";
    if (stats[2]) stats[2].querySelector("i").textContent = "无备份";
    if (stats[3]) stats[3].querySelector("i").textContent = "未连接";
    renderGrid("inventory-grid", 27, [], "inventory", 9);
    renderGrid("hotbar-grid", 9, [], "inventory", 0);
    renderGrid("armor-grid", 4, [], "armor");
    renderGrid("offhand-grid", 1, [], "offhand");
    renderGrid("ender-grid", 27, [], "ender");
  }

  async function selectPlayer(xuid, at) {
    document.body.classList.remove("manifest-open");
    closeSnapshotDrawer();
    const found = state.players.find((p) => String(p.xuid) === String(xuid));
    if (!found) return;
    state.current = found;
    state.current.at = at || "";
    $("player-name").textContent = found.name || found.xuid;
    $("player-xuid").textContent = "XUID " + found.xuid;
    $("player-state").textContent = found.online ? "在线" : "离线";
    $("player-state").style.color = found.online ? "var(--ok)" : "var(--alert)";
    $("player-seq").textContent = found.seq || "--";
    await loadPlayers();
    await loadInventory(true);
    await loadSnapshots();
  }

  async function loadInventory(showError) {
    if (!state.current) return;
    try {
      const atQuery = state.current.at ? "?at=" + encodeURIComponent(state.current.at) : "";
      const data = await api("/players/" + encodeURIComponent(state.current.xuid) + "/inventory" + atQuery);
      state.inventory = data;
      renderInventory();
      const source = data.source === "live" ? "在线实时" : (data.source === "cold" ? "冷备份" : (data.source === "snapshot" ? "历史备份" : "最后备份"));
      $("player-xuid").textContent = "XUID " + state.current.xuid;
      $("player-state").textContent = state.current.online ? "在线" : "离线";
      $("player-state").style.color = state.current.online ? "var(--ok)" : "var(--alert)";
      $("player-seq").textContent = data.seq || "--";
      $("stat-status").textContent = state.current.online ? "在线" : "离线";
      $("stat-status").className = state.current.online ? "" : "warn";
      const used = Object.values(data.containers || {}).reduce((n, list) => n + (list ? list.length : 0), 0);
      let nbtCount = 0;
      for (const list of Object.values(data.containers || {})) {
        for (const entry of list || []) if (entry.item && (entry.item.nbt || entry.item.nbtRef)) nbtCount += 1;
      }
      document.querySelectorAll(".stat")[0].querySelector("i").textContent = "已用 " + used;
      const invEntries = (data.containers && data.containers.inventory) || [];
      const backpackUsed = invEntries.filter((entry) => Number(entry.slot) >= 9).length;
      const hotbarUsed = invEntries.filter((entry) => Number(entry.slot) < 9).length;
      $("inventory-count").textContent = String(backpackUsed).padStart(2, "0") + " / 27";
      $("hotbar-count").textContent = String(hotbarUsed).padStart(2, "0") + " / 09";
      $("armor-count").textContent = String((data.containers && data.containers.armor || []).length).padStart(2, "0");
      $("offhand-count").textContent = String((data.containers && data.containers.offhand || []).length).padStart(2, "0");
      $("ender-count").textContent = String((data.containers && data.containers.ender || []).length).padStart(2, "0");
      document.querySelectorAll(".stat")[1].querySelector("b").textContent = String(nbtCount).padStart(2, "0");
      document.querySelectorAll(".stat")[1].querySelector("i").textContent = source;
      document.querySelectorAll(".stat")[2].querySelector("b").textContent = fmtTime(data.ts).slice(0, 5);
      document.querySelectorAll(".stat")[3].querySelector("i").textContent = fmtDate(data.ts);
    } catch (e) {
      state.inventory = null;
      renderInventory();
      if (showError && !e.auth) toast("背包读取失败: " + e.message);
    }
  }

  function renderInventory() {
    const containers = state.inventory ? (state.inventory.containers || {}) : {};
    renderGrid("inventory-grid", 27, containers.inventory || [], "inventory", 9);
    renderGrid("hotbar-grid", 9, containers.inventory || [], "inventory", 0);
    renderGrid("armor-grid", 4, containers.armor || [], "armor");
    renderGrid("offhand-grid", 1, containers.offhand || [], "offhand");
    renderGrid("ender-grid", 27, containers.ender || [], "ender");
  }

  function renderGrid(id, size, entries, container, startSlot) {
    const el = $(id);
    if (!el) return;
    const offset = Number(startSlot || 0);
    const map = new Map((entries || []).map((entry) => [Number(entry.slot), entry.item]));
    let html = "";
    for (let i = 0; i < size; i++) {
      const slot = offset + i;
      const item = map.get(slot);
      if (!item || item.t === "minecraft:air" || Number(item.c || 0) <= 0) {
        html += '<button class="slot empty" data-container="' + container + '" data-slot="' + slot + '" aria-label="空槽位，点击给予物品"></button>';
        continue;
      }
      const enchants = itemEnchants(item);
      const count = Number(item.c || item.count || 1);
      const nbt = item.nbt || item.nbtRef ? '<span class="nbt-dot"></span>' : "";
      const dur = item.meta && item.meta.durMax
        ? (() => {
            const pct = Math.max(0, Math.min(100, item.meta.durCur / item.meta.durMax * 100));
            return '<span class="dur ' + (pct <= 20 ? "low" : pct <= 50 ? "mid" : "") + '" style="width:' + pct + '%"></span>';
          })()
        : "";
      html += '<button class="slot' + (enchants.length ? " enchanted" : "") + '" data-container="' + container + '" data-slot="' + slot + '" title="' + esc(itemName(item)) + '">' +
        iconImg(item.t, itemName(item), true) +
        nbt + (count > 1 ? '<span class="count">' + count + "</span>" : "") +
        dur + "</button>";
    }
    el.innerHTML = html;
    el.querySelectorAll(".slot.empty").forEach((button) => {
      button.addEventListener("click", () => openNewItem(button.dataset.container, Number(button.dataset.slot)));
    });
    el.querySelectorAll(".slot:not(.empty)").forEach((button) => {
      const entry = (entries || []).find((e) => Number(e.slot) === Number(button.dataset.slot));
      button.addEventListener("mouseenter", (event) => { if (entry) showItemTip(entry.item, event.clientX, event.clientY); });
      button.addEventListener("mousemove", (event) => moveItemTip(event.clientX, event.clientY));
      button.addEventListener("mouseleave", hideItemTip);
      button.addEventListener("click", () => {
        if (entry) openDrawer(button.dataset.container, Number(button.dataset.slot), entry.item);
      });
    });
  }

  function openNewItem(container, slot) {
    const item = {
      t: "minecraft:stone",
      c: 1,
      meta: { name: "", lore: [], enchants: [], storedEnchants: [], containerItems: [], tags: {} }
    };
    openDrawer(container, slot, item);
    state.activeItem.new = true;
    $("drawer-title").textContent = "空槽位 / 给予物品";
    $("drawer-name").textContent = "新建物品";
    $("drawer-type-input").value = "minecraft:stone";
    $("drawer-count-input").value = "1";
    $("drawer-type").textContent = "空槽位 #" + slot;
    switchDrawerTab("detail");
  }

  function applyDrawerReadonly(readOnly) {
    const ids = ["drawer-type-input", "drawer-count-input", "drawer-display-name", "drawer-dur-current",
      "drawer-lore", "tag-can-place", "tag-can-destroy", "tag-keep-death", "tag-item-lock",
      "nbt-edit", "ench-select", "ench-level", "ench-level-minus", "ench-level-plus", "ench-add", "ench-save"];
    ids.forEach((id) => {
      const node = $(id);
      if (node) node.disabled = !!readOnly;
    });
    document.querySelectorAll('[data-demo="save"], [data-demo="clear"]').forEach((node) => {
      node.disabled = !!readOnly;
    });
    const note = $("drawer-readonly");
    if (note) note.classList.toggle("hidden", !readOnly);
  }

  function openDrawer(container, slot, item, nestedPath, root, keepContainer) {
    if (!nestedPath) state.drawerRoot = { container: container, slot: slot, item: item };
    state.activeItem = { container: container, slot: slot, item: item, path: nestedPath || [] };
    $("drawer-back").classList.toggle("hidden", !(nestedPath && nestedPath.length));
    state.activeNbt = item.nbt || "";
    state.nbtLoading = !item.nbt && !!item.nbtRef;
    state.enchantDraft = itemEnchants(item).map((e) => Object.assign({}, e));
    state.nestedReadOnly = !!(nestedPath && nestedPath.length && state.drawerRoot &&
      /shulker_box/i.test(String(state.drawerRoot.item && state.drawerRoot.item.t || "")));
    applyDrawerReadonly(state.nestedReadOnly);
    const drawerIcon = document.querySelector(".drawer-icon");
    if (drawerIcon) drawerIcon.classList.toggle("enchanted", itemEnchants(item).length > 0);
    $("drawer-img").src = icon(item.t);
    $("drawer-img").dataset.fallback = iconFallback(item.t);
    $("drawer-img").onerror = function () {
      if (this.dataset.fallback) {
        this.src = this.dataset.fallback;
        this.dataset.fallback = "";
      } else {
        this.style.display = "none";
      }
    };
    $("drawer-img").alt = itemName(item);
    $("drawer-name").textContent = itemName(item);
    $("drawer-type").textContent = item.t;
    $("drawer-type-input").value = item.t;
    $("drawer-count-input").value = String(Math.max(1, Number(item.c || 1)));
    $("drawer-display-name").value = String(item.meta && item.meta.customName || "");
    const durMax = Number(item.meta && item.meta.durMax || 0);
    $("drawer-dur-max").textContent = durMax ? String(durMax) : "—";
    $("drawer-dur-current").value = durMax ? String(Math.max(0, Math.min(durMax, Number(item.meta.durCur || 0)))) : "";
    $("drawer-dur-current").disabled = !durMax;
    $("drawer-dur-current").max = durMax || "";
    $("drawer-offline").style.display = state.current && !state.current.online ? "" : "none";
    const rows = [
      ["数量", "x" + Number(item.c || 1)],
      ["耐久", item.meta && item.meta.durMax ? (item.meta.durCur + " / " + item.meta.durMax) : "—"],
      ["附魔", String(itemEnchants(item).length)],
      ["NBT", item.nbt || item.nbtRef ? "存在" : "—"]
    ];
    $("drawer-meta").innerHTML = rows.map((r) => '<div class="meta-row"><span class="micro">' + r[0] + "</span><b>" + esc(r[1]) + "</b></div>").join("");
    $("drawer-nbt").value = item.nbt || "";
    $("drawer-lore").value = ((item.meta && item.meta.lore) || []).join("\n");
    const tags = (item.meta && item.meta.tags) || {};
    $("tag-can-place").value = (tags.canPlaceOn || []).join(",");
    $("tag-can-destroy").value = (tags.canDestroy || []).join(",");
    $("tag-keep-death").checked = !!tags.keepOnDeath;
    $("tag-item-lock").value = tags.itemLock || "";
    if (!keepContainer) renderNested(item);
    applyDrawerReadonly(state.nestedReadOnly);
    hideItemTip();
    document.body.classList.add("drawer-open");
    const itemContents = item.meta && Array.isArray(item.meta.containerItems) ? item.meta.containerItems : [];
    const containerItem = itemContents.length > 0 || /shulker_box|bundle/i.test(String(item.t || ""));
    switchDrawerTab(containerItem ? "container" : "detail");
    if (!item.nbt && item.nbtRef) {
      const targetItem = state.activeItem && state.activeItem.item;
      $("drawer-nbt").value = "正在读取完整 SNBT…";
      api("/nbt/" + encodeURIComponent(item.nbtRef)).then((data) => {
        if (!state.activeItem || state.activeItem.item !== targetItem) return;
        state.nbtLoading = false;
        state.activeNbt = data.snbt || "";
        $("drawer-nbt").value = state.activeNbt || "";
      }).catch(() => {
        if (!state.activeItem || state.activeItem.item !== targetItem) return;
        state.nbtLoading = false;
        $("drawer-nbt").value = "";
        toast("完整 SNBT 读取失败");
      });
    } else {
      $("drawer-nbt").value = item.nbt || "";
    }
  }

  function nestedMarkup(item, path) {
    const enchants = itemEnchants(item);
    const count = Number(item.c || 1);
    const nbt = item.nbt || item.nbtRef ? '<span class="nbt-dot"></span>' : "";
    const dur = item.meta && item.meta.durMax
      ? (() => {
          const pct = Math.max(0, Math.min(100, item.meta.durCur / item.meta.durMax * 100));
          return '<span class="dur ' + (pct <= 20 ? "low" : pct <= 50 ? "mid" : "") + '" style="width:' + pct + '%"></span>';
        })()
      : "";
    return `<div class="nested-node" data-nested-path="${path}">
      <button class="slot nested-slot${enchants.length ? " enchanted" : ""}" data-nested-slot="${Number(item.slot || 0)}" title="${esc(itemName(item))}">
        ${iconImg(item.t, itemName(item), false)}
        ${nbt}${count > 1 ? `<span class="count">${count}</span>` : ""}${dur}
      </button>
    </div>`;
  }

  function nestedGridMarkup(items, path, type) {
    const isShulker = /shulker_box/i.test(String(type || ""));
    const maxSlot = items.reduce((max, item) => Math.max(max, Number(item.slot || 0)), -1);
    const size = isShulker ? 27 : Math.max(9, Math.ceil((maxSlot + 1) / 9) * 9);
    const bySlot = new Map(items.map((item) => [Number(item.slot || 0), item]));
    const cells = [];
    for (let slot = 0; slot < size; slot++) {
      const item = bySlot.get(slot);
      cells.push(item ? nestedMarkup(item, path + "-" + slot) : '<span class="slot empty nested-slot" aria-hidden="true"></span>');
    }
    return `<div class="nested-grid">${cells.join("")}</div>`;
  }

  function bindNestedHost(host, items, depth, path) {
    host.querySelectorAll("[data-nested-slot]").forEach((button) => {
      const item = items.find((entry) => Number(entry.slot || 0) === Number(button.dataset.nestedSlot));
      if (!item) return;
      button.addEventListener("mouseenter", (event) => showItemTip(item, event.clientX, event.clientY));
      button.addEventListener("mousemove", (event) => moveItemTip(event.clientX, event.clientY));
      button.addEventListener("mouseleave", hideItemTip);
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const node = button.closest(".nested-node");
        const next = node.nextElementSibling;
        const existing = next && next.classList.contains("nested-children") ? next : null;
        if (existing) {
          existing.remove();
          return;
        }
        const childPath = path + "-" + item.slot;
        const slots = childPath.split("-").slice(1).map((value) => Number(value)).filter((value) => Number.isInteger(value));
        if (state.drawerRoot) {
          openDrawer(state.drawerRoot.container, state.drawerRoot.slot, item, slots, state.drawerRoot, true);
        }
        const contents = item.meta && Array.isArray(item.meta.containerItems) ? item.meta.containerItems : [];
        if (!contents.length) {
          return;
        }
        const child = document.createElement("div");
        child.className = "nested-children";
        child.innerHTML = nestedGridMarkup(contents, path + "-" + item.slot, item.t);
        node.after(child);
        bindNestedHost(child, contents, depth + 1, path + "-" + item.slot);
      });
    });
  }

  function renderNested(item) {
    const host = $("drawer-nested");
    const contents = item.meta && Array.isArray(item.meta.containerItems) ? item.meta.containerItems : [];
    const tab = $("dtab-container");
    const isContainer = /shulker_box|bundle/i.test(String(item.t || ""));
    const visible = contents.length > 0 || isContainer;
    if (tab) tab.classList.toggle("hidden", !visible);
    if (!visible) return;
    $("nested-count").textContent = String(contents.length).padStart(2, "0");
    const readonlyNote = $("nested-readonly-note");
    if (readonlyNote) readonlyNote.classList.toggle("hidden", !/shulker_box/i.test(String(item.t || "")));
    if (!contents.length && !isContainer) {
      host.innerHTML = '<div class="nested-empty">该物品没有可解析的容器内容。</div>';
      return;
    }
    host.innerHTML = nestedGridMarkup(contents, "root", item.t);
    bindNestedHost(host, contents, 0, "root");
  }

  function showItemTip(item, x, y) {
    const tip = $("item-tip");
    if (!tip || !item) return;
    const enchants = itemEnchants(item);
    const lore = (item.meta && item.meta.lore) || [];
    const dur = item.meta && item.meta.durMax ? `<div class="tip-line">耐久 ${item.meta.durCur} / ${item.meta.durMax}</div>` : "";
    const enchText = enchants.slice(0, 6).map((e) => `<div class="tip-ench">${esc(enchantName(e.id))} ${toRoman(e.level)} (${e.level})</div>`).join("");
    const loreText = lore.length ? `<div class="tip-lore">${lore.slice(0, 4).map(esc).join("<br>")}</div>` : "";
    const children = item.meta && Array.isArray(item.meta.containerItems) ? item.meta.containerItems : [];
    const preview = children.slice(0, 5).map((child) =>
      `<div class="tip-line">${esc(itemName(child))} ×${Number(child.c || 1)}</div>`).join("");
    const container = children.length
      ? `<div class="tip-line">容器内容 ${children.length} 项</div>${preview}` +
        (children.length > 5 ? `<div class="tip-line">还有 ${children.length - 5} 项</div>` : "")
      : "";
    tip.innerHTML = `<div class="tip-name">${esc(itemName(item))}</div>
      <div class="tip-type">${esc(item.t)}${Number(item.c || 1) > 1 ? " ×" + Number(item.c || 1) : ""}</div>
      ${dur}${enchText}${container}${loreText}
      <div class="tip-hint">点击查看详情</div>`;
    tip.classList.remove("hidden");
    moveItemTip(x, y);
  }

  function moveItemTip(x, y) {
    const tip = $("item-tip");
    if (!tip || tip.classList.contains("hidden")) return;
    const pad = 14;
    const width = tip.offsetWidth || 240;
    const height = tip.offsetHeight || 100;
    const left = Math.min(window.innerWidth - width - pad, x + pad);
    const top = Math.min(window.innerHeight - height - pad, y + pad);
    tip.style.left = Math.max(pad, left) + "px";
    tip.style.top = Math.max(pad, top) + "px";
  }

  function hideItemTip() {
    $("item-tip").classList.add("hidden");
  }

  function closeDrawer() {
    $("drawer-title").textContent = "物品 / 详情";
    $("drawer-back").classList.add("hidden");
    state.drawerRoot = null;
    document.body.classList.remove("drawer-open");
    document.body.classList.remove("drawer-instant");
    hideItemTip();
    state.activeItem = null;
  }

  function switchDrawerTab(tab) {
    document.querySelectorAll(".dtab").forEach((button) => button.classList.toggle("active", button.dataset.dtab === tab));
    $("drawer-detail").classList.toggle("hidden", tab !== "detail");
    $("drawer-enchant").classList.toggle("hidden", tab !== "enchant");
    $("drawer-container").classList.toggle("hidden", tab !== "container");
    if (tab === "enchant") renderEnchantDraft();
  }

  function toRoman(n) {
    const value = Math.max(1, Math.floor(Number(n) || 1));
    if (value > 3999) return String(value);
    const parts = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
    let left = value;
    let out = "";
    for (const pair of parts) {
      while (left >= pair[0]) { out += pair[1]; left -= pair[0]; }
    }
    return out;
  }

  function renderEnchantDraft() {
    const count = String(state.enchantDraft.length).padStart(2, "0");
    $("ench-count").textContent = count;
    $("ench-count-2").textContent = count;
    if (!state.enchantDraft.length) {
      $("ench-list").innerHTML = '<div class="ench-empty">无附魔。请从下方选择并添加。</div>';
      return;
    }
    $("ench-list").innerHTML = state.enchantDraft.map((entry, index) => `
      <div class="ench-row">
        <span class="ench-name">${esc(entry.name)}</span>
        <span class="ench-id">${esc(entry.id)}</span>
        <span class="ench-roman">${toRoman(entry.level)}<span class="ench-number">${entry.level}</span></span>
        <button class="ench-step" data-ench-step="${index}" data-delta="-1">−</button>
        <button class="ench-step" data-ench-step="${index}" data-delta="1">+</button>
        <button class="ench-remove" data-ench-remove="${index}">移除</button>
      </div>
    `).join("");
    $("ench-list").querySelectorAll("[data-ench-step]").forEach((button) => {
      button.addEventListener("click", () => {
        const entry = state.enchantDraft[Number(button.dataset.enchStep)];
        if (!entry) return;
        const meta = ENCHANTS.find((x) => x.id === entry.id.replace("minecraft:", ""));
        entry.level = Math.max(1, Math.min(entry.level + Number(button.dataset.delta), 32767));
        renderEnchantDraft();
      });
    });
    $("ench-list").querySelectorAll("[data-ench-remove]").forEach((button) => {
      button.addEventListener("click", () => {
        state.enchantDraft.splice(Number(button.dataset.enchRemove), 1);
        renderEnchantDraft();
      });
    });
  }

  function addEnchantDraft() {
    const id = $("ench-select").value;
    if (!id) return;
    const meta = ENCHANTS.find((e) => e.id === id);
    const level = Math.max(1, Math.min(Number($("ench-level").value) || 1, 32767));
    const existing = state.enchantDraft.find((e) => e.id === id || e.id === "minecraft:" + id);
    if (existing) existing.level = level;
    else state.enchantDraft.push({ id: id, name: meta ? meta.name : id, level: level });
    renderEnchantDraft();
  }

  async function waitTask(taskId, timeoutMs) {
    const deadline = Date.now() + (timeoutMs || 12000);
    while (Date.now() < deadline) {
      const task = await api("/tasks/" + encodeURIComponent(taskId));
      if (task.state === "succeeded" || task.state === "failed" || task.state === "queued_offline") return task;
      await new Promise((resolve) => setTimeout(resolve, 450));
    }
    return api("/tasks/" + encodeURIComponent(taskId));
  }

  async function postAction(actionId, payload, successText) {
    if (!canWrite()) throw new Error("当前账号无写入权限");
    const res = await api("/actions/" + encodeURIComponent(actionId), { method: "POST", body: payload });
    toast("任务已创建: " + res.taskId);
    const task = await waitTask(res.taskId, 12000);
    if (task.state === "failed") throw new Error(task.error || "任务失败");
    if (task.state !== "succeeded") {
      toast("任务已进入离线队列，将在开服后执行");
      return task;
    }
    toast(successText || "操作成功");
    if (state.current) await loadInventory(false);
    return task;
  }

  function snapshotEditBlocked() {
    if (state.current && state.current.at) {
      toast("正在查看历史备份，请先还原后再修改");
      return true;
    }
    return false;
  }

  async function saveEnchants() {
    if (snapshotEditBlocked()) return;
    if (!state.activeItem || !state.current) return;
    if (state.nestedReadOnly) return toast("潜影盒内容仅支持查看，禁止修改");
    const path = Array.isArray(state.activeItem.path) ? state.activeItem.path : [];
    try {
      if (path.length) {
        await postAction("item.nested.set", {
          xuid: state.current.xuid,
          container: state.activeItem.container,
          slot: state.activeItem.slot,
          path: path,
          item: { t: state.activeItem.item.t },
          enchants: state.enchantDraft.map((e) => ({ id: e.id, level: e.level }))
        }, "附魔已保存");
      } else {
        await postAction("item.enchants.set", {
          xuid: state.current.xuid,
          container: state.activeItem.container,
          slot: state.activeItem.slot,
          enchants: state.enchantDraft.map((e) => ({ id: e.id, level: e.level }))
        }, "附魔已保存");
      }
      closeDrawer();
    } catch (e) {
      toast("附魔保存失败: " + e.message);
    }
  }

  async function saveNbt() {
    if (snapshotEditBlocked()) return;
    if (!state.activeItem || !state.current) return;
    if (state.nestedReadOnly) return toast("潜影盒内容仅支持查看，禁止修改");
    if (state.nbtLoading) return toast("完整 SNBT 仍在读取，请稍候再保存");
    if (!state.activeNbt) return toast("无待保存的 NBT 数据");
    const path = Array.isArray(state.activeItem.path) ? state.activeItem.path : [];
    try {
      if (path.length) {
        await postAction("item.nested.set", {
          xuid: state.current.xuid,
          container: state.activeItem.container,
          slot: state.activeItem.slot,
          path: path,
          item: { t: state.activeItem.item.t },
          nbt: state.activeNbt
        }, "NBT 已保存");
      } else {
        await postAction("item.nbt.set", {
          xuid: state.current.xuid,
          container: state.activeItem.container,
          slot: state.activeItem.slot,
          nbt: state.activeNbt
        }, "NBT 已保存");
      }
    } catch (e) {
      toast("NBT 保存失败: " + e.message);
    }
  }

  function readLore() {
    return String($("drawer-lore").value || "").split(String.fromCharCode(10)).filter((line) => line.length > 0);
  }

  function readTags() {
    const split = (value) => String(value || "").split(/[,，\s]+/).filter(Boolean);
    return {
      canPlaceOn: split($("tag-can-place").value),
      canDestroy: split($("tag-can-destroy").value),
      keepOnDeath: $("tag-keep-death").checked,
      itemLock: $("tag-item-lock").value
    };
  }

  async function saveItem() {
    if (snapshotEditBlocked()) return;
    if (!state.activeItem || !state.current) return;
    if (state.nestedReadOnly) return toast("潜影盒内容仅支持查看，禁止修改");
    if (state.nbtLoading) return toast("完整 SNBT 仍在读取，请稍候再保存");
    const data = {
      t: $("drawer-type-input").value.trim() || state.activeItem.item.t,
      c: Math.max(1, Number($("drawer-count-input").value) || 1),
      nbt: state.activeNbt || undefined
    };
    const durMax = Number(state.activeItem.item.meta && state.activeItem.item.meta.durMax || 0);
    const durability = durMax ? Math.max(0, Math.min(durMax, Number($("drawer-dur-current").value) || 0)) : undefined;
    const displayName = String($("drawer-display-name").value || "").trim().slice(0, 128);
    const originalDisplayName = String(state.activeItem.item.meta && state.activeItem.item.meta.customName || "").trim();
    const nameChanged = displayName !== originalDisplayName;
    const lore = readLore();
    const tags = readTags();
    const path = Array.isArray(state.activeItem.path) ? state.activeItem.path : [];
    try {
      if (path.length) {
        await postAction("item.nested.set", {
          xuid: state.current.xuid,
          container: state.activeItem.container,
          slot: state.activeItem.slot,
          path: path,
          item: data,
          displayName: nameChanged ? displayName : undefined,
          lore: lore,
          tags: tags,
          durability: durability,
          durMax: durMax || undefined
        }, "物品、Lore 与标签已保存");
      } else {
        await postAction("inventory.set", {
          xuid: state.current.xuid,
          container: state.activeItem.container,
          slot: state.activeItem.slot,
          item: data,
          durability: durability,
          durMax: durMax || undefined
        }, "物品已保存");
        await postAction("item.lore.set", {
          xuid: state.current.xuid,
          container: state.activeItem.container,
          slot: state.activeItem.slot,
          lore: lore,
          tags: tags
        }, "Lore 与标签已同步");
        if (nameChanged) {
          await postAction("item.name.set", {
            xuid: state.current.xuid,
            container: state.activeItem.container,
            slot: state.activeItem.slot,
            name: displayName
          }, "物品名称已保存");
        }
      }
    } catch (e) {
      toast("物品保存失败: " + e.message);
    }
  }

  async function clearItem() {
    if (snapshotEditBlocked()) return;
    if (!state.activeItem || !state.current) return;
    if (state.nestedReadOnly) return toast("潜影盒内容仅支持查看，禁止修改");
    if (!confirm("清空这个槽位？")) return;
    try {
      await postAction("inventory.remove", {
        xuid: state.current.xuid,
        container: state.activeItem.container,
        slot: state.activeItem.slot
      }, "槽位已清空");
      closeDrawer();
    } catch (e) {
      toast("物品清空失败: " + e.message);
    }
  }

  async function loadOverview() {
    try {
      const data = await api("/overview");
      state.overview = data;
      renderOverview(data);
    } catch (e) {
      if (!e.auth) toast("总览数据读取失败: " + e.message);
    }
  }

  function renderOverview(data) {
    const counts = data.counts || {};
    $("kpi-online").textContent = String(counts.playersOnline || 0).padStart(2, "0");
    $("overview-online-label").textContent = String(counts.playersOnline || 0).padStart(2, "0") + " 在线";
    $("kpi-players-total").textContent = "共 " + (counts.playersTotal || 0) + " 个玩家";
    $("kpi-snapshots").textContent = Number(counts.snapshotsToday || 0).toLocaleString("zh-CN");
    $("overview-backup-today").textContent = Number(counts.snapshotsToday || 0).toLocaleString("zh-CN") + " 份";
    $("kpi-flow").textContent = Number(counts.flowToday || 0).toLocaleString("zh-CN");
    $("kpi-flow-detail").textContent = "丢弃 " + (counts.flowOut || 0) + " / 拾取 " + (counts.flowIn || 0);
    const verify = data.auditVerify || {};
    $("kpi-audit").textContent = verify.valid ? "完整" : "需检查";
    $("kpi-audit-detail").textContent = "共 " + (verify.count || 0) + " 条记录";
    $("overview-players").innerHTML = (data.players || [])
      .filter((p) => p.online)
      .sort((a, b) => String(a.name || a.xuid).localeCompare(String(b.name || b.xuid), "zh-CN"))
      .map((p, i) => `
      <div class="player-row" data-overview-xuid="${esc(p.xuid)}">
        <span class="player-index">${String(i + 1).padStart(3, "0")}</span>
        <span><span class="player-name">${esc(p.name || p.xuid)}</span></span>
        <span class="player-state ${p.online ? "" : "offline"}"></span>
      </div>
    `).join("") || '<div class="ench-empty">无在线玩家。</div>';
    $("overview-players").querySelectorAll("[data-overview-xuid]").forEach((row) => {
      row.addEventListener("click", async () => {
        switchView("players");
        await selectPlayer(row.dataset.overviewXuid);
      });
    });
    $("overview-flow").innerHTML = (data.flow || []).slice(0, 4).map((f) => {
      const item = f.item || {};
      return `<div class="compact-row">${iconImg(item.t, itemName(item), false)}<span class="grow">${esc(f.name || f.xuid)} · ${esc(itemName(item))} ×${esc(f.count || item.c || 1)}</span><span class="dir ${f.direction === "in" ? "in" : "out"}">${f.direction === "in" ? "拾取" : "丢弃"}</span><span class="dir">${fmtTime(f.ts)}</span></div>`;
    }).join("") || '<div class="ench-empty">暂无物品去向记录。</div>';
    $("overview-audit").innerHTML = (data.audit || []).slice(0, 3).map((row) => `
      <div class="compact-row"><span class="mono">${fmtTime(row.ts)}</span><span class="audit-action">${esc(row.operator || "-")} · ${esc(ACTION_TITLE[row.action] || row.action)} · ${esc(row.target || "-")}</span><span class="audit-hash">${esc(String(row.hash || "").slice(0, 10))}…</span><span class="${row.state === "succeeded" ? "ok" : "warn"}">${row.state === "succeeded" ? "成功" : "失败"}</span></div>
    `).join("") || '<div class="ench-empty">暂无操作记录。</div>';
    const system = data.system || {};
    $("sys-storage").textContent = system.storage || "本地键值库";
    $("sys-external").textContent = system.external ? "已连接" : "未启用";
    $("sys-external").className = system.external ? "ok" : "warn";
    $("sys-queue").textContent = String(system.auditQueue || 0) + " 积压";
    $("sys-nbt").textContent = String(system.nbtObjects || 0);
  }

  function flowFilterState() {
    const active = document.querySelector("[data-flow-filter].active");
    const mode = active ? active.dataset.flowFilter : "all";
    const fromValue = $("flow-from") ? $("flow-from").value : "";
    const toValue = $("flow-to") ? $("flow-to").value : "";
    const from = fromValue ? new Date(fromValue).getTime() : 0;
    const to = toValue ? new Date(toValue).getTime() : 0;
    return {
      mode: mode,
      from: Number.isFinite(from) ? from : 0,
      to: Number.isFinite(to) ? to : 0,
      xuid: $("flow-player") ? $("flow-player").value : "",
      q: $("flow-search") ? $("flow-search").value.trim() : "",
      kind: mode === "craft" ? "craft" : "",
      direction: mode === "drop" ? "out" : (mode === "pickup" ? "in" : "")
    };
  }

  function flowQueryParams(filter, page) {
    const params = new URLSearchParams();
    if (filter.from) params.set("from", String(filter.from));
    if (filter.to) params.set("to", String(filter.to));
    if (filter.xuid) params.set("xuid", filter.xuid);
    if (filter.q) params.set("q", filter.q);
    if (filter.kind) params.set("kind", filter.kind);
    if (filter.direction) params.set("direction", filter.direction);
    if (page) params.set("page", String(page));
    params.set("pageSize", String(state.flowPageSize));
    return params.toString();
  }

  function updateFlowRangeLabel() {
    const label = $("flow-range-label");
    if (!label) return;
    const from = $("flow-from") ? new Date($("flow-from").value).getTime() : 0;
    const to = $("flow-to") ? new Date($("flow-to").value).getTime() : 0;
    label.textContent = fmtRangeLabel(from, to);
  }

  async function loadFlow(reset) {
    if (reset !== false) state.flowPage = 1;
    try {
      const filter = flowFilterState();
      if (filter.from && filter.to && filter.from >= filter.to) {
        if (reset !== false) toast("开始时间必须早于结束时间");
        return;
      }
      const data = await api("/flow?" + flowQueryParams(filter, state.flowPage));
      state.flow = Array.isArray(data && data.items) ? data.items : [];
      state.flowPage = Number(data && data.page || state.flowPage);
      state.flowHasMore = !!(data && data.hasMore);
      renderFlowRows();
      updateFlowRangeLabel();
    } catch (e) {
      if (!e.auth) toast("物品去向数据读取失败: " + e.message);
    }
  }

  function flowCoords(row) {
    const pos = row && row.pos;
    if (!pos) return "—";
    const fmt = (value) => String(Math.round(Number(value || 0) * 10) / 10);
    const dim = Number(row.dim || 0);
    const label = dim === 1 ? "下界" : (dim === 2 ? "末地" : "主世界");
    return fmt(pos.x) + " " + fmt(pos.y) + " " + fmt(pos.z) + " · " + label;
  }

  function flowContainerMarkup(item) {
    const children = item && item.meta && Array.isArray(item.meta.containerItems) ? item.meta.containerItems : [];
    if (!children.length) return "";
    const visible = children.slice(0, 64);
    return '<details class="flow-container" open><summary>容器内容 ' + children.length + " 项 · 只读</summary><div class=\"flow-container-grid\">" +
      visible.map((child) => '<span class="flow-container-item" title="' + esc(itemName(child)) + '">' +
        iconImg(child.t, itemName(child), true) + '<span>' + esc(itemName(child)) + "</span><b>×" + Number(child.c || 1) + "</b></span>").join("") +
      (children.length > visible.length ? '<span class="flow-container-more">还有 ' + (children.length - visible.length) + " 项</span>" : "") +
      "</div></details>";
  }

  function renderFlowRows() {
    const list = state.flow || [];
    $("flow-count").textContent = "本页 " + list.length + " 条";
    $("flow-page-label").textContent = "第 " + state.flowPage + " 页";
    $("flow-prev").disabled = state.flowPage <= 1;
    $("flow-next").disabled = !state.flowHasMore;
    $("flow-rows").innerHTML = list.map((row) => {
      const item = row.item || {};
      const isCraft = row.kind === "craft";
      const consumed = Array.isArray(row.consumed) ? row.consumed.map((entry) => itemName(entry)).join(" + ") : "";
      const gained = Array.isArray(row.gained) ? row.gained.map((entry) => itemName(entry)).join(" + ") : "";
      const kindLabel = isCraft ? "产出" : (row.kind === "pickup" ? "拾取" : "丢弃");
      const sourceLabel = isCraft ? "合成" : (row.ref ? "实体" : "背包");
      const detail = isCraft ? `<small class="craft-detail">${esc(consumed || "?")} → ${esc(gained || itemName(item))}</small>` : "";
      return `<div class="table-row">
        <span class="mono flow-time">${esc(fmtDate(row.ts))}</span>
        <span>${esc(row.name || row.xuid)}</span>
        <span class="dir ${isCraft ? "craft" : (row.direction === "in" ? "in" : "out")}">${kindLabel}</span>
        <span class="item-cell">${iconImg(item.t, itemName(item), false)}<span>${esc(itemName(item))}</span>${detail}</span>
        <span>×${esc(row.count || item.c || 1)}</span>
        <span>${sourceLabel}</span>
        <span class="flow-coords">${esc(flowCoords(row))}</span>
        ${flowContainerMarkup(item)}
      </div>`;
    }).join("") || '<div class="ench-empty">该范围内无匹配的物品去向记录。</div>';
  }

  function flowSummaryItemRows(items) {
    return (items || []).map((item) => {
      const dir = item.direction === "out" ? "out" : "in";
      return `<div class="flow-summary-item">
        ${iconImg(item.t, itemName(item), false)}
        <span class="grow"><b>${esc(itemName(item))}</b><small>${dir === "out" ? "丢失" : "获得"} · ${Number(item.events || 0)} 次 · 首次 ${esc(fmtDate(item.firstTs))} · 末次 ${esc(fmtDate(item.lastTs))}</small></span>
        <span class="dir ${dir}">${dir === "out" ? "丢失" : "获得"}</span>
        <b class="flow-summary-count">×${Number(item.count || 0)}</b>
      </div>`;
    }).join("");
  }

  function renderFlowSummary(data) {
    const totals = data && data.totals || {};
    const players = data && Array.isArray(data.players) ? data.players : [];
    const items = data && Array.isArray(data.items) ? data.items : [];
    const range = fmtRangeLabel(Number(data && data.from || 0), Number(data && data.to || 0));
    const empty = !totals.events;
    $("flow-summary-panel").classList.remove("hidden");
    $("flow-summary-body").innerHTML = empty
      ? '<div class="ench-empty">该时间范围内没有可总结的物品流动记录。</div>'
      : `<div class="flow-summary-head">
          <div><span class="micro">时间范围</span><b>${esc(range)}</b></div>
          <div><span class="micro">丢失 / 获得</span><b><span class="warn">${Number(totals.outCount || 0)}</span> / <span class="ok">${Number(totals.inCount || 0)}</span></b></div>
          <div><span class="micro">事件 / 物品</span><b>${Number(totals.events || 0)} 次 / ${Number(totals.count || 0)} 件</b></div>
        </div>
        <div class="flow-summary-lead">在 <b>${esc(range)}</b> 期间，全服共丢失 <b class="warn">${Number(totals.outCount || 0)}</b> 件，获得 <b class="ok">${Number(totals.inCount || 0)}</b> 件。</div>
        <div class="flow-summary-section"><div class="section-head"><span class="micro">全服物品合并</span><span class="rule"></span><span class="count">${items.length}</span></div>
          <div class="flow-summary-list">${flowSummaryItemRows(items) || '<div class="ench-empty">无物品记录。</div>'}</div>
        </div>
        <div class="flow-summary-section"><div class="section-head"><span class="micro">玩家流动总结</span><span class="rule"></span><span class="count">${players.length}</span></div>
          <div class="flow-summary-players">${players.map((player) => `<details class="flow-summary-player">
            <summary><b>${esc(player.name || player.xuid)}</b><span>丢失 ${Number(player.outCount || 0)} · 获得 ${Number(player.inCount || 0)} · ${Number(player.events || 0)} 次</span></summary>
            <div class="flow-summary-list">${flowSummaryItemRows(player.items) || '<div class="ench-empty">无物品记录。</div>'}</div>
          </details>`).join("")}</div>
        </div>`;
    $("flow-summary-panel").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  async function loadFlowSummary() {
    try {
      const filter = flowFilterState();
      const data = await api("/flow/summary?" + flowQueryParams(filter, 0));
      state.flowSummary = data;
      renderFlowSummary(data);
    } catch (e) {
      if (!e.auth) toast("区间总结读取失败: " + e.message);
    }
  }

  function setFlowRangeDays(days) {
    const to = Date.now();
    const from = to - Number(days || 1) * 24 * 3600 * 1000;
    $("flow-from").value = fmtDateTimeInput(from);
    $("flow-to").value = fmtDateTimeInput(to);
    updateFlowRangeLabel();
  }

  function scheduleFlowReload() {
    if (state.flowSearchTimer) clearTimeout(state.flowSearchTimer);
    state.flowSearchTimer = setTimeout(() => {
      state.flowSearchTimer = null;
      loadFlow(true);
    }, 280);
  }

  function mapDateValue() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function mapTimeValue() {
    const d = new Date();
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }

  function mapTimestamp() {
    const day = $("map-day").value || mapDateValue();
    const time = $("map-at").value || "00:00";
    return new Date(day + "T" + time).getTime();
  }

  function mapFolder(dim) {
    const found = (state.map.meta && state.map.meta.dimensions || []).find((d) => Number(d.id) === Number(dim));
    return found ? found.tile : (Number(dim) === 1 ? "nether" : (Number(dim) === 2 ? "the_end" : "overworld"));
  }

  function mapWorldToScreen(x, z) {
    const canvas = $("map-canvas");
    const width = canvas ? canvas.clientWidth : 800;
    const height = canvas ? canvas.clientHeight : 560;
    return {
      x: width / 2 + (Number(x || 0) - state.map.center.x) * state.map.scale,
      y: height / 2 + (Number(z || 0) - state.map.center.z) * state.map.scale
    };
  }

  const mapTiles = new Map();

  function mapTileEntry(folder, level, tx, tz) {
    const key = folder + "/" + level + "/" + tx + "_" + tz;
    if (mapTiles.has(key)) return mapTiles.get(key);
    const entry = { image: null, sourceFactor: 1, offsetX: 0, offsetZ: 0, state: "loading" };
    mapTiles.set(key, entry);
    const tryLoad = (sourceLevel, sourceTx, sourceTz) => {
      const image = new Image();
      image.onload = () => {
        const factor = Math.pow(2, sourceLevel - level);
        entry.image = image;
        entry.sourceFactor = factor;
        entry.offsetX = tx - Math.floor(tx / factor) * factor;
        entry.offsetZ = tz - Math.floor(tz / factor) * factor;
        entry.state = "ok";
        mapDraw();
      };
      image.onerror = () => {
        if (sourceLevel >= 14) {
          entry.state = "failed";
          return;
        }
        const next = sourceLevel + 1;
        tryLoad(next, Math.floor(tx / Math.pow(2, next - level)), Math.floor(tz / Math.pow(2, next - level)));
      };
      image.src = "/api/v1/map/tiles/" + folder + "/" + sourceLevel + "/" + sourceTx + "/" + sourceTz;
    };
    tryLoad(level, tx, tz);
    return entry;
  }

  function mapDraw() {
    const canvas = $("map-canvas");
    if (!canvas) return;
    const stage = $("map-stage");
    const width = Math.max(320, stage.clientWidth);
    const height = Math.max(320, stage.clientHeight);
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#e8e8e1";
    ctx.fillRect(0, 0, width, height);
    const scale = state.map.scale;
    const level = Math.max(0, Math.min(14, Math.round(Math.log2(1 / Math.max(scale, 0.001)))));
    const tileWorld = 256 * Math.pow(2, level);
    const halfW = width / 2 / scale;
    const halfH = height / 2 / scale;
    const minX = state.map.center.x - halfW;
    const maxX = state.map.center.x + halfW;
    const minZ = state.map.center.z - halfH;
    const maxZ = state.map.center.z + halfH;
    const minTx = Math.floor(minX / tileWorld);
    const maxTx = Math.floor(maxX / tileWorld);
    const minTz = Math.floor(minZ / tileWorld);
    const maxTz = Math.floor(maxZ / tileWorld);
    const folder = mapFolder(state.map.dim);
    let count = 0;
    for (let tx = minTx; tx <= maxTx; tx++) {
      for (let tz = minTz; tz <= maxTz; tz++) {
        if (count++ > 120) break;
        const key = folder + "/" + level + "/" + tx + "_" + tz;
        const entry = mapTileEntry(folder, level, tx, tz);
        if (entry.state !== "ok" || !entry.image) continue;
        const left = ((tx * tileWorld) - state.map.center.x) * scale + width / 2;
        const top = ((tz * tileWorld) - state.map.center.z) * scale + height / 2;
        const size = tileWorld * scale;
        const sourceSize = 256 / entry.sourceFactor;
        ctx.drawImage(entry.image, entry.offsetX * sourceSize, entry.offsetZ * sourceSize, sourceSize, sourceSize, left, top, size, size);
        ctx.strokeStyle = "rgba(14,14,14,.08)";
        ctx.strokeRect(left, top, size, size);
      }
    }
    ctx.fillStyle = "rgba(14,14,14,.45)";
    ctx.font = "10px 'Space Grotesk', Consolas, monospace";
    ctx.fillText("WORLD " + Math.round(state.map.center.x) + ", " + Math.round(state.map.center.z), 12, height - 12);
    const crosshairOn = $("map-crosshair") && $("map-crosshair").checked;
    const steps = [16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192];
    const step = steps.find((value) => value * scale >= 56) || 8192;
    const startX = Math.floor(minX / step) * step;
    const startZ = Math.floor(minZ / step) * step;
    ctx.font = "9px 'Space Grotesk', Consolas, monospace";
    for (let gx = startX; gx <= maxX; gx += step) {
      const px = (gx - state.map.center.x) * scale + width / 2;
      if (crosshairOn) {
        ctx.strokeStyle = "rgba(14,14,14,.18)";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, height); ctx.stroke();
      }
      if (px > 18 && px < width - 26) {
        ctx.fillStyle = "rgba(244,244,238,.88)";
        ctx.fillRect(px - 1, 0, 39, 13);
        ctx.fillStyle = "rgba(14,14,14,.68)";
        ctx.fillText(String(gx), px + 3, 10);
        ctx.fillStyle = "rgba(14,14,14,.5)";
        ctx.fillRect(px, 13, 1, 4);
      }
    }
    for (let gz = startZ; gz <= maxZ; gz += step) {
      const py = (gz - state.map.center.z) * scale + height / 2;
      if (crosshairOn) {
        ctx.strokeStyle = "rgba(14,14,14,.18)";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(width, py); ctx.stroke();
      }
      if (py > 18 && py < height - 10) {
        ctx.fillStyle = "rgba(244,244,238,.88)";
        ctx.fillRect(0, py - 10, 42, 13);
        ctx.fillStyle = "rgba(14,14,14,.68)";
        ctx.fillText(String(gz), 5, py - 1);
        ctx.fillStyle = "rgba(14,14,14,.5)";
        ctx.fillRect(42, py, 4, 1);
      }
    }
    ctx.fillStyle = "rgba(14,14,14,.55)";
    if (crosshairOn) {
      ctx.strokeStyle = "rgba(224,47,120,.9)";
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(width / 2, 0); ctx.lineTo(width / 2, height); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, height / 2); ctx.lineTo(width, height / 2); ctx.stroke();
      ctx.fillStyle = "#0e0e0e";
      ctx.fillRect(width / 2 - 1, height / 2 - 1, 3, 3);
      ctx.fillStyle = "rgba(244,244,238,.92)";
      ctx.fillRect(width / 2 + 5, height / 2 + 5, 122, 15);
      ctx.fillStyle = "#0e0e0e";
      ctx.fillText("X " + Math.round(state.map.center.x) + " / Z " + Math.round(state.map.center.z), width / 2 + 9, height / 2 + 16);
    }
    mapRenderMarkers();
  }

  function mapShowTip(html, event) {
    const tip = $("map-tooltip");
    const stage = $("map-stage");
    if (!tip || !stage) return;
    const rect = stage.getBoundingClientRect();
    tip.innerHTML = html;
    tip.classList.remove("hidden");
    tip.style.left = Math.min(rect.width - 270, Math.max(6, event.clientX - rect.left + 12)) + "px";
    tip.style.top = Math.min(rect.height - 150, Math.max(6, event.clientY - rect.top + 12)) + "px";
  }

  function mapHideTip() {
    const tip = $("map-tooltip");
    if (tip) tip.classList.add("hidden");
  }

  function mapPreviewHtml(cluster) {
    const items = cluster && Array.isArray(cluster.items) ? cluster.items : [];
    const count = Number(cluster && cluster.count || items.length || 1);
    const xs = items.map((item) => Number(item.x || 0));
    const ys = items.map((item) => Number(item.y || 0));
    const zs = items.map((item) => Number(item.z || 0));
    const minX = xs.length ? Math.min(...xs) : Number(cluster && cluster.x || 0);
    const maxX = xs.length ? Math.max(...xs) : Number(cluster && cluster.x || 0);
    const minY = ys.length ? Math.min(...ys) : 0;
    const maxY = ys.length ? Math.max(...ys) : 0;
    const minZ = zs.length ? Math.min(...zs) : Number(cluster && cluster.z || 0);
    const maxZ = zs.length ? Math.max(...zs) : Number(cluster && cluster.z || 0);
    const range = (a, b) => a === b ? String(a) : a + "–" + b;
    const first = items[0] || {};
    const preview = first.preview || [];
    const previewHtml = preview.map((item) => esc(itemName(item)) + " ×" + Number(item.c || 1)).join("<br>");
    return "<b>此处 " + count + " 个容器</b><br>" +
      "<span class=\"map-tip-range\">X " + range(minX, maxX) + " · Y " + range(minY, maxY) + " · Z " + range(minZ, maxZ) + "</span><br>" +
      "<span class=\"map-tip-type\">" + esc(first.name || first.type || "容器") + (first.itemCount != null ? " · " + Number(first.itemCount) + " 件" : "") + "</span>" +
      (previewHtml ? "<br>" + previewHtml : "") +
      (first.previewMore ? "<br>还有 " + Number(first.previewMore) + " 项" : "");
  }

  function mapRenderMarkers() {
    const host = $("map-markers");
    if (!host) return;
    host.innerHTML = "";
    const clusters = state.map.clusters || [];
    for (const cluster of clusters) {
      const pos = mapWorldToScreen(cluster.x, cluster.z);
      if (pos.x < -40 || pos.y < -40 || pos.x > host.clientWidth + 40 || pos.y > host.clientHeight + 40) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "map-marker" + (cluster.count > 1 ? " cluster" : "") + (cluster.items && cluster.items[0] && cluster.items[0].state === "removed" ? " history" : "");
      const first = cluster.items && cluster.items[0];
      button.innerHTML = (first ? iconImg(first.type, first.name || itemName({ t: first.type }), false) : "<b>◆</b>") +
        (cluster.count > 1 ? `<b class="map-marker-count">${cluster.count}</b>` : "");
      button.style.left = pos.x + "px";
      button.style.top = pos.y + "px";
      button.addEventListener("mouseenter", (event) => mapShowTip(mapPreviewHtml(cluster), event));
      button.addEventListener("mousemove", (event) => mapShowTip(mapPreviewHtml(cluster), event));
      button.addEventListener("mouseleave", mapHideTip);
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        if (cluster.count > 1) openMap3D(cluster.items || []);
        else if (first) openMapContainer(first.id);
      });
      host.appendChild(button);
    }
    for (const player of state.map.players || []) {
      if (Number(player.dim) !== Number(state.map.dim)) continue;
      const pos = mapWorldToScreen(player.x, player.z);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "map-marker player";
      button.textContent = String(player.name || "?").slice(0, 1);
      button.style.background = mapPlayerColor(player);
      button.style.borderColor = mapPlayerColor(player);
      button.style.left = pos.x + "px";
      button.style.top = pos.y + "px";
      button.title = String(player.name || player.xuid);
      button.addEventListener("click", (event) => { event.stopPropagation(); });
      host.appendChild(button);
    }
  }

  async function loadMapPlayers() {
    try {
      state.map.players = await api("/map/players");
      renderMapPlayers();
      $("map-player-count").textContent = String(state.map.players.filter((p) => Number(p.dim) === Number(state.map.dim)).length);
      mapDraw();
    } catch (e) {  }
  }

  function mapClusterItems(items, maxPoints) {
    const limit = Math.max(1, Math.min(100, Number(maxPoints || 100)));
    const list = (items || []).slice().sort((a, b) => {
      const da = (a.x - state.map.center.x) ** 2 + (a.z - state.map.center.z) ** 2;
      const db = (b.x - state.map.center.x) ** 2 + (b.z - state.map.center.z) ** 2;
      return da - db;
    });
    const threshold = 26;
    const groups = [];
    for (const item of list) {
      const pos = mapWorldToScreen(item.x, item.z);
      let best = null;
      let bestDist = threshold;
      for (const group of groups) {
        const dx = group.px - pos.x;
        const dz = group.py - pos.y;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < bestDist) { best = group; bestDist = dist; }
      }
      if (best) {
        best.items.push(item);
        best.count += 1;
        best.px = (best.px * (best.count - 1) + pos.x) / best.count;
        best.py = (best.py * (best.count - 1) + pos.y) / best.count;
        best.x = (best.x * (best.count - 1) + item.x) / best.count;
        best.z = (best.z * (best.count - 1) + item.z) / best.count;
      } else {
        groups.push({ id: "screen:" + item.id, dim: item.dim, x: item.x, z: item.z, px: pos.x, py: pos.y, count: 1, items: [item] });
      }
    }
    return groups.map((group) => ({
      id: group.id,
      dim: group.dim,
      x: Math.round(group.x),
      z: Math.round(group.z),
      count: group.count,
      items: group.items
    })).sort((a, b) => {
      const da = (a.x - state.map.center.x) ** 2 + (a.z - state.map.center.z) ** 2;
      const db = (b.x - state.map.center.x) ** 2 + (b.z - state.map.center.z) ** 2;
      return da - db;
    }).slice(0, limit);
  }

  async function loadMapContainers() {
    try {
      const params = new URLSearchParams();
      params.set("dim", String(state.map.dim));
      params.set("limit", "1000");
      params.set("cx", String(Math.round(state.map.center.x)));
      params.set("cz", String(Math.round(state.map.center.z)));
      if (state.map.mode === "history") {
        params.set("day", $("map-day").value || mapDateValue());
        params.set("at", String(mapTimestamp()));
      }
      const data = await api("/map/containers?" + params.toString());
      state.map.containers = data.items || [];
      const playerCount = state.map.players.filter((player) => Number(player.dim) === Number(state.map.dim)).length;
      state.map.clusters = mapClusterItems(state.map.containers, Math.max(1, 100 - playerCount));
      if (!state.map.initialized && state.map.containers.length) {
        state.map.center = { x: Number(state.map.containers[0].x || 0), z: Number(state.map.containers[0].z || 0) };
        state.map.initialized = true;
      }
      $("map-count").textContent = state.map.mode === "history"
        ? "历史 " + state.map.clusters.length + " 个标点 / " + state.map.containers.length + " 个容器"
        : "当前 " + state.map.clusters.length + " 个标点 / " + state.map.containers.length + " 个容器";
      $("map-status").textContent = state.map.mode === "history" ? "历史快照" : "实时";
      mapDraw();
    } catch (e) {
      if (!e.auth) toast("容器地图读取失败: " + e.message);
    }
  }

  function mapScheduleReload() {
    if (state.map.reloadTimer) clearTimeout(state.map.reloadTimer);
    state.map.reloadTimer = setTimeout(() => {
      state.map.reloadTimer = null;
      loadMapContainers();
    }, 180);
  }

  function mapPlayerColor(player) {
    const palette = ["#1f9dda", "#e04f9a", "#2fa36b", "#e08a2e", "#7a5bd6", "#d4453e", "#168c8c", "#a56a2b"];
    const key = String(player && (player.xuid || player.name) || "");
    let hash = 0;
    for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
    return palette[hash % palette.length];
  }

  function renderMapPlayers() {
    const host = $("map-player-list");
    if (!host) return;
    const players = (state.map.players || []).filter((player) => Number(player.dim) === Number(state.map.dim));
    host.innerHTML = players.map((player) => `
      <button type="button" class="map-player-row" data-map-player="${esc(player.xuid)}">
        <i style="background:${mapPlayerColor(player)}"></i>
        <span>${esc(player.name || player.xuid)}</span>
        <small>${Math.round(Number(player.x || 0))}, ${Math.round(Number(player.z || 0))}</small>
      </button>`).join("") || '<div class="ench-empty">当前没有在线玩家。</div>';
    host.querySelectorAll("[data-map-player]").forEach((button) => {
      button.addEventListener("click", () => {
        const player = players.find((entry) => String(entry.xuid) === button.dataset.mapPlayer);
        if (!player) return;
        state.map.center = { x: Number(player.x || 0), z: Number(player.z || 0) };
        state.map.scale = Math.max(state.map.scale, 0.35);
        state.map.initialized = true;
        mapDraw();
        loadMapContainers();
      });
    });
  }

  async function loadMap() {
    try {
      if (!state.map.meta) {
        state.map.meta = await api("/map/meta");
        if (!$("map-day").value) $("map-day").value = mapDateValue();
        if (!$("map-at").value) $("map-at").value = mapTimeValue();
      }
      await loadMapPlayers();
      await loadMapContainers();
      if (!state.map.initialized && state.map.players.length) {
        const p = state.map.players.find((entry) => Number(entry.dim) === Number(state.map.dim)) || state.map.players[0];
        state.map.center = { x: Number(p.x || 0), z: Number(p.z || 0) };
        state.map.initialized = true;
      }
      mapDraw();
    } catch (e) {
      $("map-status").textContent = "地图不可用";
      if (!e.auth) toast("地图初始化失败: " + e.message);
    }
  }

  function mapNestedMarkup(item, depth) {
    const children = item && item.meta && Array.isArray(item.meta.containerItems) ? item.meta.containerItems : [];
    if (!children.length || depth > 3) return "";
    return `<details class="map-nested"${depth === 1 ? " open" : ""}><summary>${esc(itemName(item))} 内 ${children.length} 项</summary>` +
      children.map((child) => `<div class="map-nested-item">${iconImg(child.t, itemName(child), true)}<span>${esc(itemName(child))}</span><b>×${Number(child.c || 1)}</b>${mapNestedMarkup(child, depth + 1)}</div>`).join("") +
      "</details>";
  }

  async function openMapContainer(id) {
    try {
      const at = state.map.mode === "history" ? mapTimestamp() : 0;
      const data = await api("/containers/" + encodeURIComponent(id) + (at ? "?at=" + at : ""));
      const obs = data.observation || {};
      const items = Array.isArray(obs.items) ? obs.items : [];
      const size = Number(obs.size || data.size || 27);
      const slotCount = Number.isFinite(size) && size > 0 ? size : 27;
      const typeLabel = mapContainerTypeLabel(data.type);
      const large = String(data.type || "").toLowerCase().indexOf("chest") >= 0 && slotCount > 27;
      const gridSize = large ? 54 : slotCount;
      $("map-detail-title").textContent = typeLabel + " · " + (data.name || data.type);
      $("map-detail-meta").textContent = "坐标 " + data.x + ", " + data.y + ", " + data.z +
        " · " + (obs.at ? fmtDate(obs.at) : "无观测") + " · " + (large ? "6×9" : slotCount) + (large ? "" : " 格");
      const bySlot = new Map(items.map((entry) => [Number(entry.slot), entry.item || {}]));
      const grid = [];
      for (let i = 0; i < gridSize; i++) {
        const item = bySlot.get(i);
        grid.push(item
          ? `<div class="slot map-detail-slot" title="${esc(itemName(item))}">${iconImg(item.t, itemName(item), false)}<span class="count">${Number(item.c || 1)}</span></div>`
          : '<div class="slot empty map-detail-slot"></div>');
      }
      $("map-detail-grid").innerHTML = grid.join("");
      const nested = items.map((entry) => mapNestedMarkup(entry.item, 1)).filter(Boolean).join("");
      $("map-detail-nested").innerHTML = nested;
      $("map-container-modal").classList.remove("hidden");
    } catch (e) {
      toast("容器读取失败: " + e.message);
    }
  }

  function map3dBuildLayers(items) {
    const list = (items || []).filter(Boolean);
    const bandStart = (y) => y >= 1
      ? Math.floor((y - 1) / 16) * 16 + 1
      : Math.floor((y + 15) / 16) * 16 - 15;
    const groups = new Map();
    for (const item of list) {
      const x = Number(item.x || 0);
      const y = Number(item.y || 0);
      const z = Number(item.z || 0);
      const startY = bandStart(y);
      const chunkX = Math.floor(x / 16);
      const chunkZ = Math.floor(z / 16);
      const key = startY + ":" + chunkX + ":" + chunkZ;
      if (!groups.has(key)) {
        groups.set(key, { startY: startY, chunkX: chunkX, chunkZ: chunkZ, items: [] });
      }
      groups.get(key).items.push(item);
    }
    const layers = Array.from(groups.values()).map((group) => {
      const capped = group.items.slice(0, 256);
      return {
        items: capped,
        minX: Math.min(...capped.map((item) => Number(item.x || 0))),
        maxX: Math.max(...capped.map((item) => Number(item.x || 0))),
        minY: group.startY,
        maxY: group.startY + 15,
        minZ: Math.min(...capped.map((item) => Number(item.z || 0))),
        maxZ: Math.max(...capped.map((item) => Number(item.z || 0))),
        actualMinY: Math.min(...capped.map((item) => Number(item.y || 0))),
        actualMaxY: Math.max(...capped.map((item) => Number(item.y || 0))),
        avgY: capped.reduce((sum, item) => sum + Number(item.y || 0), 0) / capped.length,
        chunkX: group.chunkX,
        chunkZ: group.chunkZ,
        truncated: group.items.length > capped.length
      };
    });
    layers.sort((a, b) => b.minY - a.minY || a.chunkX - b.chunkX || a.chunkZ - b.chunkZ);
    layers.forEach((layer, index) => { layer.index = index; });
    return layers;
  }

  const map3dThree = {
    ready: false,
    renderer: null,
    scene: null,
    camera: null,
    controls: null,
    group: null,
    boxes: [],
    containers: [],
    explode: 0,
    explodeTarget: 0,
    explodeH: 1.6,
    explodeV: 1.0,
    selectedId: "",
    listSignature: "",
    lastListAt: 0,
    raf: 0,
    center: null,
    radius: 10,
    pointer: null
  };

  function map3dInitThree() {
    if (map3dThree.ready) return true;
    if (!window.THREE) return false;
    try {
      const canvas = $("map-3d-canvas");
      const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.setClearColor(0xe8ecdf, 0);
      const scene = new THREE.Scene();
      scene.fog = new THREE.Fog(0xe8ecdf, 50, 180);
      const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 600);
      camera.position.set(18, 20, 24);
      const controls = new THREE.OrbitControls(camera, canvas);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.screenSpacePanning = true;
      controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: -1 };
      controls.minDistance = 6;
      controls.maxDistance = 220;
      controls.maxPolarAngle = Math.PI * 0.48;
      controls.target.set(0, 2, 0);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x556644, 0.65));
      const key = new THREE.DirectionalLight(0xfff4d6, 0.9);
      key.position.set(20, 35, 16);
      scene.add(key);
      const rim = new THREE.DirectionalLight(0xb8d5ff, 0.6);
      rim.position.set(-25, 12, -20);
      scene.add(rim);
      const group = new THREE.Group();
      scene.add(group);
      map3dThree.renderer = renderer;
      map3dThree.scene = scene;
      map3dThree.camera = camera;
      map3dThree.controls = controls;
      map3dThree.group = group;
      map3dThree.center = new THREE.Vector3(0, 0, 0);
      map3dThree.ready = true;
      return true;
    } catch (e) {
      map3dThree.ready = false;
      return false;
    }
  }

  function map3dThreeResize() {
    if (!map3dThree.ready) return;
    const canvas = $("map-3d-canvas");
    const width = Math.max(320, canvas.clientWidth);
    const height = Math.max(260, canvas.clientHeight);
    map3dThree.renderer.setSize(width, height, false);
    map3dThree.camera.aspect = width / height;
    map3dThree.camera.updateProjectionMatrix();
  }

  function map3dContainerColor(type) {
    const value = String(type || "");
    if (value.includes("barrel")) return { body: 0x8a5c31, lid: 0x9d6d3b, trim: 0x3f2a16 };
    if (value.includes("shulker")) return { body: 0x8b63b0, lid: 0xa77bc8, trim: 0x5b3f76 };
    if (value.includes("furnace") || value.includes("smoker")) return { body: 0x777777, lid: 0x8e8e8e, trim: 0x3c3c3c };
    if (value.includes("hopper") || value.includes("dispenser") || value.includes("dropper")) return { body: 0x5f6467, lid: 0x777d80, trim: 0x2f3335 };
    return { body: 0x8b5a2b, lid: 0x9e6935, trim: 0x382515 };
  }

  const map3dChestTextures = new Map();
  function map3dChestTexture(name, repeatX) {
    const repeat = Math.max(1, Number(repeatX || 1));
    const key = name + ":" + repeat;
    if (map3dChestTextures.has(key)) return map3dChestTextures.get(key);
    let texture = map3dChestTextures.get(name);
    if (!texture) {
      texture = new THREE.TextureLoader().load("textures/custom/" + name);
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
      if ("encoding" in texture) texture.encoding = THREE.sRGBEncoding;
      map3dChestTextures.set(name, texture);
    }
    if (repeat > 1) {
      texture = texture.clone();
      texture.needsUpdate = true;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(repeat, 1);
    }
    map3dChestTextures.set(key, texture);
    return texture;
  }

  function mapContainerTypeLabel(type) {
    const value = String(type || "").toLowerCase();
    if (value.indexOf("shulker") >= 0) return "潜影盒";
    if (value.indexOf("hopper") >= 0) return "漏斗";
    if (value.indexOf("dispenser") >= 0) return "发射器";
    if (value.indexOf("dropper") >= 0) return "投掷器";
    if (value.indexOf("barrel") >= 0) return "木桶";
    if (value.indexOf("chest") >= 0) return "箱子";
    return "容器";
  }

  function map3dApplyFacing(group, facing) {
    const value = String(facing || "south").toLowerCase();
    if (value === "down") group.rotation.x = Math.PI / 2;
    else if (value === "up") group.rotation.x = -Math.PI / 2;
    else group.rotation.y = value === "north" ? Math.PI : (value === "east" ? Math.PI / 2 : (value === "west" ? -Math.PI / 2 : 0));
  }

  function map3dCreateContainer(item, x, y, z, removed, layerIndex) {
    const group = new THREE.Group();
    const type = String(item.type || "").toLowerCase();
    const mat = (texture, color, roughness, metalness) => new THREE.MeshStandardMaterial({
      map: texture || null,
      color: color == null ? 0xffffff : color,
      roughness: roughness == null ? 0.82 : roughness,
      metalness: metalness == null ? 0.02 : metalness,
      transparent: removed,
      opacity: removed ? 0.55 : 1
    });
    const addBox = (w, h, d, px, py, pz, materials, register, parent) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials);
      mesh.position.set(px, py, pz);
      mesh.userData.id = item.id;
      mesh.userData.layer = layerIndex;
      (parent || group).add(mesh);
      if (register !== false) map3dThree.boxes.push(mesh);
      return mesh;
    };
    const facing = String(item.facing || "south").toLowerCase();
    if (type.indexOf("shulker") >= 0) {
      const colorKeys = ["white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "light_gray", "gray", "silver", "cyan", "purple", "blue", "brown", "green", "red", "black", "undyed"];
      let colorKey = "purple";
      for (const key of colorKeys) {
        if (type.indexOf(key + "_shulker") >= 0 || type.indexOf(key + "_box") >= 0) colorKey = key;
      }
      const shulkerTex = map3dChestTexture("shulker_" + colorKey + ".png");
      const shulkerMats = [mat(shulkerTex), mat(shulkerTex), mat(shulkerTex), mat(shulkerTex), mat(shulkerTex), mat(shulkerTex)];
      addBox(0.94, 1.0, 0.94, 0, 0.5, 0, shulkerMats);
    } else if (type.indexOf("hopper") >= 0) {
      const side = map3dChestTexture("hopper_side_real.png");
      const inside = map3dChestTexture("hopper_inside_real.png");
      const sideMat = mat(side, 0xffffff, 0.62, 0.35);
      const insideMat = mat(inside, 0xffffff, 0.62, 0.35);
      addBox(0.98, 0.22, 0.98, 0, 0.89, 0, [sideMat, sideMat, insideMat, insideMat, sideMat, sideMat]);
      addBox(0.96, 0.04, 0.96, 0, 0.79, 0, insideMat, false);
      addBox(0.74, 0.36, 0.74, 0, 0.60, 0, sideMat);
      const spout = new THREE.Group();
      spout.position.set(0, 0.30, 0);
      addBox(0.46, 0.22, 0.46, 0, 0.01, 0, sideMat, true, spout);
      addBox(0.24, 0.20, 0.24, 0, -0.20, 0, sideMat, true, spout);
      if (facing === "up") spout.rotation.x = Math.PI;
      else if (facing === "north") spout.rotation.x = Math.PI / 2;
      else if (facing === "south") spout.rotation.x = -Math.PI / 2;
      else if (facing === "east") spout.rotation.z = -Math.PI / 2;
      else if (facing === "west") spout.rotation.z = Math.PI / 2;
      group.add(spout);
    } else if (type.indexOf("dispenser") >= 0 || type.indexOf("dropper") >= 0) {
      const dispenser = type.indexOf("dispenser") >= 0;
      const vertical = facing === "up" || facing === "down";
      const side = map3dChestTexture("machine_side_real.png");
      const top = map3dChestTexture("machine_top_real.png");
      const front = map3dChestTexture(dispenser
        ? (vertical ? "dispenser_front_vertical_real.png" : "dispenser_front_real.png")
        : (vertical ? "dropper_front_vertical_real.png" : "dropper_front_real.png"));
      const sideMat = mat(side);
      const frontMat = mat(front);
      const topMat = mat(top);
      const addPlane = (px, py, pz, rx, ry, material) => {
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.98, 0.98), material);
        plane.position.set(px, py, pz);
        plane.rotation.set(rx, ry, 0);
        plane.userData.id = item.id;
        plane.userData.layer = layerIndex;
        group.add(plane);
        map3dThree.boxes.push(plane);
      };
      addPlane(0, 0.49, 0.49, 0, 0, frontMat);
      addPlane(0, 0.49, -0.49, 0, Math.PI, sideMat);
      addPlane(0.49, 0.49, 0, 0, Math.PI / 2, sideMat);
      addPlane(-0.49, 0.49, 0, 0, -Math.PI / 2, sideMat);
      addPlane(0, 0.98, 0, -Math.PI / 2, 0, topMat);
      addPlane(0, 0, 0, Math.PI / 2, 0, sideMat);
      map3dApplyFacing(group, facing);
    } else if (type.indexOf("barrel") >= 0) {
      const side = map3dChestTexture("barrel_side_real.png");
      const top = map3dChestTexture("barrel_top_real.png");
      addBox(0.94, 0.90, 0.94, 0, 0.45, 0, [mat(side), mat(side), mat(top), mat(top), mat(side), mat(side)]);
      addBox(0.98, 0.10, 0.98, 0, 0.95, 0, [mat(side), mat(side), mat(top), mat(top), mat(side), mat(side)]);
      const band = mat(null, 0x4a4a4a, 0.45, 0.45);
      addBox(0.99, 0.035, 0.99, 0, 0.24, 0, band, false);
      addBox(0.99, 0.035, 0.99, 0, 0.72, 0, band, false);
      if (facing === "down") group.rotation.x = Math.PI;
      else if (facing === "north") group.rotation.x = -Math.PI / 2;
      else if (facing === "south") group.rotation.x = Math.PI / 2;
      else if (facing === "east") group.rotation.z = -Math.PI / 2;
      else if (facing === "west") group.rotation.z = Math.PI / 2;
    } else {
      const large = Number(item.size || 0) > 27;
      const front = map3dChestTexture(large ? "chest_front_large_v2.png" : "chest_front_small_v2.png");
      const side = map3dChestTexture("chest_side_v2.png");
      const top = map3dChestTexture("chest_top_v2.png");
      const lid = map3dChestTexture("chest_lid_v2.png");
      const bodyMats = [mat(side), mat(side), mat(top), mat(top), mat(front), mat(side)];
      const lidMats = [mat(side), mat(side), mat(top), mat(top), mat(lid), mat(side)];
      const bodyW = large ? 1.98 : 0.98;
      addBox(bodyW, 0.72, 0.98, 0, 0.36, 0, bodyMats);
      addBox(bodyW, 0.28, 0.98, 0, 0.86, 0, lidMats);
      const latchFront = map3dChestTexture("chest_latch_v2.png");
      const latchSide = mat(null, 0x8a8a8a, 0.48, 0.22);
      const latchFaceMat = mat(latchFront, 0xffffff, 0.42, 0.22);
      const latchMats = [latchSide, latchSide, latchSide, latchSide, latchFaceMat, latchSide];
      addBox(large ? 0.34 : 0.18, 0.12, 0.06, 0, 0.72, 0.52, latchMats, false);
      map3dApplyFacing(group, facing);
    }
    group.position.set(x, y, z);
    return group;
  }

  function map3dThreeFitGroup() {
    if (!map3dThree.ready) return;
    const box = new THREE.Box3().setFromObject(map3dThree.group);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(7, Math.max(size.x, size.y, size.z) * 1.15);
    map3dThree.radius = radius;
    map3dThree.center = center;
    map3dThreeOrientCamera();
  }

  function map3dThreeOrientCamera() {
    if (!map3dThree.ready || !state.map.three) return;
    const items = state.map.three.items || [];
    const counts = { north: 0, south: 0, east: 0, west: 0 };
    for (const item of items) {
      const facing = String(item.facing || "south").toLowerCase();
      if (counts[facing] != null) counts[facing] += 1;
    }
    const facing = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || "south";
    const radius = Math.max(7, map3dThree.radius || 10);
    const center = map3dThree.center || new THREE.Vector3();
    const target = new THREE.Vector3(center.x, Number(center.y || 0), center.z);
    map3dThree.controls.target.copy(target);
    const lift = radius * 1.05;
    const side = radius * 1.05;
    const back = radius * 1.55;
    if (facing === "north") map3dThree.camera.position.set(target.x - side, target.y + lift, target.z - back);
    else if (facing === "east") map3dThree.camera.position.set(target.x + back, target.y + lift, target.z + side);
    else if (facing === "west") map3dThree.camera.position.set(target.x - back, target.y + lift, target.z - side);
    else map3dThree.camera.position.set(target.x + side, target.y + lift, target.z + back);
    map3dThree.controls.update();
  }

  function map3dThreeFocus(index) {
    if (!map3dThree.ready) return;
    const three = state.map.three;
    if (!three) return;
    const layer = three.layers[index] || three.layers[0];
    const y = Number(layer.avgY != null ? layer.avgY : layer.minY || 0) - Number(map3dThree.worldMinY || 0) + 0.5;
    map3dThree.controls.target.set(0, y, 0);
    const radius = Math.max(6, map3dThree.radius);
    map3dThree.camera.position.set(radius * 1.35, y + radius * 0.55, radius * 1.6);
    map3dThree.controls.update();
  }

  function map3dThreeBuild() {
    if (!map3dThree.ready || !state.map.three) return;
    const three = state.map.three;
    const group = map3dThree.group;
    while (group.children.length) {
      const child = group.children.pop();
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
        else child.material.dispose();
      }
    }
    map3dThree.boxes = [];
    const layers = three.layers;
    const layer = layers[three.active] || layers[0];
    if (!layer || !layer.items.length) {
      map3dThree.containers = [];
      map3dThree.boxes = [];
      map3dSetContainerDim("");
      return;
    }
    three.active = layer.index;
    const all = layer.items;
    const centerX = (Math.min(...all.map((x) => Number(x.x || 0))) + Math.max(...all.map((x) => Number(x.x || 0)))) / 2;
    const centerZ = (Math.min(...all.map((x) => Number(x.z || 0))) + Math.max(...all.map((x) => Number(x.z || 0)))) / 2;
    const span = Math.max(8, Math.max(...all.map((x) => Number(x.x || 0))) - Math.min(...all.map((x) => Number(x.x || 0))), Math.max(...all.map((x) => Number(x.z || 0))) - Math.min(...all.map((x) => Number(x.z || 0))));
    const minWorldY = Math.min(...all.map((x) => Number(x.y || 0)));
    const maxWorldY = Math.max(...all.map((x) => Number(x.y || 0)));
    map3dThree.worldMinY = minWorldY;
    map3dThree.center.set(centerX, (minWorldY + maxWorldY) / 2, centerZ);
    map3dThree.radius = Math.max(8, span * 0.9, (maxWorldY - minWorldY) * 1.2 + 2);
    map3dThree.containers = [];
    for (const item of layer.items) {
      const large = Number(item.size || 0) > 27;
      const pairX = Number(item.pairX);
      const pairZ = Number(item.pairZ);
      const hasPair = large && Number.isFinite(pairX) && Number.isFinite(pairZ);
      const pairAxisX = hasPair && pairX !== Number(item.x);
      const axisZ = hasPair ? !pairAxisX : (large && String(item.doubleAxis || "") === "z");
      const x = (hasPair
        ? (pairAxisX ? (Number(item.x) + pairX + 1) / 2 : Number(item.x) + 0.5)
        : Number(item.x || 0) + (large ? (axisZ ? 0.5 : 1.0) : 0.5)) - centerX;
      const z = (hasPair
        ? (pairAxisX ? Number(item.z) + 0.5 : (Number(item.z) + pairZ + 1) / 2)
        : Number(item.z || 0) + (large ? (axisZ ? 1.0 : 0.5) : 0.5)) - centerZ;
      const y = Number(item.y || 0) - minWorldY;
      const container = map3dCreateContainer(item, x, y, z, item.state === "removed", layer.index);
      container.userData.item = item;
      container.userData.id = item.id;
      container.userData.baseX = x;
      container.userData.baseY = y;
      container.userData.baseZ = z;
      container.userData.targetX = x * map3dThree.explodeH;
      container.userData.targetY = y * map3dThree.explodeV;
      container.userData.targetZ = z * map3dThree.explodeH;
      group.add(container);
      map3dThree.containers.push(container);
    }
    map3dThree.explode = 0;
    map3dThree.explodeTarget = 0;
    map3dSetExplodeLabel();
    map3dSyncExplodeSliders();
    map3dThreeResize();
    map3dThreeFitGroup();
    map3dSetContainerDim("");
  }

  function map3dSetExplodeLabel() {
    const button = $("map-3d-explode");
    if (!button) return;
    button.textContent = map3dThree.explodeTarget ? "恢复位置" : "展开遮挡";
  }

  function map3dSyncExplodeSliders() {
    const h = $("map-3d-explode-h");
    const v = $("map-3d-explode-v");
    if (h) h.value = String(map3dThree.explodeH);
    if (v) v.value = String(map3dThree.explodeV);
    if ($("map-3d-explode-h-value")) $("map-3d-explode-h-value").textContent = map3dThree.explodeH.toFixed(1) + "×";
    if ($("map-3d-explode-v-value")) $("map-3d-explode-v-value").textContent = map3dThree.explodeV.toFixed(1) + "×";
  }

  function map3dUpdateExplodeAxis(axis, value) {
    const number = Math.max(1, Math.min(3, Number(value) || 1));
    if (axis === "h") map3dThree.explodeH = number;
    else map3dThree.explodeV = number;
    for (const container of map3dThree.containers) {
      container.userData.targetX = container.userData.baseX * map3dThree.explodeH;
      container.userData.targetY = container.userData.baseY * map3dThree.explodeV;
      container.userData.targetZ = container.userData.baseZ * map3dThree.explodeH;
    }
    if (!map3dThree.explodeTarget) map3dThree.explodeTarget = 1;
    map3dSyncExplodeSliders();
    map3dSetExplodeLabel();
  }

  function map3dToggleExplode() {
    map3dThree.explodeTarget = map3dThree.explodeTarget ? 0 : 1;
    map3dSetExplodeLabel();
  }

  function map3dSetContainerDim(id) {
    if (!map3dThree.ready) return;
    const selected = String(id || "");
    map3dThree.selectedId = selected;
    for (const container of map3dThree.containers) {
      const active = selected && String(container.userData.id || "") === selected;
      container.traverse((object) => {
        if (!object.isMesh || !object.material) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        object.renderOrder = selected && active ? 1000 : 0;
        for (const material of materials) {
          if (!material) continue;
          material.transparent = true;
          material.opacity = selected ? (active ? 1 : 0.3) : 1;
          material.depthWrite = !selected || active;
          material.depthTest = !selected || active;
          material.needsUpdate = true;
        }
      });
    }
    map3dThree.listSignature = "";
    map3dRefreshContainerList(true);
  }

  function map3dRefreshContainerList(force) {
    if (!map3dThree.ready) return;
    const host = $("map-3d-list-items");
    if (!host) return;
    const now = performance.now();
    if (!force && now - map3dThree.lastListAt < 250) return;
    map3dThree.lastListAt = now;
    const camera = map3dThree.camera;
    if (!camera) return;
    camera.updateMatrixWorld();
    const frustum = new THREE.Frustum();
    frustum.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const visible = [];
    for (const container of map3dThree.containers) {
      const item = container.userData.item || {};
      const radius = Math.max(1.7, (Number(item.size || 0) > 27 ? 2.1 : 1.3));
      const center = container.getWorldPosition(new THREE.Vector3());
      if (frustum.intersectsSphere(new THREE.Sphere(center, radius))) visible.push(container);
    }
    visible.sort((a, b) => {
      const ia = a.userData.item || {}, ib = b.userData.item || {};
      return Number(ib.y || 0) - Number(ia.y || 0) || Number(ia.z || 0) - Number(ib.z || 0) || Number(ia.x || 0) - Number(ib.x || 0);
    });
    const signature = visible.map((c) => c.userData.id).join("|") + "#" + map3dThree.selectedId;
    if (!force && signature === map3dThree.listSignature) return;
    map3dThree.listSignature = signature;
    if (!visible.length) {
      host.innerHTML = '<div class="ench-empty">当前视图没有容器。</div>';
      return;
    }
    host.innerHTML = visible.map((container) => {
      const item = container.userData.item || {};
      const active = map3dThree.selectedId && String(container.userData.id) === map3dThree.selectedId;
      return '<button type="button" class="map-3d-list-item' + (active ? ' active' : '') + '" data-map-container-id="' + esc(String(item.id || "")) + '">' +
        '<b>' + esc(mapContainerTypeLabel(item.type)) + '</b>' +
        '<span>' + esc(Number(item.x || 0) + ',' + Number(item.y || 0) + ',' + Number(item.z || 0)) + '</span>' +
        '<small>' + Number(item.size || 0) + ' 格 · ' + esc(String(item.facing || "-")) + ' · ' + Number(item.itemCount || 0) + ' 件</small>' +
        '</button>';
    }).join("");
  }

  function map3dThreeAnimate() {
    if (!map3dThree.ready) return;
    map3dThree.raf = requestAnimationFrame(map3dThreeAnimate);
    if ($("map-3d").classList.contains("hidden")) return;
    map3dThreeResize();
    const target = map3dThree.explodeTarget ? 1 : 0;
    map3dThree.explode += (target - map3dThree.explode) * 0.12;
    if (Math.abs(target - map3dThree.explode) < 0.001) map3dThree.explode = target;
    const ease = map3dThree.explode * map3dThree.explode * (3 - 2 * map3dThree.explode);
    for (const container of map3dThree.containers) {
      container.position.x = container.userData.baseX + (container.userData.targetX - container.userData.baseX) * ease;
      container.position.y = container.userData.baseY + (container.userData.targetY - container.userData.baseY) * ease;
      container.position.z = container.userData.baseZ + (container.userData.targetZ - container.userData.baseZ) * ease;
    }
    map3dThree.controls.update();
    map3dRefreshContainerList(false);
    map3dThree.renderer.render(map3dThree.scene, map3dThree.camera);
  }


  function map3dImage(type) {
    const key = String(type || "");
    if (map3dImageCache.has(key)) return map3dImageCache.get(key);
    const image = new Image();
    image.onload = () => map3dDraw();
    image.src = icon(key);
    map3dImageCache.set(key, image);
    return image;
  }

  function openMap3D(items) {
    const list = (items || []).filter(Boolean);
    if (!list.length) return;
    const layers = map3dBuildLayers(list);
    state.map.three = { items: list, layers: layers, active: 0, boxes: [], zoom: 1, ox: 0, oy: 0, dragging: false, moved: false };
    $("map-3d-title").textContent = "容器分层视图 · " + list.length + " 个容器 / " + layers.length + " 层";
    $("map-3d").classList.remove("hidden");
    map3dRenderLayerBar();
    if (map3dInitThree()) {
      map3dThreeBuild();
      if (!map3dThree.raf) map3dThreeAnimate();
    } else {
      map3dDraw();
    }
  }

  function map3dRenderLayerBar() {
    const three = state.map.three;
    const host = $("map-3d-layerbar");
    if (!three || !host) return;
    host.innerHTML = three.layers.map((layer) => `
      <button type="button" class="map-3d-layer${layer.index === three.active ? " active" : ""}" data-map-layer="${layer.index}">
        <b>Y ${layer.minY} – ${layer.maxY}</b><span>区块 ${layer.chunkX},${layer.chunkZ} · ${layer.items.length} 个${layer.truncated ? " / 已截断" : ""}</span>
      </button>`).join("");
    host.querySelectorAll("[data-map-layer]").forEach((button) => {
      button.addEventListener("click", () => {
        three.active = Number(button.dataset.mapLayer);
        three.ox = 0;
        three.oy = 0;
        map3dRenderLayerBar();
        if (map3dThree.ready) {
          map3dThreeBuild();
          map3dThreeFocus(three.active);
        } else map3dDraw();
      });
    });
  }

  function map3dDraw() {
    if (map3dThree.ready) return;
    const canvas = $("map-3d-canvas");
    const three = state.map.three;
    if (!canvas || !three || !three.layers.length) return;
    const width = Math.max(320, canvas.clientWidth);
    const height = Math.max(260, canvas.clientHeight);
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, "#f7f7f0");
    sky.addColorStop(0.62, "#e8ecdf");
    sky.addColorStop(1, "#d8ddce");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    const layer = three.layers[three.active] || three.layers[0];
    const centerX = width / 2 + three.ox;
    const baseY = height * 0.64 + three.oy;
    three.boxes = [];
    for (const delta of [-1, 1]) {
      const neighbor = three.layers[three.active + delta];
      if (!neighbor) continue;
      const ny = baseY + delta * 118;
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = "rgba(91,107,72,.14)";
      ctx.strokeStyle = "rgba(60,73,47,.3)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(centerX, ny - 72);
      ctx.lineTo(centerX + 180, ny - 22);
      ctx.lineTo(centerX, ny + 32);
      ctx.lineTo(centerX - 180, ny - 22);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "rgba(14,14,14,.55)";
      ctx.font = "9px 'Space Grotesk', Consolas, monospace";
      ctx.fillText("层 " + (neighbor.index + 1) + " · " + neighbor.items.length + " 个", centerX - 24, ny + 3);
      ctx.globalAlpha = 1;
    }
    const spanX = Math.max(6, layer.maxX - layer.minX);
    const spanZ = Math.max(6, layer.maxZ - layer.minZ);
    const span = Math.max(spanX, spanZ);
    const baseScale = Math.min(width / (span * 2.9), height / (span * 1.95)) * three.zoom;
    const k = Math.max(16, Math.min(58, baseScale));
    const iso = (x, z) => ({ x: centerX + (x - (layer.minX + layer.maxX) / 2) * k - (z - (layer.minZ + layer.maxZ) / 2) * k * 0.55, y: baseY + (z - (layer.minZ + layer.maxZ) / 2) * k * 0.4 + (x - (layer.minX + layer.maxX) / 2) * k * 0.16 });
    three.boxes = [];

    const pad = 1.6;
    const x0 = layer.minX - pad;
    const x1 = layer.maxX + pad;
    const z0 = layer.minZ - pad;
    const z1 = layer.maxZ + pad;
    const p00 = iso(x0, z0);
    const p10 = iso(x1, z0);
    const p11 = iso(x1, z1);
    const p01 = iso(x0, z1);
    ctx.fillStyle = "rgba(91,107,72,.18)";
    ctx.strokeStyle = "rgba(60,73,47,.45)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(p00.x, p00.y);
    ctx.lineTo(p10.x, p10.y);
    ctx.lineTo(p11.x, p11.y);
    ctx.lineTo(p01.x, p01.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = "rgba(60,73,47,.12)";
    ctx.lineWidth = 1;
    for (let gx = Math.floor(x0); gx <= Math.ceil(x1); gx++) {
      const a = iso(gx, z0);
      const b = iso(gx, z1);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    for (let gz = Math.floor(z0); gz <= Math.ceil(z1); gz++) {
      const a = iso(x0, gz);
      const b = iso(x1, gz);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.restore();

    ctx.fillStyle = "#0e0e0e";
    ctx.font = "bold 11px 'Space Grotesk', Consolas, monospace";
    ctx.fillText("层 " + (layer.index + 1) + " / " + three.layers.length, 16, 24);
    ctx.font = "10px 'Space Grotesk', Consolas, monospace";
    ctx.fillStyle = "rgba(14,14,14,.62)";
    ctx.fillText("Y " + layer.minY + (layer.maxY !== layer.minY ? "–" + layer.maxY : "") + " · " + layer.items.length + " 个容器 · 间距 > 3 格自动分层", 16, 40);

    const sorted = layer.items.slice().sort((a, b) => (a.x + a.z) - (b.x + b.z) || a.y - b.y);
    for (const item of sorted) {
      const p = iso(Number(item.x || 0), Number(item.z || 0));
      const level = (Number(item.y || 0) - layer.minY) * 5;
      const px = p.x;
      const py = p.y - level;
      const s = Math.max(12, Math.min(26, k * 0.52));
      ctx.fillStyle = "rgba(30,34,24,.13)";
      ctx.beginPath();
      ctx.ellipse(px, py + s * 1.1, s * 1.05, s * 0.36, 0, 0, Math.PI * 2);
      ctx.fill();
      const removed = item.state === "removed";
      ctx.strokeStyle = removed ? "rgba(224,47,120,.85)" : "#25291d";
      ctx.lineWidth = 1.5;
      ctx.fillStyle = removed ? "rgba(255,26,172,.22)" : "#d8c17a";
      ctx.beginPath();
      ctx.moveTo(px, py - s * 1.0);
      ctx.lineTo(px + s, py - s * 0.48);
      ctx.lineTo(px, py);
      ctx.lineTo(px - s, py - s * 0.48);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      const front = ctx.createLinearGradient(px, py, px, py + s * 1.1);
      front.addColorStop(0, removed ? "rgba(255,26,172,.28)" : "#b59a56");
      front.addColorStop(1, removed ? "rgba(255,26,172,.14)" : "#8f783e");
      ctx.fillStyle = front;
      ctx.beginPath();
      ctx.moveTo(px - s, py - s * 0.48);
      ctx.lineTo(px, py);
      ctx.lineTo(px, py + s * 1.12);
      ctx.lineTo(px - s, py + s * 0.62);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = removed ? "rgba(255,26,172,.2)" : "#c9b46b";
      ctx.beginPath();
      ctx.moveTo(px + s, py - s * 0.48);
      ctx.lineTo(px, py);
      ctx.lineTo(px, py + s * 1.12);
      ctx.lineTo(px + s, py + s * 0.62);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      const image = map3dImage(item.type);
      if (image.complete && image.naturalWidth) {
        const imageSize = Math.max(18, s * 1.3);
        ctx.drawImage(image, px - imageSize / 2, py - s * 0.48 - imageSize / 2, imageSize, imageSize);
      }
      ctx.fillStyle = "#0e0e0e";
      ctx.font = "9px 'Space Grotesk', Consolas, monospace";
      ctx.fillText(String(item.itemCount || 0) + "件", px - s * 0.35, py + s * 1.36);
      three.boxes.push({ x: px - s, y: py - s, w: s * 2, h: s * 2.2, id: item.id });
    }
    ctx.fillStyle = "rgba(14,14,14,.55)";
    ctx.font = "10px 'Space Grotesk', Consolas, monospace";
    ctx.fillText("拖动平移 · 滚轮缩放 · 点击容器查看内容", 16, height - 14);
  }

  function mapBindInteractions() {
    const canvas = $("map-canvas");
    const stage = $("map-stage");
    if (!canvas || !stage) return;
    canvas.addEventListener("mousedown", (event) => {
      state.map.dragging = true;
      state.map.dragStart = { x: event.clientX, y: event.clientY, cx: state.map.center.x, cz: state.map.center.z };
      stage.classList.add("dragging");
    });
    window.addEventListener("mousemove", (event) => {
      if (!state.map.dragging || !state.map.dragStart) return;
      state.map.center.x = state.map.dragStart.cx - (event.clientX - state.map.dragStart.x) / state.map.scale;
      state.map.center.z = state.map.dragStart.cz - (event.clientY - state.map.dragStart.y) / state.map.scale;
      mapDraw();
    });
    window.addEventListener("mouseup", () => {
      state.map.dragging = false;
      stage.classList.remove("dragging");
      if (state.view === "map" && state.map.meta) mapScheduleReload();
    });
    canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      state.map.scale = Math.max(0.015, Math.min(2, state.map.scale * (event.deltaY < 0 ? 1.18 : 0.84)));
      mapDraw();
      mapScheduleReload();
    }, { passive: false });
    $("map-zoom-in").addEventListener("click", () => {
      state.map.scale = Math.min(2, state.map.scale * 1.3);
      mapDraw();
      mapScheduleReload();
    });
    $("map-zoom-out").addEventListener("click", () => {
      state.map.scale = Math.max(0.015, state.map.scale / 1.3);
      mapDraw();
      mapScheduleReload();
    });
    $("map-apply").addEventListener("click", () => {
      state.map.mode = $("map-mode").value === "history" ? "history" : "live";
      state.map.dim = Number($("map-dim").value || 0);
      state.map.initialized = false;
      loadMap();
    });
    $("map-live").addEventListener("click", () => {
      state.map.mode = "live";
      $("map-mode").value = "live";
      state.map.initialized = false;
      loadMap();
    });
    $("map-mode").addEventListener("change", () => {
      state.map.mode = $("map-mode").value === "history" ? "history" : "live";
      state.map.initialized = false;
      loadMap();
    });
    $("map-dim").addEventListener("change", () => {
      state.map.dim = Number($("map-dim").value || 0);
      state.map.initialized = false;
      loadMap();
    });
    $("map-crosshair").addEventListener("change", () => mapDraw());
    $("map-detail-close").addEventListener("click", () => $("map-container-modal").classList.add("hidden"));
    $("map-container-modal").addEventListener("click", (event) => {
      if (event.target === $("map-container-modal")) $("map-container-modal").classList.add("hidden");
    });
    $("map-3d-close").addEventListener("click", () => {
      $("map-3d").classList.add("hidden");
      if (map3dThree.ready) map3dSetContainerDim("");
      state.map.three = null;
    });
    $("map-3d-list").addEventListener("click", (event) => {
      const button = event.target.closest("[data-map-container-id]");
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      map3dSetContainerDim(button.dataset.mapContainerId);
    });
    $("map-3d-clear").addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      map3dSetContainerDim("");
    });
    $("map-3d-explode").addEventListener("click", () => map3dToggleExplode());
    $("map-3d-explode-h").addEventListener("input", (event) => map3dUpdateExplodeAxis("h", event.target.value));
    $("map-3d-explode-v").addEventListener("input", (event) => map3dUpdateExplodeAxis("v", event.target.value));
    $("map-3d-canvas").addEventListener("mousedown", (event) => {
      if (event.button === 2 || event.button === 3 || event.button === 4) event.preventDefault();
      const three = state.map.three;
      if (!three) return;
      three.moved = false;
      if (map3dThree.ready) {
        map3dThree.pointer = { x: event.clientX, y: event.clientY };
        return;
      }
      three.dragging = true;
      three.dragStart = { x: event.clientX, y: event.clientY, ox: three.ox, oy: three.oy };
      $("map-3d-canvas").classList.add("dragging");
    });
    window.addEventListener("mousemove", (event) => {
      const three = state.map.three;
      if (!three) return;
      if (map3dThree.ready) {
        if (map3dThree.pointer && Math.abs(event.clientX - map3dThree.pointer.x) + Math.abs(event.clientY - map3dThree.pointer.y) > 4) three.moved = true;
        return;
      }
      if (!three.dragging || !three.dragStart) return;
      const dx = event.clientX - three.dragStart.x;
      const dy = event.clientY - three.dragStart.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) three.moved = true;
      three.ox = three.dragStart.ox + dx;
      three.oy = three.dragStart.oy + dy;
      map3dDraw();
    });
    window.addEventListener("mouseup", () => {
      const three = state.map.three;
      if (!three) return;
      three.dragging = false;
      $("map-3d-canvas").classList.remove("dragging");
    });
    $("map-3d-canvas").addEventListener("pointerdown", (event) => {
      if (event.button === 2 || event.button === 3 || event.button === 4) {
        event.preventDefault();
        event.stopPropagation();
      }
    }, true);
    $("map-3d").addEventListener("contextmenu", (event) => event.preventDefault());
    $("map-3d-canvas").addEventListener("contextmenu", (event) => event.preventDefault());
    $("map-3d-canvas").addEventListener("auxclick", (event) => event.preventDefault());
    $("map-3d-canvas").addEventListener("mouseup", (event) => {
      if (event.button === 2 || event.button === 3 || event.button === 4) event.preventDefault();
    });
    $("map-3d-canvas").addEventListener("click", (event) => {
      const three = state.map.three;
      if (!three) return;
      if (three.moved) { three.moved = false; return; }
      if (map3dThree.ready) {
        const rect = event.target.getBoundingClientRect();
        const pointer = new THREE.Vector2(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          -((event.clientY - rect.top) / rect.height) * 2 + 1
        );
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(pointer, map3dThree.camera);
        const hits = raycaster.intersectObjects(map3dThree.boxes, false);
        const selectedId = map3dThree.selectedId || "";
        if (selectedId) {
          const selectedHit = hits.find((hit) => String(hit.object.userData.id || "") === String(selectedId));
          if (selectedHit) openMapContainer(selectedId);
          return;
        }
        if (hits.length && hits[0].object.userData.id) openMapContainer(hits[0].object.userData.id);
        return;
      }
      const rect = event.target.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const hit = three.boxes.slice().reverse().find((box) => x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h);
      if (hit) openMapContainer(hit.id);
    });
    $("map-3d-canvas").addEventListener("wheel", (event) => {
      event.preventDefault();
      if (map3dThree.ready) return;
      if (!state.map.three) return;
      state.map.three.zoom = Math.max(0.4, Math.min(3, state.map.three.zoom * (event.deltaY < 0 ? 1.12 : 0.9)));
      map3dDraw();
    }, { passive: false });
    window.addEventListener("resize", () => mapDraw());
  }

  async function loadAudit() {
    try {
      const [auditList, taskList] = await Promise.all([
        api("/audit?limit=500"),
        api("/tasks?limit=500")
      ]);
      state.audit = Array.isArray(auditList) ? auditList : [];
      state.tasks = Array.isArray(taskList) ? taskList : [];
      renderAudit(state.auditFilter);
      await verifyAudit(true);
    } catch (e) {
      if (!e.auth) toast("操作记录读取失败: " + e.message);
    }
  }

  function taskStateName(task) {
    return (task.state === "queued_offline" ? "queued" : task.state);
  }

  function taskStateLabel(stateName) {
    return { succeeded: "成功", failed: "失败", queued: "排队", queued_offline: "离线排队", running: "执行中" }[stateName] || stateName;
  }

  function mergedAuditRows() {
    const audit = (state.audit || []).map((row) => Object.assign({}, row, { kind: "audit" }));
    const tasks = (state.tasks || []).map((task) => ({
      kind: "task",
      ts: Number(task.createdAt || task.startedAt || task.finishedAt || 0),
      operator: task.operator && typeof task.operator === "object" ? (task.operator.name || task.operator.role || "system") : (task.operator || "system"),
      action: task.actionId || "task",
      target: String((task.input && (task.input.command || task.input.xuid || task.input.item)) || "-"),
      state: taskStateName(task),
      hash: task.taskId || "",
      detail: task.error || (task.result && task.result.output ? String(task.result.output).slice(0, 160) : ""),
      task: task
    })).sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0));
    return audit.concat(tasks).sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0));
  }

  function auditMatches(row, filter) {
    const mode = filter || "all";
    if (mode === "tasks") return row.kind === "task";
    if (mode === "command") return row.kind === "task" || row.action === "command.execute";
    if (mode === "restore") return row.action === "inventory.restore";
    if (mode === "inventory") return row.action !== "command.execute" && row.action !== "inventory.restore";
    return true;
  }

  function renderAudit(filter) {
    const mode = filter || state.auditFilter || "all";
    state.auditFilter = mode;
    const rows = mergedAuditRows().filter((row) => auditMatches(row, mode));
    const pageSize = Math.max(1, Number(state.auditPageSize || 25));
    const pages = Math.max(1, Math.ceil(rows.length / pageSize));
    state.auditPage = Math.max(1, Math.min(pages, Number(state.auditPage || 1)));
    const start = (state.auditPage - 1) * pageSize;
    const pageRows = rows.slice(start, start + pageSize);
    $("audit-count").textContent = rows.length + " 条";
    $("audit-rows").innerHTML = pageRows.map((row) => {
      const isTask = row.kind === "task";
      const stateName = isTask ? row.state : (row.state === "succeeded" ? "succeeded" : "failed");
      const stateLabel = isTask ? taskStateLabel(stateName) : (row.state === "succeeded" ? "成功" : "失败");
      const target = row.target || "-";
      return `
      <div class="table-row${isTask ? " audit-task-row" : ""}">
        <span class="mono">${fmtTime(row.ts)}</span>
        <span>${esc(row.operator || "-")}</span>
        <span>${esc(ACTION_TITLE[row.action] || row.action)}${isTask ? " · 任务" : ""}</span>
        <span>${esc(target)}${row.detail ? `<small class="audit-detail">${esc(row.detail)}</small>` : ""}</span>
        <span class="state-badge ${esc(stateName)}">${esc(stateLabel)}</span>
        <code>${esc(String(row.hash || "").slice(0, 16))}${row.hash ? "…" : ""}</code>
      </div>`;
    }).join("") || '<div class="ench-empty">暂无操作记录。</div>';
    $("audit-page-label").textContent = "第 " + state.auditPage + " / " + pages + " 页";
    $("audit-prev").disabled = state.auditPage <= 1;
    $("audit-next").disabled = state.auditPage >= pages;
  }

  async function verifyAudit(silent) {
    try {
      const data = await api("/audit/verify");
      $("audit-chain").textContent = data.valid ? "完整" : "异常";
      $("audit-chain").className = data.valid ? "ok" : "warn";
      $("audit-chain-count").textContent = data.count + " 条记录";
      $("audit-verify").textContent = data.valid ? "校验链完整 · " + data.count + " 条" : "校验链异常";
      if (!silent) toast(data.valid ? "校验链完整" : "校验链校验失败");
    } catch (e) {
      toast("校验请求失败: " + e.message);
    }
  }

  function snapshotReason(reason) {
    return ({ minute: "系统分钟备份", manual: "手动备份", join: "加入时", leave: "离开时", shutdown: "关服备份", "pre-restore": "还原前" })[reason] || reason || "备份";
  }

  async function loadSnapshots() {
    if (!state.current) return;
    try {
      const list = await api("/players/" + encodeURIComponent(state.current.xuid) + "/snapshots?limit=500");
      state.snapshots = Array.isArray(list) ? list : [];
      const key = state.current.xuid + ":" + state.snapshots.map((row) => row.id).join("|");
      const changed = key !== state.snapshotKey;
      state.snapshotKey = key;
      $("history-count").textContent = String(state.snapshots.length);
      updateSnapshotBanner();
      if (document.body.classList.contains("snapshot-open") && changed) renderSnapshotDrawer();
    } catch (e) {
      if (!e.auth) toast("备份数据读取失败: " + e.message);
    }
  }

  function snapshotBagSummary(row) {
    const c = row && row.containerCounts;
    if (!c) return Number(row && row.itemCount || 0) + " 件";
    return "背包 " + Number(c.inventory || 0) + " · 装备 " + Number(c.armor || 0) +
      " · 副手 " + Number(c.offhand || 0) + " · 末影 " + Number(c.ender || 0);
  }

  function snapshotRowActions(prefix, row) {
    return `<button class="btn line" data-snap-view="${esc(row.id)}" data-snap-xuid="${esc(row.xuid)}">查看</button>
      <button class="btn dark" data-snap-restore="${esc(row.id)}" data-snap-xuid="${esc(row.xuid)}">还原</button>`;
  }

  function bindSnapshotActions(root) {
    root.querySelectorAll("[data-snap-view]").forEach((button) => {
      button.addEventListener("click", () => viewSnapshot(button.dataset.snapXuid, button.dataset.snapView));
    });
    root.querySelectorAll("[data-snap-restore]").forEach((button) => {
      button.addEventListener("click", () => restoreSnapshotFor(button.dataset.snapXuid, button.dataset.snapRestore));
    });
  }

  function renderSnapshotDrawer() {
    const player = state.current;
    if (!player) return;
    $("snap-drawer-title").textContent = player.name || player.xuid;
    const list = state.snapshots || [];
    const personal = list.filter((row) => row.reason !== "minute");
    const system = list.filter((row) => row.reason === "minute");
    const last = list.length ? Number(list[0].ts || 0) : 0;
    $("snap-drawer-summary").innerHTML = `
      <span>共 <b>${list.length}</b> 份</span>
      <span>个人/事件 <b>${personal.length}</b></span>
      <span>系统分钟 <b>${system.length}</b></span>
      <span>最近 <b>${last ? esc(fmtDate(last)) : "--"}</b></span>`;
    const group = (title, rows) => rows.length ? `
      <div class="snapshot-drawer-group"><span>${title}</span><b>${rows.length}</b></div>
      ${rows.map((row) => `
        <div class="snapshot-drawer-row">
          <span class="snap-time">${esc(fmtDate(row.ts))}</span>
          <span class="snap-info"><b>${esc(snapshotReason(row.reason))}</b><span>${esc(row.itemCount || 0)} 件 · ${esc(String(row.id || "").slice(-18))}</span></span>
          <span class="snap-actions">${snapshotRowActions("drawer", row)}</span>
        </div>`).join("")}
    ` : "";
    $("snap-drawer-list").innerHTML = group("个人 / 事件备份", personal) + group("系统分钟备份中的该玩家", system) || '<div class="snapshot-drawer-empty">该玩家还没有备份。</div>';
    bindSnapshotActions($("snap-drawer-list"));
  }

  async function openSnapshotDrawer() {
    if (!state.current) return toast("请先选择一个玩家");
    closeDrawer();
    document.body.classList.add("snapshot-open");
    renderSnapshotDrawer();
    await loadSnapshots();
  }

  function closeSnapshotDrawer() {
    document.body.classList.remove("snapshot-open");
  }

  async function loadGlobalSnapshots() {
    try {
      const list = await api("/snapshots?limit=2000");
      state.globalSnapshots = Array.isArray(list) ? list : [];
      const key = state.globalSnapshots.map((row) => row.id).join("|");
      if (key !== state.globalSnapshotsKey) {
        state.globalSnapshotsKey = key;
        renderGlobalSnapshots();
      }
    } catch (e) {
      if (!e.auth) toast("全服备份读取失败: " + e.message);
    }
  }

  function snapshotBatchKey(row) {
    if (row.batchId) return String(row.batchId);
    const ts = Number(row.ts || 0);
    if (row.reason === "minute") return "minute:" + (row.minute || Math.floor(ts / 60000));
    return "event:" + String(row.reason || "manual") + ":" + Math.floor(ts / 5000);
  }

  function groupSnapshots(rows) {
    const map = new Map();
    for (const row of rows) {
      const key = snapshotBatchKey(row);
      if (!map.has(key)) {
        map.set(key, {
          id: key,
          at: Number(row.batchAt || row.ts || 0),
          reason: row.batchReason || row.reason || "manual",
          players: [],
          totalItems: 0
        });
      }
      const group = map.get(key);
      group.at = Math.max(group.at, Number(row.batchAt || row.ts || 0));
      group.totalItems += Number(row.itemCount || 0);
      group.players.push(row);
    }
    return Array.from(map.values()).sort((a, b) => Number(b.at || 0) - Number(a.at || 0));
  }

  function renderGlobalSnapshots() {
    const query = String($("snapshot-search") ? $("snapshot-search").value : "").trim().toLowerCase();
    const all = state.globalSnapshots || [];
    const filtered = all.filter((row) => !query ||
      String(row.name || "").toLowerCase().includes(query) ||
      String(row.xuid || "").toLowerCase().includes(query) ||
      String(row.id || "").toLowerCase().includes(query));
    const allGroups = groupSnapshots(all);
    const groups = groupSnapshots(filtered);
    const pageSize = Math.max(1, Number(state.snapshotPageSize || 6));
    const pages = Math.max(1, Math.ceil(groups.length / pageSize));
    state.snapshotPage = Math.max(1, Math.min(pages, Number(state.snapshotPage || 1)));
    const start = (state.snapshotPage - 1) * pageSize;
    const pageGroups = groups.slice(start, start + pageSize);
    $("snap-total").textContent = allGroups.length + " 个备份文件夹 / " + all.length + " 份";
    $("snapshot-count").textContent = groups.length + " / " + allGroups.length + " 个备份";
    $("snapshot-page-label").textContent = "第 " + state.snapshotPage + " / " + pages + " 页";
    $("snapshot-prev").disabled = state.snapshotPage <= 1;
    $("snapshot-next").disabled = state.snapshotPage >= pages;
    $("snapshot-global-list").innerHTML = pageGroups.map((group) => {
      const open = state.expandedBatches.has(group.id);
      const players = group.players.slice().sort((a, b) => String(a.name || a.xuid).localeCompare(String(b.name || b.xuid), "zh-CN"));
      return `
        <section class="backup-folder ${open ? "open" : ""}">
          <button class="backup-folder-head" type="button" data-batch-toggle="${esc(group.id)}">
            <span class="backup-time"><b>${esc(fmtDate(group.at))}</b><small>${esc(fmtTime(group.at))}</small></span>
            <span class="backup-reason">${esc(snapshotReason(group.reason))}</span>
            <span class="backup-count">${players.length} 名玩家</span>
            <span class="backup-items">${group.totalItems} 件</span>
            <span class="backup-toggle">${open ? "收起" : "展开"}</span>
          </button>
          <div class="backup-folder-body ${open ? "" : "hidden"}">
            <div class="backup-folder-note">备份文件夹 <code>${esc(group.id)}</code> · ${players.length} 名玩家</div>
            <div class="backup-player-head"><span>玩家</span><span>备份时间</span><span>背包情况</span><span>操作</span></div>
            ${players.map((row) => `
              <div class="backup-player-row">
                <div class="backup-player"><b>${esc(row.name || row.xuid)}</b><span>${esc(row.xuid)}</span></div>
                <span class="backup-player-time">${esc(fmtDate(row.ts))}</span>
                <span class="backup-player-items" title="${esc(snapshotBagSummary(row))}">${esc(snapshotBagSummary(row))}</span>
                <span class="snap-actions">${snapshotRowActions("global", row)}</span>
              </div>
            `).join("")}
          </div>
        </section>`;
    }).join("") || '<div class="ench-empty">没有匹配的备份文件夹。</div>';
    $("snapshot-global-list").querySelectorAll("[data-batch-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        const key = button.dataset.batchToggle;
        if (state.expandedBatches.has(key)) state.expandedBatches.delete(key);
        else state.expandedBatches.add(key);
        renderGlobalSnapshots();
      });
    });
    bindSnapshotActions($("snapshot-global-list"));
  }

  async function viewSnapshot(xuid, snapshotId) {
    closeSnapshotDrawer();
    if (!state.players.some((p) => String(p.xuid) === String(xuid))) await loadPlayers();
    switchView("players");
    await selectPlayer(xuid, snapshotId);
  }

  async function restoreSnapshotFor(xuid, snapshotId) {
    const player = state.players.find((p) => String(p.xuid) === String(xuid)) || { xuid: xuid, name: xuid };
    if (!confirm("还原 " + (player.name || xuid) + " 的备份 " + snapshotId + "？")) return;
    try {
      await postAction("inventory.restore", {
        xuid: xuid,
        snapshotId: snapshotId,
        scope: ["inventory", "armor", "offhand", "ender"]
      }, "背包已还原");
      closeSnapshotDrawer();
      if (state.current && String(state.current.xuid) === String(xuid)) {
        state.current.at = "";
        await selectPlayer(xuid);
      }
      await loadGlobalSnapshots();
    } catch (e) {
      toast("还原操作失败: " + e.message);
    }
  }

  async function restoreCurrentSnapshot() {
    if (!state.current || !state.current.at) return;
    await restoreSnapshotFor(state.current.xuid, state.current.at);
  }

  async function exitSnapshotView() {
    if (!state.current) return;
    const xuid = state.current.xuid;
    state.current.at = "";
    await selectPlayer(xuid);
  }

  function updateSnapshotBanner() {
    const banner = $("snapshot-view-banner");
    if (!banner) return;
    const at = state.current && state.current.at;
    if (!at) {
      banner.classList.add("hidden");
      return;
    }
    const row = (state.snapshots || []).find((entry) => entry.id === at) ||
      (state.globalSnapshots || []).find((entry) => entry.id === at);
    $("snapshot-view-label").textContent = row
      ? fmtDate(row.ts) + " · " + snapshotReason(row.reason) + " · " + Number(row.itemCount || 0) + " 件"
      : at;
    banner.classList.remove("hidden");
  }

  async function loadAccounts() {
    const card = $("account-list");
    if (!card) return;
    if (!state.owner) {
      card.innerHTML = '<div class="ench-empty">只有初始管理员可以管理外放账号。</div>';
      return;
    }
    try {
      const list = await api("/accounts");
      state.accounts = Array.isArray(list) ? list : [];
      card.innerHTML = state.accounts.map((account) => `
        <div class="account-row">
          <b>${esc(account.username || "?")}</b>
          <span>${esc({ admin: "管理员", operator: "操作员", viewer: "只读" }[account.role] || account.role || "只读")}</span>
          <span class="state-badge ${account.owner ? "succeeded" : ""}">${account.owner ? "初始账号" : "外放"}</span>
        </div>`).join("") || '<div class="ench-empty">还没有外放账号。</div>';
    } catch (e) {
      card.innerHTML = '<div class="ench-empty">' + esc(e.message) + "</div>";
    }
  }

  async function createAccount(event) {
    event.preventDefault();
    if (!state.owner) return toast("只有初始管理员可以添加账号");
    const username = $("account-username").value.trim();
    const password = $("account-password").value;
    const confirm = $("account-confirm").value;
    const role = $("account-role").value;
    if (!username || password.length < 10) return toast("用户名必填，密码至少 10 位");
    if (password !== confirm) return toast("两次输入的密码不一致");
    const button = $("account-add");
    try {
      button.disabled = true;
      let body;
      if (STANDALONE) {
        body = { username: username, password: password, role: role };
      } else {
        const salt = randomSalt();
        const iterations = 210000;
        const verifier = await deriveVerifier(password, salt, iterations);
        body = { username: username, salt: salt, iterations: iterations, verifier: verifier, role: role };
      }
      await api("/accounts", { method: "POST", body: body });
      $("account-form").reset();
      await loadAccounts();
      toast("账号已添加");
    } catch (e) {
      toast("添加账号失败: " + e.message);
    } finally {
      button.disabled = false;
    }
  }

  function renderSettings() {
    if (!state.meta) return;
    $("set-account").textContent = (state.meta && state.meta.user) || (cookieSession ? "管理员账号" : "未登录");
    $("set-storage").textContent = COOKIE_AUTH ? "JSON 文件" : "本地键值库";
    $("set-role").textContent = { admin: "管理员", operator: "操作员", viewer: "只读" }[state.role] || state.role;
    $("set-session").textContent = cookieSession ? "HttpOnly Cookie" : "Bearer Token";
    if ($("account-owner-state")) $("account-owner-state").textContent = state.owner ? "初始管理员" : "只读";
    if ($("account-form")) $("account-form").classList.toggle("hidden", !state.owner);
    $("set-nbt-inline").textContent = (state.meta.limits && state.meta.limits.nbtInlineKB || 64) + " KB";
    $("set-nbt-item").textContent = "512 KB";
    $("settings-modules").innerHTML = state.modules.map((module) => `
      <div><span>${esc(module.name || module.id)}</span><b class="ok">启用</b><i>${esc(module.version || "1.0.0")}</i></div>
    `).join("") || '<div class="ench-empty">暂无模块数据。</div>';
  }

  async function loadModules() {
    try {
      const list = await api("/modules");
      state.modules = Array.isArray(list) ? list : [];
      renderSettings();
    } catch (e) {
      state.modules = [];
    }
  }

  async function loadLastMoment() {
    try {
      const data = await api("/last-moment");
      state.lastMoment = data;
      renderLastMoment(data);
    } catch (e) {
      if (!e.auth) {
        $("last-summary").innerHTML = '<div class="ench-empty">暂无可用的关服备份。</div>';
        $("last-players").innerHTML = "";
      }
    }
  }

  function renderLastMoment(data) {
    const at = Number(data.at || 0);
    $("last-at").textContent = fmtDate(at);
    $("last-server").textContent = (data.server && data.server.name || "BDS") + " / " + (data.server && data.server.id || "");
    $("last-summary").innerHTML = `
      <div><span class="micro">关服时在线玩家</span><b>${String((data.players || []).length).padStart(2, "0")}</b><i>关服时记录</i></div>
      <div><span class="micro">关服备份物品数</span><b>${Number(data.totalItems || 0)}</b><i>全部容器合计</i></div>
      <div><span class="micro">关服时间</span><b style="font-size:17px">${esc(fmtDate(at))}</b><i>来源：最后心跳或关服推送</i></div>
    `;
    const reasons = { minute: "分钟备份", manual: "手动备份", join: "加入时", leave: "离开时", "pre-restore": "还原前", shutdown: "关服" };
    $("last-players").innerHTML = (data.players || []).map((player) => `
      <div class="last-row">
        <div><span class="last-name">${esc(player.name || player.xuid)}</span><span class="last-xuid">${esc(player.xuid)}</span></div>
        <span class="last-time">${esc(fmtDate(player.ts))} <span class="micro">${esc(reasons[player.reason] || player.reason || "")}</span></span>
        <span class="last-items">${Number(player.itemCount || 0)} 件</span>
        ${player.snapshotId ? `<button class="btn line" data-last-xuid="${esc(player.xuid)}" data-last-snap="${esc(player.snapshotId)}">查看关服背包</button>` : '<span class="last-items">无备份</span>'}
      </div>
    `).join("") || '<div class="ench-empty">没有可用的关服备份。</div>';
    $("last-players").querySelectorAll("[data-last-snap]").forEach((button) => {
      button.addEventListener("click", () => {
        switchView("players");
        selectPlayer(button.dataset.lastXuid, button.dataset.lastSnap).catch((e) => {
          toast("读取关服背包失败: " + e.message);
        });
      });
    });
  }

  async function loadView(view) {

    if (view === "overview") await loadOverview();
    if (view === "flow") await loadFlow();
    if (view === "map") await loadMap();
    if (view === "audit") await loadAudit();
    if (view === "command") await loadCommandHistory();
    if (view === "last") await loadLastMoment();
    if (view === "snapshots") await loadGlobalSnapshots();
    if (view === "settings") {
      renderSettings();
      if (!state.modules.length) await loadModules();
      await loadAccounts();
    }
    if (view === "players" && state.current && !state.inventory) await loadInventory(false);
  }

  function updateRailIndicator() {
    const indicator = $("rail-indicator");
    const active = document.querySelector(".rail-btn.active");
    if (!indicator || !active) return;
    indicator.style.transform = "translateY(" + (active.offsetTop + 10) + "px)";
  }

  function switchView(view) {
    closeSnapshotDrawer();
    const previous = state.view;
    const changed = previous !== view;
    state.view = view;
    if (view !== "players") document.body.classList.remove("manifest-open");
    document.querySelectorAll(".view").forEach((node) => {
      node.classList.remove("slide-left", "slide-right");
      node.classList.toggle("active", node.id === "view-" + view);
    });
    document.querySelectorAll(".rail-btn").forEach((button) => button.classList.remove("active"));
    document.querySelectorAll(".rail-btn[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
    const extStyle = document.getElementById("extension-style");
    if (extStyle) extStyle.textContent = "";
    const target = document.getElementById("view-" + view);
    if (target && changed) {
      const from = VIEW_ORDER.indexOf(previous);
      const to = VIEW_ORDER.indexOf(view);
      void target.offsetWidth;
      target.classList.add(to > from ? "slide-left" : "slide-right");
    }
    closeDrawer();
    updateRailIndicator();
    const url = new URL(location.href);
    url.searchParams.set("view", view);
    history.replaceState(null, "", url);
    loadView(view);
  }

  async function runCommand() {
    const command = $("command-input").value.trim();
    if (!command) return;
    if (!canWrite()) return toast("当前账号无指令权限");
    const dangerous = /^(execute|function|schedule)\b/i.test(command);
    if (dangerous && !confirm("该指令可间接执行其他命令，确认继续？\n\n/" + command)) return;
    $("command-output").textContent = "> /" + command + "\n正在提交...";
    try {
      const res = await api("/commands", { method: "POST", body: { command: command, confirm: dangerous } });
      const task = await waitTask(res.taskId, 15000);
      if (task.state === "failed") $("command-output").textContent = "> /" + command + "\n[失败]\n" + (task.error || "未知错误");
      else if (task.state === "succeeded") $("command-output").textContent = "> /" + command + "\n[成功]\n" + JSON.stringify(task.result, null, 2);
      else $("command-output").textContent = "> /" + command + "\n[已排队] 服务器已停止，任务将在开服后执行。";
      if (state.view === "audit") await loadAudit();
      await loadCommandHistory();
    } catch (e) {
      $("command-output").textContent = "> /" + command + "\n[失败]\n" + e.message;
    }
  }

  async function loadCommandHistory() {
    try {
      const rows = await api("/commands/history");
      state.commandHistory = Array.isArray(rows) ? rows : [];
      renderCommandHistory();
    } catch (e) {
      if (!e.auth) toast("指令记录读取失败: " + e.message);
    }
  }

  function renderCommandHistory() {
    const host = $("command-log");
    if (!host) return;
    host.innerHTML = state.commandHistory.length ? state.commandHistory.map((row) => `
      <div title="${esc(row.output || row.error || "")}">
        <b>${fmtTime(row.ts)}</b>
        <span>/${esc(row.command || "")}</span>
        <em class="${row.state === "succeeded" ? "ok" : row.state === "failed" ? "warn" : ""}">${row.state === "succeeded" ? "成功" : row.state === "failed" ? "失败" : "排队"}</em>
      </div>
    `).join("") : '<div class="ench-empty">暂无执行记录。</div>';
  }

  async function backupNow() {
    if (!state.current) return toast("请先选择玩家");
    try {
      await postAction("backup.create", { xuid: state.current.xuid }, "备份已创建");
    } catch (e) {
      toast("创建备份失败: " + e.message);
    }
  }

  async function offlineSnapshot() {
    if (!state.current) return toast("请先选择玩家");
    try {
      await postAction("offline.snapshot", { xuid: state.current.xuid }, "已读取离线背包");
      await loadInventory(false);
    } catch (e) {
      toast("读取离线背包失败: " + e.message);
    }
  }

  function startPolling() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = setInterval(async () => {
      if (state.polling) return;
      state.polling = true;
      try {
        const meta = await api("/meta");
        updateTop(meta);
        if (state.current) await loadInventory(false);
        if (state.view === "overview") await loadOverview();
        if (state.view === "flow") await loadFlow(false);
        if (state.view === "map" && state.map.meta) {
          await loadMapContainers();
          await loadMapPlayers();
        }
        if (state.view === "audit") await loadAudit();
        if (state.view === "snapshots") await loadGlobalSnapshots();
        if (document.body.classList.contains("snapshot-open")) await loadSnapshots();
        if (state.view === "last") await loadLastMoment();
        if (state.view === "players") await loadPlayers();
      } catch (e) {
        if (e.auth) return;
      } finally {
        state.polling = false;
      }
    }, 3000);
  }

  async function loadExtensions() {
    try {
      const list = await api("/extensions");
      state.extensions = Array.isArray(list) ? list : [];
    } catch (e) {
      state.extensions = [];
      if (!e.auth) console.warn("[WebBundle] 扩展页面读取失败", e);
    }
    renderExtensions();
  }

  function renderExtensions() {
    const host = $("rail-extensions");
    if (!host) return;
    host.innerHTML = state.extensions.map((page) => {
      const icon = page.icon ? page.icon : '<span class="rail-ext-glyph">' + esc(String(page.label || "?").slice(0, 1)) + "</span>";
      return '<button class="rail-btn" type="button" data-ext-key="' + esc(page.key) + '" title="' + esc(page.title || page.label) + '">' + icon + "</button>";
    }).join("");
    host.querySelectorAll("[data-ext-key]").forEach((button) => {
      button.addEventListener("click", () => openExtension(button.dataset.extKey));
    });
    updateRailIndicator();
  }

  function openExtension(key) {
    const page = state.extensions.find((entry) => entry.key === key);
    if (!page) return;
    state.view = "extension:" + key;
    document.querySelectorAll(".view").forEach((node) => node.classList.remove("active", "slide-left", "slide-right"));
    const view = $("view-extension");
    if (view) view.classList.add("active");
    document.querySelectorAll(".rail-btn").forEach((button) => button.classList.remove("active"));
    const button = Array.from(document.querySelectorAll("[data-ext-key]")).find((node) => node.dataset.extKey === key);
    if (button) button.classList.add("active");
    $("extension-title").textContent = page.title || page.label || page.id;
    $("extension-micro").textContent = (page.module || "extension") + " / EXTENSION";
    $("extension-module").textContent = page.module || "--";
    const root = $("extension-root");
    root.innerHTML = page.html || '<div class="nested-empty">该扩展没有提供页面内容。</div>';
    let style = document.getElementById("extension-style");
    if (!style) {
      style = document.createElement("style");
      style.id = "extension-style";
      document.head.appendChild(style);
    }
    style.textContent = page.css || "";
    const oldScript = document.getElementById("extension-script");
    if (oldScript) oldScript.remove();
    window.WebBundle = {
      page: page,
      api: (path, options) => api(path, options),
      toast: toast,
      state: state
    };
    if (page.script) {
      const script = document.createElement("script");
      script.id = "extension-script";
      script.textContent = "(function(){const WebBundle=window.WebBundle;\n" + page.script + "\n})();";
      root.appendChild(script);
    }
    closeDrawer();
    updateRailIndicator();
    const url = new URL(location.href);
    url.searchParams.set("view", "ext:" + key);
    history.replaceState(null, "", url);
  }

  async function enterApp() {
    await loadTextureMap();
    await loadItemCatalog();
    const meta = await api("/meta");
    updateTop(meta);
    await loadExtensions();
    await loadPlayers();
    await loadModules();
    const requested = new URLSearchParams(location.search).get("xuid");
    const initial = state.players.find((p) => String(p.xuid) === String(requested)) ||
      state.players.find((p) => p.online) || state.players[0];
    if (initial) await selectPlayer(initial.xuid);
    else renderEmptyPlayer();
    const view = new URLSearchParams(location.search).get("view") || "players";
    if (view.indexOf("ext:") === 0) openExtension(view.slice(4));
    else switchView(view);
    hideLogin();
    startPolling();
  }

  function bindLogin() {
    $("login-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      if (STANDALONE) {
        if (setupRequired) {
          location.href = "/setup";
          return;
        }
        const username = $("login-username").value.trim();
        const password = $("login-password").value;
        if (!username || !password) return;
        $("login-error").textContent = "";
        try {
          const res = await fetch("/api/v1/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({ username: username, password: password })
          });
          const data = await res.json();
          if (!res.ok || data.ok === false) throw new Error(data.error ? data.error.message : "登录失败");
          location.href = "/";
        } catch (e) {
          $("login-error").textContent = e.message;
        }
        return;
      }
      const username = $("login-username").value.trim();
      const password = $("login-password").value;
      const confirm = $("login-confirm").value;
      if (!username || !password) return;
      if (setupRequired && password !== confirm) {
        $("login-error").textContent = "两次输入的密码不一致";
        return;
      }
      $("login-error").textContent = "";
      if (password.length < 10) {
        $("login-error").textContent = "密码长度至少为 10 位";
        return;
      }
      const submit = $("login-submit");
      const submitText = submit ? submit.textContent : "";
      if (submit) {
        submit.disabled = true;
        submit.textContent = "验证中...";
      }
      try {
        let salt = state.authSalt;
        let iterations = state.authIterations;
        if (setupRequired) {
          salt = randomSalt();
          iterations = 210000;
        }
        if (!salt) {
          const statusRes = await fetch("/api/v1/auth/status", { credentials: "same-origin", cache: "no-store" });
          const statusBody = await statusRes.json();
          salt = String(statusBody.data && statusBody.data.salt || "");
          iterations = Number(statusBody.data && statusBody.data.iterations || 210000);
          state.authSalt = salt;
          state.authIterations = iterations;
        }
        if (!setupRequired) {
          const saltRes = await fetch("/api/v1/auth/salt?username=" + encodeURIComponent(username), { credentials: "same-origin", cache: "no-store" });
          const saltBody = await saltRes.json();
          if (!saltRes.ok || saltBody.ok === false) throw new Error(saltBody.error ? saltBody.error.message : "账号不存在");
          salt = String(saltBody.data && saltBody.data.salt || salt);
          iterations = Number(saltBody.data && saltBody.data.iterations || iterations);
        }
        if (!salt) throw new Error("服务端未返回密码盐");
        const verifier = await deriveVerifier(password, salt, iterations);
        const endpoint = setupRequired ? "/api/v1/auth/setup" : "/api/v1/auth/login";
        const body = setupRequired
          ? { username: username, salt: salt, iterations: iterations, verifier: verifier, webToken: ($("setup-token") ? $("setup-token").value.trim() : "") }
          : { username: username, verifier: verifier };
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!res.ok || data.ok === false) throw new Error(data.error ? data.error.message : "登录失败");
        state.token = "";
        sessionStorage.removeItem("webbundle.token");
        cookieSession = true;
        setupRequired = false;
        applyLoginMode();
        await enterApp();
      } catch (e) {
        console.error("[WebBundle] 登录失败", e);
        showLogin(e.message);
      } finally {
        if (submit) {
          submit.disabled = false;
          submit.textContent = submitText;
        }
      }
    });
  }

  function bind() {
    bindLogin();
    $("logout").addEventListener("click", () => {
      if (COOKIE_AUTH) {
        fetch("/api/v1/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).finally(() => {
          if (STANDALONE) location.href = "/";
          else location.href = "/login";
        });
      } else if (cookieSession) {
        fetch("/api/v1/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).finally(() => {
          cookieSession = false;
          if (state.pollTimer) clearInterval(state.pollTimer);
          showLogin("");
        });
      } else {
        state.token = "";
        sessionStorage.removeItem("webbundle.token");
        if (state.pollTimer) clearInterval(state.pollTimer);
        showLogin("");
      }
    });
    $("player-search").addEventListener("input", () => loadPlayers().catch(() => {}));
    window.addEventListener("resize", updateRailIndicator);
    $("drawer-close").addEventListener("click", closeDrawer);
    $("drawer-back").addEventListener("click", () => {
      if (!state.drawerRoot) return;
      const root = state.drawerRoot;
      openDrawer(root.container, root.slot, root.item);
    });
    $("scrim").addEventListener("click", closeDrawer);
    $("snap-drawer-close").addEventListener("click", closeSnapshotDrawer);
    $("snapshot-scrim").addEventListener("click", closeSnapshotDrawer);
    $("snapshot-search").addEventListener("input", () => { state.snapshotPage = 1; renderGlobalSnapshots(); });
    $("snapshot-restore-current").addEventListener("click", restoreCurrentSnapshot);
    $("snapshot-exit").addEventListener("click", exitSnapshotView);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeSnapshotDrawer();
    });
    const manifestClose = $("manifest-close");
    if (manifestClose) manifestClose.addEventListener("click", () => document.body.classList.remove("manifest-open"));
    window.addEventListener("resize", () => {
      if (window.matchMedia("(max-width: 900px)").matches === false) document.body.classList.remove("manifest-open");
    });
    document.querySelectorAll(".dtab").forEach((button) => {
      button.addEventListener("click", () => switchDrawerTab(button.dataset.dtab));
    });
    $("ench-cancel").addEventListener("click", () => switchDrawerTab("detail"));
    $("ench-add").addEventListener("click", addEnchantDraft);
    $("ench-save").addEventListener("click", saveEnchants);
    $("ench-level-minus").addEventListener("click", () => { $("ench-level").value = Math.max(1, Number($("ench-level").value) - 1); });
    $("ench-level-plus").addEventListener("click", () => { $("ench-level").value = Math.min(32767, Number($("ench-level").value) + 1); });
    $("ench-select").innerHTML = '<option value="">选择附魔</option>' + ENCHANTS.map((e) => '<option value="' + e.id + '">' + e.name + "</option>").join("");
    $("drawer-nbt").addEventListener("input", (event) => {
      state.activeNbt = event.target.value;
    });
    $("nbt-edit").addEventListener("click", () => {
      const area = $("drawer-nbt");
      const unlock = area.readOnly;
      area.readOnly = !unlock;
      $("nbt-edit").textContent = unlock ? "完成" : "编辑";
      $("nbt-edit").classList.toggle("active", unlock);
      if (unlock) {
        area.focus();
        area.setSelectionRange(0, 0);
      }
    });
    $("drawer-type-input").addEventListener("focus", showItemSuggest);
    $("drawer-type-input").addEventListener("input", showItemSuggest);
    $("drawer-type-input").addEventListener("keydown", (event) => {
      if (event.key === "Escape") hideItemSuggest();
    });
    document.addEventListener("click", (event) => {
      if (!event.target.closest(".drawer-fields") && !event.target.closest("#item-suggest")) hideItemSuggest();
    });
    window.addEventListener("resize", hideItemSuggest);
    $("copy-nbt").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(state.activeNbt || "");
        toast("SNBT 已复制到剪贴板");
      } catch (e) {
        toast("复制到剪贴板失败");
      }
    });
    document.querySelectorAll("[data-demo]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.dataset.demo;
        if (action === "save") return saveItem();
        if (action === "nbt") return saveNbt();
        if (action === "clear") return clearItem();
        if (action === "backup") return backupNow();
        if (action === "offline") return offlineSnapshot();
        if (action === "history") return openSnapshotDrawer();
      });
    });
    document.querySelectorAll(".rail-btn[data-view], [data-view].link").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        const view = button.dataset.view;
        const narrow = window.matchMedia("(max-width: 900px)").matches;
        if (narrow && view === "players") {
          if (state.view === "players" && document.body.classList.contains("manifest-open")) {
            document.body.classList.remove("manifest-open");
          } else {
            document.body.classList.add("manifest-open");
          }
        } else if (narrow) {
          document.body.classList.remove("manifest-open");
        }
        switchView(view);
      });
    });
    document.querySelectorAll("[data-flow-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll("[data-flow-filter]").forEach((b) => b.classList.remove("active"));
        button.classList.add("active");
        loadFlow(true);
      });
    });
    $("flow-search").addEventListener("input", scheduleFlowReload);
    $("flow-search").addEventListener("keydown", (event) => { if (event.key === "Enter") loadFlow(true); });
    $("flow-apply").addEventListener("click", () => loadFlow(true));
    $("flow-player").addEventListener("change", () => loadFlow(true));
    $("flow-span").addEventListener("change", () => {
      setFlowRangeDays($("flow-span").value);
      loadFlow(true);
    });
    $("flow-from").addEventListener("change", () => {
      updateFlowRangeLabel();
      loadFlow(true);
    });
    $("flow-to").addEventListener("change", () => {
      updateFlowRangeLabel();
      loadFlow(true);
    });
    $("flow-reset").addEventListener("click", () => {
      document.querySelectorAll("[data-flow-filter]").forEach((b) => b.classList.toggle("active", b.dataset.flowFilter === "all"));
      $("flow-search").value = "";
      $("flow-player").value = "";
      $("flow-span").value = "30";
      setFlowRangeDays(30);
      loadFlow(true);
    });
    $("flow-prev").addEventListener("click", () => {
      if (state.flowPage <= 1) return;
      state.flowPage -= 1;
      loadFlow(false);
    });
    $("flow-next").addEventListener("click", () => {
      if (!state.flowHasMore) return;
      state.flowPage += 1;
      loadFlow(false);
    });
    $("flow-summary-btn").addEventListener("click", loadFlowSummary);
    $("flow-summary-close").addEventListener("click", () => $("flow-summary-panel").classList.add("hidden"));
    $("audit-prev").addEventListener("click", () => { if (state.auditPage > 1) { state.auditPage -= 1; renderAudit(state.auditFilter); } });
    $("audit-next").addEventListener("click", () => { state.auditPage += 1; renderAudit(state.auditFilter); });
    $("snapshot-prev").addEventListener("click", () => { if (state.snapshotPage > 1) { state.snapshotPage -= 1; renderGlobalSnapshots(); } });
    $("snapshot-next").addEventListener("click", () => { state.snapshotPage += 1; renderGlobalSnapshots(); });
    $("account-form").addEventListener("submit", createAccount);
    $("audit-verify").addEventListener("click", () => verifyAudit(false));
    $("last-moment-btn").addEventListener("click", () => switchView("last"));
    document.querySelectorAll("[data-audit-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll("[data-audit-filter]").forEach((b) => b.classList.remove("active"));
        button.classList.add("active");
        state.auditPage = 1;
        renderAudit(button.dataset.auditFilter);
      });
    });
    $("command-run").addEventListener("click", runCommand);
    $("command-input").addEventListener("keydown", (event) => { if (event.key === "Enter") runCommand(); });
    document.querySelectorAll("[data-cmd]").forEach((button) => {
      button.addEventListener("click", () => { $("command-input").value = button.dataset.cmd; $("command-input").focus(); });
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      closeDrawer();
      if ($("map-container-modal")) $("map-container-modal").classList.add("hidden");
      if ($("map-3d")) $("map-3d").classList.add("hidden");
      if (state.map.three) state.map.three = null;
    });
    mapBindInteractions();
  }

  async function loadAuthStatus() {
    state.token = "";
    sessionStorage.removeItem("webbundle.token");
    try {
      const res = await fetch("/api/v1/auth/status", { credentials: "same-origin", cache: "no-store" });
      const body = await res.json();
      if (!res.ok || !body || body.ok === false) throw new Error(body && body.error ? body.error.message : "读取登录状态失败");
      setupRequired = !!body.data.setupRequired;
      state.authSalt = String(body.data.salt || "");
      state.authIterations = Number(body.data.iterations || 210000);
      cookieSession = !!body.data.authenticated;
      applyLoginMode();
      if (cookieSession) {
        await enterApp();
      } else {
        showLogin("");
      }
    } catch (e) {
      showLogin(e.message);
    }
  }

  bind();
  $("flow-span").value = "30";
  setFlowRangeDays(30);
  applyLoginMode();
  initContours();
  updateRailIndicator();
  if (FILE_MODE) {
    hideLogin();
    renderEmptyPlayer();
    document.body.classList.add("cold");
    const banner = $("cold-banner");
    if (banner) banner.classList.remove("hidden");
    $("cold-time").textContent = "本地静态预览 / 未连接";
    $("online-state").classList.add("offline");
    $("online-state").querySelector("span").textContent = "本地预览";
    $("stat-status").textContent = "未连接";
    const last = $("last-moment-btn");
    if (last) last.style.display = "none";
    const external = $("external-link");
    if (external) external.classList.add("hidden");
    const logout = $("logout");
    if (logout) logout.style.display = "none";
    $("server-name").textContent = "本地预览";
    $("server-id").textContent = "FILE";
    $("data-time").textContent = "未连接";
    return;
  }
  if (STANDALONE && !AUTHED) {
    showLogin("");
  } else if (COOKIE_AUTH) {
    enterApp().catch((e) => {
      console.error("[WebBundle] 启动失败", e);
      if (!e.auth) showLogin(e.message);
    });
  } else {
    loadAuthStatus();
  }
})();
