#include "adapters/fs/AtomicFile.h"
#include "mod/map/MapRenderer.h"
#include <vector>
#include <unordered_map>
#include <unordered_set>
#include <map>
#include <fstream>
#include <sstream>
#include <cstring>
#include <algorithm>
#include <cmath>
#include <climits>
#include <thread>
#include <mutex>
#include <chrono>

#include <zlib.h>

#include <nlohmann/json.hpp>

namespace {

constexpr uint32_t C(uint8_t r, uint8_t g, uint8_t b, uint8_t a = 255) {
    return ((uint32_t)r << 24) | ((uint32_t)g << 16) | ((uint32_t)b << 8) | a;
}

const std::unordered_map<std::string, uint32_t>& builtinColorTable() {
    static const std::unordered_map<std::string, uint32_t> m = {
        {"grass_block", C(127, 178, 56)}, {"grass", C(127, 178, 56)},
        {"dirt", C(134, 96, 67)}, {"coarse_dirt", C(119, 85, 59)},
        {"rooted_dirt", C(124, 88, 60)}, {"dirt_with_roots", C(124, 88, 60)},
        {"podzol", C(90, 63, 24)}, {"mycelium", C(111, 99, 105)},
        {"moss_block", C(90, 120, 60)}, {"moss_carpet", C(90, 120, 60)},
        {"pale_moss_block", C(160, 168, 150)},
        {"stone", C(125, 125, 125)}, {"smooth_stone", C(158, 158, 158)},
        {"cobblestone", C(110, 110, 110)}, {"mossy_cobblestone", C(100, 118, 90)},
        {"granite", C(149, 103, 85)}, {"polished_granite", C(154, 106, 89)},
        {"diorite", C(188, 188, 188)}, {"polished_diorite", C(193, 193, 193)},
        {"andesite", C(136, 136, 136)}, {"polished_andesite", C(132, 134, 133)},
        {"deepslate", C(80, 80, 82)}, {"cobbled_deepslate", C(77, 77, 80)},
        {"tuff", C(108, 109, 102)}, {"calcite", C(223, 224, 220)},
        {"bedrock", C(70, 70, 70)},
        {"mud", C(60, 57, 60)}, {"muddy_mangrove_roots", C(70, 58, 45)},
        {"packed_mud", C(142, 106, 79)}, {"mud_bricks", C(137, 103, 79)},
        {"sand", C(219, 211, 160)}, {"red_sand", C(190, 102, 33)},
        {"sandstone", C(217, 210, 158)}, {"red_sandstone", C(186, 99, 29)},
        {"gravel", C(126, 124, 122)},
        {"clay", C(160, 166, 179)}, {"terracotta", C(152, 94, 67)},
        {"hardened_clay", C(152, 94, 67)},
        {"dripstone_block", C(134, 107, 92)}, {"pointed_dripstone", C(134, 107, 92)},
        {"amethyst_block", C(133, 97, 191)}, {"budding_amethyst", C(132, 96, 186)},
        {"snow_block", C(248, 248, 248)}, {"snow_layer", C(248, 248, 248)},
        {"snow", C(248, 248, 248)}, {"powder_snow", C(248, 253, 253)},
        {"ice", C(145, 183, 253)}, {"packed_ice", C(141, 180, 250)},
        {"blue_ice", C(116, 167, 253)}, {"frosted_ice", C(145, 183, 253)},
        {"water", C(63, 118, 228)}, {"flowing_water", C(63, 118, 228)},
        {"lava", C(207, 92, 20)}, {"flowing_lava", C(207, 92, 20)},
        {"magma", C(142, 63, 31)}, {"magma_block", C(142, 63, 31)},
        {"coal_ore", C(115, 115, 115)}, {"deepslate_coal_ore", C(77, 77, 80)},
        {"iron_ore", C(135, 130, 126)}, {"deepslate_iron_ore", C(86, 84, 90)},
        {"gold_ore", C(143, 139, 125)}, {"deepslate_gold_ore", C(102, 92, 60)},
        {"copper_ore", C(124, 125, 120)}, {"deepslate_copper_ore", C(80, 80, 80)},
        {"diamond_ore", C(129, 140, 143)}, {"deepslate_diamond_ore", C(60, 70, 75)},
        {"emerald_ore", C(117, 135, 120)}, {"deepslate_emerald_ore", C(60, 90, 70)},
        {"lapis_ore", C(102, 112, 134)}, {"deepslate_lapis_ore", C(50, 60, 80)},
        {"redstone_ore", C(132, 107, 107)}, {"deepslate_redstone_ore", C(85, 65, 65)},
        {"nether_gold_ore", C(143, 109, 70)}, {"nether_quartz_ore", C(150, 130, 110)},
        {"ancient_debris", C(94, 66, 58)},
        {"oak_log", C(109, 85, 50)}, {"stripped_oak_log", C(157, 128, 79)},
        {"spruce_log", C(58, 37, 16)}, {"stripped_spruce_log", C(114, 84, 48)},
        {"birch_log", C(216, 215, 210)}, {"stripped_birch_log", C(192, 175, 121)},
        {"jungle_log", C(87, 67, 26)}, {"stripped_jungle_log", C(160, 115, 80)},
        {"acacia_log", C(103, 96, 86)}, {"stripped_acacia_log", C(168, 90, 50)},
        {"dark_oak_log", C(61, 47, 26)}, {"stripped_dark_oak_log", C(66, 43, 20)},
        {"mangrove_log", C(83, 66, 41)}, {"stripped_mangrove_log", C(115, 85, 55)},
        {"cherry_log", C(54, 33, 44)}, {"stripped_cherry_log", C(180, 130, 160)},
        {"pale_oak_log", C(140, 135, 129)}, {"stripped_pale_oak_log", C(160, 155, 145)},
        {"oak_leaves", C(60, 120, 40, 180)}, {"birch_leaves", C(95, 130, 70, 180)},
        {"spruce_leaves", C(45, 80, 45, 180)}, {"jungle_leaves", C(55, 125, 30, 180)},
        {"acacia_leaves", C(90, 130, 45, 180)}, {"dark_oak_leaves", C(50, 100, 35, 180)},
        {"mangrove_leaves", C(60, 115, 45, 180)}, {"cherry_leaves", C(233, 173, 206, 180)},
        {"azalea_leaves", C(92, 120, 55, 180)}, {"flowering_azalea_leaves", C(160, 130, 90, 180)},
        {"pale_oak_leaves", C(130, 138, 120, 180)},
        {"leaves", C(60, 120, 40, 180)}, {"leaves2", C(60, 110, 40, 180)},
        {"oak_planks", C(162, 130, 78)}, {"spruce_planks", C(114, 84, 48)},
        {"birch_planks", C(192, 175, 121)}, {"jungle_planks", C(160, 115, 80)},
        {"acacia_planks", C(168, 90, 50)}, {"dark_oak_planks", C(66, 43, 20)},
        {"mangrove_planks", C(115, 85, 55)}, {"cherry_planks", C(180, 130, 160)},
        {"pale_oak_planks", C(160, 155, 145)},
        {"glass", C(175, 213, 219, 160)}, {"tinted_glass", C(100, 100, 100, 160)},
        {"glass_pane", C(175, 213, 219, 160)},
        {"netherrack", C(111, 54, 52)}, {"nether_bricks", C(44, 22, 26)},
        {"nether_brick", C(44, 22, 26)}, {"red_nether_bricks", C(70, 20, 22)},
        {"nether_wart_block", C(123, 2, 2)}, {"warped_wart_block", C(22, 119, 121)},
        {"crimson_nylium", C(130, 31, 31)}, {"warped_nylium", C(43, 114, 101)},
        {"crimson_stem", C(92, 25, 29)}, {"warped_stem", C(58, 58, 77)},
        {"basalt", C(73, 72, 77)}, {"smooth_basalt", C(72, 72, 78)},
        {"blackstone", C(42, 36, 41)}, {"glowstone", C(254, 217, 108)},
        {"soul_sand", C(84, 64, 51)}, {"soul_soil", C(75, 57, 46)},
        {"shroomlight", C(240, 146, 70)}, {"obsidian", C(21, 18, 30)},
        {"crying_obsidian", C(42, 2, 74)}, {"respawn_anchor", C(40, 20, 30)},
        {"end_stone", C(219, 222, 158)}, {"end_stone_bricks", C(218, 224, 162)},
        {"purpur_block", C(169, 125, 169)}, {"purpur_pillar", C(160, 110, 160)},
        {"chorus_plant", C(93, 57, 93)}, {"chorus_flower", C(151, 120, 151)},
        {"short_grass", C(110, 160, 60, 180)}, {"tall_grass", C(110, 160, 60, 180)},
        {"tallgrass", C(110, 160, 60, 180)}, {"double_plant", C(110, 160, 60, 180)},
        {"fern", C(100, 150, 60, 180)}, {"large_fern", C(100, 150, 60, 180)},
        {"seagrass", C(70, 130, 60, 200)}, {"tall_seagrass", C(70, 130, 60, 200)},
        {"kelp", C(60, 120, 50, 220)}, {"kelp_plant", C(60, 120, 50, 220)},
        {"bamboo", C(110, 160, 40)}, {"sugar_cane", C(148, 192, 101)},
        {"reeds", C(148, 192, 101)}, {"cactus", C(85, 127, 43)},
        {"vine", C(60, 110, 40, 200)}, {"glow_lichen", C(140, 180, 80, 200)},
        {"lily_pad", C(80, 130, 50, 180)},
        {"big_dripleaf", C(95, 135, 65)}, {"big_dripleaf_stem", C(80, 110, 50)},
        {"small_dripleaf", C(95, 135, 65)}, {"azalea", C(95, 125, 60)},
        {"flowering_azalea", C(200, 160, 180)}, {"mangrove_propagule", C(80, 110, 50)},
        {"spore_blossom", C(200, 130, 180)},
        {"dandelion", C(230, 210, 60)}, {"poppy", C(200, 60, 50)},
        {"blue_orchid", C(80, 180, 220)}, {"allium", C(180, 100, 220)},
        {"azure_bluet", C(140, 140, 100)}, {"oxeye_daisy", C(220, 200, 100)},
        {"cornflower", C(80, 100, 220)}, {"lily_of_the_valley", C(220, 220, 220)},
        {"wither_rose", C(60, 30, 40)}, {"torchflower", C(220, 100, 50)},
        {"sunflower", C(220, 200, 60)}, {"rose_bush", C(200, 60, 50)},
        {"lilac", C(180, 100, 180)}, {"peony", C(220, 130, 180)},
        {"dead_bush", C(140, 100, 60)},
        {"wheat", C(220, 200, 80)}, {"carrots", C(90, 160, 40)},
        {"potatoes", C(90, 160, 40)}, {"beetroots", C(110, 140, 60)},
        {"pumpkin", C(198, 118, 24)}, {"carved_pumpkin", C(198, 118, 24)},
        {"jack_o_lantern", C(198, 118, 24)}, {"melon", C(111, 153, 31)},
        {"pumpkin_stem", C(95, 135, 65)}, {"melon_stem", C(95, 135, 65)},
        {"attached_melon_stem", C(95, 135, 65)}, {"attached_pumpkin_stem", C(95, 135, 65)},
        {"nether_wart", C(123, 2, 2)}, {"cocoa", C(120, 80, 50)},
        {"sweet_berry_bush", C(120, 60, 60)}, {"torchflower_crop", C(180, 100, 50)},
        {"dirt_path", C(148, 121, 65)}, {"grass_path", C(148, 121, 65)},
        {"farmland", C(98, 68, 38)},
        {"bricks", C(151, 97, 83)}, {"brick_block", C(151, 97, 83)},
        {"stone_bricks", C(122, 122, 122)}, {"stonebrick", C(122, 122, 122)},
        {"mossy_stone_bricks", C(115, 121, 105)}, {"cracked_stone_bricks", C(110, 110, 110)},
        {"smooth_sandstone", C(217, 210, 158)}, {"cut_sandstone", C(217, 210, 158)},
        {"smooth_red_sandstone", C(186, 99, 29)}, {"cut_red_sandstone", C(186, 99, 29)},
        {"smooth_quartz", C(235, 229, 222)}, {"quartz_block", C(235, 229, 222)},
        {"quartz_pillar", C(235, 229, 222)}, {"chiseled_quartz_block", C(220, 215, 208)},
        {"bookshelf", C(157, 128, 79)}, {"crafting_table", C(140, 105, 60)},
        {"furnace", C(120, 120, 120)}, {"blast_furnace", C(110, 110, 110)},
        {"smoker", C(110, 90, 80)},
        {"chest", C(160, 115, 50)}, {"ender_chest", C(80, 50, 110)},
        {"trapped_chest", C(170, 100, 50)}, {"barrel", C(130, 95, 55)},
        {"shulker_box", C(140, 100, 140)},
        {"torch", C(255, 200, 100)}, {"wall_torch", C(255, 200, 100)},
        {"soul_torch", C(120, 180, 220)}, {"soul_wall_torch", C(120, 180, 220)},
        {"lantern", C(220, 180, 100)}, {"soul_lantern", C(120, 180, 220)},
        {"end_rod", C(240, 240, 220)},
        {"enchanting_table", C(150, 80, 180)}, {"enchantment_table", C(150, 80, 180)},
        {"anvil", C(70, 70, 70)}, {"chipped_anvil", C(70, 70, 70)}, {"damaged_anvil", C(70, 70, 70)},
        {"brewing_stand", C(120, 100, 100)}, {"cauldron", C(70, 70, 70)},
        {"composter", C(110, 90, 60)}, {"loom", C(140, 110, 70)}, {"cartography_table", C(140, 110, 70)},
        {"fletching_table", C(140, 110, 70)}, {"smithing_table", C(80, 70, 70)},
        {"grindstone", C(100, 100, 100)}, {"stonecutter", C(120, 120, 120)},
        {"bell", C(220, 180, 50)}, {"beacon", C(180, 220, 230)}, {"conduit", C(180, 220, 230)},
        {"sea_lantern", C(172, 199, 190)},
        {"prismarine", C(99, 156, 151)}, {"prismarine_bricks", C(99, 171, 158)},
        {"dark_prismarine", C(51, 91, 75)}, {"sea_pickle", C(120, 200, 90)},
        {"turtle_egg", C(220, 210, 170)}, {"sniffer_egg", C(200, 130, 70)},
        {"dragon_egg", C(40, 20, 40)},
        {"sculk", C(12, 29, 36)}, {"sculk_catalyst", C(15, 31, 38)},
        {"sculk_sensor", C(20, 50, 70)}, {"sculk_shrieker", C(15, 25, 30)},
        {"sculk_vein", C(15, 35, 40)},
        {"spawner", C(40, 60, 80)}, {"mob_spawner", C(40, 60, 80)},
        {"sponge", C(195, 192, 74)}, {"wet_sponge", C(170, 175, 60)},
        {"hay_block", C(166, 136, 38)}, {"bone_block", C(210, 206, 179)},
        {"honey_block", C(235, 160, 50)}, {"honeycomb_block", C(229, 148, 29)},
        {"slime", C(110, 190, 90, 200)}, {"slime_block", C(110, 190, 90, 200)},
        {"tnt", C(200, 60, 40)},
        {"web", C(230, 230, 230, 200)}, {"cobweb", C(230, 230, 230, 200)},
        {"scaffolding", C(180, 145, 80, 200)},
        {"ochre_froglight", C(250, 245, 206)}, {"verdant_froglight", C(229, 244, 228)},
        {"pearlescent_froglight", C(245, 235, 245)},
        {"redstone_block", C(171, 27, 9)}, {"redstone_lamp", C(160, 120, 70)},
        {"redstone_wire", C(180, 30, 30)}, {"redstone_torch", C(180, 50, 30)},
        {"redstone_wall_torch", C(180, 50, 30)}, {"repeater", C(140, 100, 50)},
        {"comparator", C(140, 100, 50)}, {"piston", C(125, 125, 125)},
        {"sticky_piston", C(120, 130, 80)}, {"observer", C(110, 110, 110)},
        {"dropper", C(110, 110, 110)}, {"dispenser", C(110, 110, 110)},
        {"hopper", C(70, 70, 70)}, {"note_block", C(130, 100, 60)},
        {"rail", C(140, 110, 70)}, {"powered_rail", C(220, 180, 50)},
        {"detector_rail", C(140, 110, 70)}, {"activator_rail", C(140, 110, 70)},
        {"iron_block", C(220, 220, 220)}, {"gold_block", C(246, 208, 61)},
        {"diamond_block", C(98, 219, 214)}, {"emerald_block", C(42, 203, 87)},
        {"lapis_block", C(30, 66, 140)}, {"coal_block", C(16, 16, 16)},
        {"netherite_block", C(66, 61, 63)},
        {"raw_iron_block", C(166, 135, 107)}, {"raw_gold_block", C(221, 169, 46)},
        {"raw_copper_block", C(154, 105, 79)},
        {"copper_block", C(192, 107, 79)}, {"cut_copper", C(191, 106, 80)},
        {"exposed_copper", C(161, 125, 103)}, {"weathered_copper", C(108, 153, 110)},
        {"oxidized_copper", C(82, 162, 132)},
        {"red_mushroom", C(180, 45, 40)}, {"red_mushroom_block", C(180, 45, 40)},
        {"brown_mushroom", C(140, 105, 80)}, {"brown_mushroom_block", C(140, 105, 80)},
        {"mushroom_stem", C(200, 190, 180)},
        {"crimson_fungus", C(140, 40, 40)}, {"warped_fungus", C(40, 130, 130)},
        {"air", 0u}, {"void_air", 0u}, {"cave_air", 0u},
    };
    return m;
}

struct DyeEntry { const char* name; uint32_t color; };
const std::vector<DyeEntry>& dyeColors() {
    static const std::vector<DyeEntry> v = {
        {"white",       C(233, 236, 236)},
        {"orange",      C(240, 118, 19)},
        {"magenta",     C(189, 68, 179)},
        {"light_blue",  C(58, 175, 217)},
        {"yellow",      C(248, 198, 39)},
        {"lime",        C(112, 185, 25)},
        {"pink",        C(237, 141, 172)},
        {"gray",        C(62, 68, 71)},
        {"light_gray",  C(142, 142, 134)},
        {"silver",      C(142, 142, 134)},
        {"cyan",        C(21, 137, 145)},
        {"purple",      C(121, 42, 172)},
        {"blue",        C(53, 57, 157)},
        {"brown",       C(114, 71, 40)},
        {"green",       C(84, 109, 27)},
        {"red",         C(161, 39, 34)},
        {"black",       C(20, 21, 25)},
    };
    return v;
}

bool isDyedFamily(const std::string& shortName) {
    static const std::unordered_set<std::string> families = {
        "wool", "carpet", "concrete", "concrete_powder", "stained_glass",
        "stained_glass_pane", "stained_hardened_clay", "shulker_box", "bed",
        "banner", "wall_banner", "glazed_terracotta"
    };
    return families.count(shortName) > 0;
}

uint32_t dyedFamilyColor(const std::string& family, uint32_t dyeColor) {
    uint8_t r = (dyeColor >> 24) & 0xFF;
    uint8_t g = (dyeColor >> 16) & 0xFF;
    uint8_t b = (dyeColor >> 8) & 0xFF;
    if (family == "terracotta" || family == "stained_hardened_clay" || family == "glazed_terracotta") {
        return C((r + 120) / 2, (g + 90) / 2, (b + 70) / 2, 255);
    }
    if (family == "stained_glass" || family == "stained_glass_pane") {
        return C(r, g, b, 160);
    }
    return C(r, g, b, 255);
}

inline bool startsWith(const std::string& s, const std::string& prefix) {
    return s.size() >= prefix.size() && s.compare(0, prefix.size(), prefix) == 0;
}

std::string stripNamespace(const std::string& name) {
    if (startsWith(name, "minecraft:")) return name.substr(10);
    return name;
}

} // namespace

