"""
tc_bforge.py — Tiny Conquerors BUILDING forge.

Companion to tc_forge.py: renders the game's buildings through the SAME camera,
sun and toon material system as the unit sheets, so the town finally matches the
army standing in it. Static renders — one image per (building, age) plus a
team-colour mask — written straight to app/bsprites/ as cropped WebP.

Geometry convention:
  - Tile system: a game tile is TILE_M metres on edge. The building is modeled
    AXIS-ALIGNED in a local frame (footprint square centred on the origin) and
    the whole object is rotated -45 deg so the footprint lands as the game's
    screen diamond. Local +X face = the SE face (down-right on screen), local
    -Y face = the SW face (down-left). Doors and signage go on those two.
  - Heights aim at the game's IHT silhouette budget so the existing roof-click
    boxes stay honest: height_m ~= 2*IHT / (0.866 * PPM).

Age dressing (mirrors the 3D renderer's buckets):
  0 Dark      rough thatch, wattle walls, no trim
  1 Feudal    neat thatch, half-timbered plaster
  2 Castle    terracotta tile, stone bases
  3 Imperial  slate roofs, pale ashlar stone
Signature buildings keep their identity at every age (monastery blue, wonder
gold, castle stone).

Run:
  blender -b --factory-startup --python tc_bforge.py -- --mode sheets
  blender -b --factory-startup --python tc_bforge.py -- --mode preview --blds house,castle
"""
import os, sys, math, json, argparse

os.environ['TC_FORGE_LIB'] = '1'
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy
import numpy as np
from mathutils import Vector, Euler, Matrix
import tc_forge as F
from tc_forge import Builder, link, toon_mat, mask_mat, D2R

def wipe_scene():
    F.wipe_scene()
    # the forge's material caches hold nodes from the wiped scene — stale refs crash
    F._MAT_CACHE.clear()
    F._MASK_CACHE.clear()
    F._MAT_BUMP.clear()

# ---------------------------------------------------------------------------
# PROJECTION — R=2: one game pixel becomes two sheet pixels (crisp on dpr>=2)
# ---------------------------------------------------------------------------
R      = 2                      # resolution multiplier vs the game's IW=26 scale
TILE_M = 1.5                    # metres per tile edge (arbitrary; ppm absorbs it)
PPM    = (2 * 26 * R) / (math.sqrt(2) * TILE_M)   # px/m so 1 tile diamond = 104px
HPX    = 0.866 * PPM            # vertical px per metre of height
def ht(iht):                    # IHT game-px -> model metres
    return (R * iht) / HPX

# ---------------------------------------------------------------------------
# PALETTE + TEXTURE EXTENSIONS (merged into the unit forge's tables so
# toon_mat()/mask_mat() serve them like any unit key)
# ---------------------------------------------------------------------------
F.PAL.update({
    'plaster':   '#e3d5ae',
    'plasterDk': '#c5b58c',
    'wattle':    '#b09a6e',
    'thatch':    '#c0a35e',
    'thatchDk':  '#957a3f',
    'terra':     '#b8613a',
    'terraDk':   '#8f4526',
    'slate':     '#6f8095',
    'slateDk':   '#55636f',
    'ashlar':    '#aaa28f',
    'ashlarDk':  '#7d7565',
    'stoneDk':   '#6e675c',
    'soil':      '#7a5c38',
    'soilDk':    '#5c4326',
    'crop':      '#8aa03f',
    'cropRipe':  '#c2a13c',
    'canvas':    '#d6c8a2',
    'bluRoof':   '#3f6fb5',
    'bluRoofDk': '#2c4f86',
    'goldRoof':  '#d9a72c',
    'charcoal':  '#3a332a',
    'forge':     '#e06820',
})
F.TEX.update({
    'plaster':   ('mottle', 10, 0.20), 'plasterDk': ('mottle', 10, 0.22),
    'wattle':    ('weave', 18, 0.34),
    'thatch':    ('straw', 16, 0.50),  'thatchDk':  ('straw', 16, 0.50),
    'terra':     ('plate', 12, 0.34),  'terraDk':   ('plate', 12, 0.34),
    'slate':     ('plate', 14, 0.28),  'slateDk':   ('plate', 14, 0.28),
    'ashlar':    ('mottle', 8, 0.30),  'ashlarDk':  ('mottle', 8, 0.30),
    'stoneDk':   ('mottle', 10, 0.30),
    'soil':      ('mottle', 14, 0.32), 'soilDk':    ('mottle', 14, 0.32),
    'crop':      ('straw', 22, 0.44),  'cropRipe':  ('straw', 22, 0.44),
    'canvas':    ('weave', 24, 0.26),
    'bluRoof':   ('plate', 12, 0.26),  'bluRoofDk': ('plate', 12, 0.26),
    'goldRoof':  ('plate', 14, 0.22),
    'charcoal':  ('mottle', 14, 0.26),
    'forge':     ('mottle', 20, 0.10),
})
F.METALS.update({'goldRoof': 0.26, 'forge': 0.10})

# roof / wall picks per age; signature buildings override locally
AGE = [
    dict(roof='thatchDk', roofT='thatchDk', wall='wattle',   wallLo='soilDk',  trim='woodDark'),
    dict(roof='thatch',   roofT='thatch',   wall='plaster',  wallLo='stoneDk', trim='woodDark'),
    dict(roof='terra',    roofT='terraDk',  wall='plaster',  wallLo='stone',   trim='woodDark'),
    dict(roof='slate',    roofT='slateDk',  wall='ashlar',   wallLo='ashlarDk',trim='stoneDk'),
]

# ---------------------------------------------------------------------------
# KIT OF PARTS (all on bone 'root'; Builder tags materials per face)
# ---------------------------------------------------------------------------
RT = 'root'

