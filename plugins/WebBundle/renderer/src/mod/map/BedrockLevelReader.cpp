#include "mod/map/BedrockLevelReader.h"
#include <cstring>
#include <sstream>
#include <algorithm>
#include <climits>
#include <chrono>
#include <thread>
#include <atomic>

#include <zlib.h>

#include <zstd.h>

#ifdef _WIN32
    #ifndef NOMINMAX
        #define NOMINMAX
    #endif
    #include <windows.h>
#endif

static constexpr uint64_t kTableMagic = 0xdb4775248b80fb57ULL;

namespace {

inline bool getVarint(const uint8_t*& p, const uint8_t* end, uint64_t& out) {
    uint64_t result = 0;
    for (int shift = 0; shift <= 63 && p < end; shift += 7) {
        uint64_t b = *p++;
        result |= (b & 0x7F) << shift;
        if (!(b & 0x80)) { out = result; return true; }
    }
    return false;
}

inline uint32_t rdLE32(const uint8_t* p) {
    return (uint32_t)(p[0] | (p[1] << 8) | (p[2] << 16) | ((uint32_t)p[3] << 24));
}

inline uint64_t rdLE64(const uint8_t* p) {
    uint64_t v = 0;
    for (int i = 7; i >= 0; i--) v = (v << 8) | p[i];
    return v;
}

bool decompressBlock(const uint8_t* data, size_t n, uint8_t type,
                     std::vector<uint8_t>& out) {
    if (type == 0) {
        out.assign(data, data + n);
        return true;
    }
    if (type == 2 || type == 3 || type == 4) {
        z_stream zs{};
        int windowBits = (type == 2) ? 15 : -15;  // zlib 带头 / raw deflate
        if (inflateInit2(&zs, windowBits) != Z_OK) return false;

        out.resize(n * 4 + 64);
        zs.next_in  = (Bytef*)data;
        zs.avail_in = (uInt)n;

        size_t pos = 0;
        bool ok = false;
        while (true) {
            if (pos == out.size()) out.resize(out.size() * 2);
            zs.next_out  = out.data() + pos;
            zs.avail_out = (uInt)(out.size() - pos);
            int ret = inflate(&zs, Z_NO_FLUSH);
            pos = out.size() - zs.avail_out;
            if (ret == Z_STREAM_END) { ok = true; break; }
            if (ret != Z_OK) break;
            if (zs.avail_in == 0 && zs.avail_out != 0) break;  // 输入耗尽但流未结束 = 数据损坏
        }
        inflateEnd(&zs);
        if (!ok) return false;
        out.resize(pos);
        return true;
    }
    if (type == 5) {
        ZSTD_DStream* ds = ZSTD_createDStream();
        if (!ds) return false;
        ZSTD_initDStream(ds);
        ZSTD_inBuffer in{data, n, 0};
        out.resize(n * 4 + 64);
        ZSTD_outBuffer ob{out.data(), out.size(), 0};
        bool ok = false;
        while (true) {
            size_t ret = ZSTD_decompressStream(ds, &ob, &in);
            if (ZSTD_isError(ret)) break;
            if (ret == 0) { ok = true; break; }  // 帧解码完成
            if (ob.pos == ob.size) {             // 输出区满，扩容
                out.resize(out.size() * 2);
                ob.dst  = out.data();
                ob.size = out.size();
            } else if (in.pos == in.size) {
                break;  // 输入耗尽但帧未完成 = 数据损坏
            }
        }
        ZSTD_freeDStream(ds);
        if (!ok) return false;
        out.resize(ob.pos);
        return true;
    }
    return false;  // 1=snappy 等未支持类型
}

inline uint8_t subchunkStdKeyLen(const uint8_t* k, size_t len) {
    auto tagAt = [&](size_t off) { return len > off && k[off] == 0x2F; };
    if (len == 10 && tagAt(8)) return 10;                 // 老 主世界
    if (len == 14 && tagAt(12)) return 14;                // 老 带dim
    if (len == 18 && tagAt(8)) return 10;                 // 新 主世界（+8B后缀）
    if (len == 22 && tagAt(12)) return 14;                // 新 带dim（+8B后缀）
    return 0;
}

} // namespace

BedrockLevelReader::BedrockLevelReader(std::filesystem::path dbPath)
    : mDbPath(std::move(dbPath)) {}

BedrockLevelReader::~BedrockLevelReader() {
    close();
}

static void* openLdbFile(const std::wstring& path) {
#ifdef _WIN32
    HANDLE h = CreateFileW(path.c_str(), GENERIC_READ,
                           FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                           nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL | FILE_FLAG_SEQUENTIAL_SCAN,
                           nullptr);
    return (h == INVALID_HANDLE_VALUE) ? nullptr : (void*)h;
#else
    FILE* f = _wfopen(path.c_str(), L"rb");
    return f;
#endif
}

static void closeLdbFile(void* h) {
#ifdef _WIN32
    if (h) CloseHandle((HANDLE)h);
#else
    if (h) fclose((FILE*)h);
#endif
}

