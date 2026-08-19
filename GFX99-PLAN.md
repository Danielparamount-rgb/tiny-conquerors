# The '99 Repaint — 20-point plan for true 1999 pre-rendered RTS graphics

Goal: the game should be visually indistinguishable, at arm's length, from a
1999 pre-rendered isometric RTS (AoE2 / StarCraft / Diablo II class). Not
"inspired by" — the actual look, recreated in totality with ORIGINAL art
(the IP line holds: reference is studied, never copied).

The one architectural rule carries over from the 3D rewrite: **built BESIDE
the current look, never instead of it** (a "Classic '99" mode toggle), so
every stage is A/B-comparable against what it replaces and the game ships at
every commit. All 20 points are render-side only — the sim, lockstep and the
four determinism baselines are untouched by construction. The endgame is
flipping Classic to the default once Daniel judges it better — the toggle is
the safety net the tiny-engine failure taught us, not the destination.

Why this is achievable here: the 1999 look was never "old graphics" — it was
a specific PIPELINE (pre-render 3D → downscale → hand-clean → index to a
256-color palette → dither), and we already own 80% of that pipeline in
`blender/tc_forge.py` / `tc_bforge.py`, whose camera matches the game's
projection to the pixel. What's missing is the back half of the chain — the
palette, the dither, the hard pixels — and the terrain/UI/FX layers.

---

## Phase A — the foundation (the look is a pipeline, not a filter)

**1. The reference board and style bible.** Assemble a fixed set of judgment
frames from our own reference captures (`f600.jpg`/`f1500.jpg`, the CD-era
observations in AOE2-REFERENCE.md, the 1v6 video frames) into one contact
sheet. Write measurable targets beside it: palette size, outline value, light
angle (single warm key, upper-left), shadow style (50% checkerboard stipple),
animation rates (10–15 fps), contrast curve. Every later point is judged
against this board, not against memory.

**2. The master palette.** One global 256-color indexed palette for the whole
game, exactly as the era shipped: ~8 ramps of 6–10 shades (grass greens,
earth browns, stone grays, wood, skin, fire, water blues, gold), with **8
reserved team-color ramps of 8 shades each** — team color becomes a palette
REMAP (the SC/AoE2 mechanism), not a mask-tint. Build the quantizer +
ordered-Bayer/error-diffusion dither as a pipeline tool (`blender/pal99.py`),
so every asset passes through the same 256 colors. This single point does
more for the 1999 look than any other: the era's texture IS dither.

