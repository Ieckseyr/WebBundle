// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 WebBundle contributors

function validUsername(name) {
    return /^[A-Za-z0-9_.-]{3,32}$/.test(String(name || ""));
}

export { validUsername };
