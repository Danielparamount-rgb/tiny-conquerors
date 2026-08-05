# AoE2:TC Reference Observations (from user's video, 7 frames captured 2026-08-04)

Video: https://www.youtube.com/watch?v=ccN33zXNZSQ — "AoE2 The Conquerors, 1 vs 6 hard computer".
Frames (720px JPEG) saved at:
`C:\Users\deove\AppData\Local\Temp\claude\C--Users-deove--claude\03f3d2c7-ca23-47e9-b32e-a4ef6f0e7431\scratchpad\f{185,600,1500,2600,3600,4600,5200}.jpg`
- f185: Dark Age start, TC under construction w/ scaffold, lumberjacks, dirt patches
- f600: Feudal, big grass expanse + jungle edge top-right, thatched houses
- f1500: Imperial TOWN shot — dense houses/monastery/church, best building reference
- f2600: open field battle, trebuchet firing, projectile arcs
- f3600: pyramid castle (Mayan), corpse pile decaying in dirt circle
- f4600: stone watch towers, jungle, big dirt/sand areas
- f5200: massive battle aftermath — battlefield STREWN with corpses/debris, towers, huge armies

## The game being imitated: Tiny Conquerors
Source: `C:\Users\deove\.claude\tiny-conquerors\tiny-conquerors.html` (single file, ~4100 lines; artifact-published).
Handoff/architecture: `C:\Users\deove\.claude\tiny-conquerors\HANDOFF.md`. Isometric canvas RTS, IW=26 IH=13 tiles, sprites pre-rendered to offscreen canvases, HUD is plain HTML/CSS (top bar `#topbar`, bottom `#panel` with `#panelTitle`+`#btnRow`, minimap `#minimap` 96x96 top-right, zoom buttons).

## HUD observations (the biggest gap)
TOP BAR: thin dark wood strip. Left→right: 4 resource chips (icon + white number on small dark inset boxes: food, wood, gold, stone) then population "44/75". Center: current Age name. Right: tiny menu buttons. Below-left in the map area: game clock "00:05:22 (Fast) (Hard)" in white text.
BOTTOM PANEL (full-width, ~20% of screen height): ornate red-brown carved wood with gold/bronze studs and Celtic-knot filigree, divided into:
1. LEFT: 5x3 grid of SQUARE command buttons (~44px), dark slate backgrounds, thin gold borders, pictographic icons; disabled = darkened.
2. CENTER-LEFT: selected-entity card: square portrait icon w/ gold frame, green HP bar under it, name above, stat rows w/ tiny icons (sword=attack, shield=armor, numbers like "6+2").
3. CENTER: parchment/scroll rectangle (aged paper w/ faint circular compass watermark) showing civ name + player name; for multi-select: rows of small portrait tiles instead.
4. RIGHT: DIAMOND minimap inside chunky gold/bronze ornate frame; tiny buttons flanking it.
TEXT OVERLAYS on map: top-left event feed (white text, newest at bottom: "Villager Created", "--House Built--", "Bodkin Arrow Research Complete"); red warning "Warning: You are being attacked by ..."; bottom-right per-player SCORE TICKER in player colors "Name 2245 224? (Castle)"; above it army-count overlay "Cavalry: 36 / Siege Units: 9 / Ranged Units: 58 / Infantry: 45".

## Terrain/world observations
- Grass: mottled multi-green dither, NO tile grid visible; large irregular dirt/sand blobs (many tiles wide) with ragged dithered edges; secondary darker-grass macro patches.
- Jungle/forest: reads as SOLID dark canopy mass — deep shadow understory between crowns, no grass gaps inside forest; edge palms/fringe plants overhang.
- Doodads everywhere: grass tufts, small bushes, rocks, BONES/skeletons in dirt, fallen logs.
- Corpses persist & decay in stages (fresh → dark → skeletal); big battles leave the field carpeted in debris (f5200). Building deaths leave rubble.
- Projectiles: high arcing trajectories w/ visible trails (trebuchet stones, arrows).
- Shadows: strong directional building/unit/tree shadows, consistent direction.
- Fog: unexplored = pure BLACK; explored-not-visible = noticeably dimmed terrain, still black-backed minimap.
- Minimap: diamond, terrain-colored (green w/ dark forest texture, tan dirt), white/player-color unit dots, gold frame.