uint32_t MapRenderer::getBlockColor(const std::string& name) {
    return lookupColor(stripNamespace(name));
}

uint32_t MapRenderer::lookupColor(const std::string& shortName) {
    if (shortName.empty()) return 0u;
    auto& m = builtinColorTable();
    auto it = m.find(shortName);
    if (it != m.end()) return it->second;

    for (auto& dye : dyeColors()) {
        std::string prefix(dye.name);
        if (startsWith(shortName, prefix)) {
            std::string rest = shortName.substr(prefix.size());
            if (startsWith(rest, "_")) {
                std::string family = rest.substr(1);
                if (isDyedFamily(family)) {
                    return dyedFamilyColor(family, dye.color);
                }
            }
        }
    }
    return heuristicColor(shortName);
}

uint32_t MapRenderer::dyeFallback(const std::string& shortName) {
    for (auto& dye : dyeColors()) {
        if (shortName == dye.name) return dye.color;
    }
    return C(128, 128, 128, 255);
}

uint32_t MapRenderer::heuristicColor(const std::string& shortName) {
    auto has = [&](const std::string& s) { return shortName.find(s) != std::string::npos; };
    if (has("water"))     return C(63, 118, 228);
    if (has("lava"))      return C(207, 92, 20);
    if (has("magma"))     return C(142, 63, 31);
    if (has("leaves"))    return C(60, 115, 40, 180);
    if (has("foliage"))   return C(60, 115, 40, 180);
    if (has("log") || has("wood") || has("stem")) return C(100, 80, 50);
    if (has("planks") || has("fence")) return C(157, 128, 79);
    if (has("sand"))      return C(219, 211, 160);
    if (has("snow") || has("ice")) return C(230, 240, 250);
    if (has("nether"))    return C(111, 54, 52);
    if (has("end_") || has("purpur")) return C(219, 222, 158);
    if (has("deepslate")) return C(80, 80, 82);
    if (has("copper"))    return C(192, 107, 79);
    if (has("coral"))     return C(190, 100, 150);
    if (has("mushroom") || has("fungus")) return C(160, 110, 90);
    if (has("brick"))     return C(151, 97, 83);
    if (has("stone") || has("cobble") || has("rock") || has("andesite") || has("ore")) return C(125, 125, 125);
    if (has("dirt") || has("mud") || has("soil")) return C(134, 96, 67);
    if (has("grass") || has("plant") || has("bush") || has("sapling") || has("flower")) return C(110, 160, 60);
    if (has("glass"))     return C(175, 213, 219, 160);
    return C(128, 128, 128, 255);
}

