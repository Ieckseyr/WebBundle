#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 WebBundle contributors

"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const PUBLIC = path.resolve(__dirname, "..", "web");
const JSON_DIR = path.resolve(__dirname, "..", "src", "json");
const CONFIG_PATH = path.join(__dirname, "config.json");
const DEFAULT_CONFIG = {
  listen: "0.0.0.0:8080",
  pushToken: "",
  dataPath: path.join(__dirname, "data", "store.json"),
  staleMs: 15000,
  bdsUrl: "http://127.0.0.1:19380"
};

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    const cfg = Object.assign({}, DEFAULT_CONFIG, {
      pushToken: crypto.randomBytes(24).toString("base64url")
    });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
    console.log("[webbundle-web] 首次启动，配置已写入:", CONFIG_PATH);
    console.log("[webbundle-web] 请用浏览器打开后完成管理员账号设置");
    return cfg;
  }
  const cfg = Object.assign({}, DEFAULT_CONFIG, JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")));
  if (!cfg.pushToken) cfg.pushToken = crypto.randomBytes(24).toString("base64url");
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  return cfg;
}

const config = loadConfig();
const dataFile = path.resolve(path.isAbsolute(config.dataPath) ? config.dataPath : path.join(__dirname, config.dataPath));
const MAP_ROOT = path.resolve(__dirname, "..", "data", "map");
const MAP_RENDERER = path.resolve(__dirname, "..", "bin", "WebBundleMapRenderer.exe");
const SERVER_ROOT = path.resolve(__dirname, "..", "..", "..");
const mapRender = { active: false, startedAt: 0, finishedAt: 0, exitCode: null, output: "" };
fs.mkdirSync(path.dirname(dataFile), { recursive: true });

function emptyStore() {
  return {
    server: { serverId: "", name: "", lastSeen: 0, version: "" },
    players: {},
    snapshots: {},
    snapshotIndex: {},
    flow: [],
    containers: {},
    containerObs: {},
    containerDay: {},
    tasks: {},
    nbt: {},
    audit: [],
    extensions: [],
    users: []
  };
}

let store = emptyStore();
if (fs.existsSync(dataFile)) {
  try {
    store = Object.assign(emptyStore(), JSON.parse(fs.readFileSync(dataFile, "utf8")));
  } catch (e) {
    console.error("[webbundle-web] 数据文件读取失败，使用空库:", e.message);
  }
}

let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const tmp = dataFile + ".tmp";
    try {
      fs.writeFileSync(tmp, JSON.stringify(store));
      fs.renameSync(tmp, dataFile);
    } catch (e) {
      console.error("[webbundle-web] 保存失败:", e.message);
    }
  }, 200);
}

function now() { return Date.now(); }

const FLOW_RETENTION_DAYS = 30;
const FLOW_MAX_EVENTS = 100000;
const FLOW_PAGE_SIZE = 50;
let lastFlowPrune = 0;

function containerDayKey(ts) {
  const d = new Date(Number(ts || Date.now()));
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function flowTime(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return n;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function flowRange(url) {
  const end = now();
  let from = flowTime(url.searchParams.get("from"), end - FLOW_RETENTION_DAYS * 24 * 3600 * 1000);
  let to = flowTime(url.searchParams.get("to"), end);
  if (from > to) {
    const swap = from;
    from = to;
    to = swap;
  }
  return {
    from: from,
    to: to,
    xuid: String(url.searchParams.get("xuid") || ""),
    kind: String(url.searchParams.get("kind") || ""),
    direction: String(url.searchParams.get("direction") || ""),
    item: String(url.searchParams.get("item") || ""),
    q: String(url.searchParams.get("q") || "").trim()
  };
}

function flowCountOf(event) {
  const item = event && event.item ? event.item : {};
  return Math.max(1, Number(event && event.count || item.c || 1));
}

function flowMatches(event, filter) {
  if (!event) return false;
  const f = filter || {};
  const ts = Number(event.ts || 0);
  if (f.from && ts < Number(f.from)) return false;
  if (f.to && ts > Number(f.to)) return false;
  if (f.xuid && String(event.xuid) !== String(f.xuid)) return false;
  if (f.kind && event.kind !== f.kind) return false;
  if (f.direction && event.direction !== f.direction) return false;
  if (f.item && String(event.item && event.item.t || "") !== String(f.item)) return false;
  if (f.q) {
    const q = String(f.q).toLowerCase();
    const name = String(event.name || "").toLowerCase();
    const xuid = String(event.xuid || "").toLowerCase();
    const item = event.item || {};
    const type = String(item.t || "").toLowerCase();
    const itemName = String((item.meta && item.meta.name) || item.n || "").toLowerCase();
    if (!name.includes(q) && !xuid.includes(q) && !type.includes(q) && !itemName.includes(q)) return false;
  }
  return true;
}

function flowQuery(filter, page, pageSize) {
  const rawPage = Number(page);
  const current = Number.isFinite(rawPage) ? Math.max(1, Math.floor(rawPage)) : 1;
  const rawSize = Number(pageSize);
  const size = Number.isFinite(rawSize) ? Math.max(1, Math.min(200, Math.floor(rawSize))) : FLOW_PAGE_SIZE;
  const offset = (current - 1) * size;
  const items = [];
  let skipped = 0;
  let hasMore = false;
  for (const event of store.flow || []) {
    if (!event) continue;
    if (filter.from && Number(event.ts || 0) < filter.from) break;
    if (!flowMatches(event, filter)) continue;
    if (skipped < offset) {
      skipped += 1;
      continue;
    }
    if (items.length < size) items.push(event);
    else {
      hasMore = true;
      break;
    }
  }
  return { items: items, page: current, pageSize: size, hasMore: hasMore, from: filter.from, to: filter.to };
}

function flowSummary(filter) {
  const players = new Map();
  const items = new Map();
  const totals = { events: 0, count: 0, inCount: 0, outCount: 0 };
  let newest = 0;
  let oldest = 0;
  for (const event of store.flow || []) {
    if (!event) continue;
    const ts = Number(event.ts || 0);
    if (filter.from && ts < filter.from) break;
    if (!flowMatches(event, filter)) continue;
    const item = event.item || {};
    const type = String(item.t || "");
    const count = flowCountOf(event);
    const direction = event.direction === "out" ? "out" : "in";
    const xuid = String(event.xuid || "");
    const name = String(event.name || xuid);
    const playerKey = xuid + "|" + type + "|" + direction;
    const globalKey = type + "|" + direction;
    let p = players.get(xuid);
    if (!p) {
      p = { xuid: xuid, name: name, events: 0, count: 0, inCount: 0, outCount: 0, items: new Map() };
      players.set(xuid, p);
    }
    p.events += 1;
    p.count += count;
    if (direction === "out") p.outCount += count; else p.inCount += count;
    let pi = p.items.get(playerKey);
    if (!pi) {
      pi = { t: type, direction: direction, count: 0, events: 0, firstTs: ts, lastTs: ts };
      p.items.set(playerKey, pi);
    }
    pi.count += count;
    pi.events += 1;
    if (ts < pi.firstTs) pi.firstTs = ts;
    if (ts > pi.lastTs) pi.lastTs = ts;
    let gi = items.get(globalKey);
    if (!gi) {
      gi = { t: type, direction: direction, count: 0, events: 0, firstTs: ts, lastTs: ts };
      items.set(globalKey, gi);
    }
    gi.count += count;
    gi.events += 1;
    if (ts < gi.firstTs) gi.firstTs = ts;
    if (ts > gi.lastTs) gi.lastTs = ts;
    totals.events += 1;
    totals.count += count;
    if (direction === "out") totals.outCount += count; else totals.inCount += count;
    if (!newest || ts > newest) newest = ts;
    if (!oldest || ts < oldest) oldest = ts;
  }
  return {
    from: Number(filter.from || oldest || 0),
    to: Number(filter.to || newest || 0),
    firstTs: oldest,
    lastTs: newest,
    totals: totals,
    players: Array.from(players.values()).map((entry) => Object.assign({}, entry, {
      items: Array.from(entry.items.values()).sort((a, b) => b.count - a.count)
    })).sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name), "zh-CN")),
    items: Array.from(items.values()).sort((a, b) => b.count - a.count)
  };
}

