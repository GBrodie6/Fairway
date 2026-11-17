// The asset catalog: every external asset the game ships, where it comes from, and what it
// is for. The pipeline downloads these at 2K into asset-src/, verifies the license from the
// source, and writes compressed tier-resolution files into public/assets/.
//
// Sources and their verified endpoints (checked against the published API docs):
//   Poly Haven   https://api.polyhaven.com/files/{id}  and  /info/{id}     (assets are CC0)
//   ambientCG    https://ambientcg.com/api/v2/full_json?id={id}&include=downloadData  (CC0)
// If a download fails after retries, `alt` is tried, and after that the texture is generated
// procedurally (scripts/assets/procedural.mjs) and recorded as such in ASSETS.md.

export const USER_AGENT = 'fairway-next-asset-pipeline/0.1';

// sizes: resolutions shipped. 2048 was dropped in Stage 11: at 1024 the fairway and green
// already give about one texel per pixel at the closest putting camera on a 1080p screen, and
// no tier sampled the 2048 files (8 MB shipped for nothing).
// flatten: remove large-scale brightness variation so tiling is less visible.
export const TEXTURES = [
  { id: 'fairway', role: 'Closely mown fairway grass', source: 'ambientcg', asset: 'Grass005', alt: { source: 'ambientcg', asset: 'Grass006' }, sizes: [512, 1024], flatten: 0.8, scale: 2.2, fallback: { color: [0.36, 0.55, 0.2], rough: 0.9, grain: 0.5 } },
  { id: 'green', role: 'Tee box and putting green grass', source: 'ambientcg', asset: 'Grass008', alt: { source: 'ambientcg', asset: 'Grass007' }, sizes: [512, 1024], flatten: 0.9, scale: 1.6, fallback: { color: [0.4, 0.6, 0.22], rough: 0.88, grain: 0.3 } },
  { id: 'rough', role: 'Rough grass', source: 'ambientcg', asset: 'Grass004', alt: { source: 'ambientcg', asset: 'Grass003' }, sizes: [512, 1024], flatten: 0.7, scale: 2.6, fallback: { color: [0.3, 0.45, 0.16], rough: 0.95, grain: 0.8 } },
  { id: 'deeprough', role: 'Deep rough grass', source: 'ambientcg', asset: 'Grass001', alt: { source: 'ambientcg', asset: 'Grass002' }, sizes: [512, 1024], flatten: 0.6, scale: 3.0, fallback: { color: [0.2, 0.34, 0.12], rough: 0.97, grain: 1.0 } },
  { id: 'fescue', role: 'Links fescue rough', source: 'polyhaven', asset: 'withered_grass', alt: { source: 'polyhaven', asset: 'sparse_grass' }, sizes: [512, 1024], flatten: 0.6, scale: 3.0, fallback: { color: [0.5, 0.46, 0.22], rough: 0.96, grain: 1.0 } },
  { id: 'bunker', role: 'Bunker sand', source: 'ambientcg', asset: 'Ground054', alt: { source: 'ambientcg', asset: 'Ground080' }, sizes: [512, 1024], flatten: 0.8, scale: 2.4, fallback: { color: [0.86, 0.78, 0.6], rough: 0.98, grain: 0.35 } },
  { id: 'beach', role: 'White beach and dune sand', source: 'polyhaven', asset: 'aerial_beach_01', alt: { source: 'polyhaven', asset: 'coast_sand_01' }, sizes: [512, 1024], flatten: 0.5, scale: 6.0, fallback: { color: [0.88, 0.85, 0.76], rough: 0.98, grain: 0.3 } },
  { id: 'wetsand', role: 'Wet sand and shoreline', source: 'polyhaven', asset: 'damp_sand', alt: { source: 'polyhaven', asset: 'coast_sand_05' }, sizes: [512, 1024], flatten: 0.4, scale: 3.0, fallback: { color: [0.42, 0.34, 0.24], rough: 0.6, grain: 0.3 } },
  { id: 'dirt', role: 'Dirt', source: 'polyhaven', asset: 'dirt_floor', alt: { source: 'polyhaven', asset: 'dry_ground_01' }, sizes: [512, 1024], flatten: 0.5, scale: 3.0, fallback: { color: [0.5, 0.36, 0.24], rough: 0.95, grain: 0.6 } },
  { id: 'forest', role: 'Forest floor and leaf litter', source: 'polyhaven', asset: 'forest_leaves_02', alt: { source: 'polyhaven', asset: 'forrest_ground_01' }, sizes: [512, 1024], flatten: 0.4, scale: 3.0, fallback: { color: [0.36, 0.3, 0.16], rough: 0.95, grain: 0.9 } },
  { id: 'needles', role: 'Conifer needle litter', source: 'polyhaven', asset: 'forest_leaves_04', alt: { source: 'polyhaven', asset: 'dry_decay_leaves' }, sizes: [512, 1024], flatten: 0.4, scale: 2.5, fallback: { color: [0.42, 0.3, 0.18], rough: 0.95, grain: 0.9 } },
  { id: 'rock', role: 'Rock', source: 'polyhaven', asset: 'rock_face_03', alt: { source: 'polyhaven', asset: 'rock_boulder_dry' }, sizes: [512, 1024], flatten: 0.2, scale: 5.0, fallback: { color: [0.42, 0.38, 0.33], rough: 0.85, grain: 0.7 } },
  { id: 'cliff', role: 'Cliff face', source: 'polyhaven', asset: 'cliff_side', alt: { source: 'polyhaven', asset: 'sandstone_cracks' }, sizes: [512, 1024], flatten: 0.2, scale: 6.0, fallback: { color: [0.55, 0.3, 0.18], rough: 0.85, grain: 0.7 } },
  { id: 'gravel', role: 'Gravel path', source: 'polyhaven', asset: 'gravel_floor', alt: { source: 'polyhaven', asset: 'gravelly_sand' }, sizes: [512, 1024], flatten: 0.5, scale: 1.6, fallback: { color: [0.55, 0.47, 0.36], rough: 0.92, grain: 0.9 } },
  { id: 'concrete', role: 'Concrete cart path', source: 'polyhaven', asset: 'brushed_concrete', alt: { source: 'polyhaven', asset: 'concrete_floor_01' }, sizes: [512, 1024], flatten: 0.5, scale: 2.5, fallback: { color: [0.55, 0.54, 0.5], rough: 0.8, grain: 0.3 } },
  { id: 'desert', role: 'Desert ground', source: 'polyhaven', asset: 'red_sand', alt: { source: 'polyhaven', asset: 'cracked_red_ground' }, sizes: [512, 1024], flatten: 0.4, scale: 4.0, fallback: { color: [0.62, 0.36, 0.24], rough: 0.95, grain: 0.5 } },
  { id: 'scrub', role: 'Desert scrub ground with stones', source: 'polyhaven', asset: 'dry_ground_rocks', alt: { source: 'polyhaven', asset: 'dry_ground_01' }, sizes: [512, 1024], flatten: 0.3, scale: 4.0, fallback: { color: [0.55, 0.4, 0.28], rough: 0.95, grain: 0.8 } },
  { id: 'alpine', role: 'Alpine ground', source: 'polyhaven', asset: 'rocky_terrain_02', alt: { source: 'polyhaven', asset: 'aerial_grass_rock' }, sizes: [512, 1024], flatten: 0.3, scale: 5.0, fallback: { color: [0.3, 0.36, 0.2], rough: 0.95, grain: 0.9 } },
  { id: 'snow', role: 'Snow', source: 'polyhaven', asset: 'snow_02', alt: { source: 'polyhaven', asset: 'snow_01' }, sizes: [512, 1024], flatten: 0.3, scale: 4.0, fallback: { color: [0.9, 0.92, 0.95], rough: 0.7, grain: 0.2 } },
  { id: 'bark', role: 'Broadleaf bark', source: 'polyhaven', asset: 'bark_brown_02', alt: { source: 'polyhaven', asset: 'bark_willow' }, sizes: [512], flatten: 0.2, scale: 1.0, fallback: { color: [0.3, 0.22, 0.15], rough: 0.95, grain: 1.0 } },
  { id: 'pinebark', role: 'Conifer bark', source: 'polyhaven', asset: 'pine_bark', alt: { source: 'polyhaven', asset: 'bark_brown_01' }, sizes: [512], flatten: 0.2, scale: 1.0, fallback: { color: [0.36, 0.22, 0.14], rough: 0.95, grain: 1.0 } },
];

