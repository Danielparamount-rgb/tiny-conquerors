# Unit forge — 3D models, rigs, animations, sprite sheets

Original low-poly units for Tiny Conquerors, built and animated in Blender and
rendered the way a 1999 isometric RTS did it: model in 3D once, render out flat
sprite sheets for 8 facings, ship the sprites.

Everything here is generated from one script — **[`tc_forge.py`](tc_forge.py)**.
There are no hand-modelled `.blend` files to keep in sync; the `.blend`s in
`blends/` are *output*, regenerated on demand. Change the script, re-run, done.

**No Microsoft assets.** Every vertex, colour and pose here is original geometry
written as code. The palette is lifted from the game's own `TEAMS` / `SKIN`
constants, nothing else.

---

## Running it

Blender 5.2 LTS lives at `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`.

```bash
"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --factory-startup --python tc_forge.py -- --mode preview
```

| mode | what you get | roughly |
|---|---|---|
| `preview` | one `out/contact.png` — every unit × 8 facings, plus walk/attack/die strips | ~1 min/unit |
| `sheets` | `sheets/<unit>_<anim>.png` + `_mask.png` + `<unit>.json` + `atlas.json` | ~4 min/unit |
| `blend` | `blends/<unit>.blend` — armature, actions, materials, ready to open and scrub | seconds |

Useful flags: `--units villager,knight` · `--anims walk,die` · `--cell 128`
· `--ppm 36` · `--soft-alpha` · `--no-mask`.

To eyeball a unit up close, preview it zoomed: `--cell 240 --ppm 80`.

---

## The projection (this is the part that has to be exact)

The game's ground diamond is `IW=26, IH=13` — a 2:1 dimetric. That pins the
camera: a horizontal square rotated 45° projects 2:1 only when the vertical axis
is squashed by `sin(elevation) = 0.5`, so **elevation is exactly 30°**, and the
camera is orthographic.

Screen mapping used by both renderers:

```
sx = X
sy = 0.5·Y + 0.866·Z          (Blender screen-y up; the game's screen-y is down,
                               so game gy = −Blender Y)
```

Facings are produced by **rotating the model, not the camera** — the lights stay
world-fixed, so a unit walking away from the sun is lit differently from one
walking into it. That is the period-correct behaviour and it's why the sheets
have a consistent "sun from the upper-left" read.

Direction row `k` maps onto the game's octant index directly:

```python
psi_k = -(90° + 45°·k)        # object Z-rotation for row k
```

so **row `k` == `u._oct` == `k` from `octPhi()`**. No remapping needed.
Verified: row 2 faces the viewer, row 6 faces away, row 0 faces screen-right.

---

## Sheet format

- One PNG per unit per animation. **Rows top→bottom = octants 0…7. Columns
  left→right = frames.** Cell is square, `cell` px (default 128).
- Straight alpha, hard-thresholded at 0.4 (1-bit edges, like an SLP). Pass
  `--soft-alpha` if you'd rather have anti-aliased edges.
- `<unit>_<anim>_mask.png` — the same frames with team-coloured surfaces white
  and everything else black. Multiply-tint it to recolour per player instead of
  re-rendering eight palettes.

`<unit>.json`:

```json
{ "unit":"militia", "cell":128, "ppm":36.0, "dirs":8,
  "anchorX":64, "anchorY":90.51,
  "anims": { "walk": {"frames":12,"loop":true,"fps":12,
                      "sheet":"militia_walk.png","mask":"militia_walk_mask.png"} } }
```

`anchorX/anchorY` is where the unit's **feet** (world origin) sit inside the
cell, in pixels from the cell's top-left. Draw a sprite by putting that pixel on
the unit's tile position — do not centre the cell, or everything floats.

`ppm` is pixels per metre horizontally. At the default 36, a 1.78 m man lands
about 55 px tall, which is the AoE2 ballpark.

---

## Adding a unit

Add an entry to `UNITS` in `tc_forge.py`. It's one dict — the costume system is
deliberately the same idea as the game's `MAN_COSTUME`: one rig, many uniforms.