def plinth(B, x, y, w, d, h=0.10, key='stoneDk'):
    B.box(RT, key, (x, y, h / 2), (w + 0.14, d + 0.14, h))

def wallbox(B, x, y, w, d, h, z=0.0, key='plaster', lo=None, loh=0.16):
    """A wall mass; `lo` paints a damp course along the bottom."""
    if lo:
        B.box(RT, lo, (x, y, z + loh / 2), (w, d, loh))
        B.box(RT, key, (x, y, z + loh + (h - loh) / 2), (w * 0.995, d * 0.995, h - loh))
    else:
        B.box(RT, key, (x, y, z + h / 2), (w, d, h))

def gable(B, x, y, w, d, z, rise, key, along='Y', ov=0.14, ridge=True):
    """Gable roof. along='Y': ridge runs along local Y; 'X' rotates it."""
    rot = (0, 0, 90) if along == 'X' else None
    size = (w + ov, d + ov, rise) if along == 'Y' else (d + ov, w + ov, rise)
    B.wedge(RT, key, (x, y, z + rise / 2), size, rot=rot)
    if ridge:  # a proud ridge beam sells the roof line at 100px
        rl = (d if along == 'Y' else w) + ov
        B.box(RT, 'woodDark', (x, y, z + rise + 0.015),
              (0.05, rl, 0.045) if along == 'Y' else (rl, 0.05, 0.045))

def hip(B, x, y, w, d, z, rise, key, ov=0.14):
    """Four-slope pyramid roof (tapered box to a small top)."""
    B.box(RT, key, (x, y, z + rise / 2), (w + ov, d + ov, rise), top=0.10)

def coneroof(B, x, y, r, z, rise, key, seg=10, finial=None):
    B.cone(RT, key, (x, y, z + rise / 2), r, rise, seg=seg)
    B.cyl(RT, key, (x, y, z + 0.02), r + 0.05, 0.05, seg=seg)   # eave collar
    if finial:
        B.ball(RT, finial, (x, y, z + rise + 0.035), 0.035, seg=6, bands=4)

def timberframe(B, x, y, w, d, z, h, n=2):
    """Half-timber studs on the two camera-facing faces."""
    t = 0.035
    for i in range(n + 1):
        fx = x - w / 2 + w * i / n
        B.box(RT, 'woodDark', (fx, y - d / 2 - 0.006, z + h / 2), (t, 0.012, h))
        fy = y - d / 2 + d * i / n
        B.box(RT, 'woodDark', (x + w / 2 + 0.006, fy, z + h / 2), (0.012, t, h))
    for zz in (z + 0.02, z + h - 0.03):   # sill + top plate
        B.box(RT, 'woodDark', (x, y - d / 2 - 0.006, zz), (w, 0.012, 0.04))
        B.box(RT, 'woodDark', (x + w / 2 + 0.006, y, zz), (0.012, d, 0.04))

def door(B, x, y, face, wgt=0.16, hgt=0.26, key='woodDark', team=True):
    """Recessed door on the SE (+X) or SW (-Y) face, with a team-trim lintel."""
    if face == 'x':
        B.box(RT, key, (x + 0.004, y, hgt / 2), (0.02, wgt, hgt))
        if team:
            B.box(RT, 'team', (x + 0.006, y, hgt + 0.025), (0.02, wgt + 0.05, 0.05))
    else:
        B.box(RT, key, (x, y - 0.004, hgt / 2), (wgt, 0.02, hgt))
        if team:
            B.box(RT, 'team', (x, y - 0.006, hgt + 0.025), (wgt + 0.05, 0.02, 0.05))

def window(B, x, y, z, face, w=0.07, h=0.10, key='charcoal'):
    if face == 'x':
        B.box(RT, key, (x + 0.004, y, z), (0.015, w, h))
    else:
        B.box(RT, key, (x, y - 0.004, z), (w, 0.015, h))

def banner(B, x, y, z, h=0.40):
    B.cyl(RT, 'woodDark', (x, y, z + h / 2), 0.018, h, seg=5)
    B.plate(RT, 'team', (x + 0.085, y, z + h - 0.12), (0.17, 0.02, 0.22))
    B.plate(RT, 'teamDark', (x + 0.085, y, z + h - 0.245), (0.17, 0.02, 0.05))

def battens(B, x, y, w, d, z, rise, key, along='Y', n=4, ov=0.14):
    """Thin course lines down a gable's two slopes -- a big roof plane at 100px
    needs them or it reads as a single flat sticker."""
    L = (d if along == 'Y' else w) + ov
    span = (w if along == 'Y' else d) + ov
    for i in range(1, n):
        f = i / n
        zz = z + rise * f
        off = (span / 2) * (1 - f) * 0.98
        for sgn in (-1, 1):
            if along == 'Y':
                B.box(RT, key, (x + sgn * off, y, zz), (0.018, L, 0.018))
            else:
                B.box(RT, key, (x, y + sgn * off, zz), (L, 0.018, 0.018))

def chimney(B, x, y, z, s=0.09, h=0.22):
    B.box(RT, 'stoneDk', (x, y, z + h / 2), (s, s, h))
    B.box(RT, 'stone',   (x, y, z + h + 0.015), (s + 0.03, s + 0.03, 0.03))

def crate(B, x, y, s=0.11, z=0.0):
    B.box(RT, 'wood', (x, y, z + s / 2), (s, s, s))
def barrel(B, x, y, z=0.0):
    B.cyl(RT, 'wood', (x, y, z + 0.075), 0.055, 0.15, seg=7)
    B.cyl(RT, 'iron', (x, y, z + 0.075), 0.058, 0.02, seg=7)
def haypile(B, x, y, r=0.12):
    B.ball(RT, 'straw', (x, y, 0.05), r, seg=7, bands=4, scale=(1, 1, 0.62))