// kind decides the processing recipe. Trees get leaf-card decimation and two mesh LODs.
// height is the in-game height in meters that the model is normalized to (trees are scanned
// small and scaled up). lod0 and lod1 are triangle targets.
export const MODELS = [
  { id: 'oak', role: 'Broadleaf tree', asset: 'island_tree_02', kind: 'tree', height: 13, lod0: 26000, lod1: 5200 },
  { id: 'maple', role: 'Broadleaf tree', asset: 'island_tree_01', kind: 'tree', height: 15, lod0: 26000, lod1: 5200 },
  { id: 'elm', role: 'Broadleaf tree', asset: 'island_tree_03', kind: 'tree', height: 17, lod0: 26000, lod1: 5200 },
  { id: 'birch', role: 'Broadleaf tree', asset: 'tree_small_02', kind: 'tree', height: 11, lod0: 24000, lod1: 4800 },
  { id: 'jacaranda', role: 'Flowering broadleaf tree', asset: 'jacaranda_tree', kind: 'tree', height: 12, lod0: 26000, lod1: 5200 },
  { id: 'fir', role: 'Conifer', asset: 'fir_sapling_medium', kind: 'tree', height: 16, lod0: 22000, lod1: 4400 },
  { id: 'pine', role: 'Conifer', asset: 'pine_sapling_medium', kind: 'tree', height: 19, lod0: 24000, lod1: 4800 },
  { id: 'bushtree', role: 'Dense evergreen bush tree', asset: 'searsia_lucida', kind: 'tree', height: 6, lod0: 16000, lod1: 3200 },
  { id: 'thorn', role: 'Dry-country bush tree', asset: 'searsia_burchellii', kind: 'tree', height: 5, lod0: 16000, lod1: 3200 },
  { id: 'quiver', role: 'Desert tree', asset: 'quiver_tree_01', kind: 'tree', height: 6, lod0: 14000, lod1: 3000 },
  { id: 'quiver2', role: 'Desert tree', asset: 'quiver_tree_02', kind: 'tree', height: 4.5, lod0: 12000, lod1: 2600 },
  { id: 'shrub2', role: 'Shrub', asset: 'shrub_02', kind: 'plant', height: 1.2, lod0: 4000, lod1: 900 },
  { id: 'shrub3', role: 'Shrub', asset: 'shrub_03', kind: 'plant', height: 1.0, lod0: 2400, lod1: 700 },
  { id: 'shrub4', role: 'Shrub', asset: 'shrub_04', kind: 'plant', height: 1.3, lod0: 4000, lod1: 900 },
  { id: 'rooibos', role: 'Desert bush', asset: 'wild_rooibos_bush', kind: 'plant', height: 1.1, lod0: 4000, lod1: 900 },
  { id: 'fern', role: 'Fern', asset: 'fern_02', kind: 'plant', height: 0.7, lod0: 1600, lod1: 500 },
  { id: 'tallgrass', role: 'Tall grass clump', asset: 'grass_medium_01', kind: 'plant', height: 0.55, lod0: 1200, lod1: 300 },
  { id: 'tallgrass2', role: 'Tall grass clump', asset: 'grass_medium_02', kind: 'plant', height: 0.5, lod0: 900, lod1: 260 },
  { id: 'celandine', role: 'Wildflower', asset: 'celandine_01', kind: 'plant', height: 0.3, lod0: 1200, lod1: 300 },
  { id: 'dandelion', role: 'Wildflower', asset: 'dandelion_01', kind: 'plant', height: 0.28, lod0: 1200, lod1: 300 },
  { id: 'gazania', role: 'Desert flower', asset: 'flower_gazania', kind: 'plant', height: 0.25, lod0: 1200, lod1: 300 },
  { id: 'succulent', role: 'Desert succulent', asset: 'cheiridopsis_succulent', kind: 'plant', height: 0.3, lod0: 2000, lod1: 500 },
  { id: 'boulder2', role: 'Desert boulder', asset: 'namaqualand_boulder_02', kind: 'rock', height: 1.8, lod0: 2400, lod1: 500 },
  { id: 'boulder3', role: 'Desert boulder', asset: 'namaqualand_boulder_05', kind: 'rock', height: 1.4, lod0: 2400, lod1: 500 },
  { id: 'rock1', role: 'Rock', asset: 'rock_07', kind: 'rock', height: 0.7, lod0: 1200, lod1: 300 },
  { id: 'rock2', role: 'Rock', asset: 'rock_09', kind: 'rock', height: 0.6, lod0: 1200, lod1: 300 },
  { id: 'stone', role: 'Stone', asset: 'stone_01', kind: 'rock', height: 0.4, lod0: 800, lod1: 240 },
  { id: 'mossrocks', role: 'Mossy rock set', asset: 'rock_moss_set_01', kind: 'rock', height: 0.6, lod0: 2400, lod1: 600 },
  { id: 'log', role: 'Fallen log', asset: 'dead_tree_trunk', kind: 'rock', height: 0.8, lod0: 2400, lod1: 500 },
  { id: 'stump', role: 'Tree stump', asset: 'tree_stump_01', kind: 'rock', height: 0.6, lod0: 1600, lod1: 400 },
  { id: 'bin', role: 'Trash can', asset: 'metal_trash_can', kind: 'prop', height: 0.9, lod0: 2000, lod1: 500 },
];