function containerSummary(record, at) {
  if (!record) return null;
  const summary = {
    id: record.id, dim: Number(record.dim || 0), x: Number(record.x || 0), y: Number(record.y || 0), z: Number(record.z || 0),
    type: record.type, name: record.name || record.type,
    firstSeen: Number(record.firstSeen || 0), lastSeen: Number(record.lastSeen || 0),
    removedAt: Number(record.removedAt || 0),
    state: record.removedAt ? "removed" : "present",
    currentObservationId: record.currentObservationId || "",
    itemCount: Number(record.currentItemCount || 0),
    size: Number(record.size || 0),
    doubleAxis: record.doubleAxis || "",
    pairX: record.pairX,
    pairZ: record.pairZ,
    pairLead: record.pairLead,
    facing: record.facing || "",
    observationCount: Array.isArray(record.observations) ? record.observations.length : 0
  };
  let obs = null;
  if (at) {
    const found = (record.observations || []).find((entry) => Number(entry.at || 0) <= Number(at));
    if (found) obs = store.containerObs[found.id] || null;
    summary.observationId = found ? found.id : "";
    summary.observationAt = found ? found.at : 0;
    summary.state = !found ? "unknown" : (record.removedAt && Number(at) >= Number(record.removedAt) ? "removed" : "present");
    if (obs) summary.itemCount = Number(obs.itemCount || 0);
  } else {
    obs = store.containerObs[record.currentObservationId] || null;
  }
  if (obs && Array.isArray(obs.items)) {
    summary.preview = obs.items.slice(0, 5).map((slot) => ({
      t: slot.item && slot.item.t || "",
      n: slot.item && (slot.item.meta && slot.item.meta.name || slot.item.n) || "",
      c: Number(slot.item && slot.item.c || 1)
    }));
    summary.previewMore = Math.max(0, obs.items.length - summary.preview.length);
  } else {
    summary.preview = [];
    summary.previewMore = 0;
  }
  return summary;
}

function listContainers(filter) {
  const daySet = filter.day ? new Set(store.containerDay[filter.day] || []) : null;
  const sizeOf = (record) => Number(record && (record.size || (record.currentObservationId && (store.containerObs[record.currentObservationId] || {}).size)) || 0);
  const largeAt = (record, dx, dz) => {
    if (!record || sizeOf(record) <= 27) return null;
    const other = store.containers[`container:${record.dim}:${Number(record.x) + dx}:${record.y}:${Number(record.z) + dz}`];
    return other && sizeOf(other) > 27 ? other : null;
  };
  const out = [];
  for (const record of Object.values(store.containers || {})) {
    if (sizeOf(record) > 27) {
      if (largeAt(record, -1, 0)) continue;
      if (!record.doubleAxis) record.doubleAxis = largeAt(record, 1, 0) ? "x" : "";
    }
    if (Number(record.dim || 0) !== Number(filter.dim || 0)) continue;
    if (daySet && !daySet.has(record.id)) continue;
    if (!filter.includeRemoved && record.removedAt) continue;
    if (filter.from && Number(record.lastSeen || 0) < Number(filter.from)) continue;
    if (filter.to && Number(record.firstSeen || 0) > Number(filter.to)) continue;
    if (filter.bbox && (record.x < filter.bbox[0] || record.x > filter.bbox[2] || record.z < filter.bbox[1] || record.z > filter.bbox[3])) continue;
    const summary = containerSummary(record, filter.at);
    if (summary) out.push(summary);
  }
  out.sort((a, b) => b.lastSeen - a.lastSeen);
  return out;
}

function clusterContainers(items, dim, radius) {
  const groups = new Map();
  for (const item of items) {
    const gx = Math.floor(item.x / radius);
    const gz = Math.floor(item.z / radius);
    const key = dim + ":" + gx + ":" + gz;
    let group = groups.get(key);
    if (!group) {
      group = { id: key, dim: dim, x: 0, z: 0, count: 0, items: [] };
      groups.set(key, group);
    }
    group.count += 1;
    group.x += item.x;
    group.z += item.z;
    group.items.push(item);
  }
  return Array.from(groups.values()).map((group) => Object.assign({}, group, {
    x: Math.round(group.x / group.count),
    z: Math.round(group.z / group.count)
  }));
}

function mapPlayers() {
  const out = [];
  for (const player of Object.values(store.players || {})) {
    if (!player) continue;
    if (player.online === false) continue;
    let snap = null;
    const ids = store.snapshotIndex[player.xuid] || [];
    for (const id of ids) {
      if (store.snapshots[id]) { snap = store.snapshots[id]; break; }
    }
    const pos = snap && snap.pos;
    if (!pos) continue;
    out.push({
      xuid: player.xuid,
      name: player.name || player.xuid,
      dim: Number(snap.dim || 0),
      x: Number(pos.x || 0), y: Number(pos.y || 0), z: Number(pos.z || 0)
    });
  }
  out.sort((a, b) => String(a.name).localeCompare(String(b.name), "zh-CN"));
  return out;
}

function pruneFlow(force) {
  const current = now();  if (!force && lastFlowPrune && current - lastFlowPrune < 6 * 3600 * 1000) return 0;
  const cutoff = current - FLOW_RETENTION_DAYS * 24 * 3600 * 1000;
  const before = Array.isArray(store.flow) ? store.flow.length : 0;
  store.flow = (store.flow || []).filter((event) => event && Number(event.ts || 0) >= cutoff);
  if (store.flow.length > FLOW_MAX_EVENTS) store.flow = store.flow.slice(0, FLOW_MAX_EVENTS);
  lastFlowPrune = current;
  const removed = before - store.flow.length;
  if (removed > 0) {
    save();
    console.log("[webbundle-web] 物品去向清理 " + removed + " 条，保留 " + store.flow.length + " 条（30 天）");
  }
  return removed;
}

pruneFlow(true);

function pruneContainersStandalone() {
  const cutoff = now() - 90 * 24 * 3600 * 1000;
  let removed = 0;
  for (const [id, record] of Object.entries(store.containers || {})) {
    if (!record || !record.removedAt || Number(record.lastSeen || 0) >= cutoff) continue;
    for (const obs of record.observations || []) delete store.containerObs[obs.id];
    delete store.containers[id];
    removed += 1;
  }
  if (removed) {
    save();
    console.log("[webbundle-web] 容器历史清理 " + removed + " 个（90 天）");
  }
  return removed;
}

pruneContainersStandalone();

const sessions = new Map();
const loginFails = new Map();
const PBKDF2_ITERATIONS = 150000;

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