def logpile(B, x, y):
    for i, (ox, oz) in enumerate([(-.05, .04), (.05, .04), (0, .11)]):
        B.cyl(RT, 'wood', (x + ox, y, oz), 0.042, 0.30, seg=6, axis='Y')

def crenel(B, x, y, w, d, z, key='stone', t=0.09, hgt=0.13, n=5):
    """A crenellated parapet ring around a flat top."""
    B.box(RT, key, (x, y, z + 0.03), (w, d, 0.07))
    for side in range(4):
        for i in range(n):
            f = (i + 0.5) / n - 0.5
            if side == 0:   px, py = x + f * w, y - d / 2 + t / 2
            elif side == 1: px, py = x + f * w, y + d / 2 - t / 2
            elif side == 2: px, py = x - w / 2 + t / 2, y + f * d
            else:           px, py = x + w / 2 - t / 2, y + f * d
            B.box(RT, key, (px, py, z + 0.065 + hgt / 2), (t, t, hgt))

# ---------------------------------------------------------------------------
# THE BUILDINGS (each: fn(B, a) with a = AGE[age] dict, plus `age` int)
# W = footprint edge in metres, computed from size
# ---------------------------------------------------------------------------
def W_of(size): return size * TILE_M

def bld_house(B, age, a):
    W = W_of(1)
    w, d, wh = W * .74, W * .60, ht(16)
    plinth(B, 0, 0, w, d)
    wallbox(B, 0, 0, w, d, wh, z=0.08, key=a['wall'], lo=a['wallLo'])
    if age >= 1: timberframe(B, 0, 0, w, d, 0.24, wh - 0.16)
    gable(B, 0, 0, w, d, 0.08 + wh, ht(14), a['roof'], along='Y')
    door(B, w / 2, 0, 'x', hgt=wh * .62)
    window(B, 0, -d / 2, 0.08 + wh * .6, 'y')
    if age >= 2: chimney(B, -w * .18, d * .12, 0.08 + wh + ht(10))

def bld_tc(B, age, a):
    W = W_of(2)
    w, d, wh = W * .78, W * .62, ht(22)
    plinth(B, 0, 0, w, d, h=0.12)
    wallbox(B, 0, 0, w, d, wh, z=0.10, key=a['wall'], lo=a['wallLo'], loh=0.22)
    if age >= 1: timberframe(B, 0, 0, w, d, 0.36, wh - 0.30, n=3)
    gable(B, 0, 0, w, d, 0.10 + wh, ht(18), a['roof'], along='Y')
    battens(B, 0, 0, w, d, 0.10 + wh, ht(18), a['roofT'], along='Y', n=5)
    # cross-gable + cupola: the hall must outrank every house at a glance
    gable(B, -w * .18, 0, w * .5, d * 1.06, 0.10 + wh, ht(15), a['roof'], along='X', ridge=False)
    B.box(RT, 'woodDark', (-w * .18, 0, 0.10 + wh + ht(15) + 0.03), (0.10, 0.10, 0.10))
    B.wedge(RT, a['roofT'], (-w * .18, 0, 0.10 + wh + ht(15) + 0.11), (0.16, 0.16, 0.07))
    # the porch: an open team-trimmed entrance — the rally point of every town
    B.box(RT, 'woodDark', (w / 2 + 0.10, 0, ht(7)), (0.26, W * .30, 0.03))
    for sy in (-W * .13, W * .13):
        B.cyl(RT, 'wood', (w / 2 + 0.20, sy, ht(3.6)), 0.025, ht(7), seg=5)
    B.wedge(RT, a['roofT'], (w / 2 + 0.12, 0, ht(7) + 0.05), (0.34, W * .34, 0.10))
    door(B, w / 2, 0, 'x', wgt=0.22, hgt=wh * .55)
    window(B, w * .22, -d / 2, 0.10 + wh * .62, 'y')
    window(B, -w * .22, -d / 2, 0.10 + wh * .62, 'y')
    chimney(B, -w * .24, d * .16, 0.10 + wh + ht(13), s=0.10)
    banner(B, w * .40, d * .34, 0.10, h=ht(30))

def bld_farm(B, age, a):
    W = W_of(1)
    B.box(RT, 'soil', (0, 0, 0.015), (W * .96, W * .96, 0.03))
    n = 5
    for i in range(n):  # furrow rows of crops, ripening with age
        fx = -W * .40 + W * .80 * i / (n - 1)
        key = 'crop' if (age + i) % 3 else 'cropRipe'
        B.box(RT, key, (fx, 0, 0.05), (W * .09, W * .88, 0.055))
    for c in ((-W * .46, -W * .46), (W * .46, -W * .46), (W * .46, W * .46), (-W * .46, W * .46)):
        B.cyl(RT, 'woodDark', (c[0], c[1], 0.07), 0.018, 0.14, seg=5)

def bld_camp(B, age, a):
    W = W_of(1)
    w, d, wh = W * .72, W * .58, ht(11)
    plinth(B, 0, 0, w, d, h=0.06)
    wallbox(B, 0, 0, w, d, wh, z=0.05, key='wood', lo='woodDark')
    gable(B, -w * .08, 0, w * .84, d, 0.05 + wh, ht(9), a['roof'], along='Y')
    # lean-to over the log store
    B.wedge(RT, a['roofT'], (w * .38, 0, 0.05 + wh * .55), (w * .40, d + 0.14, ht(5)))
    logpile(B, w * .30, -d * .12)
    crate(B, -w * .26, -d * .34)
    door(B, 0, -d / 2, 'y', hgt=wh * .7)