bool BedrockLevelReader::readFullyAt(void* handle, uint64_t offset, void* buf, size_t n) {
    if (!handle || n == 0) return n == 0;
#ifdef _WIN32
    LARGE_INTEGER li;
    li.QuadPart = (LONGLONG)offset;
    if (!SetFilePointerEx((HANDLE)handle, li, nullptr, FILE_BEGIN)) return false;
    size_t done = 0;
    auto* p = (uint8_t*)buf;
    while (done < n) {
        DWORD want = (DWORD)std::min<size_t>(n - done, 1u << 30);
        DWORD got = 0;
        if (!ReadFile((HANDLE)handle, p + done, want, &got, nullptr) || got == 0) return false;
        done += got;
    }
    return true;
#else
    return fseeko((FILE*)handle, (off_t)offset, SEEK_SET) == 0
        && fread(buf, 1, n, (FILE*)handle) == n;
#endif
}

template <typename Fn>
bool BedrockLevelReader::forEachEntryInBlock(const uint8_t* data, size_t size, Fn&& fn) {
    if (size < 4) return false;
    uint32_t numRestarts = rdLE32(data + size - 4);
    if (numRestarts == 0 || (size_t)numRestarts > (size - 4) / 4) return false;
    const uint8_t* limit = data + size - 4 - (size_t)numRestarts * 4;

    const uint8_t* p = data;
    std::string lastKey;
    std::string keyBuf;
    while (p < limit) {
        uint64_t shared = 0, nonShared = 0, valLen = 0;
        if (!getVarint(p, limit, shared)) return false;
        if (!getVarint(p, limit, nonShared)) return false;
        if (!getVarint(p, limit, valLen)) return false;
        if (shared > lastKey.size()) return false;
        if (p + nonShared + valLen > limit) return false;

        keyBuf.resize((size_t)(shared + nonShared));
        if (shared) memcpy(keyBuf.data(), lastKey.data(), (size_t)shared);
        if (nonShared) memcpy(keyBuf.data() + shared, p, (size_t)nonShared);
        p += nonShared;

        const uint8_t* valPtr = p;
        p += valLen;

        fn(keyBuf, valPtr, (size_t)valLen);
        lastKey = keyBuf;
    }
    return true;
}

bool BedrockLevelReader::findInBlock(const uint8_t* data, size_t size,
                                      const uint8_t* key, size_t keyLen,
                                      std::string& outValue) {
    if (size < 4) return false;
    uint32_t numRestarts = rdLE32(data + size - 4);
    if (numRestarts == 0 || (size_t)numRestarts > (size - 4) / 4) return false;
    const uint8_t* limit = data + size - 4 - (size_t)numRestarts * 4;

    const uint8_t* p = data;
    std::string lastKey;
    std::string keyBuf;
    bool found = false;
    while (p < limit) {
        uint64_t shared = 0, nonShared = 0, valLen = 0;
        if (!getVarint(p, limit, shared)) return false;
        if (!getVarint(p, limit, nonShared)) return false;
        if (!getVarint(p, limit, valLen)) return false;
        if (shared > lastKey.size()) return false;
        if (p + nonShared + valLen > limit) return false;

        keyBuf.resize((size_t)(shared + nonShared));
        if (shared) memcpy(keyBuf.data(), lastKey.data(), (size_t)shared);
        if (nonShared) memcpy(keyBuf.data() + shared, p, (size_t)nonShared);
        p += nonShared;
        const uint8_t* valPtr = p;
        p += valLen;

        int c = memcmp(keyBuf.data(), key, std::min(keyBuf.size(), keyLen));
        if (c < 0 || (c == 0 && keyBuf.size() < keyLen)) {
            lastKey = keyBuf;
            continue;
        }
        if (c > 0) {
            break;
        }
        outValue.assign((const char*)valPtr, (size_t)valLen);
        found = true;
        lastKey = keyBuf;
    }
    return found;
}

bool BedrockLevelReader::findInBlockPtr(const uint8_t* data, size_t size,
                                        const uint8_t* key, size_t keyLen,
                                        const uint8_t*& outPtr, size_t& outLen) {
    if (size < 4) return false;
    uint32_t numRestarts = rdLE32(data + size - 4);
    if (numRestarts == 0 || (size_t)numRestarts > (size - 4) / 4) return false;
    const uint8_t* limit = data + size - 4 - (size_t)numRestarts * 4;

    const uint8_t* p = data;
    std::string lastKey;
    std::string keyBuf;
    bool found = false;
    while (p < limit) {
        uint64_t shared = 0, nonShared = 0, valLen = 0;
        if (!getVarint(p, limit, shared)) return false;
        if (!getVarint(p, limit, nonShared)) return false;
        if (!getVarint(p, limit, valLen)) return false;
        if (shared > lastKey.size()) return false;
        if (p + nonShared + valLen > limit) return false;

        keyBuf.resize((size_t)(shared + nonShared));
        if (shared) memcpy(keyBuf.data(), lastKey.data(), (size_t)shared);
        if (nonShared) memcpy(keyBuf.data() + shared, p, (size_t)nonShared);
        p += nonShared;
        const uint8_t* valPtr = p;
        p += valLen;

        int c = memcmp(keyBuf.data(), key, std::min(keyBuf.size(), keyLen));
        if (c < 0 || (c == 0 && keyBuf.size() < keyLen)) {
            lastKey = keyBuf;
            continue;
        }
        if (c > 0) break;
        outPtr = valPtr;
        outLen = (size_t)valLen;
        found = true;
        lastKey = keyBuf;
    }
    return found;
}