async function validateWebToken(token) {
  const value = String(token || "");
  if (!value) return false;
  const base = String(config.bdsUrl || "").replace(/\/+$/, "");
  if (!base) return false;
  try {
    const res = await fetch(base + "/api/v1/meta", {
      headers: { Authorization: "Bearer " + value },
      signal: AbortSignal.timeout(2500)
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

function hashPassword(password, salt, iterations) {
  return crypto.pbkdf2Sync(String(password), Buffer.from(salt, "hex"), iterations, 32, "sha256").toString("hex");
}

function verifyPassword(password, user) {
  try {
    const actual = Buffer.from(hashPassword(password, user.salt, user.iterations), "hex");
    const expected = Buffer.from(user.hash, "hex");
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch (e) {
    return false;
  }
}


function sessionUser(req) {
  const sid = parseCookies(req).wb_session;
  if (!sid) return null;
  const session = sessions.get(sid);
  if (!session) return null;
  if (now() - session.last > 12 * 60 * 60 * 1000) {
    sessions.delete(sid);
    return null;
  }
  session.last = now();
  return session;
}

function cookieFor(sid, secure) {
  return "wb_session=" + encodeURIComponent(sid) + "; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200" + (secure ? "; Secure" : "");
}

function clearCookie() {
  return "wb_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0";
}

function clientIp(req) {
  return String(req.socket.remoteAddress || "");
}

function loginBlocked(req) {
  const key = clientIp(req);
  const entry = loginFails.get(key);
  if (!entry) return false;
  if (now() - entry.ts > 5 * 60 * 1000) {
    loginFails.delete(key);
    return false;
  }
  return entry.count >= 8;
}

function noteLoginFail(req) {
  const key = clientIp(req);
  const entry = loginFails.get(key) || { count: 0, ts: now() };
  entry.count += 1;
  entry.ts = now();
  loginFails.set(key, entry);
}

const ALL_PERMISSIONS = [
  "inventory.read", "inventory.write", "inventory.restore",
  "snapshot.read", "flow.read", "audit.read", "command.execute",
  "accounts.manage"
];
const ROLE_PERMISSIONS = {
  viewer: ["inventory.read", "snapshot.read", "flow.read", "audit.read"],
  operator: ["inventory.read", "inventory.write", "inventory.restore", "snapshot.read", "flow.read", "audit.read", "command.execute"],
  admin: ALL_PERMISSIONS.slice()
};

function normalizeUser(user) {
  const role = user.role === "viewer" || user.role === "operator" || user.role === "admin" ? user.role : "admin";
  return Object.assign({}, user, {
    role: role,
    permissions: Array.isArray(user.permissions) ? user.permissions.filter((p) => ALL_PERMISSIONS.includes(p)) : ROLE_PERMISSIONS[role].slice()
  });
}

function publicUser(user) {
  const normalized = normalizeUser(user);
  return { username: normalized.username, role: normalized.role, permissions: normalized.permissions, createdAt: normalized.createdAt };
}

store.users = (store.users || []).map(normalizeUser);

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(text),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer"
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch (e) {
        reject(new Error("invalid json"));
      }
    });
    req.on("error", reject);
  });
}