def bld_barracks(B, age, a):
    W = W_of(2)
    w, d, wh = W * .76, W * .60, ht(19)
    plinth(B, 0, 0, w, d, h=0.10)
    wallbox(B, 0, 0, w, d, wh, z=0.08, key=a['wall'] if age < 3 else 'ashlar', lo=a['wallLo'], loh=0.20)
    gable(B, 0, 0, w, d, 0.08 + wh, ht(15), a['roof'], along='X')
    battens(B, 0, 0, w, d, 0.08 + wh, ht(15), a['roofT'], along='X', n=4)
    # two team shields flanking the door + a spear rack
    door(B, 0, -d / 2, 'y', wgt=0.24, hgt=wh * .5)
    for sx in (-0.26, 0.26):
        B.plate(RT, 'team', (sx, -d / 2 - 0.016, wh * .60), (0.19, 0.025, 0.24))
        B.ball(RT, 'iron', (sx, -d / 2 - 0.030, wh * .60), 0.028, seg=6, bands=4)
    for i in range(4):
        px = w * .30 + 0.001
        B.cyl(RT, 'wood', (px, -d * .30 + i * 0.09, ht(7)), 0.012, ht(13), seg=4,
              rot=(8, 0, 0))
        B.cone(RT, 'steel', (px, -d * .30 + i * 0.09 + 0.02, ht(13.6)), 0.025, 0.07, seg=4)
    banner(B, -w * .42, -d * .40, 0.0, h=ht(26))

def bld_range(B, age, a):
    W = W_of(2)
    w, d, wh = W * .62, W * .56, ht(15)
    plinth(B, -W * .10, 0, w, d, h=0.08)
    wallbox(B, -W * .10, 0, w, d, wh, z=0.06, key=a['wall'], lo=a['wallLo'])
    gable(B, -W * .10, 0, w, d, 0.06 + wh, ht(12), a['roof'], along='Y')
    door(B, -W * .10 + w / 2, 0, 'x', hgt=wh * .6)
    battens(B, -W * .10, 0, w, d, 0.06 + wh, ht(12), a['roofT'], along='Y', n=4)
    # the practice target in the south yard — the one prop that names the building
    tx, ty = W * .34, -W * .26
    B.box(RT, 'wood', (tx, ty, ht(5)), (0.06, 0.06, ht(10)))
    B.cyl(RT, 'straw', (tx, ty, ht(11)), 0.20, 0.09, seg=12, axis='X', rot=(0, 18, 0))
    B.cyl(RT, 'white', (tx + 0.016, ty, ht(11)), 0.13, 0.095, seg=10, axis='X', rot=(0, 18, 0))
    B.cyl(RT, 'red',   (tx + 0.030, ty, ht(11)), 0.065, 0.10, seg=8, axis='X', rot=(0, 18, 0))
    for aoff in (-0.06, 0.04):
        B.cyl(RT, 'woodDark', (tx + 0.07, ty + aoff, ht(11) + aoff), 0.010, 0.26, seg=4,
              axis='X', rot=(0, 35, 0))
    barrel(B, W * .10, -W * .38)
    banner(B, -W * .10 - w / 2 + 0.06, -d / 2 - 0.05, 0.0, h=ht(22))

def bld_stable(B, age, a):
    W = W_of(2)
    w, d, wh = W * .80, W * .58, ht(15)
    plinth(B, 0, 0, w, d, h=0.07)
    wallbox(B, 0, 0, w, d, wh, z=0.06, key='wood', lo='woodDark')
    if age >= 2: wallbox(B, 0, 0, w, d, 0.18, z=0.06, key='stone')
    gable(B, 0, 0, w, d, 0.06 + wh, ht(12), a['roof'], along='X')
    # open stall front with posts + hay
    B.box(RT, 'charcoal', (0, -d / 2 + 0.01, wh * .45), (w * .8, 0.02, wh * .55))
    for i in range(4):
        fx = -w * .36 + w * .72 * i / 3
        B.cyl(RT, 'woodDark', (fx, -d / 2 + 0.02, wh * .40), 0.022, wh * .8, seg=5)
    battens(B, 0, 0, w, d, 0.06 + wh, ht(12), a['roofT'], along='X', n=4)
    haypile(B, w * .34, -d * .52, r=0.16)
    haypile(B, w * .16, -d * .55, r=0.11)
    B.box(RT, 'woodDark', (-w * .30, -d * .55, 0.05), (0.30, 0.13, 0.10))
    B.box(RT, 'bluRoof', (-w * .30, -d * .55, 0.085), (0.26, 0.10, 0.02))
    door(B, w / 2, 0, 'x', hgt=wh * .66, team=True)

def bld_siege(B, age, a):
    W = W_of(2)
    w, d, wh = W * .72, W * .58, ht(16)
    plinth(B, 0, 0, w, d, h=0.08)
    wallbox(B, 0, 0, w, d, wh, z=0.06, key='wood', lo='stoneDk')
    gable(B, 0, 0, w, d, 0.06 + wh, ht(12), a['roofT'], along='Y')
    battens(B, 0, 0, w, d, 0.06 + wh, ht(12), 'woodDark', along='Y', n=4)
    # a half-built mangonel frame + a giant spare wheel in the south yard
    yx, yy = w * .34, -d * .62
    B.cyl(RT, 'woodDark', (yx, yy, 0.22), 0.20, 0.06, seg=10, axis='X')
    for sp in range(4):
        B.box(RT, 'wood', (yx, yy, 0.22), (0.03, 0.028, 0.36), rot=(sp * 45, 0, 0))
    B.box(RT, 'wood', (-w * .10, yy, 0.10), (0.55, 0.09, 0.09), rot=(0, 0, 14))
    B.box(RT, 'wood', (-w * .16, yy + 0.10, 0.16), (0.09, 0.09, 0.32), rot=(0, -28, 0))
    logpile(B, -w * .38, -d * .40)
    door(B, 0, -d / 2, 'y', wgt=0.30, hgt=wh * .62, team=True)
    banner(B, -w * .42, d * .30, 0.0, h=ht(24))

