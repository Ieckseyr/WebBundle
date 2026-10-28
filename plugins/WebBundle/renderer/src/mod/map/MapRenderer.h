#pragma once
#include <atomic>
#include <cstdint>
#include <filesystem>
#include <functional>
#include <map>
#include <string>
#include <tuple>
#include <unordered_map>
#include <vector>

class MapRenderer {
public:
    struct ChunkSurface {
        std::string block[256];           // 短方块名（无 minecraft: 前缀），空串=无方块
        int16_t     height[256]     = {}; // 表面方块 y，INT16_MIN=无方块（构造时填哨兵）
        uint16_t    waterDepth[256] = {}; // 上方水层数

        ChunkSurface() {
            for (int i = 0; i < 256; i++) {
                height[i]     = INT16_MIN;
                waterDepth[i] = 0;
            }
        }
    };

    using ScanChunkFunc    = std::function<ChunkSurface(int cx, int cz, int dim)>;
    using ProgressCallback = std::function<void(int pct, const std::string& label)>;
    using LogCallback      = std::function<void(const std::string&)>;

    explicit MapRenderer(std::filesystem::path outputDir) : mOutputDir(std::move(outputDir)) {}

    void setLogCallback(LogCallback cb) { mLogCallback = std::move(cb); }
    void setScanChunkFunc(ScanChunkFunc fn) { mScanChunk = std::move(fn); }

    void setRenderThreads(int n) { mRenderThreads = n; }
    void setRenderSpeed(int s) { mRenderSpeed = s; }

    void setExistingChunks(std::shared_ptr<const std::vector<std::pair<int32_t, int32_t>>> chunks) {
        mExistingChunks = std::move(chunks);
    }

    void
    render(int dim, int centerX, int centerZ, int radiusChunks, std::atomic<bool>& stop, ProgressCallback progress);

    void renderRegions(
        int                                     dim,
        const std::vector<std::pair<int, int>>& regions,
        std::atomic<bool>&                      stop,
        ProgressCallback                        progress = nullptr
    );

    bool hasTiles(int dim) const;

    static uint32_t getBlockColor(const std::string& name);

    static constexpr int TILE          = 256; // 与前端 Leaflet tileSize 一致
    static constexpr int CHUNK         = 16;
    static constexpr int REGION_CHUNKS = 16; // TILE / CHUNK，一个 tile 含 16x16 chunks = 256x256 blocks
    static constexpr int MAX_ZOOM = 14;

private:
    struct Region {
        std::vector<uint32_t> color;  // TILE*TILE，ARGB（最高字节为 R）
        std::vector<int32_t>  height; // TILE*TILE，INT32_MIN=无
        bool                  dirty = true;

        Region() : color(TILE * TILE, 0u), height(TILE * TILE, INT32_MIN), dirty(true) {}
    };

    static const char* dimId(int dim);
    static const char* dimName(int dim);

    static uint32_t lookupColor(const std::string& shortName);
    static uint32_t dyeFallback(const std::string& shortName);
    static uint32_t heuristicColor(const std::string& shortName);

    void applyChunkToRegion(int cx, int cz, const ChunkSurface& sfc, std::unordered_map<int64_t, Region>& regions);
    void applyChunkToRegion(int cx, int cz, const ChunkSurface& sfc, Region& region);
    bool shadeAndWriteRegion(int dim, int rx, int rz, const Region& region);
    bool buildZoomLevel(
        int                                                dim,
        int                                                z,
        const std::vector<std::tuple<int, int, uint64_t>>& childTiles,
        std::vector<std::tuple<int, int, uint64_t>>&       outParentTiles,
        std::atomic<bool>&                                 stop
    );
    bool writePNG(const std::filesystem::path& path, const uint8_t* rgba, int w, int h);

    void regionToRGBA(const Region& region, std::vector<uint8_t>& rgba) const;
    void downsampleInto(const std::vector<uint8_t>& childRGBA, std::vector<uint8_t>& parentRGBA, int bx, int bz) const;
    static bool decodeTilePNG(const std::filesystem::path& path, std::vector<uint8_t>& rgba);
    bool        writeDimManifest(
        int                                                              dim,
        const std::map<std::tuple<int, int, int>, std::vector<uint8_t>>& tileCache,
        size_t                                                           chunkCount
    );

    std::filesystem::path tileFilePath(int dim, int zoom, int tx, int tz) const;
    static int64_t        regionKey(int rx, int rz) { return ((int64_t)rx << 32) | (uint32_t)rz; }

    std::filesystem::path mOutputDir;
    LogCallback           mLogCallback;
    ScanChunkFunc         mScanChunk;
    int mRenderThreads = 0; // 0 = 自动
    int mRenderSpeed   = 2; // 1=慢速 2=标准 3=全速
    std::shared_ptr<const std::vector<std::pair<int32_t, int32_t>>> mExistingChunks;
};