template <typename Fn>
bool BedrockLevelReader::collectChunkSubchunks(int cx, int cz, int dim, Fn&& fn) {
    if (!mOpened || mIndex.empty()) return false;

    const bool useDim = (dim != 0) || mOverworldKeyHasDim;
    const size_t plen = useDim ? 12 : 8;
    uint8_t prefix[12];
    auto le32 = [&](int off, int32_t v) {
        prefix[off]     = (uint8_t)(v & 0xFF);
        prefix[off + 1] = (uint8_t)((v >> 8) & 0xFF);
        prefix[off + 2] = (uint8_t)((v >> 16) & 0xFF);
        prefix[off + 3] = (uint8_t)((v >> 24) & 0xFF);
    };
    le32(0, cx);
    le32(4, cz);
    if (useDim) le32(8, dim);

    size_t lo = 0, hi = mIndex.size();
    while (lo < hi) {
        size_t mid = (lo + hi) / 2;
        if (keyCompare(mIndex[mid], prefix, plen) < 0) lo = mid + 1;
        else hi = mid;
    }

    bool any = false;
    for (size_t i = lo; i < mIndex.size(); i++) {
        const KeyEntry& e = mIndex[i];
        size_t cmpLen = std::min<size_t>(e.keyLen, plen);
        int c = memcmp(e.key, prefix, cmpLen);
        if (c < 0) continue;              // 防御（二分保证不会出现）
        if (c > 0) break;                 // 字典序已越过本 chunk
        if (e.keyLen < plen) continue;    // 短于前缀的 key（如其他 tag 短 key），跳过
        uint8_t tag = e.key[plen];
        if (tag < 0x2F) continue;         // Data2D(0x2D/0x2E) 排在 subchunk 之前
        if (tag > 0x2F) break;            // version(0x36)/data(0x39) 等更大，subchunk 已列完
        if (e.keyLen < plen + 2) continue;// 只有 tag 无 subY，防御
        auto block = loadBlock(e.blockIdx);
        if (block) {
            const uint8_t* vPtr = nullptr;
            size_t vLen = 0;
            if (findInBlockPtr(block->data(), block->size(), e.key, e.keyLen, vPtr, vLen)) {
                fn((int8_t)e.key[plen + 1], vPtr, vLen);
                any = true;
            }
        }
    }
    return any;
}

void BedrockLevelReader::buildSubchunkKey(uint8_t* out, uint8_t& outLen,
                                          int cx, int cz, int dim, int8_t subchunkIndex) const {
    auto le32 = [&](int off, int32_t v) {
        out[off]     = (uint8_t)(v & 0xFF);
        out[off + 1] = (uint8_t)((v >> 8) & 0xFF);
        out[off + 2] = (uint8_t)((v >> 16) & 0xFF);
        out[off + 3] = (uint8_t)((v >> 24) & 0xFF);
    };
    le32(0, cx);
    le32(4, cz);
    uint8_t p = 8;
    if (dim != 0 || mOverworldKeyHasDim) { le32(8, dim); p = 12; }
    out[p++] = 0x2F;                 // SubChunkPrefix tag
    out[p++] = (uint8_t)subchunkIndex;
    outLen = p;
}

int BedrockLevelReader::keyCompare(const KeyEntry& e, const uint8_t* k, size_t klen) {
    size_t n = std::min<size_t>(e.keyLen, klen);
    int c = memcmp(e.key, k, n);
    if (c != 0) return c;
    return (int)e.keyLen - (int)klen;
}