function bearer(req) {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

function setupRequired() {
  return !Array.isArray(store.users) || store.users.length === 0;
}

function pushAuthorized(req) {
  return !config.pushToken || bearer(req) === config.pushToken;
}

function latestSnapshot(xuid) {
  const index = store.snapshotIndex[xuid] || [];
  for (const id of index) {
    if (store.snapshots[id]) return store.snapshots[id];
  }
  return null;
}

function listSnapshots(xuid, limit) {
  const index = store.snapshotIndex[xuid] || [];
  const out = [];
  for (const id of index) {
    const snap = store.snapshots[id];
    if (!snap) continue;
    out.push({
      id: snap.id,
      xuid: snap.xuid,
      ts: snap.ts,
      minute: snap.minute,
      reason: snap.reason,
      batchId: snap.batchId || "",
      batchAt: Number(snap.batchAt || 0),
      batchReason: snap.batchReason || snap.reason,
      hash: snap.hash,
      itemCount: snap.itemCount || 0
    });
    if (out.length >= Math.min(limit || 100, 500)) break;
  }
  return out;
}

function serverOnline() {
  if (store.server.shutdownAt) return false;
  return !!(store.server.lastSeen && (now() - store.server.lastSeen) < config.staleMs);
}

function publicPlayers() {
  const online = serverOnline();
  const out = [];
  for (const meta of Object.values(store.players)) {
    out.push({
      xuid: meta.xuid,
      name: meta.name || "",
      online: online && meta.online !== false,
      lastSeen: meta.lastSeen || 0,
      dim: meta.dim || 0,
      pos: meta.pos || null
    });
  }
  out.sort((a, b) => (b.online ? 1 : 0) - (a.online ? 1 : 0) || b.lastSeen - a.lastSeen);
  return out;
}

function meta(session) {
  const online = serverOnline();
  return {
    serverId: store.server.serverId || "external",
    serverName: store.server.name || "BDS",
    version: "1.2.0",
    mode: online ? "external" : "cold",
    server: { online: online, lastSeen: store.server.lastSeen || 0, shutdownAt: store.server.shutdownAt || 0 },
    dataAsOf: store.server.shutdownAt || store.server.lastSeen || 0,
    apiVersion: 1,
    role: session ? session.role || "admin" : "admin",
    permissions: session ? (session.permissions || []) : ROLE_PERMISSIONS.admin,
    username: session ? session.username || "" : "",
    owner: !!(session && (store.users || [])[0] && session.username === (store.users || [])[0].username),
    capabilities: ["inventory.live", "snapshot", "nbt", "flow", "command", "actions", "offline.edit", "audit"],
    live: { transport: "poll", intervalMs: 2000 },
    limits: { pageSize: 200 }
  };
}

function actionList() {
  return [
    { id: "inventory.set", title: "设置槽位", permission: "inventory.write" },
    { id: "inventory.add", title: "添加物品", permission: "inventory.write" },
    { id: "inventory.remove", title: "清空槽位", permission: "inventory.write" },
    { id: "item.nbt.set", title: "设置物品 NBT", permission: "inventory.write" },
    { id: "item.enchants.set", title: "设置物品附魔", permission: "inventory.write" },
    { id: "item.lore.set", title: "设置 Lore 与物品标签", permission: "inventory.write" },
                { id: "item.name.set", title: "设置物品显示名称", permission: "inventory.write" },
                { id: "flow.craft", title: "记录合成物品", permission: "inventory.write" },


    { id: "item.nested.set", title: "修改容器内物品", permission: "inventory.write" },
    { id: "item.nbt.refresh", title: "刷新物品 NBT", permission: "inventory.read" },
    { id: "inventory.restore", title: "还原背包", permission: "inventory.write" },
    { id: "backup.create", title: "立即备份", permission: "inventory.read" },
    { id: "offline.snapshot", title: "读取离线背包", permission: "inventory.write" }
  ];
}

function createTask(actionId, input, operator) {
  const taskId = "task-" + crypto.randomUUID();
  const task = {
    schema: 1,
    taskId,
    kind: actionId === "command.execute" ? "command" : "action",
    actionId,
    state: "queued_offline",
    operator: operator || "web",
    input: input || {},
    result: null,
    error: null,
    createdAt: now(),
    startedAt: null,
    finishedAt: null,
    traceId: taskId
  };
  store.tasks[taskId] = task;
  save();
  return task;
}

async function handlePush(req, res, url) {
  if (!pushAuthorized(req)) {
    json(res, 401, { ok: false, error: { code: "UNAUTHORIZED", message: "push token invalid" } });
    return;
  }
  const pathname = url.pathname;
  if (req.method === "GET" && pathname === "/push/v1/health") {
    json(res, 200, { ok: true, data: { time: now() } });
    return;
  }
  if (req.method === "GET" && pathname === "/push/v1/actions/pending") {
    const serverId = url.searchParams.get("serverId") || "";
    const limit = Math.min(Number(url.searchParams.get("limit") || 8), 32);
    const items = [];
    for (const task of Object.values(store.tasks)) {
      if (task.state !== "queued_offline" && task.state !== "queued") continue;
      if (serverId && task.input && task.input.serverId && task.input.serverId !== serverId) continue;
      task.state = "running";
      task.startedAt = now();
      items.push({ taskId: task.taskId, actionId: task.actionId, input: task.input, operator: task.operator });
      if (items.length >= limit) break;
    }
    save();
    json(res, 200, { ok: true, data: items });
    return;
  }
  if (req.method !== "POST") {
    json(res, 405, { ok: false, error: { code: "METHOD", message: "method not allowed" } });
    return;
  }
  let body;
  try { body = await readBody(req); } catch (e) { json(res, 400, { ok: false, error: { code: "VALIDATION", message: e.message } }); return; }

  if (pathname === "/push/v1/register") {
    store.server.shutdownAt = 0;
    store.server.serverId = body.serverId || store.server.serverId;
    store.server.name = body.name || store.server.name;
    store.server.version = body.version || "";
    store.server.lastSeen = now();
    save();
    json(res, 200, { ok: true, data: { time: now() } });
    return;
  }
  if (pathname === "/push/v1/heartbeat") {
    store.server.shutdownAt = 0;
    store.server.lastSeen = now();
    save();
    json(res, 200, { ok: true, data: { time: now() } });
    return;
  }
  if (pathname === "/push/v1/shutdown") {
    store.server.lastSeen = now();
    store.server.shutdownAt = Number(body.ts || now());
    save();
    json(res, 200, { ok: true });
    return;
  }
  if (pathname === "/push/v1/extensions") {
    store.extensions = Array.isArray(body.items) ? body.items : [];
    save();
    json(res, 200, { ok: true });
    return;
  }
  if (pathname === "/push/v1/player") {
    for (const metaItem of body.items || []) {
      const old = store.players[metaItem.xuid] || {};
      store.players[metaItem.xuid] = Object.assign({}, old, metaItem, { online: !!metaItem.online });
    }
    save();
    json(res, 200, { ok: true });
    return;
  }
  if (pathname === "/push/v1/snapshot") {
    for (const snap of body.items || []) {
      if (!snap || !snap.id) continue;
      store.snapshots[snap.id] = snap;
      const index = store.snapshotIndex[snap.xuid] || [];
      const filtered = index.filter((id) => id !== snap.id);
      filtered.unshift(snap.id);
      store.snapshotIndex[snap.xuid] = filtered.slice(0, 3000);
      const old = store.players[snap.xuid] || {};
      store.players[snap.xuid] = Object.assign({}, old, {
        xuid: snap.xuid,
        name: snap.name || old.name || "",
        uuid: snap.uuid || old.uuid || "",
        online: snap.online !== false,
        lastSeen: snap.ts
      });
      for (const group of ["inventory", "armor", "offhand", "ender"]) {
        for (const entry of snap[group] || []) {
          const item = entry.item;
          if (item && item.nbtRef && item.nbt) store.nbt[item.nbtRef] = item.nbt;
        }
      }
      if (snap.nbtRefs) {
        for (const [ref, snbt] of Object.entries(snap.nbtRefs)) store.nbt[ref] = snbt;
        delete snap.nbtRefs;
      }
    }
    store.server.lastSeen = now();
    save();
    json(res, 200, { ok: true });
    return;
  }
  if (pathname === "/push/v1/flow") {
    for (const event of body.items || []) {
      if (!event || !event.id) continue;
      store.flow.unshift(event);
    }
    pruneFlow(false);
    store.flow = store.flow.slice(0, FLOW_MAX_EVENTS);
    save();
    json(res, 200, { ok: true });
    return;
  }
  if (pathname === "/push/v1/container") {
    const record = body.container;
    const observation = body.observation;
    if (!record || !record.id) { json(res, 400, { ok: false, error: { code: "VALIDATION", message: "container required" } }); return; }
    store.containers[record.id] = record;
    if (observation && observation.id) {
      store.containerObs[observation.id] = observation;
      const day = containerDayKey(observation.at);
      const list = Array.isArray(store.containerDay[day]) ? store.containerDay[day] : [];
      if (list.indexOf(record.id) < 0) list.unshift(record.id);
      store.containerDay[day] = list.slice(0, 100000);
    }
    save();
    json(res, 200, { ok: true });
    return;
  }
  if (pathname === "/push/v1/audit") {
    for (const event of body.items || []) {
      if (!event || !event.seq) continue;
      if (!store.audit.some((e) => e.seq === event.seq && e.hash === event.hash)) store.audit.unshift(event);
    }
    store.audit = store.audit.slice(0, 5000);
    save();
    json(res, 200, { ok: true });
    return;
  }
  if (pathname === "/push/v1/actions/result") {
    const task = store.tasks[body.taskId];
    if (task) {
      task.state = body.state || "succeeded";
      task.result = body.result || null;
      task.error = body.error || null;
      task.finishedAt = now();
      save();
    }
    json(res, 200, { ok: true });
    return;
  }
  json(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "unknown push endpoint" } });
}

async function loginViaBuiltin(username, password) {
  const base = String(config.bdsUrl || "").replace(/\/+$/, "");
  if (!base) return null;
  try {
    const statusRes = await fetch(base + "/api/v1/auth/status", { signal: AbortSignal.timeout(1500) });
    if (!statusRes.ok) return null;
    const statusBody = await statusRes.json();
    const status = statusBody && statusBody.data ? statusBody.data : null;
    if (!status || status.setupRequired || !status.salt) return null;
    const iterations = Number(status.iterations || 210000);
    const verifier = crypto.pbkdf2Sync(String(password), Buffer.from(status.salt, "hex"), iterations, 32, "sha256").toString("hex");
    const loginRes = await fetch(base + "/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username, verifier: verifier }),
      signal: AbortSignal.timeout(2000)
    });
    const loginBody = await loginRes.json();
    if (loginRes.ok && loginBody.ok !== false) {
      const data = loginBody.data || {};
      return { username: data.username || username, role: data.role || "admin" };
    }
    if (loginRes.status === 401) return { rejected: true };
    return null;
  } catch (e) {
    return null;
  }
}

