#pragma once
#include <cstdint>
#include <deque>
#include <filesystem>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

class BedrockLevelReader {
public:
    struct ChunkSurface {
        std::string block[256];           // 短方块名（无 minecraft: 前缀），空串=无方块/air
        int16_t     height[256]     = {}; // 表面方块 y，INT16_MIN=无方块（构造时填哨兵）
        uint16_t    waterDepth[256] = {}; // 上方水层数

        ChunkSurface() {
            for (int i = 0; i < 256; i++) {
                height[i]     = INT16_MIN;
                waterDepth[i] = 0;
            }
        }
    };

    explicit BedrockLevelReader(std::filesystem::path dbPath);
    ~BedrockLevelReader();

    bool open();
    void close();
    bool isOpen() const { return mOpened; }

    ChunkSurface scanChunkSurface(int cx, int cz, int dim);

    std::string getBlockName(int cx, int cz, int dim, int lx, int lz, int y);

    struct WorldBounds {
        int    minCX = 0, maxCX = 0, minCZ = 0, maxCZ = 0;
        size_t chunkCount = 0; // 该维度 subchunk key 数量
        bool   valid      = false;
    };
    WorldBounds scanWorldBounds(int dim);

    std::vector<std::pair<int32_t, int32_t>> listChunks(int dim);

    size_t indexSize() const { return mIndex.size(); }
    bool   overworldKeyHasDim() const { return mOverworldKeyHasDim; }
    std::string diagInfo() const;

private:
    static constexpr size_t MAX_KEY_LEN = 14;
    static constexpr size_t KEY_SUFFIX_LEN = 8;

    struct KeyEntry {
        uint8_t  key[MAX_KEY_LEN] = {0}; // 标准 key（已剥离后缀）
        uint8_t  keyLen           = 0;
        uint8_t  _pad             = 0;
        uint32_t blockIdx         = 0; // mBlocks 下标
    };
    struct BlockEntry {
        int32_t  fileIdx     = -1;
        uint32_t dataSize    = 0;
        uint64_t blockOffset = 0;
    };
    static int keyCompare(const KeyEntry& e, const uint8_t* k, size_t klen);

    struct LdbFile {
        void*    handle   = nullptr; // HANDLE (win32)
        uint64_t fileSize = 0;
        mutable std::mutex ioMutex;

        LdbFile() = default;
        LdbFile(LdbFile&& other) noexcept : handle(other.handle), fileSize(other.fileSize) {
            other.handle   = nullptr;
            other.fileSize = 0;
        }
        LdbFile& operator=(LdbFile&& other) noexcept {
            if (this != &other) {
                handle         = other.handle;
                fileSize       = other.fileSize;
                other.handle   = nullptr;
                other.fileSize = 0;
            }
            return *this;
        }
        LdbFile(LdbFile const&)            = delete;
        LdbFile& operator=(LdbFile const&) = delete;
    };

    std::unordered_map<uint32_t, std::shared_ptr<const std::vector<uint8_t>>> mBlockCache;
    std::deque<uint32_t>                                                      mBlockCacheOrder;
    std::mutex                                                                mBlockCacheMutex;
    static constexpr size_t                                                   MAX_BLOCK_CACHE = 16384;

    struct ScanResult {
        std::vector<KeyEntry>   keys;
        std::vector<BlockEntry> blocks;
        uint64_t                blocksRead     = 0;
        uint64_t                decompFail     = 0;
        uint64_t                typeHist[8]    = {0};
        uint64_t                subchunkNewFmt = 0; // 带后缀的新格式 subchunk key 数
        uint64_t                subchunkOldFmt = 0; // 老格式 subchunk key 数
    };
    bool scanFile(int fileIdx, const std::wstring& path, void* fileHandle, uint64_t fileSize, ScanResult& out);

    std::shared_ptr<const std::vector<uint8_t>> loadBlock(uint32_t blockIdx);
    bool findInBlock(const uint8_t* data, size_t size, const uint8_t* key, size_t keyLen, std::string& outValue);
    bool findInBlockPtr(
        const uint8_t*  data,
        size_t          size,
        const uint8_t*  key,
        size_t          keyLen,
        const uint8_t*& outPtr,
        size_t&         outLen
    );

    bool getSubchunkValue(const uint8_t* key, size_t keyLen, std::string& outValue);

    template <typename Fn>
    bool collectChunkSubchunks(int cx, int cz, int dim, Fn&& fn);

    static bool readFullyAt(void* handle, uint64_t offset, void* buf, size_t n);

    template <typename Fn>
    static bool forEachEntryInBlock(const uint8_t* data, size_t size, Fn&& fn);

    void buildSubchunkKey(uint8_t* out, uint8_t& outLen, int cx, int cz, int dim, int8_t subchunkIndex) const;

    struct SubchunkData {
        std::vector<std::string> palette;       // layer 0 方块名（短名）
        std::vector<uint16_t>    blockIndices;  // 4096 个，YZX 顺序
        std::vector<std::string> liquidPalette; // layer 1 液体名（若有）
        std::vector<uint16_t>    liquidIndices;
        bool                     valid = false;
    };
    SubchunkData parseSubchunk(const std::string& value);
    SubchunkData parseSubchunk(const uint8_t* data, size_t size);

    struct NBTReader {
        const uint8_t* data = nullptr;
        size_t         size = 0;
        size_t         pos  = 0;

        bool readByte(int8_t& v);
        bool readShort(int16_t& v);
        bool readInt(int32_t& v);
        bool readString(std::string& s); // 2字节LE长度 + UTF8
        bool skipTag(uint8_t type);
        bool readRootCompound(std::string& outName);
    };

    struct PaletteStorage {
        std::vector<uint32_t>    words;
        int                      bitsPerIndex  = 0;
        int                      blocksPerWord = 0;
        int                      wordCount     = 0;
        std::vector<std::string> palette; // 方块名（短名，已 strip minecraft:）
    };
    bool            parsePaletteStorage(const uint8_t* data, size_t size, size_t& offset, PaletteStorage& out);
    static uint32_t getPaletteIndex(const PaletteStorage& ps, int x, int y, int z);

    std::unordered_map<std::string, std::shared_ptr<SubchunkData>> mSubchunkCache;
    std::mutex                                                     mSubchunkCacheMutex;
    static constexpr size_t                                        MAX_SUBCHUNK_CACHE = 2048;

    std::filesystem::path   mDbPath;
    bool                    mOpened = false;
    std::vector<KeyEntry>   mIndex;  // open() 后只读（已排序去重）
    std::vector<BlockEntry> mBlocks; // open() 后只读
    std::vector<LdbFile>    mFiles;  // open() 后只读（主句柄）
    bool mOverworldKeyHasDim = false;

    struct ScanStats {
        uint64_t filesTotal     = 0;   // .ldb 文件总数
        uint64_t filesParsed    = 0;   // footer/index 解析成功的文件数
        uint64_t blocksRead     = 0;   // 处理的 data block 总数
        uint64_t decompFail     = 0;   // 解压失败次数
        uint64_t typeHist[8]    = {0}; // 块压缩类型计数 0..7
        uint64_t keyLenHist[40] = {0}; // 剥离前 key 长度直方图（>=39 归入 39）
        uint64_t subchunkNewFmt = 0;   // 带后缀的新格式 subchunk key 数
        uint64_t subchunkOldFmt = 0;   // 老格式 subchunk key 数
    };
    ScanStats mStats;
};