**3. The hard-pixel rendering contract.** Kill smooth alpha everywhere in
Classic mode: 1-bit cutout sprite edges, `imageSmoothingEnabled=false`,
sprites blitted at integer pixel positions at exactly 1× or 2× (never
fractional scale — fractional scaling is the #1 modern "tell"). Zoom becomes
stepped (0.5× / 1× / 2×) instead of continuous in Classic. Camera pans snap
to whole pixels.

## Phase B — sprites (units first: they are what the eye judges)

**4. Re-render all 46 units through the '99 chain.** tc_forge already
renders the roster at the right camera; append the period post-chain: render
2× → downscale → **5-band posterized shading BEFORE quantization** (the
research: era sprites were Phong-shaded then palettized — 3 hard bands reads
as modern cel; 5 bands + palettize reads as 1999) → index to the master
palette → dither → bake the 1px near-black outline (warm dark, not pure
black — the standing house rule).

**5. The Ensemble cleanup pass, automated.** Ensemble's own postmortem: raw
3D renders never read at 20–100px — every frame got hand cleanup (sharpen,
edge-darken, contrast). We encode that as a deterministic filter stage:
unsharp mask tuned per sprite size, darkened silhouette edge, +10% local
contrast on the lit side. Verify on the militia at 1× against the reference
board before batch-rendering the roster.

**6. Baked stipple shadows.** Replace soft shadow ellipses with the era's
sheared 50%-checkerboard shadow layer, baked per facing into the sheets
(tc_forge already renders a shadow pass — it gets thresholded to the
checkerboard). Buildings get the long NW-baked shadow the same way.

**7. Period animation cadence.** Sheets locked to era counts: 8 facings
stored as **5 + mirror** (the authentic memory trick — and the authentic
mirrored-highlight quirk), ~10 frames per walk/attack, playback at 12–15 fps
with HELD frames. In Classic mode, every smooth motion aid dies: no walk-lean
interpolation, no idle breathing tween, no smoothed turning of the drawn
facing — facing snaps between the 8 octants. (The sim keeps its continuous
headings; only the DRAWING quantizes.)

**8. Buildings re-rendered through the same chain** via tc_bforge: the
period's age-dressing survives (thatch → shingle → slate), plus baked
construction scaffold stages, baked damage states (cracks at <50%, fire
anchor sockets), rubble sprites, and team banners via the palette-remap
ramps. Corpses get the 3-stage decay (fresh → darkened → bones) as baked
sprites; death fades by palette-darkening steps, never alpha.

## Phase C — the world

**9. Terrain becomes an authored, indexed TILE SET.** Retire the synthesized
smooth ground texture in Classic: 2:1 diamond tiles, 8–12 grass variants,
dirt/sand/shallow/deep sets, all through the palette + dither — and
hand-authored **transition tiles** between terrain types (the AoE2
blend-priority system, documented in the research). Dither carries the
texture; no gradients anywhere on the ground. This is the single biggest
pixel-owner and the pass that makes screenshots read as 1999.

**10. Palette-cycled water.** The classic trick, recreated: the water ramp's
indices rotate ~4 steps at ~8 fps, so the whole sea shimmers without
redrawing a pixel (implemented as 4 pre-shifted tile variants). Hard
shoreline transition tiles with dithered foam; fish sparkle as 2-frame index
blinks.

**11. Trees and resources as pre-rendered clusters.** The 5 species
re-rendered through the chain with baked stipple shadows and stump sprites;
forests must read as ONE near-black canopy mass with a scalloped edge (the
solid understory rule already in the 2D renderer, re-quantized). Gold/stone
crags, berries, carcasses, relics — all re-rendered.

**12. Hard cliffs and rim-lit hills.** Elevation stops being a smooth ramp in
Classic: painted hill-rim tiles with a hard lit edge (high ground must read —
it is +25% damage), and dithered slope shading. No geometric smoothing.

**13. Fog of war, tile-quantized.** Unexplored = black with a DITHERED tile
edge (never a soft blur); explored = the terrain palette REMAPPED one ramp
darker (index-darkening, exactly the era's method), not an alpha veil. The
drifting mist dies in Classic. Phone-visibility gotcha #4 is honored by
keeping today's effective brightness — only the edge TEXTURE changes.

## Phase D — effects and feedback (this is half of "play feel")

**14. Sprite-cycle FX only.** Fire = 8-frame loops through the fire ramp
(red→orange→yellow→white indices); smoke = dithered gray puff cycles; arrows
with hard 1px trails; explosions as authored frame loops. In Classic, every
modern layer is OFF: additive glows, the color grade, weather washes,
screen shake, soft particles. Weather itself becomes optional dithered rain
streaks (period games mostly just... didn't).

**15. Period command feedback, pixel-exact.** 1px hard white selection
ellipse; the classic green move-flag / red attack-flag 3-frame animation at
order targets; health bars as hard 25×3 red-on-green segment bars; waypoint
flags; the era's blinking minimap event ping (2-frame white blink). Desktop
gets period cursors (gauntlet, sword) as hard-edged cursor sprites. Order
acknowledgment stays instant — the era FELT snappy because feedback was
1-frame and unanimated.

## Phase E — the interface

**16. The full 1999 HUD skin.** Beveled stone-and-gold chrome rebuilt as
indexed 9-slice art: hard 2px bevels (light top-left / dark bottom-right —
no soft shadows, no rounded glass, no blur), carved panel plates, gold-trim
button frames with a 1-frame pressed inset, dialog boxes as stone frames,
icon plates with the period's beveled border. Text gets the era treatment:
a chunky serif with hard 1px black outline, no anti-aliased glow.
**Ergonomics stay 2026**: every tap target keeps its ≥44pt floor, the layout
and thumb-zone work stays — only the SKIN travels back in time.

**17. The minimap in period dress.** Gold diamond frame with corner studs
(exists — gets quantized + hard-beveled), terrain as hard single-index
pixels, units as 2×2 blips in team indices, viewport rectangle as a 1px
hard white diamond.

## Phase F — systemization, budget, acceptance

**18. "Classic '99" as a mode, then as the default.** `OPT.r99` swaps sprite
sets, tile sets, FX tables and the CSS skin — exactly the discipline that
carried the 3D rewrite: both looks shippable at every commit, A/B screenshots
against the reference board each stage, baselines re-run every stage (they
cannot move — render-only — and proving it every time is the point). The
artifact/CSP build keeps procedural fallbacks. When the contact sheets win
at arm's length, Classic becomes the DEFAULT and the modern look becomes
the toggle.

**19. The budget.** Indexed, dithered art compresses brutally well —
lossless WebP of palettized sprites should land UNDER today's 23MB despite
covering terrain too; sheets ride the immutable sprite cache (no re-download
on deploys). Frame cost should DROP (hard blits, no gradients, no grade, no
weather compositing); verified per stage with `?bench=1` and once at the end
with `?bench=long` on Daniel's phone. Canvas stays under the 4096px ceiling;
tile atlas ≤2048².

**20. The acceptance gauntlet.** Each phase ends with: (a) a contact sheet
(all affected assets at 1×) reviewed by Daniel against the reference board —
he is the art director, batches get approved or redone; (b) the arm's-length
test — one full game screenshot beside a reference frame; (c) the four
baselines + npm test + both MP suites; (d) a phone screenshot via the /save
harness. Play-feel proper (command latency feel, pacing, unit
responsiveness) is a SEPARATE pass scheduled after Phase D lands — half of
"feel" is the stepped animation and instant feedback this plan already
restores, and the rest deserves its own list rather than a footnote here.

---

## Order of execution and why

Phase A first (1–3: the palette and pipeline decide everything downstream) →
**Phase C terrain next** (9–13: biggest pixel-owner; the research is
explicit that ground sells the era) → Phase B units/buildings (4–8) →
Phase D FX/feedback (14–15) → Phase E UI (16–17) → flip the default (18).
Points 19–20 run continuously.

Estimated as 5–6 working sessions of the size of today's, most of it
Blender-render wall-clock that runs detached (keep-awake loop — the lesson
from the HD render).

## Standing constraints that bind every point

- **No Microsoft assets, ever** — reference is studied, art is original.
- **Nothing in the sim moves** — render-side only; baselines prove it each stage.
- **The artifact CSP build keeps working** via procedural fallback.
- **Gotcha 4** (fog phone-visibility) and the tap-target floors survive the skin.
- Sprite caches gain an `r99` key dimension (gotcha 3) or variants collide.
