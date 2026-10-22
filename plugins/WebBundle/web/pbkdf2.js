// SPDX-License-Identifier: GPL-3.0-or-later
// Pure-JS PBKDF2-HMAC-SHA256 fallback for browsers without WebCrypto
// (for example plain HTTP on a non-secure origin).
(function (global) {
  "use strict";

  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function utf8Bytes(text) {
    text = String(text);
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text);
    var out = [];
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c >= 0xd800 && c < 0xdc00 && i + 1 < text.length) {
        var d = text.charCodeAt(++i);
        var cp = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(out);
  }

  function hexToBytes(hex) {
    var out = new Uint8Array(hex.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }

  function bytesToHex(bytes) {
    var out = "";
    for (var i = 0; i < bytes.length; i++) out += ("0" + bytes[i].toString(16)).slice(-2);
    return out;
  }

  function sha256(bytes) {
    var h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    var length = bytes.length;
    var total = ((length + 9 + 63) >> 6) << 6;
    var data = new Uint8Array(total);
    data.set(bytes);
    data[length] = 0x80;
    var view = new DataView(data.buffer);
    view.setUint32(total - 8, Math.floor(length / 0x20000000), false);
    view.setUint32(total - 4, (length << 3) >>> 0, false);
    var w = new Uint32Array(64);
    for (var off = 0; off < total; off += 64) {
      for (var i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
      for (i = 16; i < 64; i++) {
        var x = w[i - 15], y = w[i - 2];
        var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
        var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (i = 0; i < 64; i++) {
        var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        var ch = (e & f) ^ (~e & g);
        var t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
        var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) >>> 0;
        hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
      h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
    }
    var out = new Uint8Array(32);
    var outView = new DataView(out.buffer);
    for (var j = 0; j < 8; j++) outView.setUint32(j * 4, h[j], false);
    return out;
  }

  function createHmac(keyBytes) {
    var key = keyBytes;
    if (key.length > 64) key = sha256(key);
    var ipad = new Uint8Array(64), opad = new Uint8Array(64);
    for (var i = 0; i < 64; i++) {
      var b = key[i] || 0;
      ipad[i] = b ^ 0x36;
      opad[i] = b ^ 0x5c;
    }
    return function (message) {
      var inner = new Uint8Array(64 + message.length);
      inner.set(ipad); inner.set(message, 64);
      var innerHash = sha256(inner);
      var outer = new Uint8Array(64 + 32);
      outer.set(opad); outer.set(innerHash, 64);
      return sha256(outer);
    };
  }

  function startDerive(password, saltHex, iterations) {
    var count = Math.max(1, Number(iterations || 210000));
    var salt = hexToBytes(String(saltHex || ""));
    var hmac = createHmac(utf8Bytes(password));
    var first = new Uint8Array(salt.length + 4);
    first.set(salt);
    first[salt.length + 3] = 1;
    var u = hmac(first);
    var t = new Uint8Array(u);
    return { count: count, hmac: hmac, t: t, u: u, i: 1 };
  }

  function deriveHex(password, saltHex, iterations) {
    var st = startDerive(password, saltHex, iterations);
    for (; st.i < st.count; st.i++) {
      st.u = st.hmac(st.u);
      for (var j = 0; j < 32; j++) st.t[j] ^= st.u[j];
    }
    return bytesToHex(st.t);
  }

  async function deriveHexAsync(password, saltHex, iterations, onProgress) {
    var st = startDerive(password, saltHex, iterations);
    while (st.i < st.count) {
      var end = Math.min(st.count, st.i + 5000);
      for (; st.i < end; st.i++) {
        st.u = st.hmac(st.u);
        for (var j = 0; j < 32; j++) st.t[j] ^= st.u[j];
      }
      if (typeof onProgress === "function") onProgress(st.i / st.count);
      if (st.i < st.count) await new Promise(function (resolve) { setTimeout(resolve, 0); });
    }
    return bytesToHex(st.t);
  }

  global.WBPBKDF2 = {
    deriveHex: deriveHex,
    deriveHexAsync: deriveHexAsync,
    utf8Bytes: utf8Bytes,
    sha256: sha256
  };
})(typeof window !== "undefined" ? window : globalThis);