async function handleAuth(req, res, url) {
  const pathname = url.pathname.replace(/^\/api\/v1\/auth/, "/api");
  if (req.method === "GET" && pathname === "/api/status") {
    const session = sessionUser(req);
    json(res, 200, { ok: true, data: {
      setupRequired: setupRequired(),
      authenticated: !!session,
      username: session ? session.username : "",
      role: session ? session.role : "viewer"
    } });
    return;
  }
  if (req.method !== "POST") {
    json(res, 405, { ok: false, error: { code: "METHOD", message: "method not allowed" } });
    return;
  }
  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    json(res, 400, { ok: false, error: { code: "VALIDATION", message: e.message } });
    return;
  }
  const secure = req.headers["x-forwarded-proto"] === "https";

  if (pathname === "/api/setup") {
    if (!setupRequired()) {
      json(res, 409, { ok: false, error: { code: "CONFLICT", message: "管理员已设置" } });
      return;
    }
    if (!(await validateWebToken(String(body.webToken || "")))) {
      json(res, 403, { ok: false, error: { code: "SETUP_TOKEN", message: "请输入 BDS config.json 中的 web.token" } });
      return;
    }
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    const confirm = String(body.confirm || "");
    if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) {
      json(res, 400, { ok: false, error: { code: "VALIDATION", message: "用户名 3–32 位，仅字母数字 _ . -" } });
      return;
    }
    if (password.length < 10) {
      json(res, 400, { ok: false, error: { code: "VALIDATION", message: "密码至少 10 位" } });
      return;
    }
    if (password !== confirm) {
      json(res, 400, { ok: false, error: { code: "VALIDATION", message: "两次密码不一致" } });
      return;
    }
    const salt = crypto.randomBytes(16).toString("hex");
    const user = {
      username: username,
      salt: salt,
      iterations: PBKDF2_ITERATIONS,
      hash: hashPassword(password, salt, PBKDF2_ITERATIONS),
      createdAt: now()
    };
    store.users.push(normalizeUser(Object.assign({ role: "admin" }, user)));
    save();
    const sid = crypto.randomBytes(32).toString("base64url");
    sessions.set(sid, { sid, username, role: "admin", permissions: ROLE_PERMISSIONS.admin.slice(), created: now(), last: now() });
    res.setHeader("Set-Cookie", cookieFor(sid, secure));
    json(res, 200, { ok: true, data: { username: username } });
    return;
  }

  if (pathname === "/api/login") {
    if (loginBlocked(req)) {
      json(res, 429, { ok: false, error: { code: "RATE_LIMITED", message: "尝试过多，请稍后再试" } });
      return;
    }
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    const builtin = await loginViaBuiltin(username, password);
    if (builtin && builtin.username) {
      loginFails.delete(clientIp(req));
      const sid = crypto.randomBytes(32).toString("base64url");
      const role = builtin.role === "viewer" || builtin.role === "operator" ? builtin.role : "admin";
      sessions.set(sid, { sid, username: builtin.username, role: role, permissions: (ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.admin).slice(), created: now(), last: now() });
      res.setHeader("Set-Cookie", cookieFor(sid, secure));
      json(res, 200, { ok: true, data: { username: builtin.username, role: role } });
      return;
    }
    if (setupRequired()) {
      json(res, 409, { ok: false, error: { code: "SETUP_REQUIRED", message: "请先设置管理员账号" } });
      return;
    }
    const user = (store.users || []).find((u) => u.username === username);
    if (!user || !verifyPassword(password, user)) {
      noteLoginFail(req);
      json(res, 401, { ok: false, error: { code: "UNAUTHORIZED", message: "用户名或密码错误" } });
      return;
    }
    loginFails.delete(clientIp(req));
    const normalized = normalizeUser(user);
    const sid = crypto.randomBytes(32).toString("base64url");
    sessions.set(sid, { sid, username: normalized.username, role: normalized.role, permissions: normalized.permissions, created: now(), last: now() });
    res.setHeader("Set-Cookie", cookieFor(sid, secure));
    json(res, 200, { ok: true, data: publicUser(user) });
    return;
  }

  if (pathname === "/api/logout") {
    const sid = parseCookies(req).wb_session;
    if (sid) sessions.delete(sid);
    res.setHeader("Set-Cookie", clearCookie());
    json(res, 200, { ok: true });
    return;
  }

  json(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "unknown auth endpoint" } });
}