def bld_market(B, age, a):
    W = W_of(2)
    w, d, wh = W * .60, W * .52, ht(14)
    plinth(B, -W * .12, W * .08, w, d, h=0.07)
    wallbox(B, -W * .12, W * .08, w, d, wh, z=0.06, key=a['wall'], lo=a['wallLo'])
    hip(B, -W * .12, W * .08, w, d, 0.06 + wh, ht(11), a['roof'])
    # the striped team awning over the stall — the market's whole identity
    ax, ay = W * .18, -W * .26
    aw, ad = 0.72, 0.55
    for i in range(6):
        key = 'team' if i % 2 else 'canvas'
        B.plate(RT, key, (ax, ay + ad / 2 - (i + 0.5) * ad / 6, ht(13) - i * 0.028),
                (aw, ad / 6 + 0.01, 0.025), rot=(16, 0, 0))
    for c in ((ax - aw / 2 + .04, ay - ad / 2 + .04), (ax + aw / 2 - .04, ay - ad / 2 + .04),
              (ax - aw / 2 + .04, ay + ad / 2 - .04), (ax + aw / 2 - .04, ay + ad / 2 - .04)):
        B.cyl(RT, 'wood', (c[0], c[1], ht(6)), 0.020, ht(12), seg=5)
    B.box(RT, 'wood', (ax, ay, ht(3.4)), (aw * .84, ad * .7, 0.06))
    crate(B, ax - 0.16, ay + 0.03, s=0.11, z=ht(3.8))
    B.ball(RT, 'cropRipe', (ax + 0.10, ay - 0.05, ht(3.8) + 0.04), 0.055, seg=6, bands=4)
    B.ball(RT, 'red', (ax + 0.20, ay + 0.07, ht(3.8) + 0.035), 0.045, seg=6, bands=4)
    barrel(B, -W * .36, -W * .32)
    crate(B, -W * .28, -W * .36)

def bld_blacksmith(B, age, a):
    W = W_of(2)
    w, d, wh = W * .70, W * .56, ht(15)
    plinth(B, 0, W * .04, w, d, h=0.09)
    wallbox(B, 0, W * .04, w, d, wh, z=0.07, key='stone', lo='stoneDk', loh=0.2)
    gable(B, 0, W * .04, w, d, 0.07 + wh, ht(12), a['roofT'], along='Y')
    battens(B, 0, W * .04, w, d, 0.07 + wh, ht(12), 'woodDark', along='Y', n=4)
    chimney(B, -w * .20, W * .04 + d * .14, 0.07 + wh + ht(9), s=0.13, h=0.34)
    # the forge glow in the open front + anvil outside
    B.box(RT, 'charcoal', (w / 2 + 0.002, W * .04, wh * .38), (0.02, 0.42, wh * .62))
    B.box(RT, 'forge', (w / 2 + 0.010, W * .04, wh * .30), (0.02, 0.30, wh * .42))
    B.box(RT, 'iron', (w * .30, -d * .40, 0.14), (0.16, 0.08, 0.07))
    B.box(RT, 'iron', (w * .30, -d * .40, 0.09), (0.06, 0.06, 0.05))
    B.box(RT, 'woodDark', (w * .30, -d * .40, 0.045), (0.12, 0.10, 0.05))
    barrel(B, w * .12, -d * .42)

def bld_monastery(B, age, a):
    W = W_of(2)
    w, d, wh = W * .70, W * .56, ht(20)
    plinth(B, 0, 0, w, d, h=0.10)
    wallbox(B, 0, 0, w, d, wh, z=0.08, key='plaster' if age < 3 else 'ashlar', lo='stone', loh=0.2)
    gable(B, 0, 0, w, d, 0.08 + wh, ht(14), 'bluRoof', along='Y')
    # bell tower with the blue spire + the white gable cross
    tx, ty = -w * .28, d * .22
    B.box(RT, 'plaster' if age < 3 else 'ashlar', (tx, ty, wh + ht(6)), (0.24, 0.24, ht(16)))
    window(B, tx + 0.12, ty, wh + ht(10), 'x', w=0.06, h=0.10)
    coneroof(B, tx, ty, 0.17, wh + ht(14), ht(10), 'bluRoofDk', finial='goldRoof')
    B.box(RT, 'white', (w / 2 - 0.001 + 0.012, 0, 0.08 + wh + ht(8)), (0.02, 0.035, 0.16))
    B.box(RT, 'white', (w / 2 - 0.001 + 0.012, 0, 0.08 + wh + ht(9.5)), (0.02, 0.11, 0.035))
    door(B, 0, -d / 2, 'y', wgt=0.20, hgt=wh * .5)
    for wx in (w * .2, -w * .2):
        window(B, wx, -d / 2, 0.08 + wh * .6, 'y', w=0.06, h=0.13)

def bld_university(B, age, a):
    W = W_of(2)
    w, d, wh = W * .74, W * .58, ht(20)
    plinth(B, 0, 0, w, d, h=0.12)
    wallbox(B, 0, 0, w, d, wh, z=0.10, key='ashlar', lo='ashlarDk', loh=0.24)
    gable(B, 0, 0, w * .96, d, 0.10 + wh, ht(12), 'slate', along='Y')
    # the observatory dome — the university's signature
    B.ball(RT, 'bluRoof', (w * .22, d * .16, 0.10 + wh + ht(8)), 0.20,
           seg=10, bands=6, scale=(1, 1, 0.8))
    B.cyl(RT, 'ashlar', (w * .22, d * .16, 0.10 + wh + ht(3)), 0.21, ht(7), seg=10)
    B.ball(RT, 'goldRoof', (w * .22, d * .16, 0.10 + wh + ht(13.4)), 0.032, seg=6, bands=4)
    door(B, 0, -d / 2, 'y', wgt=0.22, hgt=wh * .45)
    for wx in (w * .26, 0, -w * .26):
        window(B, wx, -d / 2, 0.10 + wh * .62, 'y', w=0.06, h=0.14)
    for wy in (d * .2, -d * .2):
        window(B, w / 2, wy, 0.10 + wh * .55, 'x', w=0.06, h=0.14)

