# STYLE99 — the Classic '99 style bible (GFX99-PLAN point 1)

Every Classic-mode asset is judged against these targets, not against memory.
Reference basis: our own CD-era observations (AOE2-REFERENCE.md), the f600/
f1500 frame notes, and the research digest (research/research-graphics.md:
Ensemble postmortem, StarCraft Remastered doctrine, Factorio pipeline).
Reference is STUDIED — art is always original.

## Measurable targets

| Property | Target | Why |
|---|---|---|
| Color count | ONE master 256-color palette (PAL99), everything indexed through it | The era's unifying constraint; palette discipline IS the look |
| Team color | 8 reserved ramps × 8 shades; team = ramp REMAP | SC/AoE2 mechanism; kills modern tint-wash |
| Texture | Ordered Bayer 4×4 dither; gradients are FORBIDDEN | Dither is the era's texture |
| Edges | 1-bit cutouts; sprite outline = 1px warm near-black (`rgba(50,33,17)` family, never pure black) | House rule + era read |
| Light | ONE warm key, upper-left, fixed; cool ambient fill | Already the house light; era-correct |
| Shading | 5-band posterize BEFORE palettize | Phong-then-palettize ≠ cel-shade |
| Shadows | 50% checkerboard stipple, sheared SE | The AoE2 shadow |
| Facings | 8 drawn (5 stored + mirror) | Era memory trick, mirrored-highlight quirk included |
| Animation | ~10 frames/action, played 12–15 fps, HELD frames, zero tweening | Period sheets ran ~12fps (already a corpse-topple rule) |
| Scaling | Integer only (1×/2×); zoom is STEPPED; camera snaps to whole pixels | Fractional scaling is the #1 modern tell |
| Fog | Hard tile diamonds, dithered edge, index-darkened explored | Alpha-veil fog is a 2010s look. Alphas keep gotcha-4 brightness |
| Water | Palette-cycled ramp (~4 steps at ~8fps) | The classic shimmer |
| FX | Sprite cycles through palette ramps; NO additive glow, grade, bloom, soft particles, screen shake | Era compositor had none of it |
| UI | Hard 2px bevels (light TL / dark BR), stone+gold 9-slice, 1px outlined chunky text | 2026 tap-target floors are kept |

## Forbidden in Classic mode
Smooth alpha edges · gradients · fractional sprite scale · motion tweening on
sprites · additive blending · the color grade · weather washes · drifting mist
· soft shadows · rounded/blurred UI.

## Judgment ritual (every phase)
1. Contact sheet of affected assets at 1× — Daniel approves or the batch is redone.
2. Arm's-length test: full game screenshot beside a reference frame.
3. The determinism + MP test gate (render-only work — baselines must be byte-identical).
4. One capture from a real phone.
