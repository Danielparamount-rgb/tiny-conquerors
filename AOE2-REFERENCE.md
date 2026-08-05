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