```python
'huskarl': dict(rig='man', anims=['idle','walk','attack','die'], atk='melee',
                costume=dict(tunic='team', legs='leatherDk', helm='steel',
                             weapon='axe', buckler=True, pauldron='steel')),
```

- `rig` — `man` or `horse` (horse builds the mount *and* seats a rider on it).
- `atk` — which attack animation to bake:
  | | |
  |---|---|
  | `melee` | overhead swing, pause at extension |
  | `thrust` | polearm stab — spears, pikes, couched lances |
  | `bow` | raise, draw to the cheek, loose |
  | `throw` | javelin / axe / petard wind-up and release |
  | `gun` | shoulder, fire, absorb the kick |
  | `convert` | monks: staff up, both arms raised, slow sway |
- `helm` — `steel` `kettle` `cap` `straw` `hood` `topknot` `plume` `crown` `hair`
  `turban` `band` `beast` `lamellar`.
- `weapon` — `sword` `greatsword` `spear` `pike` `lance` `axe` `tool` `staff`
  `bow` `crossbow` `twinsword` `javelin` `gun` `bomb`.
- flags — `shield` `buckler` `robe` `cape` `tabard` `sash` `quiver` `pauldron`
  `bracers` `belt` `horns` `paint` `spots` `sleeves:False` (bare arms), plus
  `barding`/`caparison`/`mane`/`hide` on mounts.
- colours are palette keys from `PAL`, so a new civ tint is one entry.

**Every unit needs a team-coloured surface.** Whichever one it is — tunic,
tabard, sash, shield, cape, robe hem, or a mount's caparison — something has to
carry the player colour, or the unit is unidentifiable in a fight. Half the
unique units failed this on the first pass because their costume is defined by
*not* being uniform: the Woad Raider is bare-chested, the Jaguar Warrior is gold
and tan, the Monk is a plain robe. They all got a sash or a hem.

A new weapon needs a branch in `add_weapon` and, importantly, an entry in
`CARRY` — the rest-pose offset that swings it clear of the body. Without one the
weapon is modelled *inside* the ribcage: the fist hangs at x=0.21 and the torso
is 0.47 wide. That was the single most visible bug in the first pass.

### Building geometry

`Builder` primitives: `box` `plate` `wedge` `cyl` `cone` (faceted), plus
`tube` `ball` `strap` (the sculpted ones).

`tube(bone, key, rings, ...)` lofts an elliptical section through
`rings = [(z, rx, ry, ox, oy), ...]`. Two things bite:

1. **Rings are sorted ascending internally.** Handing them over high-to-low used
   to flip the face winding and render the limb inside-out.
2. **`rot` rotates the whole tube after the rings are laid out**, so with
   `rot=(-90,0,0)` the ring's `z` becomes world **Y** and `oy` becomes world
   **−Z**. Reusing a rotated tube's offsets on an unrotated one puts the piece a
   metre away — that's exactly how the horse's caparison ended up floating
   beside it.

---

## Roster — 46 units, five rigs

Animations are `idle` `walk` `attack` `die` (the villager also has `work`;
passive ships and grazing animals skip `attack`).

| rig | units |
|---|---|
| **man** | villager, militia, spearman, pikeman, archer, crossbowman, skirmisher, handcannon, petard, monk, king, longbow, throwing axeman, berserk, huskarl, teutonic knight, woad raider, samurai, jaguar, eagle, plumed archer, chu ko nu, janissary |
| **horse** | scout, knight, cataphract, mameluke, mangudai, missionary |
| **siege** | ram, mangonel, scorpion, trebuchet, bombard cannon |
| **ship** | fishing ship, trade cog, transport, galley, longboat, fire ship, demolition ship, turtle ship, cannon galleon |
| **beast** | sheep, deer, boar |

`man` and `horse` share the costume system. The other three have their own
builder and their own pose set (`b_*`, `s_*`, `sh_*`) — a siege engine is a
chassis with a moving arm and rolling wheels, a ship is a lofted hull with a
mast and sail, a beast is a quadruped.

