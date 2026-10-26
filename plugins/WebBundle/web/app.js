/* SPDX-License-Identifier: GPL-3.0-or-later */
(function () {
  "use strict";

  const COOKIE_AUTH = !!window.WB_COOKIE_AUTH;
  const VIEW_ORDER = ["overview", "players", "snapshots", "flow", "command", "audit", "tasks", "settings", "last"];
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
    audit: [],
    tasks: [],
    snapshots: [],
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
      // 纯 HTTP 的老浏览器可能没有 WebCrypto；首次设置仍需生成盐。
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
        // 某些旧浏览器存在 crypto.subtle 但 PBKDF2 不可用，继续走后备实现。
      }
    }
    if (window.WBPBKDF2 && typeof window.WBPBKDF2.deriveHex === "function") {
      // 非安全上下文（常见于 http://192.168.x.x）拿不到 crypto.subtle。
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
    switchDrawerTab("detail");
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
    const container = item.meta && item.meta.containerItems && item.meta.containerItems.length
      ? `<div class="tip-line">容器内容 ${item.meta.containerItems.length} 项（悬停不展开）</div>` : "";
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
    $("overview-players").innerHTML = (data.players || []).map((p, i) => `
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

  async function loadAudit() {
    try {
      const list = await api("/audit?limit=200");
      state.audit = Array.isArray(list) ? list : [];
      renderAudit("all");
      await verifyAudit(true);
    } catch (e) {
      if (!e.auth) toast("操作记录读取失败: " + e.message);
    }
  }

  function renderAudit(filter) {
    const mode = filter || "all";
    const list = state.audit.filter((row) => {
      if (mode === "all") return true;
      if (mode === "command") return row.action === "command.execute";
      if (mode === "restore") return row.action === "inventory.restore";
      return row.action !== "command.execute" && row.action !== "inventory.restore";
    });
    $("audit-rows").innerHTML = list.map((row) => `
      <div class="table-row">
        <span class="mono">${fmtTime(row.ts)}</span>
        <span>${esc(row.operator || "-")}</span>
        <span>${esc(ACTION_TITLE[row.action] || row.action)}</span>
        <span>${esc(row.target || "-")}${row.detail ? `<small class="audit-detail">${esc(row.detail)}</small>` : ""}</span>
        <span class="${row.state === "succeeded" ? "ok" : "warn"}">${row.state === "succeeded" ? "成功" : "失败"}</span>
        <code>${esc(String(row.hash || "").slice(0, 16))}…</code>
      </div>
    `).join("") || '<div class="ench-empty">暂无操作记录。</div>';
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

  async function loadTasks() {
    try {
      const list = await api("/tasks?limit=200");
      state.tasks = Array.isArray(list) ? list : [];
      renderTasks("all");
    } catch (e) {
      if (!e.auth) toast("任务数据读取失败: " + e.message);
    }
  }

  function taskStateName(task) {
    return (task.state === "queued_offline" ? "queued" : task.state);
  }

  function taskStateLabel(stateName) {
    return { succeeded: "成功", failed: "失败", queued: "排队", queued_offline: "离线排队", running: "执行中" }[stateName] || stateName;
  }

  function renderTasks(filter) {
    const list = state.tasks.filter((task) => filter === "all" || taskStateName(task) === filter);
    $("task-count").textContent = list.length + " 项任务";
    $("task-offline-count").textContent = String(state.tasks.filter((t) => taskStateName(t) === "queued").length).padStart(2, "0") + " 待执行";
    $("task-rows").innerHTML = list.map((task) => {
      const input = task.input || {};
      return `<div class="task-item">
        <div><div class="task-title">${esc(ACTION_TITLE[task.actionId] || task.actionId)}</div><div class="task-id">${esc(task.taskId)}</div></div>
        <div class="task-target">${esc(input.xuid || input.command || "-")}</div>
        <span class="state-badge ${esc(taskStateName(task))}">${taskStateLabel(task.state)}</span>
        <div class="mono">${fmtTime(task.createdAt)}</div>
        <div class="task-target">${esc(task.error || (task.result && JSON.stringify(task.result)) || "-")}</div>
      </div>`;
    }).join("") || '<div class="ench-empty">无匹配任务。</div>';
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
    $("snap-total").textContent = allGroups.length + " 个备份文件夹 / " + all.length + " 份";
    $("snapshot-count").textContent = groups.length + " / " + allGroups.length + " 个备份";
    $("snapshot-global-list").innerHTML = groups.map((group) => {
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

  function renderSettings() {
    if (!state.meta) return;
    $("set-account").textContent = (state.meta && state.meta.user) || (cookieSession ? "管理员账号" : "未登录");
    $("set-storage").textContent = COOKIE_AUTH ? "JSON 文件" : "本地键值库";
    $("set-role").textContent = { admin: "管理员", operator: "操作员", viewer: "只读" }[state.role] || state.role;
    $("set-session").textContent = cookieSession ? "HttpOnly Cookie" : "Bearer Token";
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
    if (view === "audit") await loadAudit();
    if (view === "tasks") await loadTasks();
    if (view === "command") await loadCommandHistory();
    if (view === "last") await loadLastMoment();
    if (view === "snapshots") await loadGlobalSnapshots();
    if (view === "settings") {
      renderSettings();
      if (!state.modules.length) await loadModules();
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
      if (state.view === "tasks") loadTasks();
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
        if (state.view === "audit") await loadAudit();
        if (state.view === "tasks") await loadTasks();
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
    $("snapshot-search").addEventListener("input", renderGlobalSnapshots);
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
    document.querySelectorAll("[data-task-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll("[data-task-filter]").forEach((b) => b.classList.remove("active"));
        button.classList.add("active");
        renderTasks(button.dataset.taskFilter);
      });
    });
    $("audit-verify").addEventListener("click", () => verifyAudit(false));
    $("last-moment-btn").addEventListener("click", () => switchView("last"));
    document.querySelectorAll("[data-audit-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll("[data-audit-filter]").forEach((b) => b.classList.remove("active"));
        button.classList.add("active");
        renderAudit(button.dataset.auditFilter);
      });
    });
    $("command-run").addEventListener("click", runCommand);
    $("command-input").addEventListener("keydown", (event) => { if (event.key === "Enter") runCommand(); });
    document.querySelectorAll("[data-cmd]").forEach((button) => {
      button.addEventListener("click", () => { $("command-input").value = button.dataset.cmd; $("command-input").focus(); });
    });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeDrawer(); });
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
