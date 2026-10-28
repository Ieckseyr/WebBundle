#include "adapters/fs/AtomicFile.h"
#include "mod/map/BedrockLevelReader.h"
#include "mod/map/MapRenderer.h"

#include <atomic>
#include <algorithm>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <memory>
#include <optional>
#include <string_view>
#include <string>
#include <vector>

namespace fs = std::filesystem;

namespace adapters::fs {
WriteResult writeFileAtomic(std::string const& path, std::string_view bytes) {
    try {
        std::filesystem::path p(path);
        if (p.has_parent_path()) std::filesystem::create_directories(p.parent_path());
        std::ofstream out(path, std::ios::binary | std::ios::trunc);
        if (!out) return { false, "open failed" };
        out.write(bytes.data(), (std::streamsize)bytes.size());
        return { out.good(), out.good() ? "" : "write failed" };
    } catch (const std::exception& e) { return { false, e.what() }; }
}
WriteResult writeTextAtomic(std::string const& path, std::string const& text) { return writeFileAtomic(path, text); }
std::optional<std::string> readFile(std::string const& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) return std::nullopt;
    return std::string((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
}
bool ensureDir(std::string const& dir) {
    std::error_code ec; std::filesystem::create_directories(dir, ec); return !ec;
}
}

static std::string argValue(int argc, char** argv, const std::string& key, const std::string& fallback = "") {
    for (int i = 1; i + 1 < argc; i++) {
        if (key == argv[i]) return argv[i + 1];
    }
    return fallback;
}

int main(int argc, char** argv) {
    const std::string db = argValue(argc, argv, "--db");
    const std::string out = argValue(argc, argv, "--output");
    const std::string dimArg = argValue(argc, argv, "--dim", "0,1,2");
    const int threads = std::stoi(argValue(argc, argv, "--threads", "0"));
    const int speed = std::stoi(argValue(argc, argv, "--speed", "2"));
    if (db.empty() || out.empty()) {
        std::cerr << "usage: WebBundleMapRenderer --db <world/db> --output <dir> [--dim 0,1,2] [--threads 0] [--speed 2]\n";
        return 2;
    }

    BedrockLevelReader reader(db);
    if (!reader.open()) {
        std::cerr << "failed to open bedrock leveldb: " << db << "\n";
        return 3;
    }
    std::cout << "leveldb index=" << reader.indexSize() << "\n";

    std::vector<int> dims;
    size_t start = 0;
    while (start < dimArg.size()) {
        size_t comma = dimArg.find(',', start);
        std::string part = dimArg.substr(start, comma == std::string::npos ? std::string::npos : comma - start);
        if (!part.empty()) dims.push_back(std::stoi(part));
        if (comma == std::string::npos) break;
        start = comma + 1;
    }

    fs::create_directories(out);
    std::atomic<bool> stop{false};
    for (int dim : dims) {
        auto bounds = reader.scanWorldBounds(dim);
        if (!bounds.valid || bounds.chunkCount == 0) {
            std::cout << "skip dim " << dim << ": no chunks\n";
            continue;
        }
        auto chunks = std::make_shared<const std::vector<std::pair<int32_t, int32_t>>>(reader.listChunks(dim));
        if (chunks->empty()) {
            std::cout << "skip dim " << dim << ": empty chunk list\n";
            continue;
        }
        int centerCX = (bounds.minCX + bounds.maxCX) / 2;
        int centerCZ = (bounds.minCZ + bounds.maxCZ) / 2;
        int radius = std::max(bounds.maxCX - bounds.minCX, bounds.maxCZ - bounds.minCZ) / 2 + 2;
        MapRenderer renderer(out);
        renderer.setLogCallback([](const std::string& msg) { std::cout << msg << "\n"; });
        renderer.setRenderThreads(threads);
        renderer.setRenderSpeed(speed);
        renderer.setExistingChunks(chunks);
        renderer.setScanChunkFunc([&reader](int cx, int cz, int d) -> MapRenderer::ChunkSurface {
            auto raw = reader.scanChunkSurface(cx, cz, d);
            MapRenderer::ChunkSurface out;
            for (int i = 0; i < 256; i++) {
                out.block[i] = raw.block[i];
                out.height[i] = raw.height[i];
                out.waterDepth[i] = raw.waterDepth[i];
            }
            return out;
        });
        std::cout << "render dim " << dim << " center=" << centerCX * 16 << "," << centerCZ * 16 << " radius=" << radius << " chunks=" << chunks->size() << "\n";
        renderer.render(dim, centerCX * 16, centerCZ * 16, radius, stop, nullptr);
        if (dim == 2) {
            std::error_code ec;
            auto endDir = fs::path(out) / "tiles" / "end";
            auto theEndDir = fs::path(out) / "tiles" / "the_end";
            if (fs::exists(endDir)) {
                fs::remove_all(theEndDir, ec);
                fs::rename(endDir, theEndDir, ec);
                if (ec) std::cerr << "rename end -> the_end failed: " << ec.message() << "\n";
            }
        }
    }
    reader.close();

    std::ofstream meta(fs::path(out) / "render-meta.json");
    meta << "{\n  \"renderedAt\": " << std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count() << ",\n  \"db\": \"" << db << "\"\n}\n";
    std::cout << "render complete\n";
    return 0;
}