const char* MapRenderer::dimId(int dim) {
    switch (dim) {
        case 1: return "nether";
        case 2: return "end";
        default: return "overworld";
    }
}

const char* MapRenderer::dimName(int dim) {
    switch (dim) {
        case 1: return "下界";
        case 2: return "末地";
        default: return "主世界";
    }
}

std::filesystem::path MapRenderer::tileFilePath(int dim, int zoom, int tx, int tz) const {
    return mOutputDir / "tiles" / dimId(dim) / std::to_string(zoom)
        / (std::to_string(tx) + "_" + std::to_string(tz) + ".png");
}

bool MapRenderer::hasTiles(int dim) const {
    return std::filesystem::exists(mOutputDir / "tiles" / dimId(dim) / "0");
}

void MapRenderer::applyChunkToRegion(int cx, int cz, const ChunkSurface& sfc,
                                     std::unordered_map<int64_t, Region>& regions) {
    auto floorDiv = [](int a, int b) -> int {
        int q = a / b;
        int r = a % b;
        return (r != 0 && ((r < 0) != (b < 0))) ? q - 1 : q;
    };
    int rx = floorDiv(cx, REGION_CHUNKS);  // REGION_CHUNKS chunks = 1 region(tile)
    int rz = floorDiv(cz, REGION_CHUNKS);
    auto it = regions.find(regionKey(rx, rz));
    if (it == regions.end()) {
        it = regions.emplace(regionKey(rx, rz), Region{}).first;
    }
    Region& region = it->second;

    applyChunkToRegion(cx, cz, sfc, region);
}