// Models the brief asks for that neither source offers (verified by listing the catalogs).
// These are built procedurally in the game (src/render/props.js, vegetation.js).
export const PROCEDURAL_MODELS = [
  { id: 'palm', role: 'Palm tree', reason: 'Poly Haven has no palm model and ambientCG has no plant models' },
  { id: 'saguaro', role: 'Desert cactus', reason: 'no CC0 cactus model at either source' },
  { id: 'reeds', role: 'Reeds near water', reason: 'no reed model at either source' },
  { id: 'sign', role: 'Hole sign and yardage markers', reason: 'no golf sign model at either source; needs live text anyway' },
  { id: 'fence', role: 'Fence posts and rope', reason: 'only a chainlink fence is available, wrong for a golf course' },
  { id: 'teemarker', role: 'Tee markers', reason: 'not available at either source' },
  { id: 'bench', role: 'Park bench and ball washer', reason: 'the only CC0 bench at Poly Haven is an indoor shelf bench, which was downloaded, inspected, and rejected' },
  { id: 'flagpole', role: 'Flag pole, flag, and cup', reason: 'the flag needs a cloth simulation, so it is built in code' },
  { id: 'clubhouse', role: 'Clubhouse, out-buildings, bridges, grandstands', reason: 'no suitable CC0 building set; built from primitives with the downloaded PBR textures' },
];