def bld_dock(B, age, a):
    W = W_of(2)
    # deck over water: planks on piles, a warehouse, mooring posts, boom crane
    B.box(RT, 'wood', (0, 0, 0.10), (W * .92, W * .92, 0.05))
    for c in ((-W * .40, -W * .40), (W * .40, -W * .40), (-W * .40, W * .40), (W * .40, W * .40),
              (0, -W * .42), (W * .42, 0)):
        B.cyl(RT, 'woodDark', (c[0], c[1], 0.02), 0.035, 0.20, seg=5)
    w, d, wh = W * .48, W * .40, ht(11)
    wallbox(B, -W * .16, W * .16, w, d, wh, z=0.12, key='wood', lo='woodDark')
    gable(B, -W * .16, W * .16, w, d, 0.12 + wh, ht(8), a['roofT'], along='X')
    # boom crane over the water side
    B.cyl(RT, 'woodDark', (W * .28, -W * .20, 0.12 + ht(8)), 0.03, ht(16), seg=6)
    B.box(RT, 'wood', (W * .28 + 0.16, -W * .20, 0.12 + ht(14)), (0.4, 0.04, 0.04), rot=(0, -18, 0))
    B.cyl(RT, 'rope', (W * .28 + 0.32, -W * .20, 0.12 + ht(10)), 0.006, ht(7), seg=4)
    crate(B, W * .28 + 0.32, -W * .20, s=0.10, z=0.12)
    crate(B, W * .10, -W * .30, z=0.12)
    barrel(B, -W * .02, -W * .34, z=0.12)
    banner(B, -W * .38, -W * .06, 0.12, h=ht(14))

def bld_tower(B, age, a):
    W = W_of(1)
    r, hgt = W * .30, ht(38)
    key = 'stone' if age < 3 else 'ashlar'
    B.cyl(RT, 'stoneDk', (0, 0, 0.07), r + 0.05, 0.14, seg=10)
    B.cyl(RT, key, (0, 0, 0.14 + hgt / 2), r, hgt, seg=10, rtop=r * .88)
    for zz in (hgt * .35, hgt * .7):   # ring courses
        B.cyl(RT, 'stoneDk', (0, 0, 0.14 + zz), r * .96 + 0.012, 0.035, seg=10)
    window(B, r * .82, 0, 0.14 + hgt * .55, 'x', w=0.045, h=0.13)
    window(B, 0, -r * .82, 0.14 + hgt * .75, 'y', w=0.045, h=0.13)
    door(B, 0, -r * .94, 'y', wgt=0.13, hgt=0.22, team=False)
    # crenellated deck + the clay/slate cone
    B.cyl(RT, key, (0, 0, 0.14 + hgt + 0.03), r * 1.05, 0.06, seg=10)
    for i in range(8):
        aa = 2 * math.pi * i / 8 + math.pi / 8
        B.box(RT, key, (math.cos(aa) * r * .98, math.sin(aa) * r * .98, 0.14 + hgt + 0.10), (0.06, 0.06, 0.08))
    coneroof(B, 0, 0, r * .8, 0.14 + hgt + 0.14, ht(14), a['roofT'] if age >= 2 else 'thatchDk',
             seg=10, finial='goldRoof' if age >= 2 else None)
    banner(B, r * .9, r * .5, 0.14 + hgt * .5, h=ht(15))

def bld_castle(B, age, a):
    W = W_of(2)
    w, d, hgt = W * .78, W * .78, ht(30)
    key, keyDk = ('stone', 'stoneDk') if age < 3 else ('ashlar', 'ashlarDk')
    plinth(B, 0, 0, w, d, h=0.16, key=keyDk)
    B.box(RT, key, (0, 0, 0.14 + hgt / 2), (w, d, hgt), top=0.94)
    B.box(RT, keyDk, (0, 0, 0.30), (w * 1.004, d * 1.004, 0.26))     # damp course
    # deck floor in the darker stone so the top face stops being a blank plate
    B.box(RT, keyDk, (0, 0, 0.14 + hgt + 0.005), (w * .90, d * .90, 0.02))
    crenel(B, 0, 0, w * .96, d * .96, 0.14 + hgt, key=key)
    # the central keep — a castle without one reads as an empty courtyard
    kw = w * .44
    B.box(RT, key, (0, 0, 0.14 + hgt + ht(7)), (kw, kw, ht(14)), top=0.95)
    crenel(B, 0, 0, kw * 1.02, kw * 1.02, 0.14 + hgt + ht(14), key=key, t=0.07, hgt=0.10, n=3)
    window(B, kw / 2, 0, 0.14 + hgt + ht(9), 'x', w=0.05, h=0.12)
    window(B, 0, -kw / 2, 0.14 + hgt + ht(9), 'y', w=0.05, h=0.12)
    banner(B, kw * .3, kw * .3, 0.14 + hgt + ht(14), h=ht(14))
    # four corner turrets with blue spires + gold finials
    tr = w * .16
    for cx, cy in ((-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2)):
        B.cyl(RT, key, (cx, cy, 0.14 + hgt * .58), tr, hgt * 1.16, seg=9, rtop=tr * .9)
        B.cyl(RT, keyDk, (cx, cy, 0.14 + hgt * 1.1), tr * .92, 0.04, seg=9)
        coneroof(B, cx, cy, tr * 1.05, 0.14 + hgt * 1.16, ht(13), 'bluRoofDk', seg=9,
                 finial='goldRoof')
    # gatehouse on the SW face: recessed arch, iron portcullis hint, team pennons
    door(B, 0, -d / 2, 'y', wgt=0.26, hgt=0.34, team=False)
    B.box(RT, keyDk, (0, -d / 2 - 0.01, 0.40), (0.34, 0.03, 0.12))
    B.box(RT, 'iron', (0, -d / 2 - 0.012, 0.30), (0.22, 0.015, 0.05))
    for px in (-0.20, 0.20):
        B.plate(RT, 'team', (px, -d / 2 - 0.015, 0.52), (0.09, 0.02, 0.18))
    for wx in (w * .26, -w * .26):
        window(B, wx, -d / 2, 0.14 + hgt * .62, 'y', w=0.05, h=0.15)
        window(B, w / 2, wx, 0.14 + hgt * .62, 'x', w=0.05, h=0.15)

