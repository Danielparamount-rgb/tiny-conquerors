# Graphics & Art Direction for RTS on Phone Screens — Research Report

## 1. Readability at small sizes
- **Silhouette-first (Blizzard doctrine)**: Samwise Didier (SC2 art director): characters live on "strong silhouettes, exaggerated proportions, distinctive animations, bold saturated colors" so RTS units read "from far away"; "nothing is subtle". StarCraft: Remastered treated silhouettes as untouchable IP; a Zergling's hands were 2px in the original and were expanded, outline shape stayed fixed. (GameSpot/PC Gamer Didier interviews; Blizzard "Remastering StarCraft's Art")
- **Exaggerated proportions in practice**: WoW/Warcraft: broad shoulders, massive hands, oversized weapons, big heads; "paint 2 larger chunkier nails instead of 4 small ones". Negative proof: WC3 Reforged made anatomy realistic, community documented readability loss at RTS camera distance. **Principle: at phone size (~35-55px units), head/weapon scale-up ~1.5-2x, hands ~2x is the Blizzard-lineage ratio.**
- **Pixel reality**: Ensemble postmortem — most AoE sprites were "20 to 100 pixels in each direction"; every rendered frame got hand-cleanup in Photoshop (sharpening, edge smoothing) because raw 3D renders don't read at that size. Per-frame cleanup (or sharpening/contrast post-pass) is where small-sprite readability is won.
- **Clash Royale**: pre-rendered 3D "Pixar-esque" sprites, boxy simplified models, simple gradients, strong contrast + distinctive silhouettes; units distinguished by icon + shape + color redundantly; **damage = brighten-flash of the whole sprite**. Ships only ~15-20 distinct types per match at ~60-100px.
- **How many distinguishable types**: no hard number; mobile games cap simultaneous distinct types far below desktop (C&C Rivals ~6/deck; CR 8 cards; Bad North 3 classes). Working-memory 7±2. **~6-10 simultaneously-present distinct types is the practical phone ceiling; desktop rosters survive only via redundant coding (silhouette + color + motion + sound).**
- **Outlines**: naive scaled-sprite outlines fail; working methods: 4x 1px-offset redraw, SDF alpha (TF2), offscreen blur+stencil. At 26px tiles: 1px dark outline baked into sprite (classic AoE2/SC) + shader rim only on selection.

## 2. Color and value
- **Blizzard value doctrine**: terrain/environments painted at lower saturation and mid values; characters higher saturation, wider value range; "readable at any distance". Anti-pattern: uniformly detailed realistic 3D (0 A.D. critique) creates "mental latency" — Strike Tactics dev chose pre-rendered sprites for glanceability.
- **Team colors shipped**: SC1: 8 (red, blue, teal, purple, orange, brown, white, yellow) via palette remap. AoE2: 8 (blue, red, green, yellow, cyan, purple, gray, orange). WC3: 12. Techniques: palette-shift, separate tinted mask layer, green-channel-as-mask.
- **Colorblind-safe**: Wong/Okabe-Ito palette is THE standard 8-color categorical set: #000000, #E69F00, #56B4E9, #009E73, #F0E442, #0072B2, #D55E00, #CC79A7. Blue-orange safest 2-team pair; avoid red-green, blue-purple, yellow-lightgreen; ~8% of men CVD. Modern convention: always-me-blue/enemy-red with colorblind toggle or free picker.

## 3. Isometric/dimetric conventions
- "Isometric" games are dimetric: ~26.565° (arctan 0.5) = exact 2:1 pixel stepping; true iso 30° = 1.732:1 (ugly stairs). SimCity 2000, RCT, AoE all 2:1. AoE2 tiles 96×48 at 800×600 — a 26px tile is small even by 1999 standards.
- **Facings shipped**: AoE2: **5 stored × mirrored to 8**; ~10 keyframes/direction, 50 frames per SLP. Mirroring saves ~37% memory but requires near-symmetric lighting. StarCraft: 22.5° steps — 17 stored frames mirrored (≈32 headings) for vehicles. Diablo 2: monsters 8 dirs, players 16; paperdoll layering. AoE1:DE went 8→32 directions × 3 resolutions = assets 300MB→17GB (cautionary).
- **Fixed light**: one global light top-left; baked drop shadows as separate semi-transparent layer (AoE2 SLP shadow layer; D2 sheared silhouette).
- **Original pipeline**: Ensemble modeled in 3D Studio (2k-100k polys), rendered to 256-color, 2D specialist cleaned every frame.
- **Modern pipeline — Factorio** (FFF-218, FFF-355): everything from Blender; one master .blend, 21 scenes (one per animation), linked meshes, shared materials; render layers → passes (color/mask/shadow/height); one character update = 4,000+ sprites ×2 for hi-res; hi-res re-render "never just more pixels". Extract passes separately: color, team-color mask, shadow, normal (AoE2 DE + Factorio both do).