bool BedrockLevelReader::open() {
    if (mOpened) return true;
    mIndex.clear();
    mBlocks.clear();
    mBlockCache.clear();
    mBlockCacheOrder.clear();
    mOverworldKeyHasDim = false;
    mStats = ScanStats{};

    namespace fs = std::filesystem;
    std::error_code ec;
    if (!fs::is_directory(mDbPath, ec)) return false;

    struct FileNum {
        uint64_t    num;
        std::wstring name;
    };
    std::vector<FileNum> files;
    for (auto& entry : fs::directory_iterator(mDbPath, ec)) {
        if (ec) break;
        if (!entry.is_regular_file()) continue;
        auto ext = entry.path().extension().wstring();
        for (auto& c : ext) c = (wchar_t)towlower(c);
        if (ext != L".ldb") continue;
        auto stem = entry.path().stem().wstring();
        if (stem.empty()) continue;
        try {
            uint64_t num = std::stoull(stem);
            files.push_back({num, entry.path().wstring()});
        } catch (...) {}
    }
    if (files.empty()) return false;
    std::sort(files.begin(), files.end(),
              [](const FileNum& a, const FileNum& b) { return a.num > b.num; });

    mFiles.resize(files.size());
    mStats.filesTotal = files.size();

    unsigned nThreads = std::thread::hardware_concurrency();
    if (nThreads == 0) nThreads = 2;
    if (nThreads > 6) nThreads = 6;   // BDS 与扫描同机，留出余量
    if (files.size() < nThreads) nThreads = (unsigned)files.size();

    std::vector<std::vector<ScanResult>> results(files.size()); // 每文件一个（可能为空）
    std::atomic<size_t> nextFile{0};
    std::atomic<uint64_t> filesParsed{0};

    auto worker = [&]() {
        while (true) {
            size_t fi = nextFile.fetch_add(1);
            if (fi >= files.size()) break;

            void* h = openLdbFile(files[fi].name);
            if (!h) continue;
            uint64_t fsize = 0;
#ifdef _WIN32
            LARGE_INTEGER sz{};
            if (GetFileSizeEx((HANDLE)h, &sz)) fsize = (uint64_t)sz.QuadPart;
#endif
            ScanResult r;
            if (fsize >= 48 && scanFile((int)fi, files[fi].name, h, fsize, r)) {
                results[fi].push_back(std::move(r));
                filesParsed++;
            }
            closeLdbFile(h);
        }
    };

    if (nThreads <= 1) {
        worker();
    } else {
        std::vector<std::thread> pool;
        pool.reserve(nThreads - 1);
        for (unsigned i = 0; i < nThreads - 1; i++) pool.emplace_back(worker);
        worker();
        for (auto& th : pool) th.join();
    }
    mStats.filesParsed = filesParsed.load();

    bool anyOk = false;
    for (size_t i = 0; i < files.size(); i++) {
        mFiles[i].handle = openLdbFile(files[i].name);
        mFiles[i].fileSize = 0;
        if (!mFiles[i].handle) continue;
#ifdef _WIN32
        LARGE_INTEGER sz{};
        if (GetFileSizeEx((HANDLE)mFiles[i].handle, &sz)) mFiles[i].fileSize = (uint64_t)sz.QuadPart;
#endif
        if (!results[i].empty()) anyOk = true;
    }
    if (!anyOk) {
        close();
        return false;
    }

    size_t totalKeys = 0, totalBlocks = 0;
    for (auto& perFile : results)
        for (auto& r : perFile) { totalKeys += r.keys.size(); totalBlocks += r.blocks.size(); }
    mIndex.reserve(totalKeys);
    mBlocks.reserve(totalBlocks);

    for (auto& perFile : results) {
        for (auto& r : perFile) {
            uint32_t base = (uint32_t)mBlocks.size();
            for (auto& b : r.blocks) mBlocks.push_back(b);
            for (auto& k : r.keys) {
                k.blockIdx += base;
                mIndex.push_back(k);
            }
            mStats.blocksRead += r.blocksRead;
            mStats.decompFail  += r.decompFail;
            mStats.subchunkNewFmt += r.subchunkNewFmt;
            mStats.subchunkOldFmt += r.subchunkOldFmt;
            for (int i = 0; i < 8; i++) mStats.typeHist[i] += r.typeHist[i];
        }
    }
    results.clear();

    std::sort(mIndex.begin(), mIndex.end(), [this](const KeyEntry& a, const KeyEntry& b) {
        int c = keyCompare(a, b.key, b.keyLen);
        if (c != 0) return c < 0;
        return mBlocks[a.blockIdx].fileIdx > mBlocks[b.blockIdx].fileIdx;
    });
    size_t w = 0;
    for (size_t i = 0; i < mIndex.size(); i++) {
        if (w == 0 || keyCompare(mIndex[w - 1], mIndex[i].key, mIndex[i].keyLen) != 0) {
            mIndex[w++] = mIndex[i];
        }
    }
    mIndex.resize(w);

    if (mIndex.empty()) {
        close();
        return false;
    }

    size_t n10 = 0, n14dim0 = 0;
    for (const auto& e : mIndex) {
        if (e.keyLen == 10) n10++;
        else if (e.keyLen == 14 && (int32_t)rdLE32(e.key + 8) == 0) n14dim0++;
    }
    mOverworldKeyHasDim = (n14dim0 > 0 && n14dim0 >= n10);

    mOpened = true;
    return true;
}

void BedrockLevelReader::close() {
    for (auto& f : mFiles) closeLdbFile(f.handle);
    mFiles.clear();
    mIndex.clear();
    mBlocks.clear();
    mBlockCache.clear();
    mBlockCacheOrder.clear();
    mSubchunkCache.clear();
    mOpened = false;
    mOverworldKeyHasDim = false;
}

std::string BedrockLevelReader::diagInfo() const {
    std::ostringstream oss;
    oss << "files=" << mStats.filesParsed << "/" << mStats.filesTotal
        << " blocks=" << mStats.blocksRead
        << " decompFail=" << mStats.decompFail
        << " subchunk=" << mIndex.size()
        << " (newFmt=" << mStats.subchunkNewFmt << " oldFmt=" << mStats.subchunkOldFmt << ")"
        << " typeHist[none/snappy/zlib/old/raw/zstd/6/7]=";
    for (int i = 0; i < 8; i++) oss << mStats.typeHist[i] << (i < 7 ? "/" : "");
    return oss.str();
}