def bld_wonder(B, age, a):
    W = W_of(2)
    w, d = W * .74, W * .74
    plinth(B, 0, 0, w, d, h=0.14, key='ashlarDk')
    # stepped marble mass with the gold dome — the endgame monument
    B.box(RT, 'ashlar', (0, 0, 0.12 + ht(9)), (w, d, ht(18)))
    B.box(RT, 'white', (0, 0, 0.12 + ht(20)), (w * .78, d * .78, ht(10)))
    for i in range(4):   # colonnade hints on the visible faces
        fy = -d * .30 + d * .60 * i / 3
        B.cyl(RT, 'white', (w * .40, fy, 0.12 + ht(9)), 0.035, ht(17), seg=6)
        B.cyl(RT, 'white', (-w * .30 + w * .60 * i / 3, -d * .40, 0.12 + ht(9)), 0.035, ht(17), seg=6)
    B.cyl(RT, 'goldRoof', (0, 0, 0.12 + ht(26)), w * .30, ht(3), seg=12)
    B.ball(RT, 'goldRoof', (0, 0, 0.12 + ht(31)), w * .30, seg=12, bands=7, scale=(1, 1, 0.72))
    B.cyl(RT, 'goldRoof', (0, 0, 0.12 + ht(36.5)), 0.02, ht(5), seg=5)
    B.ball(RT, 'goldRoof', (0, 0, 0.12 + ht(39.5)), 0.045, seg=6, bands=4)
    for cx, cy in ((-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2)):
        B.cyl(RT, 'ashlar', (cx, cy, 0.12 + ht(11)), 0.09, ht(22), seg=8)
        B.ball(RT, 'goldRoof', (cx, cy, 0.12 + ht(23)), 0.07, seg=7, bands=4, scale=(1, 1, 0.8))
    door(B, 0, -d / 2, 'y', wgt=0.22, hgt=0.30, key='charcoal', team=False)

BLDS = {
    'house':      (1, bld_house),
    'tc':         (2, bld_tc),
    'farm':       (1, bld_farm),
    'camp':       (1, bld_camp),
    'barracks':   (2, bld_barracks),
    'range':      (2, bld_range),
    'stable':     (2, bld_stable),
    'siege':      (2, bld_siege),
    'market':     (2, bld_market),
    'blacksmith': (2, bld_blacksmith),
    'monastery':  (2, bld_monastery),
    'university': (2, bld_university),
    'dock':       (2, bld_dock),
    'tower':      (1, bld_tower),
    'castle':     (2, bld_castle),
    'wonder':     (2, bld_wonder),
}

# ---------------------------------------------------------------------------
# STAGE / RENDER
# ---------------------------------------------------------------------------
def setup_bstage(res_w, res_h, anchor_z):
    """tc_forge's stage (same engine flags, same three suns) at a custom canvas."""
    cam = F.setup_stage(128, PPM, anchor_z=anchor_z)
    sc = bpy.context.scene
    sc.render.resolution_x = res_w
    sc.render.resolution_y = res_h
    cam.data.ortho_scale = max(res_w, res_h) / PPM
    return cam

def build_one(key, age):
    size, fn = BLDS[key]
    B = Builder()
    fn(B, age, AGE[age])
    # minimal one-bone armature so Builder.build's rig plumbing stays happy
    arm = F.make_armature(key + '_rig', [('root', None, (0, 0, 0), (0, 0.3, 0))])
    mesh = B.build(key, arm)
    rot = link(bpy.data.objects.new(key + '_ROT', None))
    arm.parent = rot
    rot.rotation_euler = (0, 0, -45 * D2R)   # square footprint -> screen diamond
    return dict(key=key, mesh=mesh, arm=arm, rot=rot, keys=list(mesh['tc_keys']))

def render_still(path):
    sc = bpy.context.scene
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)

def hard_alpha(a, thr=0.4):
    m = a[..., 3] >= thr
    a[..., 3] = m.astype(np.float32)
    return a

def crop_pair(beauty, mask, pad=1):
    al = beauty[..., 3] > 0.5
    ys, xs = np.where(al)
    if len(xs) == 0:
        return beauty, mask, 0, 0
    x0, x1 = max(0, xs.min() - pad), min(beauty.shape[1], xs.max() + 1 + pad)
    y0, y1 = max(0, ys.min() - pad), min(beauty.shape[0], ys.max() + 1 + pad)
    return beauty[y0:y1, x0:x1], (mask[y0:y1, x0:x1] if mask is not None else None), x0, y0

def save_img(arr, path, fmt='WEBP', quality=100):
    h, w = arr.shape[0], arr.shape[1]
    img = bpy.data.images.new(os.path.basename(path), w, h, alpha=True)
    img.colorspace_settings.name = 'Non-Color'
    img.alpha_mode = 'STRAIGHT'
    img.pixels.foreach_set(arr.reshape(-1).astype(np.float32))
    sc = bpy.context.scene
    sc.render.image_settings.file_format = fmt
    sc.render.image_settings.color_mode = 'RGBA'
    try:
        sc.render.image_settings.quality = quality
    except Exception:
        pass
    img.save_render(filepath=path, scene=sc)
    bpy.data.images.remove(img)
    return w, h