// IBL environments. 1k equirect .hdr. The pipeline finds the sun direction in each so the
// game can rotate the environment to match the sun.
export const HDRIS = [
  { id: 'dawn', asset: 'kiara_1_dawn', role: 'Dawn sky' },
  { id: 'morning', asset: 'autumn_field_puresky', role: 'Clear morning sky' },
  { id: 'midday', asset: 'kloofendal_48d_partly_cloudy_puresky', role: 'Midday sky, partly cloudy' },
  { id: 'golden', asset: 'evening_road_01_puresky', role: 'Golden hour sky' },
  { id: 'dusk', asset: 'kiara_9_dusk', role: 'Dusk sky' },
  { id: 'night', asset: 'dikhololo_night', role: 'Night sky' },
  { id: 'clear', asset: 'kloofendal_43d_clear_puresky', role: 'Extra sky variety: clear midday' },
  { id: 'sunset', asset: 'belfast_sunset_puresky', role: 'Extra sky variety: soft sunset' },
];

// Generated in scripts/assets/procedural.mjs. Original work, no license needed.
export const PROCEDURAL_TEXTURES = [
  { id: 'water_normal', role: 'Tileable water ripple normal map', size: 512 },
  { id: 'cloud_noise', role: 'Tileable cloud noise (Perlin-Worley)', size: 512 },
  { id: 'detail_noise', role: 'Tileable detail noise for breaking up tiling', size: 256 },
];