## Style summary
Dense, busy, grounded. Nothing floats: everything casts a shadow and sits on trampled ground. Palette: warm greens + browns, HUD is red-brown wood + gold + parchment. Text: serif gold headers, white system text with subtle black outline.

---

# CD DATA (extracted 2026-08-05 from C:\Users\deove\OneDrive\Documents\AOE2CONQ\UK — the real Conquerors CD)
Sources: DOCS\TECHTREE.PDF (18 pages, per-civ), DOCS\MANUAL.PDF (50pp UK, stat tables pp.42-47), GOODIES\AISCRIPT\SAMPLEAI.PER, WHATSNEW.RTF. Data/facts only — no Microsoft assets copied.

## Team bonuses (TECHTREE.PDF, applies to whole team incl. self)
- aztecs: Relics generate +33% gold
- britons: Archery Ranges work 20% faster
- byzantines: Monks heal +50% faster
- celts: Siege Workshops work 20% faster
- chinese: Farms +45 food
- franks: Knights +2 LOS
- goths: Barracks work 20% faster
- huns: Stables work 20% faster
- japanese: Galleys +50% LOS
- koreans: Mangonels/Onagers +1 range
- mayans: Walls cost -50%
- mongols: Scout Cavalry line +2 LOS
- persians: Knights +2 attack vs. archers
- saracens: Foot archers +1 attack vs. buildings
- spanish: Trade Cart/Trade Cog return +33% gold
- teutons: Units more resistant to conversion
- turks: Gunpowder units train 20% faster
- vikings: Docks cost -25%

## Missing unit stats (manual pp.44-46: cost | HP | atk | armor M/P | range | speed | notes)
- Scorpion: 75W 75G | 40 | 12 | 0/6 | 7 | slow | bolts pass through (damage all they touch)
- Heavy Scorpion: same cost | 50 | 16 | 0/7 | 7 | slow (upgrade 1000F 1100W)
- Mangonel: 160W 135G | 50 | 40 | 0/6 | 7 | slow | area damage
- Onager: same | 60 | 50 | 0/7 | 8 (upgrade 800F 500G)
- Siege Onager: same | 70 | 75 | 0/8 | 8 (upgrade 1450F 1000G)
- Bombard Cannon: 225W 225G | 80 | 40 | 2/5 | 12 | slow | req Chemistry; min range; bonus vs blds/ships
- Trebuchet: 200W 200G | 150 | 200 unpacked | 1/150 unpacked, 2/8 packed | 16 | pack/unpack; bonus vs blds/ships
- Hand Cannoneer: 45F 50G | 35 | 17 | 1/0 | 7 | med | bonus vs infantry; req Chemistry (archery range)
- Cannon Galleon: 200W 150G | 120 | 35 | 0/6 | 13 | med | req Chemistry; min range; bonus vs blds
- Elite Cannon Galleon: | 150 | 45 | 0/8 | 15 (upgrade 525W 500G)
- Bombard Tower upgrade: 800F 400S (Keep line; Chemistry req)
- Missionary: 100G | 30 | 0 | — | 7 conv range | fast