bool BedrockLevelReader::scanFile(int fileIdx, const std::wstring& path, void* fileHandle,
                                   uint64_t fileSize, ScanResult& out) {
    (void)path;
    if (!fileHandle || fileSize < 48) return false;

    uint8_t footer[48];
    if (!readFullyAt(fileHandle, fileSize - 48, footer, 48)) return false;
    uint64_t magic;
    memcpy(&magic, footer + 40, 8);
    if (magic != kTableMagic) return false;

    const uint8_t* fp = footer;
    const uint8_t* fend = footer + 40;
    uint64_t miOff = 0, miSize = 0, idxOff = 0, idxSize = 0;
    if (!getVarint(fp, fend, miOff)) return false;
    if (!getVarint(fp, fend, miSize)) return false;
    if (!getVarint(fp, fend, idxOff)) return false;
    if (!getVarint(fp, fend, idxSize)) return false;
    if (idxOff + idxSize + 5 > fileSize) return false;

    std::vector<uint8_t> idxRaw((size_t)idxSize + 5);
    if (!readFullyAt(fileHandle, idxOff, idxRaw.data(), idxRaw.size())) return false;
    std::vector<uint8_t> idxBlock;
    uint8_t idxType = idxRaw[idxSize];
    if (idxType < 8) out.typeHist[idxType]++;
    if (!decompressBlock(idxRaw.data(), (size_t)idxSize, idxType, idxBlock)) {
        out.decompFail++;
        return false;
    }

    std::vector<uint8_t> blkRaw;
    std::vector<uint8_t> blk;
    bool ok = forEachEntryInBlock(idxBlock.data(), idxBlock.size(),
        [&](const std::string& key, const uint8_t* valPtr, size_t valLen) {
            (void)key;
            const uint8_t* vp = valPtr;
            const uint8_t* vend = valPtr + valLen;
            uint64_t off = 0, size = 0;
            if (!getVarint(vp, vend, off)) return;
            if (!getVarint(vp, vend, size)) return;
            if (off + size + 5 > fileSize) return;

            out.blocksRead++;

            blkRaw.resize((size_t)size + 5);
            if (!readFullyAt(fileHandle, off, blkRaw.data(), blkRaw.size())) return;
            uint8_t blkType = blkRaw[size];
            if (blkType < 8) out.typeHist[blkType]++;
            if (!decompressBlock(blkRaw.data(), (size_t)size, blkType, blk)) {
                out.decompFail++;
                return;
            }

            uint32_t blockIdx = (uint32_t)out.blocks.size();
            bool used = false;

            forEachEntryInBlock(blk.data(), blk.size(),
                [&](const std::string& k, const uint8_t*, size_t) {
                    uint8_t stdLen = subchunkStdKeyLen((const uint8_t*)k.data(), k.size());
                    if (!stdLen) return;

                    if (k.size() > stdLen) out.subchunkNewFmt++;
                    else out.subchunkOldFmt++;

                    KeyEntry e;
                    e.keyLen = stdLen;
                    memcpy(e.key, k.data(), stdLen);
                    e.blockIdx = blockIdx;
                    out.keys.push_back(e);
                    used = true;
                });

            if (used) {
                out.blocks.push_back(BlockEntry{fileIdx, (uint32_t)size, off});
            } else {
                for (auto it = out.keys.rbegin();
                     it != out.keys.rend() && it->blockIdx == blockIdx; ++it) {
                    it->blockIdx = (uint32_t)out.blocks.size();
                }
            }
        });
    return ok;
}

std::shared_ptr<const std::vector<uint8_t>>
BedrockLevelReader::loadBlock(uint32_t blockIdx) {
    if (blockIdx >= mBlocks.size()) return nullptr;

    {
        std::lock_guard<std::mutex> lk(mBlockCacheMutex);
        auto it = mBlockCache.find(blockIdx);
        if (it != mBlockCache.end()) return it->second;
    }

    const BlockEntry& be = mBlocks[blockIdx];
    if (be.fileIdx < 0 || (size_t)be.fileIdx >= mFiles.size()) return nullptr;
    LdbFile& lf = mFiles[be.fileIdx];
    if (!lf.handle) return nullptr;
    if (be.blockOffset + be.dataSize + 5 > lf.fileSize) return nullptr;

    std::vector<uint8_t> raw((size_t)be.dataSize + 5);
    bool ioOk;
    {
        std::lock_guard<std::mutex> ioLk(lf.ioMutex);
        ioOk = readFullyAt(lf.handle, be.blockOffset, raw.data(), raw.size());
    }
    if (!ioOk) return nullptr;

    auto block = std::make_shared<std::vector<uint8_t>>();
    if (!decompressBlock(raw.data(), be.dataSize, raw[be.dataSize], *block)) return nullptr;

    std::lock_guard<std::mutex> lk(mBlockCacheMutex);
    auto [insIt, inserted] = mBlockCache.emplace(blockIdx, std::move(block));
    if (inserted) {
        mBlockCacheOrder.push_back(blockIdx);
        while (mBlockCacheOrder.size() > MAX_BLOCK_CACHE) {
            mBlockCache.erase(mBlockCacheOrder.front());
            mBlockCacheOrder.pop_front();
        }
    }
    return insIt->second;
}

bool BedrockLevelReader::NBTReader::readByte(int8_t& v) {
    if (pos + 1 > size) return false;
    v = (int8_t)data[pos++];
    return true;
}

bool BedrockLevelReader::NBTReader::readShort(int16_t& v) {
    if (pos + 2 > size) return false;
    v = (int16_t)(data[pos] | (data[pos + 1] << 8));
    pos += 2;
    return true;
}

bool BedrockLevelReader::NBTReader::readInt(int32_t& v) {
    if (pos + 4 > size) return false;
    v = (int32_t)(data[pos] | (data[pos + 1] << 8) | (data[pos + 2] << 16) | (data[pos + 3] << 24));
    pos += 4;
    return true;
}

bool BedrockLevelReader::NBTReader::readString(std::string& s) {
    uint16_t len;
    if (pos + 2 > size) return false;
    len = data[pos] | (data[pos + 1] << 8);
    pos += 2;
    if (pos + len > size) return false;
    s.assign((const char*)(data + pos), len);
    pos += len;
    return true;
}

bool BedrockLevelReader::NBTReader::readRootCompound(std::string& outName) {
    if (pos >= size) return false;
    uint8_t type = data[pos++];
    if (type != 10) return false; // TAG_Compound

    std::string rootName;
    if (!readString(rootName)) return false;

    outName.clear();
    while (pos < size) {
        uint8_t childType = data[pos++];
        if (childType == 0) break; // TAG_End

        std::string childName;
        if (!readString(childName)) return false;

        if (childType == 8 && childName == "name") {
            if (!readString(outName)) return false;
        } else {
            if (!skipTag(childType)) return false;
        }
    }
    return true;
}