## 4. Low-poly 3D for mobile
- Polytopia: bright low-poly, big blocky models — simplicity a byproduct of design for small screens. Bad North: 3 unit classes, flat-color low-poly, readability via color + silhouette only.
- **Vertex color vs texture**: 1000-instance test: vertex-color 15-20% faster; 150-tri crate 1024² texture ≈1.3MB vs ~4KB vertex-colored; "vertex color is always faster". Middle path: tiny shared palette texture (64×64 atlas, all meshes UV'd to cells) — one material → everything batches.
- **Mobile-friendly lighting**: single directional light, no realtime shadows (blob/decal), baked/hemisphere ambient, no per-pixel specular; flat shading hides low vertex counts, reads crisply, survives thermal throttling better.

## 5. Effects/VFX at phone scale
- **Diablo VFX doctrine (Julian Love, GDC 2013)**: readable in a split second; biggest/brightest moment belongs to the most important action; **alpha-composite blending beats pure additive in crowded fights** (additive stacks blow out white); constrain noise to mid-tones; power-of-two scroll-scale relationships.
- **What reads at 26px tiles**: hit feedback = full-sprite white flash 1-2 frames (CR blink) beats particle blood; projectiles exaggerated ~2-3x "real" scale + trails; selection = ground ellipse in team color + health bar only-when-damaged. Anti-pattern: persistent per-unit bars + circles + icons = noise wall; layer info (persistent = urgent only; long-press detail).
- **Fire/smoke**: two multiplied scrolling noise textures, randomized offsets/speeds (D3); pseudo-volumetric smoke via painted lit/shadow gradient.
- **Accessibility hard limits**: WCAG 2.3.1 — nothing flashing >3×/second; ≥20%-of-screen-area criterion; red flash worse; Xbox XAG 118: eliminate, don't warn. Screen shake: intensity slider/off; handheld held close → shake amplitude ~half desktop.

## 6. Animation
- Classic sprite RTS anims 6-12 fps; "10 fps is OK for unit animations"; walk 8-12 fps; game renders 60 while anim holds frames. D2 internal 25fps.
- Frame counts: AoE2 ~10 frames/direction/action. D2 ~12-16. Envelope at 26px-tile scale: 6-8 frame walk + 8-10 attack + 8-12 death.
- **Motion is a STRONGER identity channel than detail at small sizes.** Priorities: distinct walk gaits per class > attack anticipation > idle variety (nearly worthless at 40px). Death anims can be generic. Anti-pattern: facial/secondary motion invisible below ~60px.

## 7. Mobile GPU / browser budgets
- Frame budget @60 (16.6ms): JS 2ms, traversal 1ms, draw submission 4ms, shader 6ms, compositor 2ms, margin 1.6ms; **draw calls = #1 WebGL bottleneck**. A desktop 2ms shader can be 8ms on Adreno 740.
- Adreno/Mali are tile-based; sort opaque front-to-back; blended sprites always pay full fill — full-screen alpha stacks are the killer. Mali historically buggier WebGL than Adreno.
- Batching: PixiJS-class: 1,000 sprites → 1-2 draw calls if atlas-shared; type/blend changes break batches. WebGL2 instancing: 50,000+ quads @60fps vs ~1,000 per-object (~50x).
- **Memory/canvas limits**: iOS canvas memory cap historically 224-256MB; iOS Safari WebGL heap practical ~300-500MB. Texture: 99% of devices support 4096², only ~50% >4096 — **cap atlases 4096², prefer 1024-2048 for web**. Cap devicePixelRatio at 2x to protect fill rate.
- **Battery/thermal**: 60fps ≈ 1.5-2x power of 30fps; throttling onset 15-25 min sustained; **strategy games should target 30fps by design — stable 30 perceived better than 35-55 variable**. Browser vs native: no ADPF/Metal, Safari kills tabs over memory silently — budget ~half of native. Supercell: pre-rendered 2D sprites "lighter on GPU, allowing longer playtime" — **2D renderer is the battery-friendly default for phone RTS, 3D the opt-in.**

## 8. Environment art
- Terrain: classic tile + hand-authored transitions (AoE2 blend priority table) vs splatmaps (height/depth-aware splatting is the quality step). At 26px tiles per-pixel splat detail invisible — few terrain types, strong hue separation, hand-authored borders read better, one texture fetch.
- Features at small scale: forests as clustered canopy blobs not trunks; water needs motion (even 2-3 frame sparkle) + hard shoreline contrast; hills read via lightened top-face/darkened cliff contrast.
- **Day-night/weather as readability threats**: players park lighting at "brightest noon to see best"; recommendation: night/weather = tint grading that PRESERVES unit value contrast (clamp min luminance, exempt units/team colors from desaturation), or cosmetic-only. Anti-pattern: darkness + desaturation stacking kills team-color discrimination for CVD players.

## 9. UI art integration
- UI must follow game art style (flat over painted world reads broken); skeuomorphism signals affordances faster (relevant for casual audience), flat wins screen space — both valid if consistent.
- Persistent chrome = urgent-only; everything else behind panels/long-press. Playdigious porting pillars: optimization + UX/control adaptation.
- Touch targets: 48dp/44pt/WCAG minimums; primary actions 56-64pt; hit area may exceed visual (pad 35px units to ~44pt hitboxes).
- Portraits/icons: classic = same 3D models re-rendered high-res from fixed 3/4 portrait camera with dedicated lighting; budget path = one Blender portrait scene per unit sharing the game-model file (Factorio multi-scene pattern). **An icon is not a screenshot of the sprite: crop to head/shoulders, boost contrast, 1-2px border.**

## Cross-cutting principles
1. **Redundant coding is the master rule**: every unit distinguishable by ≥3 channels (silhouette, color, motion; +icon, +sound). Phones delete fine detail, so the others must be louder.
2. **Pre-rendered 2D is the historically and thermally correct default for phone RTS**; low-poly 3D viable only with vertex/palette coloring, one light, no realtime shadows, aggressive batching.
3. **Numbers**: 8 facings (5 stored + mirror), 6-10 frames/action @ 10-15fps playback, 8 team colors (Wong-adjacent), ≤4096² atlases (prefer ≤2048), 30fps render target, sub-100 draw calls, WCAG 3-flash limit, 44pt tap targets.
4. **Anti-patterns**: realistic proportions at RTS distance (Reforged); uniform detail/saturation (0 A.D.); additive VFX stacking; persistent per-unit UI clutter; night/weather compressing value range; >4096 textures; 60fps-or-bust on mobile browser; facing-count inflation (AoE1 DE 17GB).