void MapRenderer::applyChunkToRegion(int cx, int cz, const ChunkSurface& sfc, Region& region) {
    auto floorDiv = [](int a, int b) -> int {
        int q = a / b;
        int r = a % b;
        return (r != 0 && ((r < 0) != (b < 0))) ? q - 1 : q;
    };
    int rx = floorDiv(cx, REGION_CHUNKS);
    int rz = floorDiv(cz, REGION_CHUNKS);
    int ox = (cx - rx * REGION_CHUNKS) * CHUNK;
    int oz = (cz - rz * REGION_CHUNKS) * CHUNK;

    static thread_local std::unordered_map<std::string, uint32_t> colorCache;
    auto lookupCached = [&](const std::string& n) -> uint32_t {
        auto it = colorCache.find(n);
        if (it != colorCache.end()) return it->second;
        uint32_t c = lookupColor(n);
        if (colorCache.size() < 4096) colorCache.emplace(n, c);
        return c;
    };

    for (int lx = 0; lx < 16; lx++) {
        for (int lz = 0; lz < 16; lz++) {
            int sidx = lx * 16 + lz;
            int i = (oz + lz) * TILE + (ox + lx);
            int16_t h = sfc.height[sidx];
            if (h == INT16_MIN) {
                region.color[i]  = 0u;
                region.height[i] = INT32_MIN;
                continue;
            }
            uint32_t c = lookupCached(sfc.block[sidx]);
            int depth = sfc.waterDepth[sidx];
            if (depth > 0) {
                float t = std::min(0.92f, 0.55f + depth * 0.045f);
                uint32_t water = lookupCached("water");
                uint8_t r  = (c >> 24) & 0xFF;
                uint8_t g  = (c >> 16) & 0xFF;
                uint8_t b  = (c >> 8)  & 0xFF;
                uint8_t wr = (water >> 24) & 0xFF;
                uint8_t wg = (water >> 16) & 0xFF;
                uint8_t wb = (water >> 8)  & 0xFF;
                r = (uint8_t)std::min(255.0f, r  * (1.0f - t) + wr * t);
                g = (uint8_t)std::min(255.0f, g  * (1.0f - t) + wg * t);
                b = (uint8_t)std::min(255.0f, b  * (1.0f - t) + wb * t);
                c = C(r, g, b, 255);
            }
            region.color[i]  = c;
            region.height[i] = (int32_t)h + depth;  // 把水高度也算上
        }
    }
    region.dirty = true;
}

bool MapRenderer::shadeAndWriteRegion(int dim, int rx, int rz, const Region& region) {
    const int t = TILE;
    std::vector<uint8_t> rgba(t * t * 4, 0);
    for (int pz = 0; pz < t; pz++) {
        for (int px = 0; px < t; px++) {
            int i  = pz * t + px;
            uint32_t c = region.color[i];
            int o = i * 4;
            if ((c & 0xFF) == 0) continue;  // 透明像素跳过

            int h = region.height[i];
            float f = 1.0f;
            if (h != INT32_MIN) {
                int hw = (px > 0) ? region.height[i - 1]   : INT32_MIN;
                int hn = (pz > 0) ? region.height[i - t]   : INT32_MIN;
                int d = 0;
                if (hw != INT32_MIN) d += std::clamp(h - hw, -4, 4);
                if (hn != INT32_MIN) d += std::clamp(h - hn, -4, 4);
                if (d != 0) f = std::clamp(1.0f + d * 0.045f, 0.70f, 1.30f);
            }
            rgba[o + 0] = (uint8_t)std::min(255.0f, ((c >> 24) & 0xFF) * f);
            rgba[o + 1] = (uint8_t)std::min(255.0f, ((c >> 16) & 0xFF) * f);
            rgba[o + 2] = (uint8_t)std::min(255.0f, ((c >> 8)  & 0xFF) * f);
            rgba[o + 3] = (c & 0xFF);
        }
    }
    auto path = tileFilePath(dim, 0, rx, rz);
    std::error_code ec;
    std::filesystem::create_directories(path.parent_path(), ec);
    return writePNG(path, rgba.data(), t, t);
}