bool BedrockLevelReader::NBTReader::skipTag(uint8_t type) {
    switch (type) {
        case 1: { int8_t v; return readByte(v); }
        case 2: { int16_t v; return readShort(v); }
        case 3: { int32_t v; return readInt(v); }
        case 4: {
            if (pos + 8 > size) return false;
            pos += 8;
            return true;
        }
        case 5: {
            if (pos + 4 > size) return false;
            pos += 4;
            return true;
        }
        case 6: {
            if (pos + 8 > size) return false;
            pos += 8;
            return true;
        }
        case 7: { // ByteArray
            int32_t len;
            if (!readInt(len)) return false;
            if (pos + (size_t)len > size) return false;
            pos += len;
            return true;
        }
        case 8: {
            std::string s;
            return readString(s);
        }
        case 9: { // List
            if (pos + 5 > size) return false;
            uint8_t elemType = data[pos++];
            int32_t count;
            if (!readInt(count)) return false;
            for (int i = 0; i < count; i++) {
                if (!skipTag(elemType)) return false;
            }
            return true;
        }
        case 10: { // Compound
            while (pos < size) {
                uint8_t childType = data[pos++];
                if (childType == 0) break;
                std::string childName;
                if (!readString(childName)) return false;
                if (!skipTag(childType)) return false;
            }
            return true;
        }
        case 11: { // IntArray
            int32_t len;
            if (!readInt(len)) return false;
            if (pos + (size_t)len * 4 > size) return false;
            pos += (size_t)len * 4;
            return true;
        }
        case 12: { // LongArray
            int32_t len;
            if (!readInt(len)) return false;
            if (pos + (size_t)len * 8 > size) return false;
            pos += (size_t)len * 8;
            return true;
        }
        default:
            return false;
    }
}

bool BedrockLevelReader::parsePaletteStorage(const uint8_t* data, size_t size, size_t& offset, PaletteStorage& out) {
    if (offset + 1 > size) return false;

    uint8_t header = data[offset++];
    bool isRuntime = (header & 1) != 0;
    out.bitsPerIndex = header >> 1;

    if (out.bitsPerIndex > 16) return false;

    if (out.bitsPerIndex == 0) {
        out.blocksPerWord = 0;
        out.wordCount = 0;
        if (isRuntime) {
            return false; // 磁盘存档不用 Runtime
        }
        if (offset + 4 > size) return false;
        int32_t paletteSize = (int32_t)rdLE32(data + offset);
        offset += 4;
        if (paletteSize < 1) return false;
        if (paletteSize > 4096) return false;
        out.palette.resize(paletteSize);
        for (int i = 0; i < paletteSize; i++) {
            NBTReader reader{data, size, offset};
            std::string name;
            if (!reader.readRootCompound(name)) return false;
            if (name.rfind("minecraft:", 0) == 0) name = name.substr(10);
            out.palette[i] = std::move(name);
            offset = reader.pos;
        }
        return true;
    }

    out.blocksPerWord = 32 / out.bitsPerIndex;
    out.wordCount = (4096 + out.blocksPerWord - 1) / out.blocksPerWord;

    if (offset + (size_t)out.wordCount * 4 > size) return false;
    out.words.resize(out.wordCount);
    for (int i = 0; i < out.wordCount; i++) {
        out.words[i] = rdLE32(data + offset);
        offset += 4;
    }

    if (isRuntime) return false;
    if (offset + 4 > size) return false;
    int32_t paletteSize = (int32_t)rdLE32(data + offset);
    offset += 4;
    if (paletteSize < 1) return false;
    if (paletteSize > (1 << out.bitsPerIndex)) return false;
    out.palette.resize(paletteSize);
    for (int i = 0; i < paletteSize; i++) {
        NBTReader reader{data, size, offset};
        std::string name;
        if (!reader.readRootCompound(name)) return false;
        if (name.rfind("minecraft:", 0) == 0) name = name.substr(10);
        out.palette[i] = std::move(name);
        offset = reader.pos;
    }
    return true;
}

uint32_t BedrockLevelReader::getPaletteIndex(const PaletteStorage& ps, int x, int y, int z) {
    if (ps.bitsPerIndex == 0) {
        return 0;
    }
    int i = (x << 8) | (z << 4) | y;
    int wordIdx = i / ps.blocksPerWord;
    int bitOffset = (i % ps.blocksPerWord) * ps.bitsPerIndex;
    if (wordIdx >= (int)ps.words.size()) return 0;
    return (ps.words[wordIdx] >> bitOffset) & ((1u << ps.bitsPerIndex) - 1);
}

BedrockLevelReader::SubchunkData BedrockLevelReader::parseSubchunk(const std::string& value) {
    if (value.empty()) return SubchunkData{};
    return parseSubchunk((const uint8_t*)value.data(), value.size());
}