# generous per-building height estimates (metres) — the canvas is cropped to
# the alpha bounds afterwards, so oversizing costs render time, not bytes
HEST = {'house': None, 'farm': 0.5, 'camp': None, 'tower': None, 'castle': None,
        'wonder': None, 'monastery': None}
def hest(key):
    return {'house': ht(40), 'tc': ht(52), 'farm': 0.5, 'camp': ht(30),
            'barracks': ht(44), 'range': ht(37), 'stable': ht(37), 'siege': ht(38),
            'market': ht(35), 'blacksmith': ht(42), 'monastery': ht(64),
            'university': ht(52), 'dock': ht(40), 'tower': ht(78),
            'castle': ht(84), 'wonder': ht(66)}[key]

def do_sheets(names, outdir):
    os.makedirs(outdir, exist_ok=True)
    tmp = os.path.join(HERE, 'btmp')
    os.makedirs(tmp, exist_ok=True)
    atlas = {'ppt': 26 * R, 'scale': R, 'blds': {}}
    for key in names:
        size, _fn = BLDS[key]
        Wm = W_of(size)
        Hm = hest(key)
        # canvas: the footprint diamond + eave overhang wide, the spire tall
        res_w = int(math.sqrt(2) * Wm * PPM) + 70
        res_h = int((0.866 * Hm + 0.708 * Wm) * PPM) + 80
        res_w += res_w % 2; res_h += res_h % 2
        anchor = Hm / 2          # camera aims mid-height; the crop trims the rest
        # south corner of the footprint diamond, in FULL-image px from the top
        sx_full = res_w / 2
        sy_full = res_h / 2 + (0.866 * anchor + 0.354 * Wm) * PPM
        entry = {'size': size, 'ages': []}
        for age in range(4):
            wipe_scene()
            setup_bstage(res_w, res_h, anchor)
            unit = build_one(key, age)
            sc = bpy.context.scene
            sc.eevee.taa_render_samples = 24
            sc.eevee.use_shadows = True
            bp = os.path.join(tmp, '%s_a%d.png' % (key, age))
            render_still(bp)
            # mask pass: unlit white team surfaces
            F.swap_materials(unit['mesh'], unit['keys'], True)
            sc.eevee.taa_render_samples = 2
            sc.eevee.use_shadows = False
            mp = os.path.join(tmp, '%s_a%d_m.png' % (key, age))
            render_still(mp)
            beauty = hard_alpha(F.img_array(bp, 0))
            maskA = F.img_array(mp, 0)
            maskA[..., 3] = beauty[..., 3]
            # crop in blender's bottom-up coords. NO flip: save_img feeds
            # foreach_set, which expects bottom-up rows — Blender writes the
            # PNG right-side-up from those. (The first build flipped here and
            # every spire in the game pointed at the ground.)
            beauty, maskA, x0, y0 = crop_pair(beauty, maskA)
            hC = beauty.shape[0]
            # anchor in the FINAL image's top-down px
            rb_full = res_h - sy_full          # rows from the bottom
            ay = hC - (rb_full - y0)
            ax = sx_full - x0
            sheet = '%s_a%d.webp' % (key, age)
            maskf = '%s_a%d_m.webp' % (key, age)
            w, h = save_img(beauty, os.path.join(outdir, sheet))
            save_img(maskA, os.path.join(outdir, maskf))
            entry['ages'].append({'sheet': sheet, 'mask': maskf, 'w': w, 'h': h,
                                  'ax': round(ax, 1), 'ay': round(ay, 1)})
            print('  %s age %d -> %dx%d anchor(%.0f,%.0f)' % (key, age, w, h, ax, ay))
        atlas['blds'][key] = entry
    with open(os.path.join(outdir, 'bsprites.json'), 'w') as f:
        json.dump(atlas, f)
    print('atlas written: %d buildings' % len(atlas['blds']))

def do_preview(names, outdir):
    """One contact image: every requested building x 4 ages in a row grid."""
    os.makedirs(outdir, exist_ok=True)
    tmp = os.path.join(HERE, 'btmp')
    os.makedirs(tmp, exist_ok=True)
    cells = []
    CW = 300
    for key in names:
        row = []
        for age in range(4):
            wipe_scene()
            setup_bstage(CW, CW, hest(key) / 2)
            build_one(key, age)
            p = os.path.join(tmp, 'pv_%s_a%d.png' % (key, age))
            render_still(p)
            row.append(F.img_array(p, CW))
        cells.append(row)
    H, Wd = len(cells) * CW, 4 * CW
    out = np.zeros((H, Wd, 4), dtype=np.float32)
    out[..., 3] = 1.0
    out[..., 0:3] = 0.09
    for r, row in enumerate(cells):
        for c, img in enumerate(row):
            y0 = H - (r + 1) * CW
            a = img[..., 3:4]
            out[y0:y0 + CW, c * CW:(c + 1) * CW, :3] = (
                img[..., :3] * a + out[y0:y0 + CW, c * CW:(c + 1) * CW, :3] * (1 - a))
    F.save_array(out, os.path.join(outdir, 'bcontact.png'))
    print('preview -> %s' % os.path.join(outdir, 'bcontact.png'))

def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('--mode', default='preview', choices=['preview', 'sheets'])
    ap.add_argument('--blds', default='')
    ap.add_argument('--out', default='')
    a = ap.parse_args(argv)
    names = [n for n in a.blds.split(',') if n] or list(BLDS.keys())
    for n in names:
        if n not in BLDS:
            raise SystemExit('unknown building: ' + n)
    if a.mode == 'preview':
        do_preview(names, a.out or os.path.join(HERE, 'out'))
    else:
        do_sheets(names, a.out or os.path.abspath(os.path.join(HERE, '..', 'app', 'bsprites')))

main()
