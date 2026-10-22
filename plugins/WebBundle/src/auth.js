// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 WebBundle contributors

// 密码 KDF 在浏览器 WebCrypto 中完成；服务端只保存 verifier 的 SHA-256。
// 这样 qjs 不需要做 PBKDF2，也不会保存或接收明文密码。
function validUsername(name) {
    return /^[A-Za-z0-9_.-]{3,32}$/.test(String(name || ""));
}

export { validUsername };