BedrockLevelReader::SubchunkData BedrockLevelReader::parseSubchunk(const uint8_t* data, size_t size) {
    SubchunkData result;
    if (!data || size == 0) return result;

    size_t offset = 0;

    if (offset >= size) return result;
    uint8_t version = data[offset++];

    int numStorages = 1;
    if (version == 8 || version == 9) {
        if (offset >= size) return result;
        numStorages = data[offset++];
        if (version == 9) {
            if (offset >= size) return result;
            offset++; // y_index（key 中已有，跳过）
        }
    } else {
        return result;
    }
    if (numStorages < 1 || numStorages > 8) return result;

    std::vector<PaletteStorage> layers;
    layers.reserve(numStorages);
    for (int s = 0; s < numStorages; s++) {
        PaletteStorage ps;
        if (!parsePaletteStorage(data, size, offset, ps)) return result;
        layers.push_back(std::move(ps));
    }

    auto extractLayer = [](PaletteStorage& ps, std::vector<std::string>& palette,
                           std::vector<uint16_t>& indices) {
        palette = std::move(ps.palette);
        indices.resize(4096);
        if (ps.bitsPerIndex == 0 || ps.words.empty()) {
            std::fill(indices.begin(), indices.end(), 0);
            return;
        }
        const uint32_t mask = (1u << ps.bitsPerIndex) - 1;
        const int perWord = ps.blocksPerWord;
        int i = 0;
        for (int w = 0; w < ps.wordCount && i < 4096; w++) {
            uint32_t word = ps.words[w];
            for (int k = 0; k < perWord && i < 4096; k++, i++) {
                uint32_t idx = (word >> (k * ps.bitsPerIndex)) & mask;
                int j = ((i & 15) << 8) | (((i >> 4) & 15) << 4) | (i >> 8);
                indices[j] = (uint16_t)std::min(idx, 65535u);
            }
        }
        for (; i < 4096; i++) {
            int j = ((i & 15) << 8) | (((i >> 4) & 15) << 4) | (i >> 8);
            indices[j] = 0;
        }
    };

    if (layers.size() >= 1) {
        extractLayer(layers[0], result.palette, result.blockIndices);
    }
    if (layers.size() >= 2) {
        extractLayer(layers[1], result.liquidPalette, result.liquidIndices);
    }

    result.valid = true;
    return result;
}

bool BedrockLevelReader::getSubchunkValue(const uint8_t* key, size_t keyLen, std::string& outValue) {
    if (!mOpened || mIndex.empty()) return false;

    size_t lo = 0, hi = mIndex.size();
    while (lo < hi) {
        size_t mid = (lo + hi) / 2;
        if (keyCompare(mIndex[mid], key, keyLen) < 0) lo = mid + 1;
        else hi = mid;
    }
    if (lo >= mIndex.size()) return false;
    if (keyCompare(mIndex[lo], key, keyLen) != 0) return false;

    auto block = loadBlock(mIndex[lo].blockIdx);
    if (!block) return false;
    return findInBlock(block->data(), block->size(), key, keyLen, outValue);
}

std::string BedrockLevelReader::getBlockName(int cx, int cz, int dim, int lx, int lz, int y) {
    if (!mOpened) return "";

    int8_t subchunkIndex = (int8_t)(y / 16);
    if (y < 0 && (y % 16) != 0) subchunkIndex--;

    uint8_t key[MAX_KEY_LEN];
    uint8_t klen;
    buildSubchunkKey(key, klen, cx, cz, dim, subchunkIndex);

    std::string keyStr((const char*)key, klen);
    std::shared_ptr<SubchunkData> sd;
    {
        std::lock_guard<std::mutex> lk(mSubchunkCacheMutex);
        auto it = mSubchunkCache.find(keyStr);
        if (it != mSubchunkCache.end()) sd = it->second;
    }
    if (!sd) {
        std::string value;
        bool found = getSubchunkValue(key, klen, value);
        sd = std::make_shared<SubchunkData>(found ? parseSubchunk(value) : SubchunkData{});
        std::lock_guard<std::mutex> lk(mSubchunkCacheMutex);
        if (mSubchunkCache.size() >= MAX_SUBCHUNK_CACHE) mSubchunkCache.clear();
        mSubchunkCache[keyStr] = sd;
    }
    if (!sd->valid) return "";

    int localY = y - (subchunkIndex * 16);
    if (localY < 0) localY += 16;
    int i = (localY << 8) | (lz << 4) | lx;
    if (i < 0 || i >= 4096) return "";
    if (i >= (int)sd->blockIndices.size()) return "";
    uint16_t idx = sd->blockIndices[i];
    if (idx >= sd->palette.size()) return "";
    return sd->palette[idx];
}