Two conventions worth knowing:

- **A ship's origin is the WATERLINE, not the keel.** The game draws water over
  the bottom of the hull, so the sprite anchor has to sit where hull meets water.
- **Siege wheel bones point along +X**, so spinning a wheel is a rotation about
  its own local Y. `s_walk` turns them exactly 360° per loop, which is what makes
  the cycle seamless.

## Style rules baked in

These are the things that make it read as 1999 rather than as a modern low-poly
asset, and they're easy to undo by accident:

- **Heroic proportions, not anatomical.** Big head, big hands, wide shoulders,
  short thick legs, oversized weapons. A correctly-proportioned man at 50 px is
  an unreadable smudge.
- **Sculpted, not stacked.** Limbs, torsos, necks and horse barrels are lofted
  tubes (`Builder.tube`) with a joint `ball` at elbow, knee and shoulder; heads
  are a skull ball plus a jaw, brow, nose and ears. A figure assembled from
  boxes reads as voxel art, not as a pre-rendered sprite. ~1700 polys a unit,
  which is roughly what the era actually shipped.
- **Mixed shading.** Rounded forms are smooth-shaded, armour plate and cloth
  slabs stay faceted. That contrast is most of what sells "sculpted".
- **Procedural surface texture, driven by a baked rest position.** Mail rings,
  cloth weave, wood grain, mottled leather, plate wear, fur, straw. Each vertex's
  **rest** position is written to a mesh attribute at build time and the textures
  sample *that*, not live coordinates — drive them from Object or Generated
  coords and the texture swims across the skin as the armature deforms it, which
  at 12fps reads as boiling static. It also means no UV unwrapping anywhere.
- **Texture has to drive a bump, not just the albedo.** A ±15% tint on the base
  colour is invisible at 55 pixels. What actually reads is the *normal*
  perturbation: against a hard-banded ramp the terminator wanders across the
  weave and the rings, and that's the thing your eye calls texture. `BUMP` sets
  the strength per surface kind; the metal specular rides the same normal.
- **Scale texture to the output, not to the model.** At 36 px/m anything finer
  than ~0.03 m is sub-pixel and aliases into noise, so nothing in `TEX` is
  finer than ~46 cycles/m. Always check a change at `--cell 128 --ppm 36`, not
  just zoomed in — texture that looks great at 240 px/m can be static at 36.
- **Five bands, plus specular on metal.** Those models were Phong-shaded and
  then squeezed into a 256-colour palette, which reads as a smooth-ish falloff
  broken into steps — not as a 3-band cel shade. Three hard bands look like a
  modern flat-shaded toy. Metals get a hard-edged hot spot (`METALS`).
- **`view_transform = 'Standard'`.** AgX or Filmic desaturates the whole thing
  into mush; these sprites want punch.
- **No black outlines.** The game's own art note says forms read through value
  contrast; the shader adds a thin warm inverse-fresnel rim instead.
- **World-fixed warm key from the upper-left**, cool fill, cool back rim —
  matching the 2D renderer's stated lighting.
- **Rigid skinning.** Every mesh part is weighted 100 % to one bone, so limbs
  stay hard-edged blocks instead of bending like rubber.

## Wiring sprites into the game (not done — this is a note, not a claim)

Nothing in `tiny-conquerors.html` reads these sheets yet. The game currently
draws units procedurally (`drawManRig` / `drawHorseRig`) in 2D and with real
geometry in 3D, and both still work exactly as before. If you do wire sprites
in, the pieces that make it cheap are already lined up: octant row == `u._oct`,
`anchorX/anchorY` for the draw origin, and the mask PNG for player colour.

Two cautions from the handoff that apply here: sprite caches key on
type/team/built/stage, so a new key dimension has to be added to the cache key;
and the artifact CSP blocks external requests, so any sheets used in the
artifact build have to be inlined as data URIs — which at this frame count is a
lot of bytes. The Render web app has no such limit.
