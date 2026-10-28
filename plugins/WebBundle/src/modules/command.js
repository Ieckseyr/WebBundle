// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 WebBundle contributors

export const commandModule = {
    id: "command",
    name: "网页指令",
    version: "1.2.0",
    setup(ctx) {
        function execute(payload) {
            const cmd = String((payload && payload.command) || "").trim();
            if (!cmd) throw new Error("命令为空");
            if (cmd.length > 512) throw new Error("命令过长");
            if (/[\r\n\0;]/.test(cmd)) throw new Error("命令包含非法字符");
            const words = cmd.replace(/^\//, "").split(/\s+/).filter(Boolean).map((word) => word.toLowerCase());
            const first = words[0] || "";
            const deny = new Set(((ctx.config.command && ctx.config.command.deny) || []).map((word) => String(word).toLowerCase()));
            if (deny.has(first)) throw new Error("命令被禁止: " + first);

            const wrappers = new Set(["execute", "function", "schedule"]);
            if (wrappers.has(first) && (!payload || payload.confirm !== true)) {
                throw new Error("危险指令需要二次确认: " + first);
            }
            const runIndex = words.indexOf("run");
            const targets = runIndex >= 0 ? words.slice(runIndex + 1) : words;
            for (const word of targets) {
                if (deny.has(word)) throw new Error("命令被禁止: " + word);
            }

            const res = mc.runcmdEx(cmd);
            return {
                success: !!(res && res.success),
                output: res && res.output ? String(res.output).substring(0, 4096) : ""
            };
        }
        return { execute: execute };
    }
};