BedrockLevelReader::ChunkSurface BedrockLevelReader::scanChunkSurface(int cx, int cz, int dim) {
    ChunkSurface sfc;
    if (!mOpened) return sfc;

    int minSub, maxSub;
    if (dim == 0) { minSub = -4; maxSub = 19; }
    else if (dim == 1) { minSub = 0; maxSub = 7; }
    else { minSub = 0; maxSub = 15; }

    int subCount = maxSub - minSub + 1;

    std::vector<std::shared_ptr<SubchunkData>> subchunks(subCount);
    collectChunkSubchunks(cx, cz, dim, [&](int8_t subIdx, const uint8_t* data, size_t size) {
        int s = (int)subIdx - minSub;
        if (s < 0 || s >= subCount) return;
        auto sd = std::make_shared<SubchunkData>(parseSubchunk(data, size));
        if (sd->valid) subchunks[s] = std::move(sd);
    });

    struct SubFlags {
        uint16_t airIdx = 0xFFFF;
        uint16_t waterIdx = 0xFFFF;
        uint16_t flowingWaterIdx = 0xFFFF;
        uint16_t liqWaterIdx = 0xFFFF;
        uint16_t liqFlowingWaterIdx = 0xFFFF;
    };

    auto buildFlags = [](const SubchunkData& sd) {
        SubFlags f;
        for (size_t i = 0; i < sd.palette.size(); i++) {
            const std::string& n = sd.palette[i];
            if (n == "air" || n.empty()) f.airIdx = (uint16_t)i;
            else if (n == "water") f.waterIdx = (uint16_t)i;
            else if (n == "flowing_water") f.flowingWaterIdx = (uint16_t)i;
        }
        for (size_t i = 0; i < sd.liquidPalette.size(); i++) {
            const std::string& n = sd.liquidPalette[i];
            if (n == "water") f.liqWaterIdx = (uint16_t)i;
            else if (n == "flowing_water") f.liqFlowingWaterIdx = (uint16_t)i;
        }
        return f;
    };

    std::vector<SubFlags> flags(subCount);
    for (int s = 0; s < subCount; s++) {
        if (subchunks[s]) flags[s] = buildFlags(*subchunks[s]);
    }

    for (int lx = 0; lx < 16; lx++) {
        for (int lz = 0; lz < 16; lz++) {
            int sidx = lx * 16 + lz;
            int waterDepth = 0;
            bool found = false;

            for (int sIdx = subCount - 1; sIdx >= 0 && !found; sIdx--) {
                const SubchunkData* sd = subchunks[sIdx].get();
                if (!sd) continue;

                const SubFlags& f = flags[sIdx];
                int worldYBase = (minSub + sIdx) * 16;

                const uint16_t* blockIdxPtr = sd->blockIndices.data();
                const uint16_t* liqIdxPtr = sd->liquidIndices.empty() ? nullptr : sd->liquidIndices.data();

                for (int localY = 15; localY >= 0; localY--) {
                    int i = (localY << 8) | (lz << 4) | lx;
                    uint16_t blockIdx = blockIdxPtr[i];

                    bool isAir = (blockIdx == f.airIdx);
                    bool isWater = (blockIdx == f.waterIdx) || (blockIdx == f.flowingWaterIdx);

                    bool isLiqWater = false;
                    if (liqIdxPtr) {
                        uint16_t liqIdx = liqIdxPtr[i];
                        isLiqWater = (liqIdx == f.liqWaterIdx) || (liqIdx == f.liqFlowingWaterIdx);
                    }

                    if (isAir) {
                        if (isLiqWater) waterDepth++;
                        continue;
                    }
                    if (isWater) {
                        waterDepth++;
                        continue;
                    }

                    int y = worldYBase + localY;
                    if (blockIdx < sd->palette.size()) {
                        sfc.block[sidx] = sd->palette[blockIdx];
                    }
                    sfc.height[sidx] = (int16_t)y;
                    sfc.waterDepth[sidx] = (uint16_t)waterDepth;
                    found = true;
                    break;
                }
            }
        }
    }

    return sfc;
}

BedrockLevelReader::WorldBounds BedrockLevelReader::scanWorldBounds(int dim) {
    WorldBounds b;
    if (!mOpened) return b;

    const bool useDim = (dim != 0) || mOverworldKeyHasDim;
    const uint8_t expectedLen = useDim ? 14 : 10;
    const uint8_t tagOffset = useDim ? 12 : 8;

    int32_t minCX = INT32_MAX, maxCX = INT32_MIN;
    int32_t minCZ = INT32_MAX, maxCZ = INT32_MIN;
    size_t count = 0;
    bool found = false;

    for (const auto& e : mIndex) {
        if (e.keyLen != expectedLen) continue;
        if (e.key[tagOffset] != 0x2F) continue;
        if (useDim) {
            int32_t kDim = (int32_t)rdLE32(e.key + 8);
            if (kDim != dim) continue;
        }

        int32_t cx = (int32_t)rdLE32(e.key);
        int32_t cz = (int32_t)rdLE32(e.key + 4);

        if (cx < minCX) minCX = cx;
        if (cx > maxCX) maxCX = cx;
        if (cz < minCZ) minCZ = cz;
        if (cz > maxCZ) maxCZ = cz;
        count++;
        found = true;
    }

    if (found) {
        b.minCX = minCX;
        b.maxCX = maxCX;
        b.minCZ = minCZ;
        b.maxCZ = maxCZ;
        b.chunkCount = count;
        b.valid = true;
    }
    return b;
}

std::vector<std::pair<int32_t, int32_t>> BedrockLevelReader::listChunks(int dim) {
    std::vector<std::pair<int32_t, int32_t>> out;
    if (!mOpened) return out;

    const bool useDim = (dim != 0) || mOverworldKeyHasDim;
    const uint8_t expectedLen = useDim ? 14 : 10;
    const uint8_t tagOffset = useDim ? 12 : 8;

    out.reserve(mIndex.size() / 8);  // 粗估：平均每 chunk ~8 个 subchunk key
    int32_t lastCX = INT32_MAX, lastCZ = INT32_MAX;
    bool first = true;

    for (const auto& e : mIndex) {
        if (e.keyLen != expectedLen) continue;
        if (e.key[tagOffset] != 0x2F) continue;
        if (useDim) {
            int32_t kDim = (int32_t)rdLE32(e.key + 8);
            if (kDim != dim) continue;
        }

        int32_t cx = (int32_t)rdLE32(e.key);
        int32_t cz = (int32_t)rdLE32(e.key + 4);

        if (!first && cx == lastCX && cz == lastCZ) continue;  // 同 chunk 多个 subchunk
        out.emplace_back(cx, cz);
        lastCX = cx;
        lastCZ = cz;
        first = false;
    }
    return out;
}
