#pragma once
#include <optional>
#include <string>
#include <string_view>

namespace adapters::fs {

struct WriteResult {
    bool               ok = false;
    std::string        error; // 空 = 成功
    [[nodiscard]] bool succeeded() const noexcept { return ok; }
};

WriteResult writeFileAtomic(std::string const& path, std::string_view bytes);

WriteResult writeTextAtomic(std::string const& path, std::string const& text);

std::optional<std::string> readFile(std::string const& path);

bool ensureDir(std::string const& dir);

} // namespace adapters::fs