async function handleApi(req, res, url) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
    });
    res.end();
    return;
  }
  const session = sessionUser(req);
  if (!session) {
    if (setupRequired()) {
      json(res, 401, { ok: false, error: { code: "SETUP_REQUIRED", message: "请先完成管理员账号设置" } });
      return;
    }
    json(res, 401, { ok: false, error: { code: "UNAUTHORIZED", message: "请先登录" } });
    return;
  }
  const pathname = url.pathname.replace(/^\/api\/v1/, "");
  const hasPermission = (permission) => session.role === "admin" || (session.permissions || []).includes(permission);
  const deny = (permission) => json(res, 403, { ok: false, error: { code: "FORBIDDEN", message: "缺少 " + permission + " 权限" } });
  if (req.method === "GET") {
    if (pathname === "/meta" || pathname === "/health") {
      json(res, 200, { ok: true, data: meta(session) });
      return;
    }
    if (pathname === "/last-moment") {
      const at = store.server.shutdownAt || store.server.lastSeen || 0;
      const players = publicPlayers().map((player) => {
        const snap = latestSnapshot(player.xuid);
        return {
          xuid: player.xuid,
          name: player.name,
          online: false,
          lastSeen: player.lastSeen,
          snapshotId: snap ? snap.id : "",
          ts: snap ? snap.ts : 0,
          reason: snap ? (snap.reason || "") : "",
          itemCount: snap ? Number(snap.itemCount || 0) : 0
        };
      });
      players.sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0));
      json(res, 200, { ok: true, data: {
        at: at,
        server: { id: store.server.serverId || "external", name: store.server.name || "BDS" },
        players: players,
        totalItems: players.reduce((sum, p) => sum + Number(p.itemCount || 0), 0)
      } });
      return;
    }
    if (pathname === "/items/translations") {
      try {
        const file = path.join(JSON_DIR, "item-translations.json");
        json(res, 200, { ok: true, data: JSON.parse(fs.readFileSync(file, "utf8")) });
      } catch (e) {
        json(res, 200, { ok: true, data: { items: {}, english: {} } });
      }
      return;
    }
    if (pathname === "/items/search") {
      const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
      let table = { items: {}, english: {} };
      try { table = JSON.parse(fs.readFileSync(path.join(JSON_DIR, "item-translations.json"), "utf8")); } catch (e) {  }
      const out = [];
      for (const [id, name] of Object.entries(table.items || {})) {
        if (q && !id.toLowerCase().includes(q) && !String(name).toLowerCase().includes(q)) continue;
        out.push({ id: "minecraft:" + id, name: name, english: table.english && table.english[id] || "" });
        if (out.length >= 100) break;
      }
      json(res, 200, { ok: true, data: out });
      return;
    }
    if (pathname === "/items/translations") {
      try {
        const file = path.join(JSON_DIR, "item-translations.json");
        json(res, 200, { ok: true, data: JSON.parse(fs.readFileSync(file, "utf8")) });
      } catch (e) {
        json(res, 200, { ok: true, data: { items: {}, english: {} } });
      }
      return;
    }
    if (pathname === "/items/search") {
      const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
      let table = { items: {}, english: {} };
      try { table = JSON.parse(fs.readFileSync(path.join(JSON_DIR, "item-translations.json"), "utf8")); } catch (e) {  }
      const out = [];
      for (const [id, name] of Object.entries(table.items || {})) {
        if (q && !id.toLowerCase().includes(q) && !String(name).toLowerCase().includes(q)) continue;
        out.push({ id: "minecraft:" + id, name: name, english: table.english && table.english[id] || "" });
        if (out.length >= 100) break;
      }
      json(res, 200, { ok: true, data: out });
      return;
    }
    if (pathname === "/commands/history") {
      const rows = Object.values(store.tasks || {})
        .filter((task) => task.actionId === "command.execute")
        .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
        .slice(0, 30)
        .map((task) => ({
          taskId: task.taskId,
          command: String(task.input && task.input.command || ""),
          operator: task.operator || "",
          state: task.state || "",
          ts: task.createdAt || task.startedAt || task.finishedAt || 0,
          output: task.result && task.result.output ? String(task.result.output).slice(0, 4000) : "",
          error: task.error || ""
        }));
      json(res, 200, { ok: true, data: rows });
      return;
    }
    if (pathname === "/commands/history") {
      const rows = Object.values(store.tasks || {})
        .filter((task) => task.actionId === "command.execute")
        .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
        .slice(0, 30)
        .map((task) => ({
          taskId: task.taskId,
          command: String(task.input && task.input.command || ""),
          operator: task.operator || "",
          state: task.state || "",
          ts: task.createdAt || task.startedAt || task.finishedAt || 0,
          output: task.result && task.result.output ? String(task.result.output).slice(0, 4000) : "",
          error: task.error || ""
        }));
      json(res, 200, { ok: true, data: rows });
      return;
    }
    if (pathname === "/map/render") {
      if (!session || session.role !== "admin") {
        json(res, 403, { ok: false, error: { code: "FORBIDDEN", message: "只有管理员可以渲染地图" } });
        return;
      }
      if (mapRender.active) {
        json(res, 409, { ok: false, error: { code: "BUSY", message: "地图正在渲染" } });
        return;
      }
      let level = "Bedrock level";
      try {
        const props = fs.readFileSync(path.join(SERVER_ROOT, "server.properties"), "utf8");
        const line = props.split(String.fromCharCode(10)).find((entry) => entry.trim().startsWith("level-name="));
        if (line) level = line.slice(line.indexOf("=") + 1).trim() || level;
      } catch (e) { level = "Bedrock level"; }
      mapRender.active = true; mapRender.startedAt = Date.now(); mapRender.finishedAt = 0; mapRender.exitCode = null; mapRender.output = "";
      try {
        const child = spawn(MAP_RENDERER, ["--db", path.join(SERVER_ROOT, "worlds", level, "db"), "--output", MAP_ROOT, "--dim", "0,1,2", "--threads", "0", "--speed", "2"], { cwd: SERVER_ROOT, windowsHide: true });
        const collect = (chunk) => { mapRender.output = (mapRender.output + chunk.toString()).slice(-4000); };
        child.stdout.on("data", collect);
        child.stderr.on("data", collect);
        child.on("error", (error) => { mapRender.active = false; mapRender.output = error.message; });
        child.on("close", (code) => { mapRender.active = false; mapRender.exitCode = code; mapRender.finishedAt = Date.now(); });
        json(res, 200, { ok: true, data: mapRender });
      } catch (e) {
        mapRender.active = false; mapRender.output = e.message;
        json(res, 500, { ok: false, error: { code: "RENDER_FAILED", message: e.message } });
      }
      return;
    }
    if (pathname === "/accounts") {
      const owner = (store.users || [])[0];
      if (!owner || session.username !== owner.username) {
        json(res, 403, { ok: false, error: { code: "FORBIDDEN", message: "只有初始管理员可以管理账号" } });
        return;
      }
      json(res, 200, { ok: true, data: (store.users || []).map(publicUser) });
      return;
    }
    if (pathname === "/accounts") {
      const owner = (store.users || [])[0];
      if (!owner || session.username !== owner.username) {
        json(res, 403, { ok: false, error: { code: "FORBIDDEN", message: "只有初始管理员可以管理账号" } });
        return;
      }
      json(res, 200, { ok: true, data: (store.users || []).map(publicUser) });
      return;
    }
    if (pathname === "/extensions") {
      json(res, 200, { ok: true, data: Array.isArray(store.extensions) ? store.extensions : [] });
      return;
    }
    if (pathname === "/overview") {
      const players = publicPlayers();
      const online = players.filter((p) => p.online).length;
      const midnight = new Date();
      midnight.setHours(0, 0, 0, 0);
      const start = midnight.getTime();
      const flow = store.flow.slice(0, 500);
      const todayFlow = flow.filter((e) => Number(e.ts || 0) >= start);
      const tasks = Object.values(store.tasks || {});
      const entries = store.audit.slice().sort((a, b) => Number(a.seq) - Number(b.seq));
      let prevHash = "";
      let valid = true;
      for (const entry of entries) {
        if (entry.prevHash !== prevHash) valid = false;
        const base = {
          schema: entry.schema, seq: entry.seq, ts: entry.ts, operator: entry.operator,
          action: entry.action, taskId: entry.taskId, target: entry.target,
          state: entry.state, error: entry.error, prevHash: entry.prevHash
        };
        if (crypto.createHash("sha256").update(JSON.stringify(base)).digest("hex") !== entry.hash) valid = false;
        prevHash = entry.hash;
      }
      const heat = new Array(30).fill(0);
      const dayMs = 24 * 60 * 60 * 1000;
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      for (const snap of Object.values(store.snapshots || {})) {
        const diff = Math.floor((Number(snap.ts || 0) - dayStart.getTime()) / dayMs);
        if (diff >= 0 && diff < 30) heat[29 - diff] += 1;
      }
      let snapshotsToday = 0;
      for (const snap of Object.values(store.snapshots || {})) {
        if (Number(snap.ts || 0) >= start) snapshotsToday += 1;
      }
      json(res, 200, { ok: true, data: {
        server: { id: store.server.serverId || "external", name: store.server.name || "BDS", online: meta().server.online, version: "1.2.0" },
        counts: {
          playersOnline: online, playersTotal: players.length,
          snapshotsToday, flowToday: todayFlow.length,
          flowIn: todayFlow.filter((e) => e.direction === "in").length,
          flowOut: todayFlow.filter((e) => e.direction === "out").length,
          tasksQueued: tasks.filter((t) => t.state === "queued" || t.state === "queued_offline" || t.state === "running").length,
          auditCount: entries.length
        },
        players,
        flow: flow.slice(0, 5),
        audit: entries.slice(-5).reverse(),
        auditVerify: { valid, count: entries.length, firstSeq: entries.length ? entries[0].seq : null, lastSeq: entries.length ? entries[entries.length - 1].seq : null },
        backupHeat: heat,
        system: { storage: "JSON 文件", external: true, nbtObjects: Object.keys(store.nbt || {}).length, auditQueue: 0 },
        dataAsOf: store.server.shutdownAt || store.server.lastSeen || now()
      } });
      return;
    }
    if (pathname === "/tasks") {
      const state = url.searchParams.get("state") || "";
      let list = Object.values(store.tasks || {});
      if (state) list = list.filter((t) => t.state === state || (state === "queued" && t.state === "queued_offline"));
      list.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
      json(res, 200, { ok: true, data: list.slice(0, Math.min(Number(url.searchParams.get("limit") || 100), 500)) });
      return;
    }
    if (pathname === "/modules") {
      json(res, 200, { ok: true, data: [
        { id: "command", name: "网页指令", version: "1.2.0" },
        { id: "logistics", name: "物流信息", version: "1.2.0" }
      ] });
      return;
    }
    if (pathname === "/players") {
      let list = publicPlayers();
      const q = (url.searchParams.get("q") || "").toLowerCase();
      if (q) list = list.filter((p) => (p.name || "").toLowerCase().includes(q) || p.xuid.includes(q));
      json(res, 200, { ok: true, data: list });
      return;
    }
    let m = pathname.match(/^\/players\/([^/]+)\/inventory$/);
    if (m) {
      const xuid = decodeURIComponent(m[1]);
      const at = url.searchParams.get("at") || "";
      const snap = at ? store.snapshots[at] : latestSnapshot(xuid);
      if (!snap) {
        json(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "no data" } });
        return;
      }
      json(res, 200, {
        ok: true,
        data: {
          xuid: snap.xuid,
          uuid: snap.uuid,
          name: snap.name,
          seq: snap.seq,
          ts: snap.ts,
          source: meta().server.online ? "snapshot" : "cold",
          containers: {
            inventory: snap.inventory || [],
            armor: snap.armor || [],
            offhand: snap.offhand || [],
            ender: snap.ender || []
          },
          dim: snap.dim,
          pos: snap.pos
        }
      });
      return;
    }
    m = pathname.match(/^\/players\/([^/]+)\/snapshots$/);
    if (m) {
      json(res, 200, { ok: true, data: listSnapshots(decodeURIComponent(m[1]), Number(url.searchParams.get("limit") || 100)) });
      return;
    }
    if (pathname === "/snapshots") {
      const limit = Math.min(Number(url.searchParams.get("limit") || 500), 2000);
      const all = Object.values(store.snapshots || {}).map((snap) => {
        const player = store.players[snap.xuid] || {};
        return {
          id: snap.id,
          xuid: snap.xuid,
          name: snap.name || player.name || "",
          ts: snap.ts,
          minute: snap.minute,
          reason: snap.reason,
          batchId: snap.batchId || "",
          batchAt: Number(snap.batchAt || 0),
          batchReason: snap.batchReason || snap.reason,
          hash: snap.hash,
          itemCount: snap.itemCount || 0,
          containerCounts: snap.containerCounts || null
        };
      }).sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0));
      json(res, 200, { ok: true, data: all.slice(0, limit) });
      return;
    }
    m = pathname.match(/^\/snapshots\/([^/]+)$/);
    if (m) {
      const snap = store.snapshots[decodeURIComponent(m[1])];
      if (!snap) { json(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "not found" } }); return; }
      json(res, 200, { ok: true, data: snap });
      return;
    }
    m = pathname.match(/^\/nbt\/([^/]+)$/);
    if (m) {
      const snbt = store.nbt[decodeURIComponent(m[1])];
      if (!snbt) { json(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "nbt not found" } }); return; }
      json(res, 200, { ok: true, data: { snbt, size: snbt.length } });
      return;
    }
    if (pathname === "/map/render/status") {
      json(res, 200, { ok: true, data: mapRender });
      return;
    }
    if (pathname === "/map/meta") {
      let mapMeta = {};
      try { mapMeta = JSON.parse(fs.readFileSync(path.join(MAP_ROOT, "render-meta.json"), "utf8")); } catch (e) { mapMeta = {}; }
      json(res, 200, { ok: true, data: {
        tileUrl: "/api/v1/map/tiles/{dim}/{zoom}/{tx}/{ty}",
        zoomIn: 2,
        zoomOut: -7,
        lastRender: Number(mapMeta.renderedAt || 0),
        renderActive: !!mapRender.active,
        dimensions: [
          { id: 0, tile: "overworld", name: "主世界" },
          { id: 1, tile: "nether", name: "下界" },
          { id: 2, tile: "the_end", name: "末地" }
        ],
        clusterRadius: 4,
        retentionDays: 90
      } });
      return;
    }
    if (pathname === "/map/players") {
      json(res, 200, { ok: true, data: mapPlayers() });
      return;
    }
    if (pathname === "/map/containers") {
      const dim = Number(url.searchParams.get("dim") || 0);
      const at = Number(url.searchParams.get("at") || 0) || 0;
      const day = url.searchParams.get("day") || "";
      let bbox = null;
      const bboxRaw = url.searchParams.get("bbox") || "";
      if (bboxRaw) {
        const values = bboxRaw.split(",").map(Number);
        if (values.length === 4 && values.every(Number.isFinite)) bbox = values;
      }
      let items = listContainers({ dim, at, day, bbox, includeRemoved: !!at || !!day });
      const limit = Math.max(1, Math.min(2000, Number(url.searchParams.get("limit") || 1000) || 1000));
      const cx = Number(url.searchParams.get("cx"));
      const cz = Number(url.searchParams.get("cz"));
      if (Number.isFinite(cx) && Number.isFinite(cz)) {
        items.sort((a, b) => {
          const da = (a.x - cx) * (a.x - cx) + (a.z - cz) * (a.z - cz);
          const db = (b.x - cx) * (b.x - cx) + (b.z - cz) * (b.z - cz);
          return da - db;
        });
      }
      items = items.slice(0, limit);
      json(res, 200, { ok: true, data: { at, day, items, clusters: [] } });
      return;
    }
    const mapTile = pathname.match(/^\/map\/tiles\/([^/]+)\/(\d+)\/(-?\d+)\/(-?\d+)$/);
    if (mapTile) {
      const folder = mapTile[1] === "nether" ? "nether" : (mapTile[1] === "the_end" ? "the_end" : "overworld");
      const level = Math.max(0, Math.min(20, Number(mapTile[2])));
      const tileFile = path.join(MAP_ROOT, "tiles", folder, String(level), mapTile[3] + "_" + mapTile[4] + ".png");
      if (!tileFile.startsWith(path.join(MAP_ROOT, "tiles"))) { res.writeHead(400); res.end(); return; }
      if (!fs.existsSync(tileFile)) { res.writeHead(404); res.end(); return; }
      return sendFile(res, tileFile, "public, max-age=3600");
    }
    const historyMatch = pathname.match(/^\/containers\/([^/]+)\/history$/);
    if (historyMatch) {
      const record = store.containers[decodeURIComponent(historyMatch[1])];
      if (!record) { json(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "container not found" } }); return; }
      json(res, 200, { ok: true, data: { container: containerSummary(record, 0), observations: record.observations || [] } });
      return;
    }
    const containerMatch = pathname.match(/^\/containers\/([^/]+)$/);
    if (containerMatch) {
      const record = store.containers[decodeURIComponent(containerMatch[1])];
      if (!record) { json(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "container not found" } }); return; }
      const at = Number(url.searchParams.get("at") || 0) || 0;
      let obsId = record.currentObservationId || "";
      if (at) {
        const found = (record.observations || []).find((entry) => Number(entry.at || 0) <= at);
        obsId = found ? found.id : "";
      }
      json(res, 200, { ok: true, data: Object.assign({ observation: store.containerObs[obsId] || null }, containerSummary(record, at)) });
      return;
    }
    if (pathname === "/flow" || pathname === "/flow/summary") {
      const filter = flowRange(url);
      if (pathname === "/flow/summary") {
        json(res, 200, { ok: true, data: flowSummary(filter) });
        return;
      }
      const page = Number(url.searchParams.get("page") || 1);
      const pageSize = Number(url.searchParams.get("pageSize") || url.searchParams.get("limit") || FLOW_PAGE_SIZE);
      json(res, 200, { ok: true, data: flowQuery(filter, page, pageSize) });
      return;
    }
    if (pathname === "/audit") {
      if (!hasPermission("audit.read")) { deny("audit.read"); return; }
      const limit = Math.min(Number(url.searchParams.get("limit") || 100), 500);
      json(res, 200, { ok: true, data: store.audit.slice(0, limit) });
      return;
    }
    if (pathname === "/audit/verify") {
      if (!hasPermission("audit.read")) { deny("audit.read"); return; }
      const entries = store.audit.slice().sort((a, b) => Number(a.seq) - Number(b.seq));
      let prevHash = "";
      let valid = true;
      for (const entry of entries) {
        if (entry.prevHash !== prevHash) valid = false;
        const base = {
          schema: entry.schema,
          seq: entry.seq,
          ts: entry.ts,
          operator: entry.operator,
          action: entry.action,
          taskId: entry.taskId,
          target: entry.target,
          state: entry.state,
          error: entry.error,
          prevHash: entry.prevHash
        };
        const hash = crypto.createHash("sha256").update(JSON.stringify(base)).digest("hex");
        if (hash !== entry.hash) valid = false;
        prevHash = entry.hash;
      }
      json(res, 200, { ok: true, data: { valid, count: entries.length, firstSeq: entries.length ? entries[0].seq : null, lastSeq: entries.length ? entries[entries.length - 1].seq : null } });
      return;
    }
    if (pathname === "/stream") {
      json(res, 200, { ok: true, data: { events: [], nextSeq: 0, reset: false } });
      return;
    }
    if (pathname === "/actions") {
      json(res, 200, { ok: true, data: actionList() });
      return;
    }
    m = pathname.match(/^\/tasks\/([^/]+)$/);
    if (m) {
      const task = store.tasks[decodeURIComponent(m[1])];
      if (!task) { json(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "task not found" } }); return; }
      json(res, 200, { ok: true, data: task });
      return;
    }
    json(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "unknown endpoint" } });
    return;
  }
  if (req.method === "POST") {
    let body;
    try { body = await readBody(req); } catch (e) { json(res, 400, { ok: false, error: { code: "VALIDATION", message: e.message } }); return; }
    if (pathname === "/accounts") {
      const owner = (store.users || [])[0];
      if (!owner || !session || session.username !== owner.username || !hasPermission("accounts.manage")) {
        json(res, 403, { ok: false, error: { code: "FORBIDDEN", message: "只有初始管理员可以添加账号" } });
        return;
      }
      const username = String(body.username || "").trim();
      const password = String(body.password || "");
      const role = ["viewer", "operator", "admin"].includes(String(body.role || "viewer")) ? String(body.role || "viewer") : "viewer";
      if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) {
        json(res, 400, { ok: false, error: { code: "VALIDATION", message: "用户名 3-32 位，仅字母数字 _ . -" } });
        return;
      }
      if (password.length < 10) {
        json(res, 400, { ok: false, error: { code: "VALIDATION", message: "密码至少 10 位" } });
        return;
      }
      if ((store.users || []).some((u) => u.username === username)) {
        json(res, 409, { ok: false, error: { code: "CONFLICT", message: "账号已存在" } });
        return;
      }
      const salt = crypto.randomBytes(16).toString("hex");
      const user = normalizeUser({ username: username, salt: salt, iterations: PBKDF2_ITERATIONS, hash: hashPassword(password, salt, PBKDF2_ITERATIONS), role: role });
      store.users.push(user); save();
      json(res, 200, { ok: true, data: publicUser(user) });
      return;
    }
    if (pathname === "/commands") {
      if (!hasPermission("command.execute")) { deny("command.execute"); return; }
      if (!body.command) { json(res, 400, { ok: false, error: { code: "VALIDATION", message: "command required" } }); return; }
      const task = createTask("command.execute", { command: String(body.command), serverId: store.server.serverId }, "web");
      json(res, 200, { ok: true, data: { taskId: task.taskId, state: task.state } });
      return;
    }
    const m = pathname.match(/^\/actions\/([^/]+)$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      const action = actionList().find((a) => a.id === id);
      if (!action) {
        json(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "unknown action" } });
        return;
      }
      if (!hasPermission(action.permission)) { deny(action.permission); return; }
      const task = createTask(id, Object.assign({}, body, { serverId: store.server.serverId }), "web");
      json(res, 200, { ok: true, data: { taskId: task.taskId, state: task.state } });
      return;
    }
    json(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "unknown endpoint" } });
    return;
  }
  json(res, 405, { ok: false, error: { code: "METHOD", message: "method not allowed" } });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.includes("..") || pathname.includes("\\")) {
    res.writeHead(400); res.end("bad path"); return;
  }

  if (pathname === "/setup") {
    if (!setupRequired()) {
      res.writeHead(302, { Location: "/login" }); res.end(); return;
    }
    return sendFile(res, path.join(PUBLIC, "setup.html"), "no-cache");
  }
  if (pathname === "/login") {
    if (sessionUser(req)) {
      res.writeHead(302, { Location: "/" }); res.end(); return;
    }
    if (setupRequired()) {
      res.writeHead(302, { Location: "/setup" }); res.end(); return;
    }
    return sendAppIndex(res, req, true);
  }
  if (pathname === "/" || pathname === "" || pathname === "/index.html") {
    return sendAppIndex(res, req);
  }

  const file = path.join(PUBLIC, pathname);
  if (!file.startsWith(PUBLIC)) { res.writeHead(400); res.end("bad path"); return; }
  return sendFile(res, file, pathname === "/index.html" ? "no-cache" : "public, max-age=3600");
}