## Tech costs & effects (manual pp.47-49)
TC/building: Town Watch II 75F (+4 bld LOS); Town Patrol III 300F 200G (+4 more); Masonry III 175W 150S (+bld HP/armor); Architecture IV 200W 300S; Treadmill Crane III 200W 300S (+20% vill build speed); Hoardings IV 400W 400S (+1000 castle HP); Loom I 50G (+15 vill HP, +1/+1P armor); Wheelbarrow II 175F 50W (+10% vill speed, +25% carry); Hand Cart III 300F 200W (+10% speed, +50% carry); Sappers IV 400F 200G (vills +15 atk vs blds); Conscription IV 150F 150G (+33% train speed barracks/stable/range/castle); Spies IV 200G/enemy (see enemy LOS).
Gathering: Gold Mining II 100F 75W (+15%); Gold Shaft Mining III 200F 150W (+15%); Stone equivalents same; Double-Bit Axe II 100F 50W (+20% chop); Bow Saw III 150F 100W (+20%); Two-Man Saw IV 300F 200W (+10%); Horse Collar II 75F 75W (farm +75 food); Heavy Plow III 125F 125W (+125 food, +1 carry); Crop Rotation IV 250F 250W (+175 food).
Market: Coinage II 150F 50G; Banking III 200F 100G; Guilds IV 300F 200G (trade fee 15%); Caravan III 200F 200G (trade units faster); Cartography II 100F 100G (ally LOS).
Monastery: Fervor III 140G (+15% monk speed); Sanctity III 120G (+50% monk HP); Redemption III 475G (convert blds+siege); Atonement III 325G (convert monks); Heresy III 1000G (converted units die instead); Herbal Medicine III 350G (garrison heal 4x); Illumination IV 120G (+50% rejuvenation); Faith IV 750F 1000G (+50% conv resistance); Block Printing IV 200G (+3 conv range); Theocracy IV 400F 800G (one monk rests per group conversion).
University: Ballistics III 300W 175G (hit moving targets); Murder Holes III 200F 200S (no min range); Heated Shot III 350F 100G (+50% tower atk vs ships); Chemistry IV 300F 200G (+1 missile atk, enables gunpowder); Siege Engineers IV 500F 600W (+1 siege range except rams, +20% siege atk vs blds, +40% petard).
Cavalry: Bloodlines II 150F 100G (+20 HP mounted); Husbandry III 250F (+10% cav speed).
Archery: Thumb Ring III 300F 250W (fire faster, 100% accurate); Parthian Tactics IV (already in game).
Infantry: Tracking II 75F (+2 LOS); Squires III 200F (+10% speed).
Ships: Careening III 250F 150G (+1P armor, +5 transport cap); Dry Dock IV 600F 400G (+15% ship speed, +10 transport cap); Shipwright IV 1000F 300G (-20% ship wood).
Fish Trap: built by fishing ship, 100W, renewable food source (manual: Fishing Ship "Harvests fish; builds Fish Traps").
Farms EXPIRE in the real game (WHATSNEW/manual: farm expiry, auto-replant via Farm queue button at Mill).

## AI parameters (SAMPLEAI.PER — the shipped sample AI)
- Gatherer % by age — Dark: 60 food / 40 wood; Feudal: 35F/40G/25W; Castle+: 30F/30G/10S/30W. Builders 15% of civilians.
- Villager target ~30; houses when headroom <4; 3 TCs by Castle Age; farms: min 4, up to 12 when food <100; camps when dropsite-min-distance >5 (wood) / >7 (gold, stone), max 5 each.
- Military targets: knights 12, militia line 10, scout 1, UU 8, trebuchets 3, rams 4 (only when town not under attack); monks by difficulty: moderate 2, hard 4, hardest 6.
- Attacks: first at game-time 1100s, then every 1400s if ≥12 defend soldiers. Enemy sighted response distance 25; town size 25; camps ≤30 from town.
- AI "cheats" on long games: +700 each resource every ~45-60 min (we can skip this or gate by difficulty).
- Build order (one each unless noted): barracks → range → 2 stables → blacksmith → market → university → monastery → castle → siege workshop.

## Turbo mode (WHATSNEW) — possible future game mode
All buildings work 2.5x faster (except eco units), gathering 2.5x, trade 2x, construction 2.5x (except castles/towers/wonders).