bool MapRenderer::buildZoomLevel(int dim, int z,
                                  const std::vector<std::tuple<int, int, uint64_t>>& childTiles,
                                  std::vector<std::tuple<int, int, uint64_t>>& outParentTiles,
                                  std::atomic<bool>& stop) {
    if (childTiles.size() <= 1) return false;

    std::unordered_set<int64_t> childExists;
    for (auto& [tx, tz, ver] : childTiles) {
        childExists.insert(regionKey(tx, tz));
    }

    std::map<int64_t, std::pair<int,int>> parentSet;
    for (auto& [tx, tz, ver] : childTiles) {
        int px = tx >> 1;
        int pz = tz >> 1;
        int64_t key = regionKey(px, pz);
        parentSet.emplace(key, std::make_pair(px, pz));
    }

    const int half = TILE / 2;  // 256
    int targetCount = (int)parentSet.size();
    int done = 0;

    for (auto& [pkey, ppair] : parentSet) {
        if (stop.load()) return false;
        int px = ppair.first;
        int pz = ppair.second;

        (void)px; (void)pz; (void)childExists; (void)half;
        (void)outParentTiles; (void)done; (void)targetCount;
        return false;
    }
    return false;
}

static inline void writeU32BE(std::vector<uint8_t>& v, uint32_t val) {
    v.push_back((val >> 24) & 0xFF); v.push_back((val >> 16) & 0xFF);
    v.push_back((val >> 8) & 0xFF);  v.push_back(val & 0xFF);
}

bool MapRenderer::writePNG(const std::filesystem::path& path, const uint8_t* rgba, int w, int h) {
    size_t rawSize = (size_t)w * 4 + 1;
    std::vector<uint8_t> raw(rawSize * h);
    for (int y = 0; y < h; y++) {
        raw[y * rawSize] = 0; // filter: None
        memcpy(raw.data() + y * rawSize + 1, rgba + (size_t)y * w * 4, (size_t)w * 4);
    }
    uLong compressedSize = compressBound(raw.size());
    std::vector<uint8_t> compressed(compressedSize);
    if (compress2(compressed.data(), &compressedSize, raw.data(), raw.size(), 1) != Z_OK) return false;

    std::vector<uint8_t> png;
    const uint8_t sig[] = {0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A};
    png.insert(png.end(), sig, sig + 8);

    auto writeChunk = [&](const char type[4], const uint8_t* data, size_t len) {
        writeU32BE(png, (uint32_t)len);
        png.insert(png.end(), type, type + 4);
        if (data && len) png.insert(png.end(), data, data + len);
        uint32_t crc = crc32(0, (const Bytef*)type, 4);
        if (data && len) crc = crc32(crc, data, len);
        writeU32BE(png, crc);
    };
    uint8_t ihdr[13] = {0};
    ihdr[0] = (w >> 24) & 0xFF; ihdr[1] = (w >> 16) & 0xFF;
    ihdr[2] = (w >> 8) & 0xFF;  ihdr[3] = w & 0xFF;
    ihdr[4] = (h >> 24) & 0xFF; ihdr[5] = (h >> 16) & 0xFF;
    ihdr[6] = (h >> 8) & 0xFF;  ihdr[7] = h & 0xFF;
    ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    writeChunk("IHDR", ihdr, 13);
    writeChunk("IDAT", compressed.data(), compressedSize);
    writeChunk("IEND", nullptr, 0);

    auto writeResult = adapters::fs::writeFileAtomic(
        path.string(),
        std::string_view(reinterpret_cast<const char*>(png.data()), png.size())
    );
    return writeResult.ok;
}

void MapRenderer::regionToRGBA(const Region& region, std::vector<uint8_t>& rgba) const {
    const int t = TILE;
    for (int pz = 0; pz < t; pz++) {
        for (int px = 0; px < t; px++) {
            int i  = pz * t + px;
            uint32_t c = region.color[i];
            int o = i * 4;
            if ((c & 0xFF) == 0) continue;
            int h = region.height[i];
            float f = 1.0f;
            if (h != INT32_MIN) {
                int hw = (px > 0) ? region.height[i - 1] : INT32_MIN;
                int hn = (pz > 0) ? region.height[i - t] : INT32_MIN;
                int d = 0;
                if (hw != INT32_MIN) d += std::clamp(h - hw, -4, 4);
                if (hn != INT32_MIN) d += std::clamp(h - hn, -4, 4);
                if (d != 0) f = std::clamp(1.0f + d * 0.045f, 0.70f, 1.30f);
            }
            rgba[o + 0] = (uint8_t)std::min(255.0f, ((c >> 24) & 0xFF) * f);
            rgba[o + 1] = (uint8_t)std::min(255.0f, ((c >> 16) & 0xFF) * f);
            rgba[o + 2] = (uint8_t)std::min(255.0f, ((c >> 8)  & 0xFF) * f);
            rgba[o + 3] = (c & 0xFF);
        }
    }
}

void MapRenderer::downsampleInto(const std::vector<uint8_t>& childRGBA,
                                 std::vector<uint8_t>& parentRGBA, int bx, int bz) const {
    const int half = TILE / 2;
    for (int y = 0; y < half; y++) {
        for (int x = 0; x < half; x++) {
            uint32_t acc[4] = {0, 0, 0, 0};
            uint32_t cnt = 0;
            for (int sy = 0; sy < 2; sy++) {
                for (int sx = 0; sx < 2; sx++) {
                    int cxp = x * 2 + sx;
                    int cyp = y * 2 + sy;
                    int ci = (cyp * TILE + cxp) * 4;
                    acc[0] += childRGBA[ci + 0];
                    acc[1] += childRGBA[ci + 1];
                    acc[2] += childRGBA[ci + 2];
                    acc[3] += childRGBA[ci + 3];
                    cnt++;
                }
            }
            int pi = (bz + y) * TILE + (bx + x);
            parentRGBA[pi * 4 + 0] = (uint8_t)(acc[0] / cnt);
            parentRGBA[pi * 4 + 1] = (uint8_t)(acc[1] / cnt);
            parentRGBA[pi * 4 + 2] = (uint8_t)(acc[2] / cnt);
            parentRGBA[pi * 4 + 3] = (uint8_t)(acc[3] / cnt);
        }
    }
}