function sendFile(res, file, cache) {
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("not found");
      return;
    }
    const type = MIME[path.extname(file)] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": cache,
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer"
    });
    res.end(data);
  });
}

function sendAppIndex(res, req, loginMode) {
  if (!loginMode && !sessionUser(req)) {
    res.writeHead(302, { Location: "/login" });
    res.end();
    return;
  }
  fs.readFile(path.join(PUBLIC, "index.html"), (err, data) => {
    if (err) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("index missing");
      return;
    }
    const script = "<script>window.WB_COOKIE_AUTH = true; window.WB_STANDALONE = true;" +
      " window.WB_AUTHED = " + (loginMode ? "false" : "true") + ";" +
      " window.WB_SETUP_REQUIRED = " + (loginMode ? "false" : "false") + ";</script>";
    const html = data.toString("utf8").replace(
      /<script src="(?:\/)?app\.js[^"]*"><\/script>/,
      script + "$&"
    );
    res.writeHead(200, { "Content-Type": MIME[".html"], "Cache-Control": "no-cache" });
    res.end(html);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));
  try {
    if (url.pathname === "/health") {
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    });
    res.end(JSON.stringify({ ok: true, service: "webbundle-web", time: now() }));
    return;
  }
  if (url.pathname.startsWith("/push/v1/")) {
      await handlePush(req, res, url);
      return;
    }
    if (url.pathname.startsWith("/api/setup") || url.pathname.startsWith("/api/login") || url.pathname.startsWith("/api/logout") || url.pathname.startsWith("/api/v1/auth/")) {
      await handleAuth(req, res, url);
      return;
    }
    if (url.pathname.startsWith("/api/v1/")) {
      await handleApi(req, res, url);
      return;
    }
    serveStatic(req, res, url);
  } catch (e) {
    console.error("[webbundle-web] request error:", e);
    if (!res.headersSent) json(res, 500, { ok: false, error: { code: "INTERNAL", message: String(e.message || e) } });
    else res.end();
  }
});

const [host, portText] = String(config.listen).split(":");
const port = Number(portText || 8080);
server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.error(`[webbundle-web] 端口 ${port} 已被占用；请关闭占用进程或修改 config.json 的 listen。`);
  } else {
    console.error("[webbundle-web] 启动失败:", err);
  }
  process.exit(1);
});
server.listen(port, host || "0.0.0.0", () => {
  console.log(`[webbundle-web] listening http://${host || "0.0.0.0"}:${port}`);
  console.log(`[webbundle-web] data: ${dataFile}`);
});