bool MapRenderer::decodeTilePNG(const std::filesystem::path& path, std::vector<uint8_t>& rgba) {
    std::ifstream f(path, std::ios::binary);
    if (!f) return false;
    std::vector<uint8_t> data((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
    const uint8_t sig[] = {0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A};
    if (data.size() < 8 || memcmp(data.data(), sig, 8) != 0) return false;

    auto be32 = [](const uint8_t* p) -> uint32_t {
        return ((uint32_t)p[0] << 24) | ((uint32_t)p[1] << 16) | ((uint32_t)p[2] << 8) | p[3];
    };

    size_t pos = 8;
    int w = 0, h = 0;
    std::vector<uint8_t> idat;
    bool haveHdr = false;
    while (pos + 8 <= data.size()) {
        uint32_t len = be32(&data[pos]);
        if (pos + 12 + (size_t)len > data.size()) return false;
        const uint8_t* type = &data[pos + 4];
        const uint8_t* body = &data[pos + 8];
        if (memcmp(type, "IHDR", 4) == 0) {
            if (len != 13) return false;
            w = (int)be32(body);
            h = (int)be32(body + 4);
            if (w <= 0 || h <= 0 || body[8] != 8 || body[9] != 6 || body[12] != 0) return false;
            haveHdr = true;
        } else if (memcmp(type, "IDAT", 4) == 0) {
            idat.insert(idat.end(), body, body + len);
        } else if (memcmp(type, "IEND", 4) == 0) {
            break;
        }
        pos += 12 + (size_t)len;
    }
    if (!haveHdr || idat.empty()) return false;

    uLongf rawLen = (uLongf)((size_t)h * ((size_t)w * 4 + 1));
    std::vector<uint8_t> raw(rawLen);
    if (uncompress(raw.data(), &rawLen, idat.data(), (uLong)idat.size()) != Z_OK) return false;
    if (rawLen != (size_t)h * ((size_t)w * 4 + 1)) return false;

    rgba.assign((size_t)w * h * 4, 0);
    for (int y = 0; y < h; y++) {
        const uint8_t* line = raw.data() + (size_t)y * ((size_t)w * 4 + 1);
        if (line[0] != 0) return false;
        memcpy(rgba.data() + (size_t)y * w * 4, line + 1, (size_t)w * 4);
    }
    return true;
}

bool MapRenderer::writeDimManifest(int dim,
                                    const std::map<std::tuple<int, int, int>, std::vector<uint8_t>>& tileCache,
                                    size_t chunkCount) {
    nlohmann::json j;
    j["id"]     = dimId(dim);
    j["chunks"] = chunkCount;

    int minTx = INT_MAX, maxTx = INT_MIN, minTz = INT_MAX, maxTz = INT_MIN;
    int maxZoom = 0;
    nlohmann::json tilesMap = nlohmann::json::object();
    for (auto& [key, rgba] : tileCache) {
        int z  = std::get<0>(key);
        int tx = std::get<1>(key);
        int tz = std::get<2>(key);
        if (z > maxZoom) maxZoom = z;
        if (z == 0) {
            minTx = std::min(minTx, tx);
            maxTx = std::max(maxTx, tx);
            minTz = std::min(minTz, tz);
            maxTz = std::max(maxTz, tz);
        }
        tilesMap[std::to_string(z) + "/" + std::to_string(tx) + "_" + std::to_string(tz)] = 1;
    }
    if (minTx > maxTx) { minTx = maxTx = minTz = maxTz = 0; }
    j["minTx"]   = minTx;
    j["maxTx"]   = maxTx;
    j["minTz"]   = minTz;
    j["maxTz"]   = maxTz;
    j["maxZoom"] = maxZoom;
    j["tiles"]   = tilesMap;

    auto path = mOutputDir / "tiles" / dimId(dim) / "manifest.json";
    std::error_code ec;
    std::filesystem::create_directories(path.parent_path(), ec);
    std::ofstream f(path);
    if (!f) return false;
    f << j.dump(2);
    return f.good();
}

void MapRenderer::render(int dim, int centerX, int centerZ, int radiusChunks,
                          std::atomic<bool>& stop, ProgressCallback progress) {
    if (mLogCallback) {
        std::ostringstream oss;
        oss << "[MapRenderer] Starting: dim=" << dim << " center=(" << centerX << "," << centerZ
            << ") radius=" << radiusChunks << " chunks";
        mLogCallback(oss.str());
    }

    int centerCX = centerX >> 4;
    int centerCZ = centerZ >> 4;
    int minCX = centerCX - radiusChunks;
    int maxCX = centerCX + radiusChunks;
    int minCZ = centerCZ - radiusChunks;
    int maxCZ = centerCZ + radiusChunks;

    auto dimDir = mOutputDir / "tiles" / dimId(dim);
    std::error_code ec;
    std::filesystem::create_directories(dimDir, ec);

    auto floorDiv = [](int a, int b) -> int {
        int q = a / b;
        int r = a % b;
        return (r != 0 && ((r < 0) != (b < 0))) ? q - 1 : q;
    };
    int minRX = floorDiv(minCX, REGION_CHUNKS);
    int maxRX = floorDiv(maxCX, REGION_CHUNKS);
    int minRZ = floorDiv(minCZ, REGION_CHUNKS);
    int maxRZ = floorDiv(maxCZ, REGION_CHUNKS);

    std::map<std::tuple<int, int, int>, std::vector<uint8_t>> tileCache;
    std::mutex tileCacheMutex;
    std::atomic<int> regionsDone{0};
    std::atomic<int> chunksDone{0};

    struct RegionJob {
        int rx, rz;
        std::vector<std::pair<int32_t, int32_t>> chunks;
    };
    std::vector<RegionJob> jobs;

    if (mExistingChunks && !mExistingChunks->empty()) {
        std::unordered_map<int64_t, std::vector<std::pair<int32_t, int32_t>>> byRegion;
        byRegion.reserve(1024);
        for (const auto& [cx, cz] : *mExistingChunks) {
            if (cx < minCX || cx > maxCX || cz < minCZ || cz > maxCZ) continue;
            int rx = floorDiv(cx, REGION_CHUNKS);
            int rz = floorDiv(cz, REGION_CHUNKS);
            byRegion[regionKey(rx, rz)].emplace_back(cx, cz);
        }
        jobs.reserve(byRegion.size());
        for (auto& [key, chunkList] : byRegion) {
            RegionJob j;
            j.rx = (int32_t)(key >> 32);
            j.rz = (int32_t)(uint32_t)key;
            j.chunks = std::move(chunkList);
            jobs.push_back(std::move(j));
        }
        if (mLogCallback) {
            std::ostringstream oss;
            oss << "[MapRenderer] Existing-chunk mode: " << mExistingChunks->size()
                << " chunks in archive, " << jobs.size() << " regions have data (box "
                << (maxRX - minRX + 1) * (maxRZ - minRZ + 1) << " regions probed before)";
            mLogCallback(oss.str());
        }
    } else {
        int totalRegions = (maxRX - minRX + 1) * (maxRZ - minRZ + 1);
        jobs.reserve(totalRegions);
        for (int rx = minRX; rx <= maxRX; rx++)
            for (int rz = minRZ; rz <= maxRZ; rz++)
                jobs.push_back({rx, rz, {}});
    }
    {
        int centerRX = 0, centerRZ = 0;  // (0,0) 所在 region（出生点）
        auto cheb = [&](const RegionJob& j) {
            return std::max(std::abs(j.rx - centerRX), std::abs(j.rz - centerRZ));
        };
        std::stable_sort(jobs.begin(), jobs.end(),
                         [&](const RegionJob& a, const RegionJob& b) {
                             return cheb(a) < cheb(b);
                         });
    }
    std::atomic<size_t> nextJob{0};
    int totalRegions = (int)jobs.size();
    int totalChunks = 0;
    for (auto& j : jobs) totalChunks += (int)j.chunks.size();

    auto processRegion = [&](RegionJob& job) {
        Region region;
        bool hasAnyBlock = false;
        if (!job.chunks.empty()) {
            for (auto& [cx, cz] : job.chunks) {
                if (stop.load()) return;
                try {
                    if (mScanChunk) {
                        auto sfc = mScanChunk(cx, cz, dim);
                        applyChunkToRegion(cx, cz, sfc, region);
                        for (int i = 0; i < 256; i++) {
                            if (!sfc.block[i].empty()) { hasAnyBlock = true; break; }
                        }
                    }
                } catch (...) {}
                chunksDone++;
            }
        } else {
            int chunkStartX = job.rx * REGION_CHUNKS;
            int chunkStartZ = job.rz * REGION_CHUNKS;
            for (int lcx = 0; lcx < REGION_CHUNKS && !stop.load(); lcx++) {
                for (int lcz = 0; lcz < REGION_CHUNKS && !stop.load(); lcz++) {
                    int cx = chunkStartX + lcx;
                    int cz = chunkStartZ + lcz;
                    if (cx < minCX || cx > maxCX || cz < minCZ || cz > maxCZ) continue;
                    try {
                        if (mScanChunk) {
                            auto sfc = mScanChunk(cx, cz, dim);
                            applyChunkToRegion(cx, cz, sfc, region);
                            for (int i = 0; i < 256; i++) {
                                if (!sfc.block[i].empty()) { hasAnyBlock = true; break; }
                            }
                        }
                    } catch (...) {}
                    chunksDone++;
                }
            }
        }
        if (stop.load() || !hasAnyBlock) return;

        const int t = TILE;
        std::vector<uint8_t> rgba(t * t * 4, 0);
        regionToRGBA(region, rgba);

        std::error_code ec2;
        auto path = tileFilePath(dim, 0, job.rx, job.rz);
        std::filesystem::create_directories(path.parent_path(), ec2);
        writePNG(path, rgba.data(), t, t);

        {
            std::lock_guard<std::mutex> lk(tileCacheMutex);
            tileCache.emplace(std::make_tuple(0, job.rx, job.rz), std::move(rgba));
        }
    };

    const int speed = (mRenderSpeed >= 1 && mRenderSpeed <= 3) ? mRenderSpeed : 2;
    const int    sleepInterval = (speed == 1) ? 1 : (speed == 2 ? 4 : 0);
    const int    sleepMs       = (speed == 1) ? 15 : (speed == 2 ? 5 : 0);
    auto workerMain = [&]() {
        int doneByMe = 0;  // worker 自身计数（栈变量，无竞争）
        while (!stop.load()) {
            size_t j = nextJob.fetch_add(1);
            if (j >= jobs.size()) break;
            processRegion(jobs[j]);
            int rd = ++regionsDone;
            if (progress && (rd & 0x3) == 0) {
                int pct = (rd * 80) / std::max(1, totalRegions);
                progress(std::min(79, pct), dimName(dim));
            }
            if (sleepInterval > 0 && ++doneByMe >= sleepInterval) {
                doneByMe = 0;
                std::this_thread::sleep_for(std::chrono::milliseconds(sleepMs));
            }
        }
    };

    unsigned nThreads = 0;
    if (mRenderThreads >= 1 && mRenderThreads <= 16) {
        nThreads = (unsigned)mRenderThreads;
    } else {
        nThreads = std::thread::hardware_concurrency();
        if (nThreads == 0) nThreads = 2;
        if (nThreads > 8) nThreads = 8;
    }
    if ((int)jobs.size() < (int)nThreads) nThreads = (unsigned)jobs.size();

    {
        std::ostringstream oss;
        oss << "[MapRenderer] Parallel scan: " << nThreads << " threads, " << jobs.size()
            << " regions" << (totalChunks > 0 ? ", " + std::to_string(totalChunks) + " known chunks" : "")
            << ", speed=" << (speed == 1 ? "slow" : speed == 2 ? "normal" : "full");
        if (mLogCallback) mLogCallback(oss.str());
    }

    if (nThreads <= 1) {
        workerMain();
    } else {
        std::vector<std::thread> pool;
        pool.reserve(nThreads - 1);
        for (unsigned i = 0; i < nThreads - 1; i++) pool.emplace_back(workerMain);
        workerMain();  // 主渲染线程也参与
        for (auto& th : pool) th.join();
    }

    if (mLogCallback) {
        std::ostringstream oss;
        oss << "[MapRenderer] Scan+render done: " << chunksDone << " chunks, " << tileCache.size() << " tiles";
        mLogCallback(oss.str());
    }

    const int half = TILE / 2;  // 256
    int z = 0;
    while (z < MAX_ZOOM && !stop.load()) {
        std::vector<std::pair<int, int>> levelTiles;
        for (auto& [key, _] : tileCache) {
            if (std::get<0>(key) == z) {
                levelTiles.emplace_back(std::get<1>(key), std::get<2>(key));
            }
        }
        if (levelTiles.empty()) break;

        auto floorDiv2 = [](int v) -> int {
            return (v >= 0) ? (v / 2) : ((v - 1) / 2);
        };
        std::map<std::pair<int, int>, bool> parentSet;
        for (auto& [tx, tz] : levelTiles) {
            parentSet.emplace(std::make_pair(floorDiv2(tx), floorDiv2(tz)), true);
        }

        int parentDone = 0;
        int parentTotal = (int)parentSet.size();
        auto buildParent = [&](const std::pair<int, int>& pp) {
            if (stop.load()) return;
            int px = pp.first;
            int pz = pp.second;

            std::vector<uint8_t> parentRGBA(TILE * TILE * 4, 0);
            for (int dz = 0; dz < 2; dz++) {
                for (int dx = 0; dx < 2; dx++) {
                    int cxk = px * 2 + dx;
                    int czk = pz * 2 + dz;
                    std::vector<uint8_t> childRGBA;
                    {
                        std::lock_guard<std::mutex> lk(tileCacheMutex);
                        auto childIt = tileCache.find(std::make_tuple(z, cxk, czk));
                        if (childIt == tileCache.end()) continue;
                        childRGBA = childIt->second;
                    }
                    const std::vector<uint8_t>& childRef = childRGBA;

                    downsampleInto(childRef, parentRGBA, dx * half, dz * half);
                }
            }

            auto path = tileFilePath(dim, z + 1, px, pz);
            std::error_code ec2;
            std::filesystem::create_directories(path.parent_path(), ec2);
            writePNG(path, parentRGBA.data(), TILE, TILE);

            {
                std::lock_guard<std::mutex> lk(tileCacheMutex);
                tileCache.emplace(std::make_tuple(z + 1, px, pz), std::move(parentRGBA));
            }
        };

        std::vector<std::pair<int, int>> parentList;
        parentList.reserve(parentSet.size());
        for (auto& [pp, _] : parentSet) parentList.push_back(pp);
        {
            std::atomic<size_t> nextParent{0};
            auto parentWorker = [&]() {
                while (!stop.load()) {
                    size_t j = nextParent.fetch_add(1);
                    if (j >= parentList.size()) break;
                    buildParent(parentList[j]);
                    int pd = ++parentDone;
                    if (progress && (pd & 0x7) == 0) {
                        int pct = 80 + (z * 15) / MAX_ZOOM
                                + (pd * 15) / std::max(1, parentTotal * MAX_ZOOM);
                        progress(std::min(99, pct), dimName(dim));
                    }
                }
            };
            unsigned zThreads = nThreads;
            if (parentList.size() < zThreads) zThreads = (unsigned)parentList.size();
            if (zThreads <= 1) {
                parentWorker();
            } else {
                std::vector<std::thread> zpool;
                zpool.reserve(zThreads - 1);
                for (unsigned i = 0; i < zThreads - 1; i++) zpool.emplace_back(parentWorker);
                parentWorker();
                for (auto& th : zpool) th.join();
            }
        }

        z++;
    }

    if (mLogCallback) {
        std::ostringstream oss;
        oss << "[MapRenderer] Render done: " << tileCache.size() << " tiles across " << (z + 1) << " zoom levels";
        mLogCallback(oss.str());
    }

    writeDimManifest(dim, tileCache, chunksDone);

    if (progress) progress(100, dimName(dim));
}

void MapRenderer::renderRegions(int dim, const std::vector<std::pair<int, int>>& regions,
                                std::atomic<bool>& stop, ProgressCallback progress) {
    if (regions.empty() || !mScanChunk) return;

    std::vector<std::pair<int, int>> uniq(regions.begin(), regions.end());
    std::sort(uniq.begin(), uniq.end());
    uniq.erase(std::unique(uniq.begin(), uniq.end()), uniq.end());

    auto floorDiv2 = [](int v) -> int { return (v >= 0) ? (v / 2) : ((v - 1) / 2); };

    unsigned nThreads = 0;
    if (mRenderThreads >= 1 && mRenderThreads <= 16) {
        nThreads = (unsigned)mRenderThreads;
    } else {
        nThreads = std::thread::hardware_concurrency();
        if (nThreads == 0) nThreads = 2;
        if (nThreads > 8) nThreads = 8;
    }
    if ((int)uniq.size() < (int)nThreads) nThreads = (unsigned)uniq.size();

    std::atomic<size_t> next{0};
    std::atomic<size_t> doneCnt{0};
    auto worker = [&]() {
        while (!stop.load()) {
            size_t i = next.fetch_add(1);
            if (i >= uniq.size()) break;
            int rx = uniq[i].first;
            int rz = uniq[i].second;

            Region region;
            bool hasAnyBlock = false;
            int chunkStartX = rx * REGION_CHUNKS;
            int chunkStartZ = rz * REGION_CHUNKS;
            for (int lcx = 0; lcx < REGION_CHUNKS && !stop.load(); lcx++) {
                for (int lcz = 0; lcz < REGION_CHUNKS && !stop.load(); lcz++) {
                    int cx = chunkStartX + lcx;
                    int cz = chunkStartZ + lcz;
                    try {
                        auto sfc = mScanChunk(cx, cz, dim);
                        applyChunkToRegion(cx, cz, sfc, region);
                        for (int b = 0; b < 256; b++) {
                            if (!sfc.block[b].empty()) { hasAnyBlock = true; break; }
                        }
                    } catch (...) {}
                }
            }
            if (stop.load() || !hasAnyBlock) {
                if (progress) {
                    size_t d = doneCnt.fetch_add(1) + 1;
                    progress((int)(d * 80 / uniq.size()), dimName(dim));
                }
                continue;  // 与全量行为一致：空 region 不产生瓦片
            }

            std::vector<uint8_t> rgba((size_t)TILE * TILE * 4, 0);
            regionToRGBA(region, rgba);
            std::error_code ec;
            auto path = tileFilePath(dim, 0, rx, rz);
            std::filesystem::create_directories(path.parent_path(), ec);
            writePNG(path, rgba.data(), TILE, TILE);
            if (progress) {
                size_t d = doneCnt.fetch_add(1) + 1;
                progress((int)(d * 80 / uniq.size()), dimName(dim));
            }
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
    if (stop.load()) return;

    std::vector<std::pair<int, int>> cur = std::move(uniq);
    for (int z = 1; z <= MAX_ZOOM && !cur.empty() && !stop.load(); z++) {
        std::map<std::pair<int, int>, bool> parentSet;
        for (auto& [tx, tz] : cur) parentSet.emplace(std::make_pair(floorDiv2(tx), floorDiv2(tz)), true);

        std::vector<std::pair<int, int>> nextLevel;
        nextLevel.reserve(parentSet.size());
        for (auto& [pp, _] : parentSet) {
            if (stop.load()) break;
            int px = pp.first;
            int pz = pp.second;

            std::vector<uint8_t> parentRGBA((size_t)TILE * TILE * 4, 0);
            bool anyChild = false;
            for (int dz = 0; dz < 2; dz++) {
                for (int dx = 0; dx < 2; dx++) {
                    std::vector<uint8_t> childRGBA;
                    auto childPath = tileFilePath(dim, z - 1, px * 2 + dx, pz * 2 + dz);
                    if (!decodeTilePNG(childPath, childRGBA)) continue;  // 缺失子瓦片 → 象限保持透明
                    anyChild = true;
                    downsampleInto(childRGBA, parentRGBA, dx * (TILE / 2), dz * (TILE / 2));
                }
            }
            if (!anyChild) continue;  // 4 子全缺：不写无意义透明瓦片（与全量行为一致）

            std::error_code ec;
            auto path = tileFilePath(dim, z, px, pz);
            std::filesystem::create_directories(path.parent_path(), ec);
            writePNG(path, parentRGBA.data(), TILE, TILE);
            nextLevel.emplace_back(px, pz);
        }
        cur = std::move(nextLevel);
        if (progress) progress(80 + z * 20 / (MAX_ZOOM + 1), dimName(dim));  // 阶段2：80-100%
    }
    if (progress) progress(100, dimName(dim));
}
