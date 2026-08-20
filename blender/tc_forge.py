"""
tc_forge.py — Tiny Conquerors unit forge.

Builds low-poly 3D units in Blender, rigs and animates them, and renders them to
8-direction sprite sheets the way a 1999 isometric RTS did it: chunky readable
silhouettes, hard-banded toon shading, a world-fixed warm key light, and a fixed
2:1 dimetric orthographic camera.

The camera matches the game's own projection exactly (IW=26, IH=13 -> 2:1), so a
sheet rendered here drops onto the same octant index the sim already computes in
octPhi(): direction row k == u._oct == k.

Run:
  blender -b --factory-startup --python tc_forge.py -- --mode preview
  blender -b --factory-startup --python tc_forge.py -- --mode sheets --units militia,archer
  blender -b --factory-startup --python tc_forge.py -- --mode blend  --units knight

Modes:
  preview  one contact sheet: every unit x 8 facings, plus an animation strip
  sheets   full sprite sheets + team-colour masks + atlas JSON per unit
  blend    save an editable .blend per unit (armature, actions, materials)
"""

import bpy, bmesh, math, os, sys, json, argparse, shutil
from mathutils import Vector, Euler, Matrix

try:
    import numpy as np
except ImportError:
    np = None

HERE = os.path.dirname(os.path.abspath(__file__))
D2R = math.pi / 180.0

# ---------------------------------------------------------------------------
# 1. PROJECTION / OUTPUT CONFIG
# ---------------------------------------------------------------------------
# Game: IW=26, IH=13 -> ground diamond is 2:1 -> sin(elev)=0.5 -> 30 deg elevation.
ELEV_DEG   = 30.0
CAM_ROT_X  = 90.0 - ELEV_DEG      # 60 deg: Blender camera pitch from straight-down
SIN_E      = math.sin(ELEV_DEG * D2R)   # 0.5   vertical squash of ground
COS_E      = math.cos(ELEV_DEG * D2R)   # 0.866 how much world Z becomes screen Y

DIRS       = 8
R8         = 2 * math.pi / DIRS

def dir_yaw(k):
    """Object Z-rotation (radians) so the model's +Y forward lands on the game's octant k.

    Game rigProj: forward (0,1) -> ground (cos phi, sin phi), screen (gx, gy*0.5),
    screen-y down.  Blender screen: sx = X, sy = 0.5*Y + 0.866*Z, screen-y up.
    So game gy = -(Blender Y), giving forward_world = (cos phi, -sin phi).
    Model forward is +Y, so a Z-rotation psi gives (-sin psi, cos psi):
        -sin psi = cos phi,  cos psi = -sin phi  ->  psi = -(90 deg + phi)
    """
    return -(math.pi / 2 + k * R8)

CELL_DEFAULT = 128    # sprite cell in pixels
PPM_DEFAULT  = 36.0   # pixels per metre, horizontally (a man lands ~55px tall)
ANCHOR_Z     = 0.85   # metres above the feet that the camera centres on

# --- r99-human proportion pass (2026-08-20, Daniel: "more actual human like")
# The rigs are HEROIC on purpose (art gotcha 5: readable at 22px).  Classic '99
# now draws a ~60px man from the HD renders, so man-rig meshes shrink the head
# group and the hands about their own bone pivots at build time.  Bone-group
# based, so every helmet, hat, beard, ear and fist travels with its bone -- and
# RIDERS inherit it automatically (same bone names; the lifted pivot is read
# from the armature itself).  Gated on the man-rig bone signature so horses,
# beasts, ships and siege never qualify.
HUMANIZE = {'head': 0.83, 'handR': 0.86, 'handL': 0.86}

# ---------------------------------------------------------------------------
# 2. PALETTE  (drawn from the game's own TEAMS / SKIN / OUT values)
# ---------------------------------------------------------------------------
def srgb(hexstr):
    """Hex -> linear RGB tuple, because Blender node colours are linear."""
    h = hexstr.lstrip('#')
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (out[0], out[1], out[2], 1.0)

PAL = {
    'team':      '#2a56d4',   # TEAMS[0].main  (player 1 blue; the mask pass re-tints)
    'teamDark':  '#16308f',
    'teamTrim':  '#7da2f2',
    'skin':      '#e0b78e',   # SKIN
    'skinDark':  '#b5865c',
    'steel':     '#9aa4b0',
    'mail':      '#7c8592',   # riveted mail -- carries the voronoi ring texture
    'steelDark': '#5c6673',
    'iron':      '#6d7480',
    'gold':      '#d9a72c',
    'leather':   '#8a5f36',
    'leatherDk': '#5d4930',   # legs: any darker and they vanish into forest floor
    'wood':      '#8a6538',
    'woodDark':  '#5c421f',
    'linen':     '#c9b07f',
    'cloth':     '#8a6538',
    'rope':      '#b7a271',
    'straw':     '#bda05c',   # desaturated: bright straw reads as a gold halo
    'hair':      '#4a3320',
    'white':     '#ddd6c4',
    'red':       '#a8321f',
    'black':     '#2b2419',
    'stone':     '#8d8577',
    'tan':       '#c49a70',   # bare arms and legs (Woad, Jaguar, Eagle)
    'paleSkin':  '#d8b58e',
    'woad':      '#3f6fb5',   # the blue body paint the unit is named for
    'fur':       '#6b5a44',
    'silk':      '#c2543f',
    'jade':      '#5f8f6a',
    'turban':    '#e2dcc6',
    'lacquer':   '#7d2f28',   # samurai plate
    'bronze':    '#a8763a',
}

TEAM_KEYS = {'team', 'teamDark', 'teamTrim'}   # what the mask pass marks white

# ---------------------------------------------------------------------------
# 3. SCENE PLUMBING
# ---------------------------------------------------------------------------
def wipe_scene():
    for coll in (bpy.data.objects, bpy.data.meshes, bpy.data.armatures,
                 bpy.data.materials, bpy.data.actions, bpy.data.cameras,
                 bpy.data.lights, bpy.data.images):
        for item in list(coll):
            try:
                coll.remove(item)
            except Exception:
                pass

def link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob

def set_active(ob):
    for o in bpy.context.selected_objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob

# ---------------------------------------------------------------------------
# 4. MATERIALS — hard-banded toon, warm rim.  No black outlines (the game's rule).
# ---------------------------------------------------------------------------
_MAT_CACHE = {}
_MAT_BUMP = {}

# Which palette keys are metal.  Metals get a specular lobe; cloth and skin don't.
METALS = {'steel': 0.30, 'steelDark': 0.34, 'iron': 0.40, 'gold': 0.24,
          'bronze': 0.30, 'silver': 0.22}

# The 1999 pre-rendered look is NOT a 3-band cel shade -- those models were
# Phong-shaded and then squeezed into a 256-colour palette, which reads as a
# smooth-ish falloff broken into steps.  Five bands plus a specular hit lands
# there; three hard bands read as a modern flat-shaded toy.
BANDS = [(0.00, 0.24, 0.28, 0.42),   # position, then the cool/neutral/warm tint
         (0.15, 0.43, 0.45, 0.54),
         (0.33, 0.66, 0.65, 0.65),
         (0.55, 0.87, 0.85, 0.80),
         (0.77, 1.06, 1.02, 0.93)]

# --- surface texture -------------------------------------------------------
# kind -> (anisotropy, scale, strength).  Scale is in cycles per metre, so a
# feature is 1/scale metres across; at 36 px/m anything finer than ~0.03m is
# under a pixel and turns to noise, which is why nothing here goes above ~90.
TEX = {
    'steel':     ('plate', 20, 0.20),  'steelDark': ('plate', 20, 0.22),
    'iron':      ('plate', 16, 0.28),  'gold':      ('plate', 24, 0.18),
    'bronze':    ('plate', 20, 0.22),  'silver':    ('plate', 24, 0.18),
    'mail':      ('mail', 46, 0.38),
    'leather':   ('mottle', 22, 0.30), 'leatherDk': ('mottle', 22, 0.30),
    'wood':      ('wood', 11, 0.34),   'woodDark':  ('wood', 11, 0.34),
    'linen':     ('weave', 34, 0.26),  'cloth':     ('weave', 34, 0.28),
    'white':     ('weave', 34, 0.24),  'turban':    ('weave', 30, 0.24),
    'team':      ('weave', 30, 0.22),  'teamDark':  ('weave', 30, 0.22),
    'teamTrim':  ('weave', 30, 0.22),  'silk':      ('weave', 30, 0.23),
    'jade':      ('weave', 30, 0.24),  'lacquer':   ('plate', 24, 0.20),
    'skin':      ('skin', 26, 0.10),   'paleSkin':  ('skin', 26, 0.10),
    'tan':       ('skin', 26, 0.11),   'skinDark':  ('skin', 26, 0.10),
    'fur':       ('fur', 20, 0.40),    'hair':      ('fur', 30, 0.30),
    'straw':     ('straw', 24, 0.36),  'rope':      ('straw', 32, 0.30),
    'stone':     ('mottle', 14, 0.28), 'black':     ('mottle', 22, 0.22),
    'red':       ('weave', 30, 0.24),  'woad':      ('mottle', 30, 0.20),
}
# how the coordinate space is stretched before sampling -- this is what turns
# isotropic noise into grain, streaks or a weave
ANISO = {'wood': (1.0, 1.0, 0.10), 'straw': (1.0, 1.0, 0.14),
         'fur': (1.0, 1.0, 0.42), 'plate': (1.0, 1.0, 0.55)}

# How hard each surface perturbs the normal.  This matters far more than the
# albedo tint does: against a hard-banded ramp, bump makes the terminator wander
# across the weave/rings/grain, and THAT is what reads as texture at 55 pixels.
BUMP = {'mail': 1.00, 'weave': 0.45, 'wood': 0.55, 'mottle': 0.60,
        'plate': 0.35, 'fur': 0.85, 'straw': 0.70, 'skin': 0.18}

def _tex_nodes(nt, kind, scale, strength, y=420):
    """(albedo multiplier around 1.0, raw height) for one surface kind.
    Driven by the baked rest-position attribute, so it never swims."""
    attr = nt.nodes.new('ShaderNodeAttribute')
    attr.attribute_name = 'rest'
    attr.attribute_type = 'GEOMETRY'
    attr.location = (-1700, y)
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.location = (-1520, y)
    nt.links.new(attr.outputs['Vector'], mp.inputs['Vector'])
    ax, ay, az = ANISO.get(kind, (1.0, 1.0, 1.0))
    mp.inputs['Scale'].default_value = (scale * ax, scale * ay, scale * az)

    def noise(det, rough, sc=1.0, yy=y):
        n = nt.nodes.new('ShaderNodeTexNoise')
        n.location = (-1320, yy)
        try:
            n.inputs['Detail'].default_value = det
            n.inputs['Roughness'].default_value = rough
            n.inputs['Scale'].default_value = sc
        except Exception:
            pass
        nt.links.new(mp.outputs['Vector'], n.inputs['Vector'])
        return n.outputs['Fac']

    if kind == 'mail':
        v = nt.nodes.new('ShaderNodeTexVoronoi')
        v.location = (-1320, y)
        try:
            v.feature = 'F1'
            v.inputs['Scale'].default_value = 1.0
        except Exception:
            pass
        nt.links.new(mp.outputs['Vector'], v.inputs['Vector'])
        src = v.outputs['Distance']
    elif kind == 'weave':
        # two crossed band waves = cloth; the noise breaks up the regularity
        ws = []
        for i, d in enumerate(('X', 'Y')):
            w = nt.nodes.new('ShaderNodeTexWave')
            w.location = (-1320, y - i * 160)
            try:
                w.wave_type = 'BANDS'
                w.bands_direction = d
                w.inputs['Scale'].default_value = 1.0
                w.inputs['Distortion'].default_value = 1.6
            except Exception:
                pass
            nt.links.new(mp.outputs['Vector'], w.inputs['Vector'])
            ws.append(w.outputs['Fac'])
        m = nt.nodes.new('ShaderNodeMath')
        m.operation = 'MULTIPLY_ADD'
        m.location = (-1140, y)
        nt.links.new(ws[0], m.inputs[0])
        nt.links.new(ws[1], m.inputs[1])
        nt.links.new(noise(3.0, 0.5, 1.0, y - 320), m.inputs[2])
        src = m.outputs['Value']
    elif kind == 'wood':
        src = noise(8.0, 0.62)
    elif kind == 'fur':
        src = noise(9.0, 0.72)
    elif kind == 'straw':
        src = noise(6.0, 0.60)
    elif kind == 'skin':
        src = noise(3.0, 0.45)
    elif kind == 'plate':
        src = noise(5.0, 0.55)
    else:
        src = noise(6.0, 0.55)

    mr = nt.nodes.new('ShaderNodeMapRange')
    mr.location = (-960, y)
    try:
        mr.inputs['From Min'].default_value = 0.18
        mr.inputs['From Max'].default_value = 0.82
        mr.inputs['To Min'].default_value = 1.0 - strength
        mr.inputs['To Max'].default_value = 1.0 + strength * 0.65
        mr.clamp = True
    except Exception:
        pass
    nt.links.new(src, mr.inputs['Value'])
    return mr.outputs['Result'], src

def toon_mat(key):
    """Banded diffuse + optional specular + procedural surface texture."""
    if key in _MAT_CACHE:
        return _MAT_CACHE[key]
    base = srgb(PAL[key])
    mat = bpy.data.materials.new('tc_' + key)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()

    diff = nt.nodes.new('ShaderNodeBsdfDiffuse')
    diff.inputs['Color'].default_value = (1, 1, 1, 1)
    diff.location = (-900, 0)
    s2r = nt.nodes.new('ShaderNodeShaderToRGB')
    s2r.location = (-720, 0)
    nt.links.new(diff.outputs['BSDF'], s2r.inputs['Shader'])

    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.location = (-540, 0)
    cr = ramp.color_ramp
    cr.interpolation = 'CONSTANT'
    cr.elements[0].position = BANDS[0][0]
    cr.elements[0].color = (BANDS[0][1], BANDS[0][2], BANDS[0][3], 1)
    cr.elements[1].position = BANDS[1][0]
    cr.elements[1].color = (BANDS[1][1], BANDS[1][2], BANDS[1][3], 1)
    for pos, r, g, b in BANDS[2:]:
        e = cr.elements.new(pos)
        e.color = (r, g, b, 1)
    nt.links.new(s2r.outputs['Color'], ramp.inputs['Fac'])

    # albedo = flat colour, modulated by the surface texture; the same texture
    # also drives a bump so the surface actually catches the light
    albedo = None
    if key in TEX:
        kind, tscale, tstr = TEX[key]
        fac, height = _tex_nodes(nt, kind, tscale, tstr)
        alb = nt.nodes.new('ShaderNodeMixRGB')
        alb.blend_type = 'MULTIPLY'
        alb.inputs['Fac'].default_value = 1.0
        alb.inputs['Color1'].default_value = base
        alb.location = (-780, 320)
        nt.links.new(fac, alb.inputs['Color2'])
        albedo = alb.outputs['Color']

        bump = nt.nodes.new('ShaderNodeBump')
        bump.location = (-780, 60)
        try:
            bump.inputs['Strength'].default_value = BUMP.get(kind, 0.4)
            bump.inputs['Distance'].default_value = 0.03
        except Exception:
            pass
        nt.links.new(height, bump.inputs['Height'])
        nt.links.new(bump.outputs['Normal'], diff.inputs['Normal'])
        _MAT_BUMP[key] = bump

    mul = nt.nodes.new('ShaderNodeMixRGB')
    mul.blend_type = 'MULTIPLY'
    mul.inputs['Fac'].default_value = 1.0
    mul.inputs['Color1'].default_value = base
    mul.location = (-340, 0)
    if albedo:
        nt.links.new(albedo, mul.inputs['Color1'])
    nt.links.new(ramp.outputs['Color'], mul.inputs['Color2'])

    chain = mul

    # specular: a hard-edged hot spot, which is what sells polished plate at 50px
    if key in METALS:
        gl = nt.nodes.new('ShaderNodeBsdfGlossy')
        gl.inputs['Color'].default_value = (1, 1, 1, 1)
        try:
            gl.inputs['Roughness'].default_value = METALS[key]
        except Exception:
            pass
        gl.location = (-900, -280)
        if key in _MAT_BUMP:      # the highlight has to ride the same relief
            nt.links.new(_MAT_BUMP[key].outputs['Normal'], gl.inputs['Normal'])
        gs = nt.nodes.new('ShaderNodeShaderToRGB')
        gs.location = (-720, -280)
        nt.links.new(gl.outputs['BSDF'], gs.inputs['Shader'])
        sramp = nt.nodes.new('ShaderNodeValToRGB')
        sramp.location = (-540, -280)
        scr = sramp.color_ramp
        scr.interpolation = 'CONSTANT'
        scr.elements[0].position = 0.0
        scr.elements[0].color = (0, 0, 0, 1)
        scr.elements[1].position = 0.34
        scr.elements[1].color = (0.16, 0.16, 0.15, 1)
        e = scr.elements.new(0.62)
        e.color = (0.52, 0.50, 0.44, 1)
        nt.links.new(gs.outputs['Color'], sramp.inputs['Fac'])
        sadd = nt.nodes.new('ShaderNodeMixRGB')
        sadd.blend_type = 'ADD'
        sadd.inputs['Fac'].default_value = 1.0
        sadd.location = (-160, -140)
        nt.links.new(chain.outputs['Color'], sadd.inputs['Color1'])
        nt.links.new(sramp.outputs['Color'], sadd.inputs['Color2'])
        chain = sadd

    # thin warm rim so the silhouette stays legible at 50px without an outline
    fres = nt.nodes.new('ShaderNodeFresnel')
    fres.inputs['IOR'].default_value = 1.5
    fres.location = (-720, -540)
    rramp = nt.nodes.new('ShaderNodeValToRGB')
    rramp.location = (-540, -540)
    rcr = rramp.color_ramp
    rcr.interpolation = 'CONSTANT'
    rcr.elements[0].position = 0.0
    rcr.elements[0].color = (0, 0, 0, 1)
    rcr.elements[1].position = 0.68
    rcr.elements[1].color = (0.20, 0.16, 0.10, 1)
    nt.links.new(fres.outputs['Fac'], rramp.inputs['Fac'])

    add = nt.nodes.new('ShaderNodeMixRGB')
    add.blend_type = 'ADD'
    add.inputs['Fac'].default_value = 1.0
    add.location = (40, 0)
    nt.links.new(chain.outputs['Color'], add.inputs['Color1'])
    nt.links.new(rramp.outputs['Color'], add.inputs['Color2'])

    em = nt.nodes.new('ShaderNodeEmission')
    em.location = (220, 0)
    nt.links.new(add.outputs['Color'], em.inputs['Color'])
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    out.location = (400, 0)
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])

    _MAT_CACHE[key] = mat
    return mat

_MASK_CACHE = {}

def mask_mat(key):
    """Flat white where the material is team-coloured, flat black elsewhere."""
    if key in _MASK_CACHE:
        return _MASK_CACHE[key]
    lit = key in TEAM_KEYS
    mat = bpy.data.materials.new('mask_' + key)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (1, 1, 1, 1) if lit else (0, 0, 0, 1)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    _MASK_CACHE[key] = mat
    return mat

# ---------------------------------------------------------------------------
# 5. MESH BUILDER — raw vert/face assembly, one mesh per unit, rigid weights
# ---------------------------------------------------------------------------
class Builder:
    """Accumulates chunky primitives, each tagged with a bone and a palette key."""

    def __init__(self):
        self.verts = []
        self.faces = []
        self.face_key = []      # palette key per face
        self.face_smooth = []   # per face: rounded forms smooth, plate/armour flat
        self.vert_bone = []     # bone name per vert

    def _emit(self, vs, fs, key, bone, smooth=False):
        off = len(self.verts)
        self.verts.extend(vs)
        self.vert_bone.extend([bone] * len(vs))
        for f in fs:
            self.faces.append(tuple(i + off for i in f))
            self.face_key.append(key)
            self.face_smooth.append(smooth)

    @staticmethod
    def _xform(vs, center, rot, pivot=None):
        m = Matrix.Identity(3)
        if rot:
            m = Euler((rot[0] * D2R, rot[1] * D2R, rot[2] * D2R), 'XYZ').to_matrix()
        p = Vector(pivot) if pivot else Vector((0, 0, 0))
        c = Vector(center)
        return [tuple((m @ (Vector(v) - p)) + p + c) for v in vs]

    def box(self, bone, key, center, size, top=1.0, bot=1.0, rot=None, shear=0.0):
        """Axis-aligned box, optionally tapered top/bottom and sheared along +Y."""
        sx, sy, sz = size[0] / 2, size[1] / 2, size[2] / 2
        vs = []
        for zi, sc in ((-sz, bot), (sz, top)):
            sh = shear * (zi / sz if sz else 0)
            tx, ty = sx * sc, sy * sc
            vs += [(-tx, -ty + sh, zi), (tx, -ty + sh, zi),
                   (tx, ty + sh, zi), (-tx, ty + sh, zi)]
        fs = [(0, 1, 2, 3)[::-1], (4, 5, 6, 7),
              (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
        self._emit(self._xform(vs, center, rot), fs, key, bone)

    def cyl(self, bone, key, center, r, h, seg=8, rtop=None, rot=None, axis='Z'):
        rtop = r if rtop is None else rtop
        vs, fs = [], []
        for zi, rr in ((-h / 2, r), (h / 2, rtop)):
            for i in range(seg):
                a = 2 * math.pi * i / seg + math.pi / seg
                vs.append((math.cos(a) * rr, math.sin(a) * rr, zi))
        for i in range(seg):
            j = (i + 1) % seg
            fs.append((i, j, seg + j, seg + i))
        fs.append(tuple(range(seg))[::-1])
        fs.append(tuple(range(seg, 2 * seg)))
        if axis == 'Y':
            vs = [(x, z, y) for (x, y, z) in vs]
        elif axis == 'X':
            vs = [(z, y, x) for (x, y, z) in vs]
        self._emit(self._xform(vs, center, rot), fs, key, bone)

    def cone(self, bone, key, center, r, h, seg=8, rot=None):
        self.cyl(bone, key, center, r, h, seg=seg, rtop=0.012, rot=rot)

    def tube(self, bone, key, rings, seg=10, smooth=True, rot=None, center=(0, 0, 0),
             cap_lo=True, cap_hi=True):
        """Loft an elliptical cross-section through `rings` = [(z, rx, ry, ox, oy), ...].

        This is the workhorse for limbs, necks and torsos.  A tapered tube with
        smooth normals is what separates a sculpted figure from a stack of boxes,
        and it costs the same handful of polygons.
        """
        # Loft ascending, always.  Rings given high-to-low flip the face winding and
        # the whole limb renders inside-out; sorting here beats remembering to.
        rings = sorted(rings, key=lambda r: r[0])
        vs, fs = [], []
        for (z, rx, ry, ox, oy) in rings:
            for i in range(seg):
                a = 2 * math.pi * i / seg + math.pi / seg
                vs.append((math.cos(a) * rx + ox, math.sin(a) * ry + oy, z))
        for r in range(len(rings) - 1):
            b0, b1 = r * seg, (r + 1) * seg
            for i in range(seg):
                j = (i + 1) % seg
                fs.append((b0 + i, b0 + j, b1 + j, b1 + i))
        n = len(vs)
        flat = []
        if cap_lo:
            flat.append(tuple(range(seg))[::-1])
        if cap_hi:
            flat.append(tuple(range(n - seg, n)))
        vs = self._xform(vs, center, rot)
        self._emit(vs, fs, key, bone, smooth)
        if flat:
            # caps stay flat, or the shading bleeds around the end of a limb
            off = len(self.verts) - len(vs)
            for f in flat:
                self.faces.append(tuple(i + off for i in f))
                self.face_key.append(key)
                self.face_smooth.append(False)

    def ball(self, bone, key, center, r, seg=10, bands=6, scale=(1, 1, 1),
             rot=None, smooth=True):
        """Low-poly spheroid -- skulls, shoulders, joints, pommels, fruit."""
        sx, sy, sz = scale
        vs, fs = [], []
        vs.append((0, 0, -r * sz))
        for b in range(1, bands):
            phi = math.pi * b / bands
            zz, rr = -math.cos(phi) * r * sz, math.sin(phi) * r
            for i in range(seg):
                a = 2 * math.pi * i / seg + math.pi / seg
                vs.append((math.cos(a) * rr * sx, math.sin(a) * rr * sy, zz))
        vs.append((0, 0, r * sz))
        top = len(vs) - 1
        for i in range(seg):
            fs.append((0, 1 + (i + 1) % seg, 1 + i))
        for b in range(bands - 2):
            b0, b1 = 1 + b * seg, 1 + (b + 1) * seg
            for i in range(seg):
                j = (i + 1) % seg
                fs.append((b0 + i, b0 + j, b1 + j, b1 + i))
        b0 = 1 + (bands - 2) * seg
        for i in range(seg):
            fs.append((b0 + i, b0 + (i + 1) % seg, top))
        self._emit(self._xform(vs, center, rot), fs, key, bone, smooth)

    def strap(self, bone, key, a, b, w=0.05, t=0.03):
        """A flat band between two points -- belts, baldrics, harness, laces."""
        a, b = Vector(a), Vector(b)
        d = b - a
        L = d.length
        if L < 1e-6:
            return
        mid = (a + b) / 2
        yaw = math.atan2(d.y, d.x)
        pitch = math.asin(max(-1.0, min(1.0, d.z / L)))
        self.box(bone, key, tuple(mid), (L, w, t),
                 rot=(0, -pitch / D2R, yaw / D2R))

    def plate(self, bone, key, center, size, rot=None, **kw):
        """Thin slab -- shields, blades, banners, cloth."""
        self.box(bone, key, center, size, rot=rot, **kw)

    def wedge(self, bone, key, center, size, rot=None):
        """Triangular prism, apex up along +Z, running along Y. Helmets, roofs."""
        sx, sy, sz = size[0] / 2, size[1] / 2, size[2] / 2
        vs = [(-sx, -sy, -sz), (sx, -sy, -sz), (sx, sy, -sz), (-sx, sy, -sz),
              (0, -sy, sz), (0, sy, sz)]
        fs = [(0, 1, 2, 3)[::-1], (0, 4, 5, 3), (1, 2, 5, 4), (0, 1, 4), (3, 5, 2)]
        self._emit(self._xform(vs, center, rot), fs, key, bone)

    def build(self, name, arm_obj):
        # r99-human: shrink head/hand vert groups about their bone pivots
        # BEFORE from_pydata and the rest attribute, so textures stay welded.
        bones = arm_obj.data.bones
        if 'shoulderR' in bones and 'head' in bones:
            for bn, f in HUMANIZE.items():
                if bn not in bones:
                    continue
                p = bones[bn].head_local
                for vi, vb in enumerate(self.vert_bone):
                    if vb == bn:
                        v = self.verts[vi]
                        self.verts[vi] = (p[0] + (v[0] - p[0]) * f,
                                          p[1] + (v[1] - p[1]) * f,
                                          p[2] + (v[2] - p[2]) * f)
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.verts, [], self.faces)
        me.update()
        keys = sorted(set(self.face_key))
        for k in keys:
            me.materials.append(toon_mat(k))
        idx = {k: i for i, k in enumerate(keys)}
        for poly, k, sm in zip(me.polygons, self.face_key, self.face_smooth):
            poly.material_index = idx[k]
            poly.use_smooth = sm   # rounded forms smooth, armour plate faceted
        # Bake the REST position of every vertex into a mesh attribute.  Procedural
        # textures read this instead of the live coordinates, so the grain stays
        # welded to the surface while the armature deforms it -- drive them from
        # Object/Generated coords instead and the texture visibly swims frame to
        # frame, which at 12fps reads as boiling static.  It also means no UVs.
        try:
            at = me.attributes.new('rest', 'FLOAT_VECTOR', 'POINT')
            flat = []
            for v in self.verts:
                flat.extend((v[0], v[1], v[2]))
            at.data.foreach_set('vector', flat)
        except Exception as e:
            print('rest attribute failed: %s' % e)

        ob = link(bpy.data.objects.new(name, me))

        groups = {}
        for vi, bone in enumerate(self.vert_bone):
            groups.setdefault(bone, []).append(vi)
        for bone, ids in groups.items():
            vg = ob.vertex_groups.new(name=bone)
            vg.add(ids, 1.0, 'REPLACE')       # rigid: 1 part, 1 bone, no blending

        ob.parent = arm_obj
        mod = ob.modifiers.new('Armature', 'ARMATURE')
        mod.object = arm_obj
        ob['tc_keys'] = keys
        return ob

# ---------------------------------------------------------------------------
# 6. ARMATURES
# ---------------------------------------------------------------------------
# (name, parent, head, tail)   forward = +Y, up = +Z, character's right = +X
MAN_BONES = [
    ('root',      None,       (0, 0, 0.00), (0, 0.35, 0.00)),
    ('hips',      'root',     (0, 0, 0.86), (0, 0, 1.02)),
    ('spine',     'hips',     (0, 0, 1.02), (0, 0, 1.20)),
    ('chest',     'spine',    (0, 0, 1.20), (0, 0, 1.36)),
    ('neck',      'chest',    (0, 0, 1.36), (0, 0, 1.44)),
    ('head',      'neck',     (0, 0, 1.44), (0, 0, 1.82)),
    ('shoulderR', 'chest',    (0.05, 0, 1.33), (0.20, 0, 1.33)),
    ('armR',      'shoulderR', (0.21, 0, 1.31), (0.21, 0, 1.05)),
    ('forearmR',  'armR',     (0.21, 0, 1.05), (0.21, 0, 0.82)),
    ('handR',     'forearmR', (0.21, 0, 0.82), (0.21, 0, 0.70)),
    ('shoulderL', 'chest',    (-0.05, 0, 1.33), (-0.20, 0, 1.33)),
    ('armL',      'shoulderL', (-0.21, 0, 1.31), (-0.21, 0, 1.05)),
    ('forearmL',  'armL',     (-0.21, 0, 1.05), (-0.21, 0, 0.82)),
    ('handL',     'forearmL', (-0.21, 0, 0.82), (-0.21, 0, 0.70)),
    ('thighR',    'hips',     (0.11, 0, 0.84), (0.11, 0, 0.48)),
    ('shinR',     'thighR',   (0.11, 0, 0.48), (0.11, 0, 0.11)),
    ('footR',     'shinR',    (0.11, 0, 0.09), (0.11, 0.18, 0.09)),
    ('thighL',    'hips',     (-0.11, 0, 0.84), (-0.11, 0, 0.48)),
    ('shinL',     'thighL',   (-0.11, 0, 0.48), (-0.11, 0, 0.11)),
    ('footL',     'shinL',    (-0.11, 0, 0.09), (-0.11, 0.18, 0.09)),
]

# Horse: rider bones hang off 'saddle' so one armature drives both.
HORSE_BONES = [
    ('root',   None,     (0, 0, 0.00), (0, 0.40, 0.00)),
    ('barrel', 'root',   (0, -0.30, 1.06), (0, 0.42, 1.10)),
    ('saddle', 'barrel', (0, 0.02, 1.18), (0, 0.02, 1.34)),
    ('withers', 'barrel', (0, 0.42, 1.10), (0, 0.62, 1.26)),
    ('hneck',  'withers', (0, 0.60, 1.24), (0, 0.80, 1.54)),
    ('hhead',  'hneck',  (0, 0.80, 1.54), (0, 1.02, 1.44)),
    ('tail',   'barrel', (0, -0.40, 1.14), (0, -0.60, 0.88)),
    ('fthighR', 'withers', (0.18, 0.40, 1.02), (0.18, 0.36, 0.62)),
    ('fshinR', 'fthighR', (0.18, 0.36, 0.62), (0.18, 0.36, 0.12)),
    ('fthighL', 'withers', (-0.18, 0.40, 1.02), (-0.18, 0.36, 0.62)),
    ('fshinL', 'fthighL', (-0.18, 0.36, 0.62), (-0.18, 0.36, 0.12)),
    ('bthighR', 'barrel', (0.18, -0.34, 1.04), (0.18, -0.40, 0.64)),
    ('bshinR', 'bthighR', (0.18, -0.40, 0.64), (0.18, -0.30, 0.12)),
    ('bthighL', 'barrel', (-0.18, -0.34, 1.04), (-0.18, -0.40, 0.64)),
    ('bshinL', 'bthighL', (-0.18, -0.40, 0.64), (-0.18, -0.30, 0.12)),
]

def rider_bones(dz=0.27, dy=-0.05):
    """Man bones lifted onto the saddle, minus their own root."""
    out = []
    for name, parent, head, tail in MAN_BONES:
        if name == 'root':
            continue
        p = 'saddle' if parent == 'root' else parent
        out.append((name, p,
                    (head[0], head[1] + dy, head[2] + dz),
                    (tail[0], tail[1] + dy, tail[2] + dz)))
    return out

# Wildlife: one quadruped skeleton, scaled and dressed per species.  Matches the
# game's GAIA animals (UNITS.sheep / deer / boar, `animal:true`).
BEAST_BONES = [
    ('root',    None,     (0, 0, 0.00), (0, 0.30, 0.00)),
    ('body',    'root',   (0, -0.26, 0.52), (0, 0.26, 0.55)),
    ('bneck',   'body',   (0, 0.26, 0.55), (0, 0.44, 0.64)),
    ('bhead',   'bneck',  (0, 0.44, 0.64), (0, 0.66, 0.60)),
    ('btail',   'body',   (0, -0.28, 0.54), (0, -0.44, 0.46)),
    ('fthighR', 'body',   (0.13, 0.22, 0.48), (0.13, 0.21, 0.26)),
    ('fshinR',  'fthighR', (0.13, 0.21, 0.26), (0.13, 0.21, 0.04)),
    ('fthighL', 'body',   (-0.13, 0.22, 0.48), (-0.13, 0.21, 0.26)),
    ('fshinL',  'fthighL', (-0.13, 0.21, 0.26), (-0.13, 0.21, 0.04)),
    ('bthighR', 'body',   (0.13, -0.22, 0.50), (0.13, -0.24, 0.28)),
    ('bshinR',  'bthighR', (0.13, -0.24, 0.28), (0.13, -0.20, 0.04)),
    ('bthighL', 'body',   (-0.13, -0.22, 0.50), (-0.13, -0.24, 0.28)),
    ('bshinL',  'bthighL', (-0.13, -0.24, 0.28), (-0.13, -0.20, 0.04)),
]

def build_beast(B, c):
    """sheep / deer / boar off one skeleton -- the silhouette does the work."""
    hide = c.get('hide', 'linen')
    kind = c.get('beast', 'sheep')
    w = c.get('girth', 1.0)

    if kind == 'sheep':      # woolly: overlapping fleece lobes, not one smooth tube
        # rot=(-90,0,0): ring z becomes world Y and oy becomes world -Z, so these
        # offsets are NEGATIVE. Positive puts the whole body under the floor.
        B.tube('body', hide, [(-0.34, 0.148, 0.150, 0, -0.560),
                              (-0.10, 0.176, 0.172, 0, -0.580),
                              (0.16, 0.170, 0.166, 0, -0.575),
                              (0.30, 0.146, 0.146, 0, -0.560)],
               seg=10, center=(0, 0, 0), rot=(-90, 0, 0))
        for (yy, zz, rr) in ((-0.24, 0.62, 0.115), (-0.02, 0.65, 0.125),
                             (0.18, 0.63, 0.112), (-0.14, 0.47, 0.105),
                             (0.08, 0.47, 0.100)):
            B.ball('body', hide, (0, yy, zz), rr, seg=8, bands=5,
                   scale=(1.15, 1.0, 0.85))
        # a woolly neck -- without it the head simply floats off the shoulder
        B.tube('bneck', hide, [(0.50, 0.118, 0.120, 0, 0.270),
                               (0.58, 0.108, 0.110, 0, 0.360),
                               (0.63, 0.094, 0.096, 0, 0.420)], seg=8, cap_hi=False)
        B.ball('bhead', hide, (0, 0.455, 0.650), 0.098, seg=8, bands=5)   # poll wool
        B.ball('bhead', c.get('face', 'black'), (0, 0.545, 0.628), 0.084, seg=8,
               bands=6, scale=(0.86, 1.25, 1.0))
        for s in (1, -1):
            B.ball('bhead', c.get('face', 'black'), (0.072 * s, 0.495, 0.660),
                   0.040, seg=6, bands=4, scale=(0.5, 1.0, 0.8))
    elif kind == 'deer':     # slender, long neck, antlers
        B.tube('body', hide, [(-0.30, 0.115, 0.132, 0, -0.580),
                              (-0.06, 0.132, 0.155, 0, -0.600),
                              (0.18, 0.126, 0.150, 0, -0.592),
                              (0.30, 0.104, 0.120, 0, -0.570)],
               seg=10, center=(0, 0, 0), rot=(-90, 0, 0))
        B.tube('bneck', hide, [(0.54, 0.078, 0.090, 0, 0.250),
                               (0.68, 0.062, 0.070, 0, 0.380),
                               (0.78, 0.052, 0.058, 0, 0.450)], seg=8, cap_hi=False)
        B.tube('bhead', hide, [(0.715, 0.032, 0.034, 0, 0.630),
                               (0.740, 0.042, 0.046, 0, 0.560),
                               (0.765, 0.050, 0.056, 0, 0.460)], seg=8)
        B.ball('bhead', 'black', (0, 0.648, 0.710), 0.030, seg=6, bands=4)
        for s in (1, -1):
            B.tube('bhead', hide, [(0.788, 0.020, 0.018, 0.030 * s, 0.450),
                                   (0.850, 0.016, 0.015, 0.048 * s, 0.435),
                                   (0.905, 0.011, 0.010, 0.070 * s, 0.450)], seg=5)
            for (az, ay, ln) in ((0.850, 0.435, 0.055), (0.888, 0.442, 0.048)):
                B.tube('bhead', hide, [(az, 0.009, 0.009, 0.048 * s, ay),
                                       (az + ln, 0.006, 0.006, 0.086 * s, ay - 0.03)],
                       seg=4)
            B.ball('bhead', hide, (0.052 * s, 0.540, 0.750), 0.026, seg=6, bands=4,
                   scale=(0.5, 0.9, 1.4))
    else:                    # boar: heavy shoulders, low head, bristles, tusks
        B.tube('body', hide, [(-0.30, 0.130, 0.140, 0, -0.530),
                              (-0.04, 0.168, 0.176, 0, -0.560),
                              (0.20, 0.185, 0.190, 0, -0.550),
                              (0.34, 0.152, 0.154, 0, -0.510)],
               seg=10, center=(0, 0, 0), rot=(-90, 0, 0))
        B.tube('bhead', hide, [(0.495, 0.040, 0.042, 0, 0.700),
                               (0.505, 0.058, 0.060, 0, 0.660),
                               (0.530, 0.092, 0.096, 0, 0.550),
                               (0.560, 0.122, 0.126, 0, 0.400)], seg=8)
        B.ball('bhead', 'black', (0, 0.712, 0.492), 0.036, seg=6, bands=4)
        for s in (1, -1):    # tusks
            B.tube('bhead', 'white', [(0.480, 0.014, 0.014, 0.040 * s, 0.650),
                                      (0.525, 0.011, 0.011, 0.050 * s, 0.672),
                                      (0.560, 0.005, 0.005, 0.056 * s, 0.660)], seg=4)
            B.ball('bhead', hide, (0.062 * s, 0.500, 0.620), 0.032, seg=6, bands=4,
                   scale=(0.45, 0.8, 1.2))
        for i, yy in enumerate((0.16, 0.04, -0.08, -0.18)):   # bristle ridge
            B.plate('body', c.get('mane', 'black'), (0, yy, 0.64 + 0.02 * (i % 2)),
                    (0.030, 0.090, 0.085))

    B.tube('btail', c.get('mane', hide), [(0.42, 0.016, 0.016, 0, -0.430),
                                          (0.54, 0.026, 0.026, 0, -0.300)], seg=6)
    for s, sfx in ((1, 'R'), (-1, 'L')):
        x = 0.125 * s * w
        for pre, yy in (('f', 0.215), ('b', -0.235)):
            B.tube(pre + 'thigh' + sfx, hide,
                   [(0.26, 0.026, 0.028, x, yy), (0.37, 0.038, 0.046, x, yy),
                    (0.50, 0.054, 0.068, x, yy)], seg=8)
            B.tube(pre + 'shin' + sfx, hide,
                   [(0.09, 0.018, 0.019, x, yy), (0.27, 0.025, 0.027, x, yy)], seg=8)
            B.tube(pre + 'shin' + sfx, 'black',
                   [(0.005, 0.027, 0.030, x, yy), (0.080, 0.021, 0.023, x, yy)],
                   seg=6, smooth=False)

# Siege: a chassis, a moving arm, and four wheels.  Wheel bones point along +X so
# that spinning them is a rotation about their own local Y.
SIEGE_BONES = [
    ('root',  None,   (0, 0, 0.00), (0, 0.30, 0.00)),
    ('base',  'root', (0, 0, 0.16), (0, 0, 0.62)),
    ('arm',   'base', (0, -0.10, 0.62), (0, -0.10, 1.30)),
    ('wFR',   'base', (0.26, 0.40, 0.24), (0.42, 0.40, 0.24)),
    ('wFL',   'base', (-0.26, 0.40, 0.24), (-0.42, 0.40, 0.24)),
    ('wBR',   'base', (0.26, -0.40, 0.24), (0.42, -0.40, 0.24)),
    ('wBL',   'base', (-0.26, -0.40, 0.24), (-0.42, -0.40, 0.24)),
]

def _wheel(B, bone, x, y, r, w=0.07, spokes=6, rim='wood', hub='iron'):
    """A wheel lying in the YZ plane: a flattened disc plus spokes and a tyre."""
    B.ball(bone, rim, (x, y, r), r, seg=12, bands=6, scale=(w / r, 1.0, 1.0))
    # hub must stay inside the tyre's width or it reads as a bolt sticking out
    B.ball(bone, hub, (x, y, r), r * 0.24, seg=8, bands=5,
           scale=(w * 1.25 / (r * 0.24), 1.0, 1.0))
    for i in range(spokes):
        a = math.pi * i / spokes
        B.plate(bone, rim, (x, y + math.cos(a) * 0, r), (w * 0.5, r * 1.7, 0.030),
                rot=(a / D2R, 0, 0))
    B.tube(bone, hub, [(-w * 0.55, r * 1.02, r * 1.02, 0, 0),
                       (w * 0.55, r * 1.02, r * 1.02, 0, 0)],
           seg=12, smooth=False, cap_lo=False, cap_hi=False,
           center=(x, y, r), rot=(0, 90, 0))

def build_siege(B, c):
    kind = c.get('siege', 'ram')
    wood, iron = c.get('wood', 'wood'), c.get('iron', 'iron')

    if kind == 'ram':
        # a timber shed on wheels with the log slung underneath
        for s in (1, -1):
            B.tube('base', wood, [(0.22, 0.052, 0.052, 0.30 * s, -0.52),
                                  (0.62, 0.046, 0.046, 0.24 * s, -0.50)], seg=6)
            B.tube('base', wood, [(0.22, 0.052, 0.052, 0.30 * s, 0.52),
                                  (0.62, 0.046, 0.046, 0.24 * s, 0.50)], seg=6)
            B.strap('base', wood, (0.30 * s, -0.56, 0.30), (0.30 * s, 0.56, 0.30),
                    w=0.07, t=0.07)
        for s in (1, -1):   # gable roof
            B.plate('base', c.get('roof', 'woodDark'), (0.19 * s, 0, 0.80),
                    (0.44, 1.22, 0.055), rot=(0, 34 * s, 0))
        B.tube('base', wood, [(0.62, 0.045, 0.045, 0, -0.56),
                              (0.98, 0.040, 0.040, 0, -0.54)], seg=6)
        B.tube('base', wood, [(0.62, 0.045, 0.045, 0, 0.56),
                              (0.98, 0.040, 0.040, 0, 0.54)], seg=6)
        B.strap('base', wood, (0, -0.55, 0.99), (0, 0.55, 0.99), w=0.08, t=0.08)
        for y in (-0.30, 0.30):   # slings
            B.strap('arm', iron, (0, y, 0.95), (0, y, 0.56), w=0.03, t=0.03)
        # the log has to run PAST the shed at the front, or the ram just reads as
        # a hut on wheels -- the striking head is the whole point of the unit
        B.tube('arm', c.get('log', 'woodDark'),
               [(-0.60, 0.088, 0.088, 0, 0), (0.50, 0.100, 0.100, 0, 0),
                (0.72, 0.088, 0.088, 0, 0)],
               seg=10, center=(0, 0, 0.44), rot=(-90, 0, 0))
        B.tube('arm', iron, [(0.70, 0.110, 0.110, 0, 0), (0.86, 0.094, 0.094, 0, 0),
                             (0.93, 0.060, 0.060, 0, 0)],
               seg=8, smooth=False, center=(0, 0, 0.44), rot=(-90, 0, 0))
        for yy in (0.36, -0.12):    # iron bands along the timber
            B.tube('arm', iron, [(yy - 0.03, 0.104, 0.104, 0, 0),
                                 (yy + 0.03, 0.104, 0.104, 0, 0)],
                   seg=10, smooth=False, cap_lo=False, cap_hi=False,
                   center=(0, 0, 0.44), rot=(-90, 0, 0))
        for s in (1, -1):
            _wheel(B, 'wF' + ('R' if s > 0 else 'L'), 0.30 * s, 0.40, 0.21)
            _wheel(B, 'wB' + ('R' if s > 0 else 'L'), 0.30 * s, -0.40, 0.21)

    elif kind == 'mangonel':
        for s in (1, -1):
            B.strap('base', wood, (0.26 * s, -0.52, 0.30), (0.26 * s, 0.52, 0.30),
                    w=0.10, t=0.10)
            B.tube('base', wood, [(0.28, 0.048, 0.048, 0.26 * s, -0.30),
                                  (0.86, 0.042, 0.042, 0.10 * s, 0.10)], seg=6)
        B.strap('base', wood, (-0.11, 0.10, 0.86), (0.11, 0.10, 0.86), w=0.09, t=0.09)
        B.strap('base', c.get('pad', 'leather'), (-0.24, 0.34, 0.62),
                (0.24, 0.34, 0.62), w=0.13, t=0.13)      # padded stop beam
        B.tube('arm', wood, [(-0.06, 0.046, 0.046, 0, -0.10),
                             (0.62, 0.038, 0.038, 0, -0.10)], seg=6)
        B.tube('arm', iron, [(0.60, 0.105, 0.115, 0, -0.10),
                             (0.74, 0.130, 0.140, 0, -0.10)],
               seg=8, cap_hi=False)                       # bucket
        B.ball('arm', 'stone', (0, -0.10, 0.75), 0.075, seg=8, bands=5)
        for s in (1, -1):
            _wheel(B, 'wF' + ('R' if s > 0 else 'L'), 0.30 * s, 0.16, 0.28, w=0.09)
            _wheel(B, 'wB' + ('R' if s > 0 else 'L'), 0.30 * s, -0.40, 0.20, w=0.08)

    elif kind == 'scorpion':
        # light bolt-thrower: axle, splayed legs, a stock running fore-aft, and a
        # recurved bow across the front
        B.strap('base', wood, (-0.24, -0.22, 0.20), (0.24, -0.22, 0.20), w=0.08, t=0.08)
        for s in (1, -1):
            B.tube('base', wood, [(0.20, 0.038, 0.038, 0.22 * s, -0.22),
                                  (0.58, 0.032, 0.032, 0.07 * s, 0.04)], seg=6)
            B.tube('base', wood, [(0.06, 0.030, 0.030, 0.15 * s, 0.34),
                                  (0.56, 0.028, 0.028, 0.06 * s, 0.10)], seg=6)
        B.tube('base', wood, [(-0.42, 0.048, 0.058, 0, 0), (0.44, 0.040, 0.050, 0, 0)],
               seg=6, center=(0, 0.04, 0.62), rot=(-90, 0, 0))     # stock
        B.box('base', wood, (0, -0.34, 0.60), (0.16, 0.16, 0.10))  # winch block
        for s in (1, -1):    # recurved limbs, angled back from the centre
            B.tube('arm', wood, [(0.66, 0.030, 0.040, 0.10 * s, 0.34),
                                 (0.665, 0.026, 0.034, 0.30 * s, 0.30),
                                 (0.670, 0.016, 0.022, 0.46 * s, 0.22)], seg=6)
        B.plate('arm', 'white', (0, 0.235, 0.668), (0.92, 0.016, 0.016))
        B.tube('arm', iron, [(-0.12, 0.016, 0.016, 0, 0), (0.32, 0.013, 0.013, 0, 0)],
               seg=5, center=(0, 0.18, 0.665), rot=(-90, 0, 0))     # bolt
        B.cone('arm', iron, (0, 0.53, 0.665), 0.026, 0.10, seg=4, rot=(-90, 0, 0))
        for s in (1, -1):
            _wheel(B, 'wB' + ('R' if s > 0 else 'L'), 0.24 * s, -0.22, 0.20, w=0.07)

    elif kind == 'treb':
        for s in (1, -1):    # tall A-frame
            B.tube('base', wood, [(0.18, 0.055, 0.055, 0.34 * s, -0.42),
                                  (1.34, 0.042, 0.042, 0.08 * s, -0.02)], seg=6)
            B.tube('base', wood, [(0.18, 0.055, 0.055, 0.34 * s, 0.42),
                                  (1.34, 0.042, 0.042, 0.08 * s, -0.02)], seg=6)
            B.strap('base', wood, (0.34 * s, -0.46, 0.22), (0.34 * s, 0.46, 0.22),
                    w=0.09, t=0.09)
        B.strap('base', iron, (-0.12, -0.02, 1.35), (0.12, -0.02, 1.35), w=0.07, t=0.07)
        B.tube('arm', wood, [(-0.52, 0.048, 0.048, 0, -0.02),
                             (1.02, 0.034, 0.034, 0, -0.02)], seg=6)
        B.box('arm', 'stone', (0, -0.02, 0.16), (0.30, 0.30, 0.34))   # counterweight
        B.strap('arm', 'rope', (0, -0.02, 1.60), (0, 0.22, 1.30), w=0.02, t=0.02)
        B.ball('arm', 'stone', (0, 0.24, 1.26), 0.070, seg=8, bands=5)
        for s in (1, -1):
            _wheel(B, 'wF' + ('R' if s > 0 else 'L'), 0.34 * s, 0.42, 0.20)
            _wheel(B, 'wB' + ('R' if s > 0 else 'L'), 0.34 * s, -0.42, 0.20)

    else:   # bombard cannon
        for s in (1, -1):
            B.plate('base', wood, (0.20 * s, -0.02, 0.42), (0.075, 1.05, 0.42),
                    rot=(12, 0, 0))
        B.strap('base', wood, (-0.22, -0.30, 0.26), (0.22, -0.30, 0.26), w=0.10, t=0.10)
        B.strap('base', wood, (-0.22, 0.34, 0.34), (0.22, 0.34, 0.34), w=0.10, t=0.10)
        B.tube('arm', c.get('barrel', 'bronze'),
               [(-0.46, 0.115, 0.115, 0, 0), (-0.30, 0.098, 0.098, 0, 0),
                (0.30, 0.086, 0.086, 0, 0), (0.44, 0.104, 0.104, 0, 0)],
               seg=10, center=(0, 0.06, 0.60), rot=(-90, 0, 0))
        for yy in (-0.16, 0.10):
            B.tube('arm', iron, [(-0.03, 0.096, 0.096, 0, 0), (0.03, 0.096, 0.096, 0, 0)],
                   seg=10, smooth=False, cap_lo=False, cap_hi=False,
                   center=(0, 0.06 + yy, 0.60), rot=(-90, 0, 0))
        for s in (1, -1):
            _wheel(B, 'wB' + ('R' if s > 0 else 'L'), 0.26 * s, -0.24, 0.26, w=0.09)
            _wheel(B, 'wF' + ('R' if s > 0 else 'L'), 0.24 * s, 0.40, 0.16, w=0.07)

# Ships.  The origin is the WATERLINE, not the keel -- the game draws water over
# the bottom of the hull, and the sprite anchor has to sit where the hull meets it.
SHIP_BONES = [
    ('root',   None,   (0, 0, 0.00), (0, 0.40, 0.00)),
    ('hull',   'root', (0, -0.20, 0.24), (0, 0.60, 0.28)),
    ('mast',   'hull', (0, 0.04, 0.46), (0, 0.04, 1.55)),
    ('sail',   'mast', (0, 0.04, 0.92), (0, 0.04, 1.46)),
    ('rudder', 'hull', (0, -1.02, 0.30), (0, -1.16, 0.08)),
]

def build_ship(B, c):
    kind = c.get('ship', 'galley')
    hull = c.get('hull', 'wood')
    trim = c.get('trim', 'woodDark')
    L, Bm = c.get('len', 1.15), c.get('beam', 0.40)
    dk = c.get('deck', 0.50)          # deck height above the waterline

    rings = [(-L, 0.09 * Bm / 0.40, 0.20, 0, -0.26),
             (-L * 0.72, 0.72 * Bm, 0.25, 0, -0.26),
             (-L * 0.26, Bm, 0.27, 0, -0.26),
             (L * 0.24, Bm, 0.27, 0, -0.26),
             (L * 0.70, 0.74 * Bm, 0.25, 0, -0.27),
             (L * 1.02, 0.08 * Bm / 0.40, 0.19, 0, -0.30)]
    B.tube('hull', hull, rings, seg=10, center=(0, 0, 0), rot=(-90, 0, 0))
    # gunwale strake and deck
    B.tube('hull', trim, [(-L * 0.94, 0.30 * Bm, 0.045, 0, -dk),
                          (-L * 0.30, 1.03 * Bm, 0.05, 0, -dk),
                          (L * 0.26, 1.03 * Bm, 0.05, 0, -dk),
                          (L * 0.94, 0.28 * Bm, 0.045, 0, -dk + 0.03)],
           seg=10, center=(0, 0, 0), rot=(-90, 0, 0))
    B.plate('hull', c.get('deckC', 'woodDark'), (0, -L * 0.05, dk - 0.03),
            (Bm * 1.55, L * 1.30, 0.045))
    B.tube('rudder', trim, [(0.06, 0.030, 0.075, 0, -L - 0.05),
                            (0.34, 0.036, 0.090, 0, -L - 0.02)], seg=6)

    def mast_and_sail(h=1.55, sw=0.62, sh=0.56, sailC='white'):
        B.tube('mast', trim, [(0.44, 0.045, 0.045, 0, 0.04),
                              (h, 0.030, 0.030, 0, 0.04)], seg=8)
        B.tube('sail', trim, [(-0.34, 0.026, 0.026, 0, 0), (0.34, 0.026, 0.026, 0, 0)],
               seg=6, center=(0, 0.04, h - 0.14), rot=(0, 90, 0))     # yard
        B.tube('sail', sailC, [(h - 0.16, sw, 0.05, 0, 0.04),
                               (h - 0.16 - sh * 0.5, sw * 1.04, 0.075, 0, 0.02),
                               (h - 0.16 - sh, sw * 0.92, 0.05, 0, 0.04)],
               seg=10, cap_lo=False, cap_hi=False)
        B.plate('sail', c.get('band', 'teamDark'), (0, 0.005, h - 0.16 - sh * 0.5),
                (sw * 1.9, 0.02, 0.10))

    if kind == 'fishing':
        B.tube('mast', trim, [(0.44, 0.034, 0.034, 0, 0.10), (1.02, 0.024, 0.024, 0, 0.10)],
               seg=6)
        B.strap('mast', 'rope', (0, 0.10, 1.00), (0, 0.62, 0.58), w=0.02, t=0.02)
        B.tube('hull', c.get('net', 'linen'), [(dk - 0.04, 0.20, 0.10, 0, 0.60),
                                               (dk - 0.26, 0.26, 0.13, 0, 0.66)], seg=8)
        for yy in (-0.55, -0.30):
            B.box('hull', trim, (0, yy, dk + 0.09), (0.34, 0.22, 0.18))   # creels
    elif kind == 'cog':
        mast_and_sail(1.45, 0.60, 0.54, c.get('sailC', 'white'))
        for s in (1, -1):   # fore and after castles
            B.box('hull', trim, (0, -L * 0.80, dk + 0.16), (Bm * 1.5, 0.34, 0.32))
        B.box('hull', trim, (0, L * 0.78, dk + 0.14), (Bm * 1.2, 0.30, 0.28))
        for (xx, yy) in ((0.16, -0.28), (-0.16, -0.30), (0.14, 0.10)):
            B.tube('hull', 'woodDark', [(dk, 0.11, 0.11, xx, yy),
                                        (dk + 0.24, 0.11, 0.11, xx, yy)], seg=8)  # casks
    elif kind == 'transport':
        mast_and_sail(1.40, 0.58, 0.50, c.get('sailC', 'white'))
        B.box('hull', trim, (0, L * 0.62, dk + 0.10), (Bm * 1.3, 0.44, 0.22))
        for s in (1, -1):   # bulwarks for the cargo
            B.plate('hull', trim, (Bm * 1.02 * s, -L * 0.10, dk + 0.16),
                    (0.05, L * 1.0, 0.28))
    elif kind == 'galley':
        mast_and_sail(1.42, 0.52, 0.46, c.get('sailC', 'white'))
        B.tube('hull', 'iron', [(0.20, 0.075, 0.075, 0, L * 1.00),
                                (0.24, 0.055, 0.055, 0, L * 1.22)], seg=6)   # beak
        for s in (1, -1):   # oars
            for i, yy in enumerate((-0.55, -0.22, 0.12, 0.46)):
                B.tube('hull', 'wood', [(dk - 0.02, 0.020, 0.020, Bm * 0.9 * s, yy),
                                        (0.10, 0.024, 0.024, Bm * 2.0 * s, yy - 0.16)],
                       seg=5)
        B.box('hull', trim, (0, -L * 0.74, dk + 0.16), (Bm * 1.4, 0.30, 0.30))
    elif kind == 'longboat':
        mast_and_sail(1.40, 0.56, 0.50, c.get('sailC', 'white'))
        for s in (1, -1):   # shield wall along the gunwale
            for i, yy in enumerate((-0.62, -0.30, 0.02, 0.34, 0.66)):
                B.ball('hull', 'team' if i % 2 else 'teamDark',
                       (Bm * 1.06 * s, yy, dk + 0.12), 0.135, seg=8, bands=5,
                       scale=(0.18, 1.0, 1.0))
        # dragon prow
        B.tube('hull', trim, [(dk, 0.045, 0.045, 0, L * 0.98),
                              (dk + 0.42, 0.036, 0.036, 0, L * 1.12),
                              (dk + 0.62, 0.030, 0.030, 0, L * 0.98)], seg=6)
        B.ball('hull', trim, (0, L * 0.99, dk + 0.66), 0.075, seg=8, bands=5,
               scale=(0.7, 1.5, 0.9))
        B.box('hull', 'white', (0, L * 1.06, dk + 0.62), (0.055, 0.10, 0.05))
    elif kind == 'fireship':
        B.tube('mast', trim, [(0.44, 0.032, 0.032, 0, 0), (0.92, 0.026, 0.026, 0, 0)],
               seg=6)
        B.tube('hull', 'iron', [(dk + 0.02, 0.16, 0.16, 0, L * 0.72),
                                (dk + 0.22, 0.22, 0.22, 0, L * 0.72)],
               seg=8, cap_hi=False)                                    # brazier
        for i, (xx, zz, rr) in enumerate(((0.0, 0.30, 0.13), (0.07, 0.44, 0.10),
                                          (-0.06, 0.54, 0.075))):
            B.ball('hull', 'gold' if i else 'silk', (xx, L * 0.72, dk + zz), rr,
                   seg=8, bands=5, scale=(0.9, 0.9, 1.4))
        for yy in (-0.42, -0.10, 0.24):
            B.tube('hull', 'woodDark', [(dk, 0.10, 0.10, 0.14, yy),
                                        (dk + 0.20, 0.10, 0.10, 0.14, yy)], seg=8)
    elif kind == 'demo':
        B.tube('mast', trim, [(0.44, 0.030, 0.030, 0, 0), (0.80, 0.024, 0.024, 0, 0)],
               seg=6)
        for (xx, yy, zz) in ((0.13, -0.10, 0.0), (-0.13, -0.10, 0.0),
                             (0.13, 0.24, 0.0), (-0.13, 0.24, 0.0), (0, 0.06, 0.24)):
            B.tube('hull', 'woodDark', [(dk + zz, 0.125, 0.125, xx, yy),
                                        (dk + zz + 0.26, 0.125, 0.125, xx, yy)], seg=8)
            B.tube('hull', 'iron', [(dk + zz + 0.11, 0.132, 0.132, xx, yy),
                                    (dk + zz + 0.15, 0.132, 0.132, xx, yy)],
                   seg=8, smooth=False, cap_lo=False, cap_hi=False)
        B.strap('hull', 'rope', (0, 0.06, dk + 0.52), (0, 0.40, dk + 0.62), w=0.02, t=0.02)
    elif kind == 'turtle':
        # armoured shell with spikes -- the silhouette IS the unit
        # one lofted carapace running fore-aft; a second unrotated tube here was a
        # vertical slab standing across the deck
        sh = c.get('shell', 'steelDark')
        B.tube('hull', sh, [(-L * 0.82, Bm * 0.70, 0.17, 0, -dk - 0.16),
                            (-L * 0.10, Bm * 0.98, 0.22, 0, -dk - 0.18),
                            (L * 0.64, Bm * 0.76, 0.18, 0, -dk - 0.16)],
               seg=10, center=(0, 0, 0), rot=(-90, 0, 0))
        for i in range(5):    # plate seams across the shell
            yy = -0.62 + 0.31 * i
            B.tube('hull', 'iron', [(yy - 0.018, Bm * 0.94, 0.215, 0, -dk - 0.18),
                                    (yy + 0.018, Bm * 0.94, 0.215, 0, -dk - 0.18)],
                   seg=10, smooth=False, cap_lo=False, cap_hi=False,
                   center=(0, 0, 0), rot=(-90, 0, 0))
        for s in (1, -1):     # spikes proud of the carapace, or they vanish into it
            for yy in (-0.52, -0.18, 0.16, 0.50):
                B.cone('hull', 'steel', (Bm * 0.34 * s, yy, dk + 0.34), 0.036, 0.20, seg=4)
        B.cone('hull', 'steel', (0, -0.34, dk + 0.40), 0.040, 0.22, seg=4)
        B.cone('hull', 'steel', (0, 0.32, dk + 0.40), 0.040, 0.22, seg=4)
        B.tube('hull', trim, [(dk + 0.02, 0.070, 0.070, 0, L * 0.88),
                              (dk + 0.26, 0.055, 0.055, 0, L * 1.06)], seg=6)
        B.ball('hull', trim, (0, L * 1.02, dk + 0.30), 0.085, seg=8, bands=5,
               scale=(0.75, 1.5, 0.9))
    else:   # cannon galleon
        mast_and_sail(1.52, 0.60, 0.56, c.get('sailC', 'white'))
        B.box('hull', trim, (0, -L * 0.72, dk + 0.20), (Bm * 1.5, 0.42, 0.40))
        for s in (1, -1):
            B.plate('hull', trim, (Bm * 1.04 * s, -L * 0.10, dk + 0.18),
                    (0.05, L * 1.05, 0.30))
            for yy in (-0.46, 0.0, 0.46):    # gun barrels out the ports
                B.tube('hull', 'bronze', [(-0.05, 0.048, 0.048, 0, 0),
                                          (0.26, 0.040, 0.040, 0, 0)],
                       seg=6, center=(Bm * 1.06 * s, yy, dk + 0.16), rot=(0, 90 * s, 0))

# --- ship poses -------------------------------------------------------------
def sh_idle(t, c):
    a = TAU * t
    return ({'hull': (1.4 * math.sin(a), 0, 0),
             'mast': (0, 0, 1.0 * math.sin(a + 0.6)),
             'sail': (0, 0, 2.2 * math.sin(a + 1.1)),
             'rudder': (0, 0, 5 * math.sin(a * 0.5))},
            (0, 0, 0.016 * math.sin(a)), (0, 2.0 * math.sin(a + 0.9), 0))

def sh_walk(t, c):
    a = TAU * t
    return ({'hull': (-2.0 + 2.6 * math.sin(a), 0, 0),
             'mast': (0, 0, 1.6 * math.sin(a + 0.5)),
             'sail': (-4.0, 0, 3.0 * math.sin(a + 1.0)),
             'rudder': (0, 0, 7 * math.sin(a * 0.5))},
            (0, 0, 0.028 * math.sin(a)), (0, 3.4 * math.sin(a + 0.8), 0))

def sh_attack(t, c):
    fire = ease(seg(t, 0.30, 0.42))
    back = ease(seg(t, 0.50, 1.0))
    k = fire * (1 - back)
    return ({'hull': (3.0 * k, 0, 0), 'sail': (0, 0, 4 * k),
             'mast': (0, 0, 2 * k)},
            (0, -0.06 * k, 0), (0, 7.0 * k, 0))

def sh_die(t, c):
    heel = ease(seg(t, 0.05, 0.60))
    sink = ease(seg(t, 0.35, 1.0))
    return ({'hull': (-8 * heel, 0, 0), 'mast': (0, 0, -14 * heel),
             'sail': (0, 0, -20 * heel), 'rudder': (0, 0, 18 * heel)},
            (0, 0, -0.86 * sink), (14 * heel, 46 * heel, 0))

# --- siege poses ------------------------------------------------------------
def s_idle(t, c):
    s = math.sin(TAU * t)
    return {'arm': (1.2 * s * c.get('idleK', 1.0), 0, 0)}, (0, 0, 0.004 * s), (0, 0, 0)

def s_walk(t, c):
    spin = 360.0 * t                    # one full turn per loop = seamless
    P = {w: (0, spin, 0) for w in ('wFR', 'wFL', 'wBR', 'wBL')}
    P['base'] = (1.6 * math.sin(TAU * t * 2), 0, 0.8 * math.sin(TAU * t))
    P['arm'] = (2.0 * math.sin(TAU * t * 2), 0, 0)
    return P, (0, 0, 0.012 * abs(math.sin(TAU * t * 2))), (0, 0, 0)

def s_attack(t, c):
    """Load, hold, release fast, settle.  `swing` is (rest, fired) in degrees."""
    a, b = c.get('swing', (-40, 30))
    load = ease(seg(t, 0.0, 0.34))
    fire = ease(seg(t, 0.40, 0.52))
    back = ease(seg(t, 0.60, 1.0))
    ang = a * load + (b - a) * fire - b * back
    rec = c.get('recoil', 0.0) * fire * (1 - back)
    P = {'arm': (ang, 0, 0), 'base': (-1.5 * fire * (1 - back), 0, 0)}
    return P, (0, -rec, 0), (0, 0, 0)

def s_die(t, c):
    fall = ease(seg(t, 0.10, 0.80))
    P = {'arm': (-34 * fall, 0, 12 * fall), 'base': (0, 0, 0)}
    for i, w in enumerate(('wFR', 'wFL', 'wBR', 'wBL')):
        P[w] = (0, 40 * fall * (1 if i % 2 else -1), 0)
    return P, (0, 0.05 * fall, -0.16 * fall), (-16 * fall, 9 * fall, 0)

def make_armature(name, bones):
    arm = bpy.data.armatures.new(name + '_data')
    ob = link(bpy.data.objects.new(name, arm))
    set_active(ob)
    bpy.ops.object.mode_set(mode='EDIT')
    for bname, parent, head, tail in bones:
        eb = arm.edit_bones.new(bname)
        eb.head = head
        eb.tail = tail
        eb.roll = 0.0
        eb.use_connect = False
    for bname, parent, head, tail in bones:
        if parent:
            arm.edit_bones[bname].parent = arm.edit_bones[parent]
    bpy.ops.object.mode_set(mode='OBJECT')
    for pb in ob.pose.bones:
        pb.rotation_mode = 'XYZ'
    return ob

# ---------------------------------------------------------------------------
# 7. COSTUME / BODY CONSTRUCTION
# ---------------------------------------------------------------------------
def build_man(B, c, zoff=0.0, yoff=0.0, seated=False):
    """One humanoid, dressed by the costume dict `c`.  Mirrors the game's
    MAN_COSTUME idea: one rig, many uniforms."""
    tunic = c.get('tunic', 'team')
    legs  = c.get('legs', 'leatherDk')
    skin  = c.get('skin', 'skin')
    trim  = c.get('trim', 'teamDark')
    Z, Y = zoff, yoff

    def ctr(x, y, z):
        return (x, y + Y, z + Z)

    # --- legs -------------------------------------------------------------
    # Heroic, not anatomical -- but sculpted, not stacked.  Limbs are tapered
    # tubes with a joint ball at knee and elbow; only armour plate stays faceted.
    for s, sfx in ((1, 'R'), (-1, 'L')):
        if c.get('robe'):
            continue
        x = 0.115 * s
        B.tube('thigh' + sfx, legs, [(0.86, 0.105, 0.115, x, 0.005),
                                     (0.72, 0.098, 0.108, x, 0.012),
                                     (0.56, 0.082, 0.090, x, 0.010),
                                     (0.47, 0.074, 0.080, x, 0.004)], seg=10)
        B.ball('shin' + sfx, legs, ctr(x, 0.008, 0.475), 0.082, seg=10, bands=6,
               scale=(1.0, 1.05, 0.85))
        B.tube('shin' + sfx, legs, [(0.47, 0.076, 0.082, x, 0.004),
                                    (0.36, 0.072, 0.086, x, -0.004),
                                    (0.22, 0.056, 0.062, x, -0.010),
                                    (0.13, 0.050, 0.055, x, -0.008)], seg=10)
        if c.get('greaves'):
            B.tube('shin' + sfx, c['greaves'], [(0.44, 0.088, 0.094, x, 0.004),
                                                (0.30, 0.082, 0.092, x, -0.006),
                                                (0.18, 0.064, 0.070, x, -0.010)],
                   seg=8, smooth=False, cap_lo=False, cap_hi=False)
        # boot: sole, upper, toe, cuff -- four small forms read as a real boot
        B.box('foot' + sfx, 'leatherDk', ctr(x, 0.075, 0.028), (0.155, 0.32, 0.055))
        B.tube('foot' + sfx, 'leather', [(0.05, 0.070, 0.135, x, 0.045),
                                         (0.12, 0.064, 0.115, x, 0.020),
                                         (0.17, 0.060, 0.080, x, -0.004)], seg=8)
        B.box('foot' + sfx, 'leather', ctr(x, 0.145, 0.075), (0.125, 0.13, 0.07), top=0.8)
        B.tube('shin' + sfx, 'leather', [(0.14, 0.075, 0.080, x, -0.008),
                                         (0.21, 0.083, 0.088, x, -0.010)], seg=8, smooth=False)
    if c.get('robe'):
        # a robe is a lofted cone -- flares at the hem, folds catch the key light
        B.tube('hips', tunic, [(0.02, 0.30, 0.26, 0, 0.005),
                               (0.26, 0.265, 0.225, 0, 0.004),
                               (0.56, 0.215, 0.185, 0, 0.002),
                               (0.80, 0.185, 0.160, 0, 0),
                               (0.99, 0.175, 0.150, 0, 0)], seg=12, cap_hi=False)
        B.tube('hips', trim, [(0.005, 0.315, 0.275, 0, 0.005),
                              (0.075, 0.305, 0.265, 0, 0.005)], seg=12, smooth=False)
        for a in (-32, 0, 34, 150, 200):   # vertical folds
            rad = a * D2R
            B.box('hips', c.get('foldC', tunic),
                  ctr(math.cos(rad) * 0.245, math.sin(rad) * 0.215, 0.40),
                  (0.05, 0.05, 0.74), top=0.7, rot=(0, 0, a))

    # --- torso ------------------------------------------------------------
    # one lofted trunk: broad chest, cinched waist, flare at the hips
    B.tube('hips', tunic, [(0.86, 0.175, 0.125, 0, 0),
                           (0.96, 0.180, 0.128, 0, 0),
                           (1.02, 0.172, 0.122, 0, 0.002)], seg=12, cap_hi=False)
    B.tube('spine', tunic, [(1.02, 0.172, 0.122, 0, 0.002),
                            (1.12, 0.183, 0.130, 0, 0.006),
                            (1.20, 0.205, 0.142, 0, 0.008)], seg=12,
           cap_lo=False, cap_hi=False)
    B.tube('chest', tunic, [(1.20, 0.205, 0.142, 0, 0.008),
                            (1.29, 0.232, 0.152, 0, 0.006),
                            (1.35, 0.228, 0.146, 0, 0),
                            (1.39, 0.195, 0.128, 0, -0.004)], seg=12, cap_lo=False)
    if c.get('mail'):
        # hauberk skirt below the belt and a coif at the throat -- the two places
        # mail is actually visible on a figure this size
        B.tube('hips', 'mail', [(0.70, 0.198, 0.150, 0, 0),
                                (0.82, 0.196, 0.146, 0, 0),
                                (0.97, 0.186, 0.136, 0, 0)],
               seg=12, cap_lo=False, cap_hi=False)
        B.tube('neck', 'mail', [(1.315, 0.126, 0.118, 0, 0.002),
                                (1.395, 0.104, 0.098, 0, 0.004)],
               seg=10, cap_lo=False, cap_hi=False)
        for s, sfx in ((1, 'R'), (-1, 'L')):   # short mail sleeve
            B.tube('arm' + sfx, 'mail', [(1.12, 0.076, 0.078, 0.21 * s, 0.002),
                                         (1.24, 0.088, 0.090, 0.21 * s, 0.003),
                                         (1.31, 0.090, 0.092, 0.21 * s, 0.002)],
                   seg=10, cap_lo=False, cap_hi=False)
    if c.get('cuirass'):   # a second shell over the chest reads as plate armour
        B.tube('chest', c['cuirass'], [(1.13, 0.196, 0.140, 0, 0.006),
                                       (1.24, 0.243, 0.163, 0, 0.008),
                                       (1.33, 0.240, 0.157, 0, 0.002)],
               seg=12, smooth=False, cap_lo=False, cap_hi=False)
        B.strap('chest', c['cuirass'], ctr(-0.20, 0.10, 1.36), ctr(0.20, 0.10, 1.36),
                w=0.09, t=0.05)
    if c.get('belt'):
        B.tube('hips', c['belt'], [(0.975, 0.190, 0.138, 0, 0),
                                   (1.035, 0.188, 0.136, 0, 0.002)], seg=12, smooth=False)
        B.box('hips', 'gold' if c['belt'] != 'rope' else 'wood',
              ctr(0, 0.135, 1.005), (0.085, 0.04, 0.075))
    if c.get('tabard'):
        B.tube('spine', trim, [(0.86, 0.105, 0.028, 0, 0.108),
                               (1.10, 0.098, 0.026, 0, 0.126),
                               (1.34, 0.088, 0.024, 0, 0.130)], seg=6, smooth=False)
    if c.get('sash'):
        B.strap('chest', trim, ctr(-0.19, 0.115, 1.14), ctr(0.17, 0.125, 1.36),
                w=0.115, t=0.035)
    if c.get('cape'):
        B.tube('chest', c['cape'], [(0.42, 0.315, 0.075, 0, -0.130),
                                    (0.86, 0.285, 0.068, 0, -0.145),
                                    (1.20, 0.245, 0.060, 0, -0.150),
                                    (1.37, 0.180, 0.050, 0, -0.135)],
               seg=10, cap_lo=False, cap_hi=False)
        for s in (1, -1):   # clasp
            B.ball('chest', c.get('claspC', 'gold'), ctr(0.155 * s, -0.04, 1.365),
                   0.038, seg=8, bands=5)
    if c.get('paint'):   # war paint: chest bars and a face stripe
        B.plate('chest', c.get('paintC', 'woad'), ctr(0, 0.140, 1.30), (0.30, 0.02, 0.045))
        B.plate('spine', c.get('paintC', 'woad'), ctr(0, 0.128, 1.15), (0.26, 0.02, 0.045))
    if c.get('spots'):
        for (sx, sz) in ((0.09, 1.30), (-0.11, 1.23), (0.04, 1.14), (-0.03, 1.31)):
            B.ball('chest' if sz > 1.18 else 'spine', c.get('spotC', 'black'),
                   ctr(sx, 0.140, sz), 0.032, seg=6, bands=4, scale=(1, 0.3, 1))

    # --- shoulders + arms -------------------------------------------------
    for s, sfx in ((1, 'R'), (-1, 'L')):
        x = 0.21 * s
        sleeve = tunic if c.get('sleeves', True) else skin
        B.ball('shoulder' + sfx, sleeve, ctr(0.195 * s, 0.004, 1.305), 0.098,
               seg=10, bands=6, scale=(1.0, 1.0, 0.95))
        if c.get('pauldron'):
            # Flattened cap plus two lames.  A tall dome up here reads as a SECOND
            # HEAD at sprite size -- it has to sit low and wide, not round.
            B.ball('shoulder' + sfx, c['pauldron'], ctr(0.200 * s, 0.004, 1.300),
                   0.124, seg=10, bands=6, scale=(1.05, 1.10, 0.52), smooth=False)
            B.tube('shoulder' + sfx, c['pauldron'],
                   [(1.288, 0.118, 0.126, 0.212 * s, 0.004),
                    (1.246, 0.130, 0.138, 0.220 * s, 0.004),
                    (1.228, 0.124, 0.132, 0.224 * s, 0.004)],
                   seg=8, smooth=False, cap_lo=False, cap_hi=False)
            B.tube('shoulder' + sfx, c['pauldron'],
                   [(1.214, 0.122, 0.130, 0.226 * s, 0.004),
                    (1.176, 0.130, 0.138, 0.232 * s, 0.004),
                    (1.160, 0.122, 0.130, 0.234 * s, 0.004)],
                   seg=8, smooth=False, cap_lo=False, cap_hi=False)
        B.tube('arm' + sfx, sleeve, [(1.31, 0.084, 0.086, x, 0.002),
                                     (1.20, 0.079, 0.082, x, 0.004),
                                     (1.10, 0.070, 0.073, x, 0.002),
                                     (1.04, 0.064, 0.066, x, 0)], seg=10)
        B.ball('forearm' + sfx, skin, ctr(x, 0.002, 1.045), 0.066, seg=8, bands=5)
        fore = 'leather' if c.get('bracers') else skin
        B.tube('forearm' + sfx, skin, [(1.05, 0.066, 0.068, x, 0),
                                       (0.95, 0.062, 0.064, x, 0),
                                       (0.86, 0.054, 0.056, x, 0),
                                       (0.80, 0.050, 0.052, x, 0)], seg=10)
        if c.get('bracers'):
            B.tube('forearm' + sfx, fore, [(1.00, 0.072, 0.074, x, 0),
                                           (0.88, 0.062, 0.064, x, 0),
                                           (0.82, 0.058, 0.060, x, 0)],
                   seg=8, smooth=False, cap_lo=False, cap_hi=False)
        # hand: palm block, knuckle row, thumb -- a cube reads as a mitten
        B.box('hand' + sfx, skin, ctr(x, 0.006, 0.755), (0.085, 0.115, 0.115), top=0.92)
        B.ball('hand' + sfx, skin, ctr(x, 0.012, 0.700), 0.058, seg=8, bands=5,
               scale=(0.85, 1.15, 0.75))
        B.box('hand' + sfx, skin, ctr(x - 0.045 * s, 0.045, 0.755),
              (0.042, 0.075, 0.055), rot=(0, 0, -22 * s))

    # --- head -------------------------------------------------------------
    B.tube('neck', skin, [(1.355, 0.062, 0.058, 0, 0),
                          (1.435, 0.058, 0.055, 0, 0.004)], seg=8)
    # skull, then a jaw and brow -- three forms, and it stops reading as a crate
    B.ball('head', skin, ctr(0, -0.004, 1.625), 0.150, seg=12, bands=7,
           scale=(1.0, 1.06, 1.10))
    B.tube('head', skin, [(1.475, 0.098, 0.112, 0, 0.020),
                          (1.545, 0.122, 0.132, 0, 0.016),
                          (1.605, 0.140, 0.146, 0, 0.008)], seg=10, cap_hi=False)
    B.box('head', skin, ctr(0, 0.118, 1.672), (0.215, 0.075, 0.045), top=0.85)   # brow
    B.box('head', skin, ctr(0, 0.150, 1.598), (0.062, 0.055, 0.075), top=0.7)    # nose
    if c.get('beard'):
        B.tube('head', c.get('beardC', 'hair'), [(1.455, 0.088, 0.098, 0, 0.030),
                                                 (1.530, 0.116, 0.124, 0, 0.024),
                                                 (1.580, 0.126, 0.130, 0, 0.014)],
               seg=10, cap_hi=False)
    if not c.get('helm') in ('hood', 'beast'):
        B.ball('head', 'hair', ctr(0, -0.022, 1.660), 0.158, seg=12, bands=6,
               scale=(1.0, 1.02, 0.92))
        B.box('head', 'hair', ctr(0, 0.118, 1.712), (0.235, 0.085, 0.045))
    for s in (1, -1):   # ears
        B.ball('head', skin, ctr(0.148 * s, -0.005, 1.618), 0.042, seg=6, bands=4,
               scale=(0.5, 1.0, 1.3))
    if c.get('paint'):
        B.plate('head', c.get('paintC', 'woad'), ctr(0, 0.145, 1.648), (0.26, 0.02, 0.05))
    for s in (1, -1):
        B.box('head', 'black', ctr(0.062 * s, 0.140, 1.641), (0.052, 0.03, 0.030))
    helm = c.get('helm')
    if helm == 'steel':
        # domed bascinet: skull, brow band, nasal, and a neck lame at the back
        B.ball('head', 'steel', ctr(0, -0.008, 1.655), 0.172, seg=12, bands=7,
               scale=(1.0, 1.05, 1.02), smooth=False)
        B.tube('head', 'steelDark', [(1.640, 0.176, 0.184, 0, -0.008),
                                     (1.688, 0.178, 0.186, 0, -0.008)],
               seg=12, smooth=False, cap_lo=False, cap_hi=False)
        B.box('head', 'steel', ctr(0, 0.152, 1.618), (0.052, 0.075, 0.135))   # nasal
        B.tube('head', 'steel', [(1.630, 0.150, 0.120, 0, -0.075),
                                 (1.545, 0.162, 0.115, 0, -0.100),
                                 (1.490, 0.148, 0.100, 0, -0.105)],
               seg=8, smooth=False, cap_lo=False, cap_hi=False)
    elif helm == 'kettle':
        B.ball('head', 'steel', ctr(0, -0.004, 1.680), 0.158, seg=10, bands=6,
               scale=(1.0, 1.0, 1.05), smooth=False)
        B.tube('head', 'steel', [(1.672, 0.166, 0.172, 0, -0.004),
                                 (1.640, 0.250, 0.258, 0, -0.004),
                                 (1.616, 0.246, 0.254, 0, -0.004)],
               seg=12, smooth=False, cap_lo=False)
    elif helm == 'cap':
        B.ball('head', 'leather', ctr(0, -0.006, 1.652), 0.166, seg=10, bands=6,
               scale=(1.0, 1.02, 0.98))
        B.tube('head', 'leatherDk', [(1.648, 0.170, 0.176, 0, -0.006),
                                     (1.690, 0.170, 0.176, 0, -0.006)],
               seg=10, smooth=False, cap_lo=False, cap_hi=False)
        B.plate('head', 'red', ctr(0, -0.15, 1.80), (0.055, 0.10, 0.24), rot=(-28, 0, 0))
    elif helm == 'straw':
        B.tube('head', 'straw', [(1.690, 0.130, 0.135, 0, 0),
                                 (1.742, 0.108, 0.112, 0, 0),
                                 (1.790, 0.060, 0.062, 0, 0)], seg=10)
        B.tube('head', 'straw', [(1.652, 0.228, 0.234, 0, 0),
                                 (1.672, 0.234, 0.240, 0, 0),
                                 (1.700, 0.150, 0.155, 0, 0)],
               seg=12, cap_hi=False)
    elif helm == 'hood':
        B.ball('head', c.get('hoodC', 'linen'), ctr(0, -0.020, 1.640), 0.198,
               seg=12, bands=7, scale=(1.0, 1.05, 1.05))
        B.tube('head', c.get('hoodC', 'linen'), [(1.640, 0.196, 0.206, 0, -0.020),
                                                 (1.520, 0.208, 0.216, 0, -0.010),
                                                 (1.440, 0.200, 0.205, 0, 0)],
               seg=12, cap_lo=False, cap_hi=False)
        B.ball('head', 'black', ctr(0, 0.115, 1.622), 0.118, seg=10, bands=6,
               scale=(0.95, 0.45, 1.0))                                   # shaded face
    elif helm == 'topknot':
        B.tube('head', 'hair', [(1.690, 0.156, 0.162, 0, -0.010),
                                (1.740, 0.140, 0.146, 0, -0.014)], seg=10)
        B.tube('head', 'hair', [(1.750, 0.048, 0.050, 0, -0.055),
                                (1.830, 0.042, 0.044, 0, -0.105),
                                (1.880, 0.026, 0.028, 0, -0.150)], seg=6)
    elif helm == 'plume':
        B.ball('head', 'leather', ctr(0, -0.006, 1.652), 0.168, seg=10, bands=6,
               scale=(1.0, 1.02, 0.98))
        B.tube('head', 'gold', [(1.646, 0.172, 0.178, 0, -0.006),
                                (1.688, 0.172, 0.178, 0, -0.006)],
               seg=10, smooth=False, cap_lo=False, cap_hi=False)
        for ph in (-26, -9, 9, 26):
            B.tube('head', c.get('plumeC', 'red'),
                   [(1.760, 0.030, 0.055, math.sin(ph * D2R) * 0.05, -0.045),
                    (1.870, 0.038, 0.070, math.sin(ph * D2R) * 0.09, -0.105),
                    (1.940, 0.020, 0.040, math.sin(ph * D2R) * 0.13, -0.175)], seg=6)
    elif helm == 'crown':
        B.tube('head', 'gold', [(1.700, 0.176, 0.182, 0, -0.008),
                                (1.775, 0.180, 0.186, 0, -0.008)],
               seg=10, smooth=False, cap_lo=False, cap_hi=False)
        for i in range(6):
            a = 2 * math.pi * i / 6 + math.pi / 6
            B.cone('head', 'gold', ctr(math.cos(a) * 0.172, math.sin(a) * 0.178 - 0.008,
                                       1.822), 0.036, 0.115, seg=4)
    elif helm == 'hair':
        B.ball('head', 'hair', ctr(0, -0.024, 1.660), 0.172, seg=12, bands=6,
               scale=(1.0, 1.04, 0.98))
        B.tube('head', 'hair', [(1.600, 0.176, 0.150, 0, -0.070),
                                (1.510, 0.170, 0.140, 0, -0.090),
                                (1.455, 0.150, 0.120, 0, -0.095)],
               seg=10, cap_lo=False, cap_hi=False)
    elif helm == 'turban':
        tc = c.get('turbanC', 'turban')
        B.ball('head', tc, ctr(0, -0.008, 1.712), 0.196, seg=12, bands=7,
               scale=(1.0, 1.02, 0.78))
        B.tube('head', tc, [(1.700, 0.070, 0.072, 0.055, -0.006),   # one wrap, not a stack
                            (1.762, 0.062, 0.064, -0.045, -0.006),
                            (1.812, 0.048, 0.050, 0.030, -0.006)], seg=8)
        B.ball('head', tc, ctr(0, -0.006, 1.838), 0.060, seg=8, bands=5,
               scale=(1.0, 1.0, 0.9))
    elif helm == 'band':
        B.tube('head', c.get('bandC', 'red'), [(1.690, 0.166, 0.172, 0, -0.006),
                                               (1.735, 0.166, 0.172, 0, -0.006)],
               seg=10, smooth=False, cap_lo=False, cap_hi=False)
        B.tube('head', c.get('bandC', 'red'), [(1.700, 0.040, 0.042, -0.140, -0.090),
                                               (1.630, 0.036, 0.038, -0.175, -0.145),
                                               (1.570, 0.020, 0.022, -0.190, -0.190)], seg=5)
    elif helm == 'beast':
        # animal-head cowl: muzzle over the brow, ears up, jaws around the face.
        # A unique unit has to be nameable from its silhouette alone.
        B.ball('head', c.get('beastC', 'gold'), ctr(0, -0.014, 1.660), 0.196,
               seg=12, bands=7, scale=(1.0, 1.02, 1.0))
        B.tube('head', c.get('beastC', 'gold'), [(1.700, 0.140, 0.120, 0, 0.090),
                                                 (1.665, 0.128, 0.108, 0, 0.170),
                                                 (1.630, 0.100, 0.082, 0, 0.225)], seg=8)
        B.box('head', 'white', ctr(0, 0.205, 1.596), (0.165, 0.06, 0.055))     # teeth
        B.box('head', 'black', ctr(0, 0.248, 1.640), (0.055, 0.045, 0.04))     # muzzle
        for s in (1, -1):
            B.tube('head', c.get('beastC', 'gold'),
                   [(1.800, 0.062, 0.052, 0.115 * s, -0.020),
                    (1.880, 0.048, 0.040, 0.140 * s, -0.030),
                    (1.930, 0.014, 0.012, 0.155 * s, -0.036)], seg=5)
    elif helm == 'lamellar':
        B.tube('head', 'steel', [(1.640, 0.180, 0.186, 0, -0.006),
                                 (1.720, 0.164, 0.170, 0, -0.006),
                                 (1.790, 0.108, 0.112, 0, -0.006),
                                 (1.830, 0.048, 0.050, 0, -0.006)],
               seg=10, smooth=False)
        B.cone('head', 'gold', ctr(0, -0.006, 1.885), 0.032, 0.10, seg=5)
        for s in (1, -1):    # cheek and neck plates
            B.tube('head', 'steel', [(1.660, 0.062, 0.104, 0.155 * s, -0.010),
                                     (1.570, 0.058, 0.100, 0.172 * s, -0.020),
                                     (1.500, 0.048, 0.082, 0.176 * s, -0.028)],
                   seg=6, smooth=False, cap_lo=False, cap_hi=False)
    if c.get('horns'):
        for s in (1, -1):
            B.cone('head', 'white', ctr(0.19 * s, 0, 1.85), 0.05, 0.24, seg=5, rot=(0, 26 * s, 0))

    add_weapon(B, c, Z, Y)
    add_shield(B, c, Z, Y)

def sword(B, bone, hx, Y, hz, blade=0.66, wide=0.072, guard=0.15, grip=0.17,
          steel='steel', fit='gold'):
    """Pommel, wrapped grip, quillons, then a blade that tapers to a point with a
    raised central fuller.  A flat plank with a gold brick on it reads as a plank."""
    B.ball(bone, fit, (hx, Y, hz + grip * 0.16), 0.046, seg=8, bands=5,
           scale=(1.0, 0.85, 0.9))                                   # pommel
    B.tube(bone, 'leatherDk', [(hz + grip * 0.22, 0.030, 0.026, hx, Y),
                               (hz + grip * 0.70, 0.034, 0.029, hx, Y),
                               (hz + grip * 1.05, 0.031, 0.027, hx, Y)], seg=8)
    top = hz + grip * 1.12
    B.tube(bone, fit, [(top - 0.020, guard, 0.038, hx, Y),
                       (top + 0.022, guard * 0.90, 0.034, hx, Y)],
           seg=8, smooth=False)                                      # quillons
    B.tube(bone, steel, [(top + 0.020, wide, 0.020, hx, Y),
                         (top + blade * 0.55, wide * 0.92, 0.019, hx, Y),
                         (top + blade * 0.88, wide * 0.66, 0.015, hx, Y),
                         (top + blade, 0.010, 0.006, hx, Y)], seg=6, smooth=False)
    B.tube(bone, steel, [(top + 0.030, wide * 0.34, 0.030, hx, Y),
                         (top + blade * 0.80, wide * 0.24, 0.024, hx, Y)],
           seg=6, smooth=False, cap_lo=False, cap_hi=False)           # fuller ridge

def polearm(B, bone, hx, Y, hz, shaft=2.10, up=1.42, head=0.34, wide=0.062,
            lugs=False):
    """Shaft, socket, and a leaf blade that swells then tapers to a point."""
    lo = up - shaft
    B.tube(bone, 'wood', [(hz + lo, 0.026, 0.026, hx, Y),
                          (hz + lo + shaft * 0.5, 0.032, 0.032, hx, Y),
                          (hz + up, 0.028, 0.028, hx, Y)], seg=8)
    B.tube(bone, 'iron', [(hz + lo - 0.02, 0.030, 0.030, hx, Y),
                          (hz + lo + 0.07, 0.032, 0.032, hx, Y)], seg=8, smooth=False)
    B.tube(bone, 'steel', [(hz + up - 0.03, 0.040, 0.040, hx, Y),
                           (hz + up + 0.05, 0.044, 0.044, hx, Y)], seg=8,
           smooth=False, cap_hi=False)                                   # socket
    B.tube(bone, 'steel', [(hz + up + 0.04, wide * 0.55, 0.022, hx, Y),
                           (hz + up + head * 0.42, wide, 0.028, hx, Y),
                           (hz + up + head * 0.80, wide * 0.55, 0.018, hx, Y),
                           (hz + up + head, 0.008, 0.005, hx, Y)], seg=6, smooth=False)
    if lugs:
        for s in (1, -1):
            B.plate(bone, 'steel', (hx + 0.075 * s, Y, hz + up + 0.04),
                    (0.13, 0.024, 0.05), rot=(0, 26 * s, 0))

def add_weapon(B, c, Z=0.0, Y=0.0):
    """Right hand (+X) holds the weapon; bows go in the left."""
    w = c.get('weapon')
    hx, hz = 0.21, 0.75 + Z
    if w == 'sword':
        sword(B, 'handR', hx, Y, hz, blade=0.66, wide=0.072, guard=0.15)
    elif w == 'greatsword':
        sword(B, 'handR', hx, Y, hz, blade=0.94, wide=0.092, guard=0.19, grip=0.26)
    elif w == 'spear':
        polearm(B, 'handR', hx, Y + 0.02, hz, shaft=2.10, up=1.42, head=0.34, wide=0.062)
    elif w == 'pike':
        polearm(B, 'handR', hx, Y + 0.02, hz, shaft=2.70, up=1.90, head=0.32, wide=0.055,
                lugs=True)
    elif w == 'lance':
        # couched: mostly ahead of the fist, only a stub behind, or it swallows the cell
        B.tube('handR', 'wood', [(-0.46, 0.052, 0.052, 0, 0), (0.30, 0.044, 0.044, 0, 0),
                                 (0.92, 0.030, 0.030, 0, 0)],
               seg=8, center=(hx, Y + 0.50, hz + 0.04), rot=(-90, 0, 0))
        B.cone('handR', 'steel', (hx, Y + 1.50, hz + 0.04), 0.058, 0.26, seg=5, rot=(-90, 0, 0))
        B.tube('handR', 'teamDark', [(-0.30, 0.088, 0.088, 0, 0), (-0.14, 0.092, 0.092, 0, 0),
                                     (-0.06, 0.062, 0.062, 0, 0)],
               seg=8, center=(hx, Y + 0.50, hz + 0.04), rot=(-90, 0, 0))   # vamplate
    elif w == 'axe':
        B.cyl('handR', 'wood', (hx, Y, hz + 0.26), 0.028, 0.78, seg=6)
        B.plate('handR', 'steel', (hx + 0.09, Y, hz + 0.60), (0.20, 0.035, 0.22))
        B.plate('handR', 'steel', (hx + 0.16, Y, hz + 0.60), (0.08, 0.030, 0.30))
    elif w == 'tool':      # villager's felling axe / hoe
        B.cyl('handR', 'wood', (hx, Y, hz + 0.24), 0.036, 0.74, seg=6)
        B.plate('handR', 'iron', (hx + 0.10, Y, hz + 0.55), (0.22, 0.042, 0.22))
    elif w == 'staff':
        B.cyl('handR', 'wood', (hx, Y, hz + 0.32), 0.038, 1.54, seg=6)
        B.cyl('handR', 'gold', (hx, Y, hz + 1.10), 0.085, 0.11, seg=8, rtop=0.035)
    elif w == 'bow':
        # Off-hand.  The stave runs along +Y (perpendicular to the arm bone) so that
        # when the bow arm swings up to aim, the bow rotates into vertical instead of
        # lying flat -- building it along Z is the obvious choice and it is wrong.
        # Lofted as a real curved stave: tube built along its own Z, then laid onto
        # Y by rot=(-90,0,0), with each ring pushed back to form the bow's arc.
        rings = []
        for i in range(9):
            t = -0.52 + 1.04 * i / 8.0
            k = (t / 0.52) ** 2
            rr = 0.027 * (1 - 0.58 * k)          # limbs taper toward the nocks
            rings.append((t, rr, rr * 1.55, 0, -0.088 * k))
        B.tube('handL', 'wood', rings, seg=6, center=(-hx, Y, hz), rot=(-90, 0, 0))
        for t in (-0.50, 0.50):
            B.tube('handL', 'leatherDk', [(t - 0.022, 0.026, 0.034, 0, -0.082),
                                          (t + 0.022, 0.026, 0.034, 0, -0.082)],
                   seg=6, center=(-hx, Y, hz), rot=(-90, 0, 0), smooth=False)
        B.tube('handL', 'leather', [(-0.075, 0.034, 0.046, 0, 0),
                                    (0.075, 0.034, 0.046, 0, 0)],
               seg=6, center=(-hx, Y, hz), rot=(-90, 0, 0), smooth=False)   # grip
        B.plate('handL', 'white', (-hx, Y, hz + 0.088), (0.014, 1.02, 0.014))
        # nocked arrow: shaft, head, fletching
        B.tube('handR', 'wood', [(-0.34, 0.011, 0.011, 0, 0), (0.34, 0.011, 0.011, 0, 0)],
               seg=6, center=(hx, Y, hz + 0.02), rot=(-90, 0, 0))
        B.cone('handR', 'steel', (hx, Y + 0.38, hz + 0.02), 0.024, 0.09, seg=4,
               rot=(-90, 0, 0))
        for a in (0, 120, 240):
            B.plate('handR', 'white', (hx, Y - 0.28, hz + 0.02), (0.006, 0.10, 0.055),
                    rot=(0, a, 0))
    elif w == 'crossbow':
        # Stock runs DOWN from the fist (-Z).  The aim pose swings the arm forward
        # about local X, which turns -Z into +Y -- so the stock ends up level and
        # pointing at the target, while the limbs stay across the screen.
        B.box('handL', 'wood', (-hx, Y, hz - 0.26), (0.10, 0.11, 0.72))
        B.box('handL', 'wood', (-hx, Y, hz - 0.05), (0.13, 0.14, 0.16))
        B.plate('handL', 'iron', (-hx, Y, hz - 0.56), (0.94, 0.05, 0.045))
        B.plate('handL', 'white', (-hx, Y + 0.075, hz - 0.50), (0.86, 0.02, 0.02))
        B.box('handL', 'wood', (-hx, Y - 0.02, hz - 0.60), (0.09, 0.14, 0.10))
        B.cyl('handR', 'wood', (hx, Y, hz + 0.02), 0.016, 0.5, seg=4, axis='Y')
    elif w == 'twinsword':
        for s, bone in ((1, 'handR'), (-1, 'handL')):
            B.box(bone, 'leatherDk', (hx * s, Y, hz + 0.10), (0.07, 0.07, 0.16))
            B.box(bone, 'gold', (hx * s, Y, hz + 0.20), (0.26, 0.08, 0.05))
            B.plate(bone, 'steel', (hx * s, Y, hz + 0.52), (0.13, 0.04, 0.60))
            B.cone(bone, 'steel', (hx * s, Y, hz + 0.88), 0.07, 0.14, seg=4)
    elif w == 'javelin':
        B.cyl('handR', 'wood', (hx, Y, hz + 0.34), 0.024, 1.30, seg=6)
        B.cone('handR', 'steel', (hx, Y, hz + 1.06), 0.042, 0.18, seg=4)
    elif w == 'gun':
        B.box('handR', 'wood', (hx, Y + 0.24, hz + 0.06), (0.085, 0.78, 0.13), rot=(-8, 0, 0))
        B.cyl('handR', 'iron', (hx, Y + 0.74, hz + 0.11), 0.040, 0.86, seg=6, axis='Y')
        B.cyl('handR', 'iron', (hx, Y + 1.16, hz + 0.11), 0.055, 0.08, seg=6, axis='Y')
        B.box('handR', 'wood', (hx, Y - 0.14, hz - 0.01), (0.09, 0.22, 0.19), rot=(16, 0, 0))
    elif w == 'bomb':
        B.cyl('handR', 'black', (hx, Y + 0.10, hz + 0.02), 0.16, 0.24, seg=8)
        B.cyl('handR', 'rope', (hx, Y + 0.10, hz + 0.20), 0.015, 0.16, seg=4, rot=(0, 18, 0))

    if c.get('quiver'):
        B.cyl('chest', 'leather', (-0.13, -0.20, 1.22 + Z), 0.062, 0.36, seg=6, rot=(16, 0, -18))
        for i, dx in enumerate((-0.03, 0.0, 0.03)):
            B.cyl('chest', 'white', (-0.13 + dx, -0.24, 1.44 + Z), 0.010, 0.16, seg=4, rot=(16, 0, -18))

def add_shield(B, c, Z=0.0, Y=0.0):
    # Shields are the loudest team-colour surface on an infantryman -- oversize
    # them, and angle them out from the body so they survive the back facings.
    if c.get('shield'):
        zc, xs, yo = 0.90 + Z, -0.275, Y + 0.03
        # heater shape: a lens cross-section that narrows to a point at the base,
        # so it curves in the light instead of flashing as a flat blue card
        def heater(scale, dx, ry_k=1.0):
            return [(zc + 0.270 * scale, 0.036 * scale, 0.196 * scale * ry_k, xs + dx, yo),
                    (zc + 0.105 * scale, 0.046 * scale, 0.208 * scale * ry_k, xs + dx, yo),
                    (zc - 0.060 * scale, 0.044 * scale, 0.184 * scale * ry_k, xs + dx, yo),
                    (zc - 0.190 * scale, 0.036 * scale, 0.126 * scale * ry_k, xs + dx, yo),
                    (zc - 0.290 * scale, 0.016 * scale, 0.040 * scale * ry_k, xs + dx, yo)]
        B.tube('handL', 'teamDark', heater(1.0, 0.0), seg=12)
        # the team face has to sit PROUD of the outer shell -- nudged in by less
        # than the shell thickness it is simply buried inside and never renders
        B.tube('handL', 'team', heater(0.76, -0.034, ry_k=0.92), seg=12)
        B.tube('handL', 'steel', [(zc + 0.276, 0.040, 0.200, xs, yo),
                                  (zc + 0.298, 0.036, 0.180, xs, yo)],
               seg=12, smooth=False, cap_lo=False)                        # top rim
        B.ball('handL', 'steel', (xs - 0.030, yo, zc + 0.03), 0.062, seg=8, bands=5,
               scale=(0.55, 1.0, 1.0))                                    # boss
    elif c.get('buckler'):
        zc, xs, yo = 0.82 + Z, -0.300, Y + 0.02
        B.ball('handL', 'steel', (xs, yo, zc), 0.242, seg=12, bands=6,
               scale=(0.17, 1.0, 1.0))                                    # steel rim
        B.ball('handL', 'teamDark', (xs - 0.012, yo, zc), 0.202, seg=12, bands=6,
               scale=(0.20, 1.0, 1.0))
        B.ball('handL', 'team', (xs - 0.020, yo, zc), 0.150, seg=10, bands=6,
               scale=(0.20, 1.0, 1.0))
        B.ball('handL', 'steel', (xs - 0.036, yo, zc), 0.072, seg=8, bands=5,
               scale=(0.55, 1.0, 1.0))

def build_horse(B, c):
    """A lofted barrel, an arched neck and tapered legs.  The rider is sculpted, so
    a box-stack mount underneath it looks like a toy someone else made."""
    hide = c.get('hide', 'leather')
    mane = c.get('mane', 'black')

    # barrel: deep chest, tucked flank, rounded rump.  Built along Y via rot.
    B.tube('barrel', hide, [(-0.56, 0.150, 0.190, 0, -1.115),
                            (-0.42, 0.196, 0.232, 0, -1.135),
                            (-0.16, 0.208, 0.238, 0, -1.125),
                            (0.14, 0.203, 0.244, 0, -1.115),
                            (0.40, 0.195, 0.230, 0, -1.120),
                            (0.52, 0.176, 0.206, 0, -1.140)],
           seg=12, center=(0, 0, 0), rot=(-90, 0, 0))
    B.ball('barrel', hide, (0, -0.52, 1.14), 0.215, seg=12, bands=7,
           scale=(0.94, 1.05, 1.0))                                   # rump
    B.tube('withers', hide, [(-0.10, 0.196, 0.212, 0, -1.140),
                             (0.02, 0.185, 0.205, 0, -1.175),
                             (0.14, 0.160, 0.180, 0, -1.205)],
           seg=12, center=(0, 0.44, 0), rot=(-90, 0, 0), cap_hi=False)

    # neck: three rings climbing forward, so it arches instead of hinging
    B.tube('hneck', hide, [(1.16, 0.150, 0.170, 0, 0.560),
                           (1.30, 0.128, 0.152, 0, 0.640),
                           (1.44, 0.110, 0.132, 0, 0.730),
                           (1.54, 0.098, 0.118, 0, 0.800)], seg=10, cap_hi=False)
    B.tube('hhead', hide, [(1.545, 0.092, 0.108, 0, 0.800),
                           (1.520, 0.082, 0.096, 0, 0.905),
                           (1.470, 0.064, 0.074, 0, 0.995),
                           (1.442, 0.058, 0.066, 0, 1.040)], seg=8)
    B.ball('hhead', 'black', (0, 1.060, 1.435), 0.058, seg=8, bands=5,
           scale=(1.0, 0.75, 0.85))                                   # muzzle
    for s in (1, -1):
        B.ball('hhead', 'black', (0.052 * s, 0.955, 1.505), 0.026, seg=6, bands=4)
        B.tube('hhead', hide, [(1.560, 0.030, 0.026, 0.058 * s, 0.792),
                               (1.625, 0.022, 0.019, 0.062 * s, 0.780),
                               (1.660, 0.006, 0.005, 0.064 * s, 0.774)], seg=5)
    # mane along the crest, tail as a lofted switch
    for i, (z, y, r) in enumerate(((1.24, 0.590, 0.058), (1.36, 0.665, 0.052),
                                   (1.47, 0.752, 0.044), (1.55, 0.808, 0.034))):
        B.ball('hneck' if z < 1.52 else 'hhead', mane, (0, y - 0.030, z + 0.030),
               r, seg=6, bands=4, scale=(0.55, 1.5, 1.0))
    B.tube('tail', mane, [(1.16, 0.062, 0.052, 0, -0.430),
                          (1.02, 0.078, 0.062, 0, -0.520),
                          (0.84, 0.062, 0.050, 0, -0.560),
                          (0.72, 0.028, 0.024, 0, -0.570)], seg=8)

    for s, sfx in ((1, 'R'), (-1, 'L')):
        x = 0.175 * s
        # forelegs: shoulder mass, cannon bone, fetlock, hoof
        B.tube('fthigh' + sfx, hide, [(1.03, 0.098, 0.128, x, 0.395),
                                      (0.86, 0.082, 0.104, x, 0.378),
                                      (0.70, 0.061, 0.072, x, 0.366),
                                      (0.63, 0.052, 0.058, x, 0.362)], seg=8)
        B.tube('fshin' + sfx, hide, [(0.63, 0.050, 0.056, x, 0.362),
                                     (0.44, 0.042, 0.046, x, 0.360),
                                     (0.24, 0.038, 0.042, x, 0.358),
                                     (0.16, 0.046, 0.050, x, 0.358)], seg=8)
        B.tube('fshin' + sfx, 'black', [(0.145, 0.052, 0.056, x, 0.358),
                                        (0.02, 0.060, 0.066, x, 0.362)], seg=8, smooth=False)
        # hind legs: heavy gaskin, then the same thin cannon
        B.tube('bthigh' + sfx, hide, [(1.06, 0.110, 0.150, x, -0.330),
                                      (0.88, 0.096, 0.128, x, -0.378),
                                      (0.72, 0.066, 0.080, x, -0.400),
                                      (0.64, 0.054, 0.060, x, -0.402)], seg=8)
        B.tube('bshin' + sfx, hide, [(0.64, 0.052, 0.058, x, -0.402),
                                     (0.44, 0.042, 0.046, x, -0.360),
                                     (0.24, 0.038, 0.042, x, -0.320),
                                     (0.16, 0.046, 0.050, x, -0.312)], seg=8)
        B.tube('bshin' + sfx, 'black', [(0.145, 0.052, 0.056, x, -0.312),
                                        (0.02, 0.060, 0.066, x, -0.308)], seg=8, smooth=False)

    # tack
    B.tube('saddle', 'leatherDk', [(1.30, 0.150, 0.185, 0, 0.010),
                                   (1.37, 0.168, 0.175, 0, 0.015),
                                   (1.40, 0.140, 0.140, 0, 0.015)],
           seg=10, smooth=False, cap_lo=False)
    B.box('saddle', 'leatherDk', (0, -0.150, 1.395), (0.20, 0.10, 0.10), top=0.6)
    for s in (1, -1):    # stirrup leathers and irons
        B.strap('saddle', 'leatherDk', (0.155 * s, 0.02, 1.36), (0.185 * s, 0.02, 1.14),
                w=0.045, t=0.02)
        B.tube('saddle', 'iron', [(1.10, 0.048, 0.030, 0.188 * s, 0.02),
                                  (1.06, 0.052, 0.034, 0.188 * s, 0.02)],
               seg=6, smooth=False, cap_lo=False, cap_hi=False)
    # NB: unrotated tubes take (z, rx, ry, world_x, world_y) -- do NOT reuse the
    # barrel's offsets here, those are in its own rotated frame.
    B.tube('barrel', c.get('caparison', 'team'), [(0.86, 0.228, 0.268, 0, -0.05),
                                                  (1.02, 0.236, 0.280, 0, -0.05),
                                                  (1.24, 0.220, 0.266, 0, -0.04)],
           seg=12, cap_lo=False, cap_hi=False)
    B.tube('hneck', 'leatherDk', [(1.34, 0.118, 0.142, 0, 0.672),   # bridle browband
                                  (1.31, 0.120, 0.144, 0, 0.688)],
           seg=8, smooth=False, cap_lo=False, cap_hi=False)
    B.strap('hhead', 'leatherDk', (0, 0.812, 1.520), (0, 1.020, 1.450), w=0.035, t=0.018)
    if c.get('barding'):
        B.tube('withers', c['barding'], [(1.02, 0.202, 0.222, 0, 0.42),
                                         (1.16, 0.218, 0.238, 0, 0.43),
                                         (1.34, 0.204, 0.224, 0, 0.44)],
               seg=12, smooth=False, cap_lo=False, cap_hi=False)
        B.tube('hhead', c['barding'], [(1.560, 0.088, 0.100, 0, 0.808),
                                       (1.520, 0.078, 0.090, 0, 0.910),
                                       (1.478, 0.062, 0.070, 0, 0.985)],
               seg=8, smooth=False, cap_lo=False, cap_hi=False)
        B.cone('hhead', 'gold', (0, 0.790, 1.640), 0.030, 0.14, seg=5)

# ---------------------------------------------------------------------------
# 8. ANIMATION — procedural pose functions, baked to keys on every frame
# ---------------------------------------------------------------------------
TAU = math.pi * 2

def ease(t):
    return t * t * (3 - 2 * t)

def seg(t, a, b):
    """Normalised progress of t through the window [a,b]."""
    if t <= a:
        return 0.0
    if t >= b:
        return 1.0
    return (t - a) / (b - a)

def _swing(mounted):
    return 0.0 if mounted else 1.0

def p_idle(t, c):
    """Weight shift + breathing.  Nothing here should ever read as frozen."""
    s = math.sin(TAU * t)
    s2 = math.sin(TAU * t * 2)
    P = {
        'chest': (2 + 1.6 * s, 0, 1.2 * s),
        'spine': (1.0 * s, 0, 0),
        'head':  (-1.5 - 1.4 * s, 1.8 * s, 0),
        'armR':  (-3 + 2.0 * s, 0, -5),
        'armL':  (-3 + 2.0 * s, 0, 5),
        'forearmR': (-10 - 3 * s, 0, 0),
        'forearmL': (-10 - 3 * s, 0, 0),
    }
    root = (0, 0, 0.012 * s2)
    return P, root, (0, 0, 0)

def p_walk(t, c):
    a = TAU * t
    sw, co = math.sin(a), math.cos(a)
    st = c.get('stride', 32.0)
    P = {
        'thighR': (st * sw, 0, 0),
        'thighL': (-st * sw, 0, 0),
        'shinR':  (-max(0.0, 42 * math.sin(a - 0.9)), 0, 0),
        'shinL':  (-max(0.0, 42 * math.sin(a - 0.9 + math.pi)), 0, 0),
        'footR':  (14 * math.sin(a + 1.2), 0, 0),
        'footL':  (14 * math.sin(a + 1.2 + math.pi), 0, 0),
        'hips':   (2.5, 0, -4 * sw),
        'spine':  (3.0, 0, 2.5 * sw),
        'chest':  (1.5, 0, 3.5 * sw),
        'head':   (-4.0, 0, -2.0 * sw),
        'armR':   (-24 * sw, 0, -6),
        'armL':   (24 * sw, 0, 6),
        'forearmR': (-14 - 10 * max(0.0, -sw), 0, 0),
        'forearmL': (-14 - 10 * max(0.0, sw), 0, 0),
    }
    root = (0, 0, 0.030 * abs(math.sin(a)) - 0.012)
    return P, root, (0, 0, 0)

def p_attack_melee(t, c):
    """Wind up slow, strike fast, recover.  The pause at full extension is what
    sells a hit at 12fps."""
    wind = ease(seg(t, 0.0, 0.36))
    hit  = ease(seg(t, 0.36, 0.52))
    rec  = ease(seg(t, 0.62, 1.0))
    sw = wind - hit * 1.0 - (0.0) + 0.0
    reach = hit * (1 - rec)
    P = {
        'chest': (-6 * wind + 10 * reach, 0, 26 * wind - 40 * reach),
        'spine': (-3 * wind + 6 * reach, 0, 12 * wind - 18 * reach),
        'hips':  (0, 0, 8 * wind - 12 * reach),
        'head':  (0, 0, -14 * wind + 20 * reach),
        'armR':  (-118 * wind + 190 * reach, 0, -18 - 10 * wind),
        'forearmR': (-96 * wind + 104 * reach, 0, 0),
        'handR': (0, 0, -18 * wind + 26 * reach),
        'armL':  (10 * wind - 26 * reach, 0, 14),
        'forearmL': (-30 - 26 * wind + 12 * reach, 0, 0),
        'thighR': (-10 * wind + 22 * reach, 0, 0),
        'thighL': (12 * wind - 16 * reach, 0, 0),
        'shinL':  (-14 * wind, 0, 0),
    }
    root = (0, 0.10 * reach, 0)
    return P, root, (0, 0, 0)

def p_attack_bow(t, c):
    """Raise, draw to the cheek, loose, lower.  Positive X on an arm bone swings it
    forward -- the bow arm has to end level or the arrow reads as fired at the sky."""
    d = ease(seg(t, 0.0, 0.46)) if t < 0.5 else (1.0 - ease(seg(t, 0.52, 0.92)))
    up = ease(seg(t, 0.0, 0.30)) if t < 0.5 else (1.0 - ease(seg(t, 0.55, 0.95)))
    P = {
        'chest': (0, 0, -30 * up),      # turn side-on to the target
        'spine': (0, 0, -12 * up),
        'head':  (0, 0, 26 * up),
        'armL':  (84 * up, 0, 14 * up),         # bow arm forward and level
        'forearmL': (-8 * up, 0, 0),
        'armR':  (56 * up, 0, -38 * d),         # elbow high and out
        'forearmR': (-52 * up - 58 * d, 0, 0),  # fist back to the cheek
        'thighR': (-6 * up, 0, 0),
        'thighL': (8 * up, 0, 0),
    }
    return P, (0, 0, 0), (0, 0, 0)

def p_attack_thrust(t, c):
    """Spear and pike: draw the shaft back along the body, drive it forward, recover.
    A polearm swung like a sword is the single most obvious animation mistake in a
    medieval RTS -- these units brace and stab."""
    wind = ease(seg(t, 0.0, 0.34))
    push = ease(seg(t, 0.34, 0.50))
    rec  = ease(seg(t, 0.60, 1.0))
    r = push * (1 - rec)
    P = {
        'chest': (0, 0, 30 * wind - 44 * r),
        'spine': (0, 0, 12 * wind - 18 * r),
        'hips':  (0, 0, 10 * wind - 14 * r),
        'head':  (0, 0, -18 * wind + 24 * r),
        'armR':  (-34 * wind + 96 * r, 0, -14 - 12 * wind + 22 * r),
        'forearmR': (-72 * wind + 84 * r, 0, 0),
        'armL':  (-20 * wind + 74 * r, 0, 16),
        'forearmL': (-40 - 20 * wind + 40 * r, 0, 0),
        'thighR': (-16 * wind + 30 * r, 0, 0),
        'thighL': (14 * wind - 20 * r, 0, 0),
        'shinL':  (-18 * wind, 0, 0),
    }
    return P, (0, -0.06 * wind + 0.22 * r, 0), (0, 0, 0)

def p_convert(t, c):
    """Monks have atk:0 in the sim -- they convert.  Staff raised, both arms up,
    a slow insistent sway, so the 'attack' sheet reads as preaching, not clubbing."""
    a = TAU * t
    s = math.sin(a)
    rise = ease(seg(t, 0.0, 0.30)) if t < 0.72 else (1.0 - ease(seg(t, 0.76, 1.0)))
    P = {
        'armR':  (-152 * rise, 0, -20 - 8 * s),
        'forearmR': (-24 * rise - 10 * s, 0, 0),
        'armL':  (-120 * rise, 0, 26 + 8 * s),
        'forearmL': (-30 * rise + 10 * s, 0, 0),
        'chest': (-10 * rise, 0, 4 * s),
        'spine': (-6 * rise, 0, 0),
        'head':  (-16 * rise, 6 * s, 0),
    }
    return P, (0, 0, 0.03 * rise + 0.012 * s), (0, 0, 0)

def p_attack_gun(t, c):
    """Shoulder it, fire, absorb the kick, lower.  The recoil spike is short and
    violent -- one frame of it is what makes a gunpowder unit feel different."""
    up   = ease(seg(t, 0.0, 0.30)) if t < 0.62 else (1.0 - ease(seg(t, 0.66, 1.0)))
    kick = seg(t, 0.44, 0.50) * (1.0 - ease(seg(t, 0.50, 0.70)))
    P = {
        'chest': (0, 0, -26 * up + 10 * kick),
        'spine': (0, 0, -10 * up),
        'head':  (0, 0, 22 * up - 6 * kick),
        'armR':  (62 * up - 14 * kick, 0, -30 * up),
        'forearmR': (-64 * up + 18 * kick, 0, 0),
        'armL':  (74 * up - 10 * kick, 0, 20 * up),
        'forearmL': (-30 * up, 0, 0),
        'thighR': (-8 * up, 0, 0),
        'thighL': (10 * up, 0, 0),
    }
    return P, (0, -0.05 * kick, 0), (0, 0, 0)

def p_attack_throw(t, c):
    wind = ease(seg(t, 0.0, 0.40))
    thr  = ease(seg(t, 0.40, 0.56))
    rec  = ease(seg(t, 0.62, 1.0))
    r = thr * (1 - rec)
    P = {
        'chest': (-8 * wind, 0, 34 * wind - 46 * r),
        'spine': (-4 * wind, 0, 14 * wind - 18 * r),
        'armR':  (-150 * wind + 214 * r, 0, -22),
        'forearmR': (-84 * wind + 92 * r, 0, 0),
        'armL':  (-30 * wind + 40 * r, 0, 18),
        'head':  (0, 0, -16 * wind + 22 * r),
        'thighR': (-12 * wind + 20 * r, 0, 0),
        'thighL': (14 * wind - 18 * r, 0, 0),
    }
    return P, (0, 0.08 * r, 0), (0, 0, 0)

def p_work(t, c):
    """Villager chop/dig: a two-beat swing, faster on the down stroke."""
    a = TAU * t
    up = ease(seg(t, 0.0, 0.55))
    dn = ease(seg(t, 0.55, 0.80))
    k = up - dn
    P = {
        'chest': (18 - 26 * k, 0, 14 - 20 * k),
        'spine': (10 - 12 * k, 0, 6 - 8 * k),
        'head':  (-16 + 10 * k, 0, 0),
        'armR':  (-40 - 96 * k, 0, -14),
        'forearmR': (-28 - 40 * k, 0, 0),
        'armL':  (-34 - 80 * k, 0, 14),
        'forearmL': (-30 - 34 * k, 0, 0),
        'thighR': (-16, 0, 0),
        'thighL': (10, 0, 0),
        'shinR': (-12, 0, 0),
    }
    return P, (0, 0.03 - 0.06 * k, 0), (0, 0, 0)

def p_die(t, c):
    """Recoil, knees buckle, then topple from the collapse.  Deliberately a fold
    rather than a rigid plank: a 1.8m body pivoting on its heels swings its head
    most of a tile away and walks straight out of the sprite cell."""
    stag = ease(seg(t, 0.0, 0.22))
    sink = ease(seg(t, 0.14, 0.62))
    fall = ease(seg(t, 0.34, 0.86))
    land = ease(seg(t, 0.80, 1.0))
    P = {
        'hips':  (16 * stag + 30 * sink - 18 * fall, 0, 0),
        'spine': (-16 * stag + 26 * fall, 0, 8 * stag),
        'chest': (-26 * stag + 40 * fall, 0, 14 * stag),
        'head':  (30 * stag - 52 * fall, 14 * stag, 0),
        'armR':  (-48 * stag - 46 * fall, 0, -46 * stag - 30 * fall),
        'forearmR': (-24 - 54 * fall, 0, 0),
        'armL':  (-42 * stag - 40 * fall, 0, 46 * stag + 30 * fall),
        'forearmL': (-24 - 50 * fall, 0, 0),
        'thighR': (-14 * stag + 74 * sink, 0, -8 * sink),
        'thighL': (-8 * stag + 58 * sink, 0, 8 * sink),
        'shinR': (-24 * stag - 104 * sink, 0, 0),
        'shinL': (-18 * stag - 92 * sink, 0, 0),
        'footR': (40 * sink, 0, 0),
        'footL': (36 * sink, 0, 0),
    }
    # sink first, then tip over from the kneel; the +Y push keeps the corpse centred
    root = (0.04 * fall, 0.42 * fall - 0.05 * stag, -0.30 * sink)
    root_rot = (-58 * fall - 4 * land, 0, 12 * fall)
    return P, root, root_rot

# horse-specific overlays -----------------------------------------------------
def h_idle(t, c):
    s = math.sin(TAU * t)
    return {'hneck': (2 * s, 0, 0), 'hhead': (-3 * s, 2 * s, 0),
            'tail': (0, 0, 10 * s), 'barrel': (0.6 * s, 0, 0)}, (0, 0, 0.006 * s), (0, 0, 0)

def h_walk(t, c):
    a = TAU * t
    # diagonal pairs, the readable gallop-ish trot of a 90s RTS horse
    def leg(ph):
        return (34 * math.sin(a + ph), -max(0.0, 46 * math.sin(a + ph - 1.0)))
    fr, fr2 = leg(0.0)
    fl, fl2 = leg(math.pi)
    br, br2 = leg(math.pi)
    bl, bl2 = leg(0.0)
    P = {
        'fthighR': (fr, 0, 0), 'fshinR': (fr2, 0, 0),
        'fthighL': (fl, 0, 0), 'fshinL': (fl2, 0, 0),
        'bthighR': (br, 0, 0), 'bshinR': (-br2, 0, 0),
        'bthighL': (bl, 0, 0), 'bshinL': (-bl2, 0, 0),
        'barrel': (3 * math.sin(2 * a), 0, 0),
        'hneck': (-4 + 5 * math.sin(2 * a), 0, 0),
        'hhead': (4 - 4 * math.sin(2 * a), 0, 0),
        'tail': (0, 0, 12 * math.sin(a)),
    }
    return P, (0, 0, 0.05 * abs(math.sin(2 * a)) - 0.02), (0, 0, 0)

def h_die(t, c):
    fall = ease(seg(t, 0.18, 0.78))
    P = {
        'fthighR': (-40 * fall, 0, 0), 'fshinR': (-60 * fall, 0, 0),
        'fthighL': (-30 * fall, 0, 0), 'fshinL': (-56 * fall, 0, 0),
        'bthighR': (34 * fall, 0, 0), 'bshinR': (48 * fall, 0, 0),
        'bthighL': (28 * fall, 0, 0), 'bshinL': (44 * fall, 0, 0),
        'hneck': (-30 * fall, 0, 0), 'hhead': (24 * fall, 0, 0),
        'barrel': (0, 0, 0),
    }
    return P, (0, 0, -0.34 * fall), (0, -74 * fall, 0)

# rider pose when mounted: legs locked to the saddle, upper body free.
# Thigh forward + shin back so the lower leg hangs vertical against the barrel --
# a straight 58 deg thigh reads as a man sitting on an invisible chair.
MOUNT_LEGS = {
    'thighR': (46, 0, -13), 'thighL': (46, 0, 13),
    'shinR': (-74, 0, 0), 'shinL': (-74, 0, 0),
    'footR': (26, 0, 0), 'footL': (26, 0, 0),
}

# Rest ("carry") offsets, added on top of idle/walk/work so the weapon clears the
# body.  Without these a sword held at the fist is simply inside the ribcage: the
# arm hangs at x=0.21 and the torso is 0.47 wide.
# r99-human arm fix (Daniel: "the arms look backwards"): the old X-flexes
# (-40..-64) stacked on the idle bend and the 30-degree camera foreshortened
# them into horizontal tray-arms.  The LATERAL z-swing is what actually clears
# the ribcage; the flex only lifts the fist, so weapons now hang DOWN at the
# side, AoE2-idle style.  Bows/lances keep their cross-body carry -- those
# read as intended.
CARRY = {
    'sword':      {'armR': (-6, 0, -34), 'forearmR': (-18, 0, 0)},
    'greatsword': {'armR': (-8, 0, -32), 'forearmR': (-22, 0, 0)},
    'spear':      {'armR': (-4, 0, -26), 'forearmR': (-18, 0, 0)},
    'pike':       {'armR': (-4, 0, -24), 'forearmR': (-14, 0, 0)},
    'axe':        {'armR': (-6, 0, -32), 'forearmR': (-20, 0, 0)},
    'tool':       {'armR': (-6, 0, -28), 'forearmR': (-18, 0, 0)},
    'staff':      {'armR': (-6, 0, -24), 'forearmR': (-16, 0, 0)},
    'javelin':    {'armR': (-10, 0, -30), 'forearmR': (-26, 0, 0)},
    'bow':        {'armL': (-14, 0, 30), 'forearmL': (-34, 0, 0)},
    'crossbow':   {'armL': (-10, 0, 26), 'forearmL': (-40, 0, 0)},
    'twinsword':  {'armR': (-6, 0, -34), 'forearmR': (-18, 0, 0),
                   'armL': (-6, 0, 34), 'forearmL': (-18, 0, 0)},
    'gun':        {'armR': (-14, 0, -22), 'forearmR': (-34, 0, 0)},
    'bomb':       {'armR': (-20, 0, -18), 'forearmR': (-44, 0, 0)},
    'lance':      {'armR': (14, 0, -26), 'forearmR': (-24, 0, 0)},
}
CARRY_SHIELD = {'armL': (-6, 0, 13), 'forearmL': (-24, 0, 0)}
CARRY_BUCKLER = {'armL': (-5, 0, 20), 'forearmL': (-20, 0, 0)}

def carry_pose(c):
    """The rest offsets this costume needs, weapon plus off-hand."""
    out = dict(CARRY.get(c.get('weapon'), {}))
    off = CARRY_SHIELD if c.get('shield') else (CARRY_BUCKLER if c.get('buckler') else None)
    if off:
        for k, v in off.items():
            if k not in out:
                out[k] = v
    return out

# --- wildlife poses ---------------------------------------------------------
def b_idle(t, c):
    """Grazing: head dips to the grass, ears twitch, tail swings."""
    a = TAU * t
    dip = 0.5 - 0.5 * math.cos(a)          # slow nod down and back up
    P = {
        'bneck': (36 * dip - 4, 0, 3 * math.sin(a * 2)),
        'bhead': (24 * dip, 5 * math.sin(a * 3), 0),
        'body':  (2 * dip, 0, 0),
        'btail': (0, 0, 16 * math.sin(a * 2)),
    }
    return P, (0, 0, -0.012 * dip), (0, 0, 0)

def b_walk(t, c):
    a = TAU * t
    def leg(ph):
        return (30 * math.sin(a + ph), -max(0.0, 40 * math.sin(a + ph - 1.0)))
    fr, fr2 = leg(0.0)
    fl, fl2 = leg(math.pi)
    P = {
        'fthighR': (fr, 0, 0), 'fshinR': (fr2, 0, 0),
        'fthighL': (fl, 0, 0), 'fshinL': (fl2, 0, 0),
        'bthighR': (fl, 0, 0), 'bshinR': (-fl2, 0, 0),
        'bthighL': (fr, 0, 0), 'bshinL': (-fr2, 0, 0),
        'body':  (2.5 * math.sin(2 * a), 0, 0),
        'bneck': (-6 + 4 * math.sin(2 * a), 0, 0),
        'bhead': (4 - 3 * math.sin(2 * a), 0, 0),
        'btail': (0, 0, 12 * math.sin(a)),
    }
    return P, (0, 0, 0.026 * abs(math.sin(2 * a)) - 0.010), (0, 0, 0)

def b_attack(t, c):
    """Boar charge: head down, shoulders driving, then a gore upward."""
    wind = ease(seg(t, 0.0, 0.34))
    hit = ease(seg(t, 0.34, 0.50))
    rec = ease(seg(t, 0.58, 1.0))
    r = hit * (1 - rec)
    P = {
        'bneck': (26 * wind - 46 * r, 0, 0),
        'bhead': (18 * wind - 40 * r, 0, 0),
        'body':  (8 * wind - 14 * r, 0, 0),
        'fthighR': (-20 * wind + 34 * r, 0, 0),
        'fthighL': (-14 * wind + 28 * r, 0, 0),
        'bthighR': (16 * wind - 10 * r, 0, 0),
        'bthighL': (12 * wind - 8 * r, 0, 0),
    }
    return P, (0, -0.05 * wind + 0.16 * r, 0), (0, 0, 0)

def b_die(t, c):
    """Legs buckle, then it rolls onto its side.  Ends as the carcass the game
    drops food from, so the last frame has to read as meat on the ground."""
    buck = ease(seg(t, 0.06, 0.46))
    roll = ease(seg(t, 0.30, 0.86))
    P = {
        'fthighR': (-34 * buck, 0, 0), 'fshinR': (-52 * buck, 0, 0),
        'fthighL': (-28 * buck, 0, 0), 'fshinL': (-48 * buck, 0, 0),
        'bthighR': (30 * buck, 0, 0), 'bshinR': (44 * buck, 0, 0),
        'bthighL': (26 * buck, 0, 0), 'bshinL': (40 * buck, 0, 0),
        'bneck': (-28 * roll, 0, 20 * roll),
        'bhead': (18 * roll, 0, 0),
        'btail': (0, 0, -10 * roll),
    }
    return P, (0, 0, -0.30 * buck), (0, -78 * roll, 0)

ANIMS = {
    # name          frames loop  fn                 fps
    'idle':   (8,  True,  p_idle,         10),
    'walk':   (12, True,  p_walk,         12),
    'attack': (10, False, p_attack_melee, 14),
    'die':    (12, False, p_die,          12),
    'work':   (12, True,  p_work,         12),
}

# ---------------------------------------------------------------------------
# 9. UNIT ROSTER
# ---------------------------------------------------------------------------
UNITS = {
    'villager': dict(rig='man', anims=['idle', 'walk', 'attack', 'die', 'work'],
                     atk='melee', costume=dict(
                         tunic='team', legs='leatherDk', belt='rope', helm='straw',
                         weapon='tool', sleeves=True)),
    'militia': dict(rig='man', anims=['idle', 'walk', 'attack', 'die'],
                    atk='melee', costume=dict(
                        tunic='team', legs='leatherDk', belt='steelDark', helm='steel',
                        weapon='sword', shield=True, pauldron='steel', bracers=True,
                        mail=True)),
    'spearman': dict(rig='man', anims=['idle', 'walk', 'attack', 'die'],
                     atk='thrust', costume=dict(
                         tunic='linen', legs='leatherDk', helm='kettle', weapon='spear',
                         buckler=True, tabard=True, belt='leather')),
    'archer': dict(rig='man', anims=['idle', 'walk', 'attack', 'die'],
                   atk='bow', costume=dict(
                       tunic='teamDark', legs='leatherDk', belt='leather', helm='cap',
                       weapon='bow', quiver=True, bracers=True)),
    'monk': dict(rig='man', anims=['idle', 'walk', 'attack', 'die'],
                 atk='convert', costume=dict(
                     tunic='linen', helm='hood', hoodC='linen', weapon='staff',
                     robe=True, trim='team', sleeves=True)),
    'knight': dict(rig='horse', anims=['idle', 'walk', 'attack', 'die'],
                   atk='thrust', costume=dict(
                       tunic='steel', legs='steelDark', helm='steel', weapon='lance',
                       shield=True, pauldron='steel', cape='team', bracers=True,
                       hide='leather', mane='black', caparison='team', barding='steel')),

    # ---- rest of the trainable roster; all of it is costume data on the two rigs ----
    'pikeman': dict(rig='man', anims=['idle', 'walk', 'attack', 'die'], atk='thrust',
                    costume=dict(tunic='team', legs='leatherDk', helm='kettle',
                                 weapon='pike', tabard=True, belt='leather',
                                 pauldron='steel')),
    'crossbowman': dict(rig='man', anims=['idle', 'walk', 'attack', 'die'], atk='bow',
                        costume=dict(tunic='teamDark', legs='leatherDk', belt='leather',
                                     helm='kettle', weapon='crossbow', quiver=True,
                                     bracers=True)),
    'skirmisher': dict(rig='man', anims=['idle', 'walk', 'attack', 'die'], atk='throw',
                       costume=dict(tunic='cloth', legs='leatherDk', belt='leather',
                                    helm='band', weapon='javelin', buckler=True,
                                    sash=True, trim='team')),
    'handcannon': dict(rig='man', anims=['idle', 'walk', 'attack', 'die'], atk='gun',
                       costume=dict(tunic='team', legs='leatherDk', belt='leather',
                                    helm='kettle', weapon='gun', bracers=True)),
    'petard': dict(rig='man', anims=['idle', 'walk', 'attack', 'die'], atk='throw',
                   costume=dict(tunic='cloth', legs='leatherDk', belt='leather',
                                helm='steel', weapon='bomb', sash=True, trim='team')),
    'king': dict(rig='man', anims=['idle', 'walk', 'attack', 'die'], atk='melee',
                 costume=dict(tunic='team', helm='crown', weapon='sword', robe=True,
                              trim='gold', cape='silk')),
    # unique units -- each one needs a silhouette you can name at 50 pixels
    'longbow': dict(rig='man', anims=['idle', 'walk', 'attack', 'die'], atk='bow',
                    costume=dict(tunic='jade', legs='leatherDk', belt='leather',
                                 helm='hair', weapon='bow', quiver=True, trim='team',
                                 sash=True)),
    'axeman': dict(rig='man', anims=['idle', 'walk', 'attack', 'die'], atk='throw',
                   costume=dict(tunic='team', legs='leatherDk', belt='leather',
                                helm='cap', weapon='axe', bracers=True)),
    'berserker': dict(rig='man', anims=['idle', 'walk', 'attack', 'die'], atk='melee',
                      costume=dict(tunic='fur', legs='fur', helm='hair', weapon='axe',
                                   sleeves=False, belt='leather', trim='team',
                                   sash=True)),
    'huskarl': dict(rig='man', anims=['idle', 'walk', 'attack', 'die'], atk='melee',
                    costume=dict(tunic='team', legs='leatherDk', helm='steel',
                                 weapon='axe', buckler=True, belt='steelDark')),
    'teuton': dict(rig='man', anims=['idle', 'walk', 'attack', 'die'], atk='melee',
                   costume=dict(tunic='steel', legs='steelDark', helm='steel',
                                weapon='greatsword', pauldron='steel', cape='team',
                                bracers=True, belt='steelDark')),
    'woad': dict(rig='man', anims=['idle', 'walk', 'attack', 'die'], atk='thrust',
                 costume=dict(tunic='paleSkin', legs='tan', helm='topknot',
                              weapon='spear', paint=True, sleeves=False, trim='team',
                              sash=True)),
    'samurai': dict(rig='man', anims=['idle', 'walk', 'attack', 'die'], atk='melee',
                    costume=dict(tunic='lacquer', legs='black', helm='lamellar',
                                 weapon='sword', sash=True, pauldron='lacquer',
                                 trim='team', belt='leather')),
    'jaguar': dict(rig='man', anims=['idle', 'walk', 'attack', 'die'], atk='melee',
                   costume=dict(tunic='gold', legs='tan', helm='beast', beastC='gold',
                                weapon='sword', spots=True, sleeves=False, trim='team',
                                sash=True)),
    'eagle': dict(rig='man', anims=['idle', 'walk', 'attack', 'die'], atk='thrust',
                  costume=dict(tunic='team', legs='tan', helm='plume', plumeC='white',
                               weapon='spear', paint=True, paintC='silk', sleeves=False)),
    'plumed': dict(rig='man', anims=['idle', 'walk', 'attack', 'die'], atk='bow',
                   costume=dict(tunic='teamDark', legs='tan', helm='plume',
                                plumeC='jade', weapon='bow', quiver=True, sash=True)),
    'chukonu': dict(rig='man', anims=['idle', 'walk', 'attack', 'die'], atk='bow',
                    costume=dict(tunic='team', legs='leatherDk', helm='lamellar',
                                 weapon='crossbow', quiver=True, belt='leather')),
    'janissary': dict(rig='man', anims=['idle', 'walk', 'attack', 'die'], atk='gun',
                      costume=dict(tunic='team', legs='leatherDk', helm='turban',
                                   weapon='gun', sash=True, trim='silk', belt='leather')),
    'scout': dict(rig='horse', anims=['idle', 'walk', 'attack', 'die'], atk='melee',
                  costume=dict(tunic='team', legs='leatherDk', helm='cap', weapon='sword',
                               buckler=True, hide='wood', mane='woodDark',
                               caparison='team')),
    'cataphract': dict(rig='horse', anims=['idle', 'walk', 'attack', 'die'], atk='melee',
                       costume=dict(tunic='steel', legs='steelDark', helm='lamellar',
                                    weapon='sword', pauldron='steel', bracers=True,
                                    hide='leather', mane='black', caparison='teamDark',
                                    barding='steel')),
    'mameluke': dict(rig='horse', anims=['idle', 'walk', 'attack', 'die'], atk='melee',
                     costume=dict(tunic='turban', legs='linen', helm='turban',
                                  weapon='twinsword', sash=True, trim='team',
                                  hide='wood', mane='black', caparison='team')),
    'mangudai': dict(rig='horse', anims=['idle', 'walk', 'attack', 'die'], atk='bow',
                     costume=dict(tunic='leather', legs='leatherDk', helm='lamellar',
                                  weapon='bow', quiver=True, trim='team',
                                  hide='wood', mane='woodDark', caparison='teamDark')),
    # ---- ships.  Origin is the waterline; the game draws water over the keel. ----
    'fishing': dict(rig='ship', anims=['idle', 'walk', 'die'],
                    costume=dict(ship='fishing', len=0.92, beam=0.34, deck=0.46,
                                 net='linen')),
    'cog': dict(rig='ship', anims=['idle', 'walk', 'die'],
                costume=dict(ship='cog', len=1.05, beam=0.42, deck=0.52,
                             sailC='linen', band='team')),
    'transport': dict(rig='ship', anims=['idle', 'walk', 'die'],
                      costume=dict(ship='transport', len=1.20, beam=0.46, deck=0.48,
                                   sailC='white', band='team')),
    'galley': dict(rig='ship', anims=['idle', 'walk', 'attack', 'die'],
                   costume=dict(ship='galley', len=1.28, beam=0.36, deck=0.48,
                                sailC='white', band='team')),
    'longboat': dict(rig='ship', anims=['idle', 'walk', 'attack', 'die'],
                     costume=dict(ship='longboat', len=1.24, beam=0.36, deck=0.44,
                                  sailC='white', band='team')),
    'fireship': dict(rig='ship', anims=['idle', 'walk', 'attack', 'die'],
                     costume=dict(ship='fireship', len=1.00, beam=0.34, deck=0.44,
                                  band='team')),
    'demo': dict(rig='ship', anims=['idle', 'walk', 'attack', 'die'],
                 costume=dict(ship='demo', len=0.88, beam=0.34, deck=0.44)),
    'turtle': dict(rig='ship', anims=['idle', 'walk', 'attack', 'die'],
                   costume=dict(ship='turtle', len=1.10, beam=0.42, deck=0.46,
                                shell='iron')),
    'cannongalleon': dict(rig='ship', anims=['idle', 'walk', 'attack', 'die'],
                          costume=dict(ship='cannongalleon', len=1.34, beam=0.44,
                                       deck=0.54, sailC='linen', band='team')),

    # ---- siege engines.  `swing` is the arm's (rest, fired) angle in degrees. ----
    'ram': dict(rig='siege', anims=['idle', 'walk', 'attack', 'die'],
                costume=dict(siege='ram', roof='woodDark', log='woodDark',
                             swing=(-26, 30), idleK=1.6)),
    'mangonel': dict(rig='siege', anims=['idle', 'walk', 'attack', 'die'],
                     costume=dict(siege='mangonel', pad='leather',
                                  swing=(-52, 96))),
    'scorpion': dict(rig='siege', anims=['idle', 'walk', 'attack', 'die'],
                     costume=dict(siege='scorpion', swing=(-4, 6), recoil=0.10,
                                  idleK=0.4)),
    'treb': dict(rig='siege', anims=['idle', 'walk', 'attack', 'die'],
                 costume=dict(siege='treb', swing=(-46, 132), idleK=0.6)),
    'bombard': dict(rig='siege', anims=['idle', 'walk', 'attack', 'die'],
                    costume=dict(siege='bombard', barrel='bronze', swing=(0, -9),
                                 recoil=0.26, idleK=0.3)),

    # ---- wildlife (GAIA).  The game owns these on player slot 8. ----
    'sheep': dict(rig='beast', anims=['idle', 'walk', 'die'],
                  costume=dict(beast='sheep', hide='white', face='black',
                               mane='linen')),
    'deer': dict(rig='beast', anims=['idle', 'walk', 'die'],
                 costume=dict(beast='deer', hide='leather', mane='woodDark')),
    'boar': dict(rig='beast', anims=['idle', 'walk', 'attack', 'die'],
                 costume=dict(beast='boar', hide='woodDark', mane='black')),

    'missionary': dict(rig='horse', anims=['idle', 'walk', 'attack', 'die'], atk='convert',
                       costume=dict(tunic='linen', legs='linen', helm='hood',
                                    hoodC='linen', weapon='staff', cape='linen',
                                    trim='gold', hide='white', mane='linen',
                                    caparison='team')),
}

# ---------------------------------------------------------------------------
# 10. ASSEMBLY
# ---------------------------------------------------------------------------
def assign_action(ob, act):
    """Blender 4.4+ actions are slotted; assigning a fresh one needs a slot."""
    if ob.animation_data is None:
        ob.animation_data_create()
    ad = ob.animation_data
    ad.action = act
    if hasattr(ad, 'action_slot') and ad.action_slot is None:
        try:
            slot = act.slots.new(id_type='OBJECT', name=ob.name)
            ad.action_slot = slot
        except Exception:
            pass

def action_fcurves(act):
    """Blender 4.4+ moved curves into layers/strips/channelbags; act.fcurves is the
    legacy path and reads empty on a slotted action, so try both."""
    legacy = list(getattr(act, 'fcurves', []) or [])
    if legacy:
        return legacy
    out = []
    for layer in getattr(act, 'layers', []):
        for strip in getattr(layer, 'strips', []):
            for bag in getattr(strip, 'channelbags', []):
                out.extend(bag.fcurves)
    return out

def bake_action(arm, name, length, fn, hfn, cfg, mounted, carry=None):
    act = bpy.data.actions.new(name)
    assign_action(arm, act)
    pbs = arm.pose.bones
    for f in range(length):
        t = f / float(length) if cfg['loop'] else (f / float(length - 1) if length > 1 else 0)
        P, rloc, rrot = fn(t, cfg)
        H = {}
        if hfn:
            H, hloc, hrot = hfn(t, cfg)
            rloc, rrot = hloc, hrot
        pose = {}
        if mounted:
            pose.update(MOUNT_LEGS)
            for k in ('thighR', 'thighL', 'shinR', 'shinL', 'footR', 'footL', 'hips'):
                P.pop(k, None)
        pose.update(P)
        pose.update(H)
        if carry:   # additive: the swing still reads, it just starts clear of the ribs
            for bname, off in carry.items():
                b = pose.get(bname, (0, 0, 0))
                pose[bname] = (b[0] + off[0], b[1] + off[1], b[2] + off[2])
        for pb in pbs:
            r = pose.get(pb.name, (0, 0, 0))
            pb.rotation_euler = (r[0] * D2R, r[1] * D2R, r[2] * D2R)
            pb.location = (0, 0, 0)
            if pb.name == 'root':
                pb.location = rloc
                pb.rotation_euler = (rrot[0] * D2R, rrot[1] * D2R, rrot[2] * D2R)
            pb.keyframe_insert('rotation_euler', frame=f + 1)
            pb.keyframe_insert('location', frame=f + 1)
    # Actions are swapped off the armature as each one is baked, which leaves the
    # earlier ones with zero users -- and Blender drops zero-user datablocks on
    # save, so a .blend would open holding only the LAST animation.
    act.use_fake_user = True
    for fc in action_fcurves(act):
        for kp in fc.keyframe_points:
            kp.interpolation = 'LINEAR'
    return act

def make_unit(key):
    spec = UNITS[key]
    c = dict(spec['costume'])
    rig = spec['rig']
    mounted = rig == 'horse'

    B = Builder()
    if mounted:
        arm = make_armature(key + '_rig', HORSE_BONES + rider_bones())
        build_horse(B, c)
        build_man(B, c, zoff=0.27, yoff=-0.05)
    elif rig == 'beast':
        arm = make_armature(key + '_rig', BEAST_BONES)
        build_beast(B, c)
    elif rig == 'siege':
        arm = make_armature(key + '_rig', SIEGE_BONES)
        build_siege(B, c)
    elif rig == 'ship':
        arm = make_armature(key + '_rig', SHIP_BONES)
        build_ship(B, c)
    else:
        arm = make_armature(key + '_rig', MAN_BONES)
        build_man(B, c)

    mesh = B.build(key, arm)

    if rig in ('beast', 'siege', 'ship'):
        # these rigs have their own pose set end to end -- no carry offsets, no rider
        pfn = {'beast': {'idle': b_idle, 'walk': b_walk, 'attack': b_attack,
                         'die': b_die},
               'siege': {'idle': s_idle, 'walk': s_walk, 'attack': s_attack,
                         'die': s_die},
               'ship':  {'idle': sh_idle, 'walk': sh_walk, 'attack': sh_attack,
                         'die': sh_die}}[rig]
        acts = {}
        for aname in spec['anims']:
            length, loop, _f, fps = ANIMS[aname]
            cfg = dict(c)
            cfg['loop'] = loop
            acts[aname] = (bake_action(arm, '%s_%s' % (key, aname), length,
                                       pfn[aname], None, cfg, False, None),
                           length, loop, fps)
        rot = link(bpy.data.objects.new(key + '_ROT', None))
        rot.empty_display_size = 0.4
        arm.parent = rot
        return dict(key=key, arm=arm, mesh=mesh, rot=rot, actions=acts,
                    mat_keys=list(mesh['tc_keys']))

    atk = spec.get('atk', 'melee')
    atk_fn = {'melee': p_attack_melee, 'bow': p_attack_bow,
              'throw': p_attack_throw, 'gun': p_attack_gun,
              'thrust': p_attack_thrust, 'convert': p_convert}[atk]
    horse_fn = {'idle': h_idle, 'walk': h_walk, 'die': h_die,
                'attack': h_walk, 'work': h_idle}

    carry = carry_pose(c)
    actions = {}
    for aname in spec['anims']:
        length, loop, fn, fps = ANIMS[aname]
        if aname == 'attack':
            fn = atk_fn
        cfg = {'loop': loop, 'stride': 32.0}
        hfn = None
        if mounted:
            hfn = horse_fn.get(aname)
            if aname == 'attack':
                hfn = None
        # the attack authors its own arm arc; everything else gets the rest offsets
        ca = None if aname == 'attack' else carry
        actions[aname] = (bake_action(arm, '%s_%s' % (key, aname), length, fn, hfn,
                                      cfg, mounted, ca),
                          length, loop, fps)

    rot = link(bpy.data.objects.new(key + '_ROT', None))
    rot.empty_display_size = 0.4
    arm.parent = rot
    return dict(key=key, arm=arm, mesh=mesh, rot=rot, actions=actions,
                mat_keys=list(mesh['tc_keys']))

# ---------------------------------------------------------------------------
# 11. CAMERA + LIGHTS
# ---------------------------------------------------------------------------
def setup_stage(cell, ppm, anchor_z=ANCHOR_Z):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x = cell
    sc.render.resolution_y = cell
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = True
    sc.render.filter_size = 1.1
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.render.image_settings.color_depth = '8'
    sc.render.image_settings.compression = 15
    try:
        sc.view_settings.view_transform = 'Standard'   # never AgX: 1999 wants punch
        sc.view_settings.look = 'None'
    except Exception:
        pass
    try:
        sc.eevee.taa_render_samples = 24
        sc.eevee.use_shadows = True
        # cheap ambient occlusion: crevices between plates, under the chin, inside
        # a hood.  Without it the new surface texture floats on a flat form.
        sc.eevee.use_fast_gi = True
        sc.eevee.fast_gi_method = 'AMBIENT_OCCLUSION_ONLY'
        sc.eevee.fast_gi_distance = 0.22
        sc.eevee.fast_gi_ray_count = 2
        sc.eevee.fast_gi_step_count = 6
    except Exception as e:
        print('eevee GI setup skipped: %s' % e)

    world = bpy.data.worlds.new('tc_world')
    sc.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get('Background')
    if bg:
        bg.inputs['Color'].default_value = (0.055, 0.065, 0.095, 1)
        bg.inputs['Strength'].default_value = 1.0

    cam_data = bpy.data.cameras.new('iso_cam')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = cell / ppm
    cam = link(bpy.data.objects.new('iso_cam', cam_data))
    dist = 20.0
    cam.location = (0.0, -dist * COS_E, anchor_z + dist * SIN_E)
    cam.rotation_euler = (CAM_ROT_X * D2R, 0.0, 0.0)
    sc.camera = cam

    def sun(name, loc, color, energy, shadow):
        d = bpy.data.lights.new(name, 'SUN')
        d.color = srgb(color)[:3]
        d.energy = energy
        d.angle = 12 * D2R
        d.use_shadow = shadow
        o = link(bpy.data.objects.new(name, d))
        o.location = loc
        v = Vector((0, 0, anchor_z)) - Vector(loc)
        o.rotation_euler = v.to_track_quat('-Z', 'Y').to_euler()
        return o

    # world-fixed sun from the screen's upper-left, exactly like the 2D art note
    sun('key',  (-4.2, 2.6, 6.0), '#fff0d2', 3.5, True)
    sun('fill', (4.6, -3.4, 2.2), '#93a9d6', 0.80, False)
    sun('rim',  (2.2, 5.4, 4.4),  '#cfe0ff', 2.1, False)
    return cam

# ---------------------------------------------------------------------------
# 12. RENDER + SHEET ASSEMBLY
# ---------------------------------------------------------------------------
def swap_materials(mesh, keys, to_mask):
    for i, k in enumerate(keys):
        mesh.data.materials[i] = mask_mat(k) if to_mask else toon_mat(k)

def render_anim(unit, aname, act, length, tmp, tag):
    sc = bpy.context.scene
    # The mask pass is unlit emission -- sampling and shadow maps buy it nothing,
    # and at ~1s a frame that overhead is most of a long roster run.
    try:
        mask_pass = (tag == 'msk')
        sc.eevee.taa_render_samples = 2 if mask_pass else 16
        sc.eevee.use_shadows = not mask_pass
    except Exception:
        pass
    assign_action(unit['arm'], act)
    sc.frame_start, sc.frame_end = 1, length
    paths = []
    for d in range(DIRS):
        unit['rot'].rotation_euler = (0, 0, dir_yaw(d))
        pre = os.path.join(tmp, '%s_%s_%s_d%d_' % (unit['key'], aname, tag, d))
        sc.render.filepath = pre
        bpy.ops.render.render(animation=True)
        paths.append([pre + ('%04d.png' % (f + 1)) for f in range(length)])
    return paths

def img_array(path, cell):
    img = bpy.data.images.load(path, check_existing=False)
    img.colorspace_settings.name = 'Non-Color'   # raw passthrough: no double transform
    img.alpha_mode = 'STRAIGHT'
    buf = np.empty(len(img.pixels), dtype=np.float32)
    img.pixels.foreach_get(buf)
    a = buf.reshape(img.size[1], img.size[0], 4)
    bpy.data.images.remove(img)
    return a

def save_array(arr, path):
    h, w = arr.shape[0], arr.shape[1]
    img = bpy.data.images.new(os.path.basename(path), w, h, alpha=True)
    img.colorspace_settings.name = 'Non-Color'
    img.alpha_mode = 'STRAIGHT'
    img.pixels.foreach_set(arr.reshape(-1).astype(np.float32))
    img.file_format = 'PNG'
    img.filepath_raw = path
    img.save()
    bpy.data.images.remove(img)

def assemble(paths, cell, hard_alpha=True):
    """paths[d][f] -> sheet of (DIRS rows x frames cols).  Blender images are
    bottom-up, so direction 0 (which we want on top) goes in the last row."""
    rows, cols = len(paths), len(paths[0])
    sheet = np.zeros((rows * cell, cols * cell, 4), dtype=np.float32)
    for d, frames in enumerate(paths):
        rb = (rows - 1 - d) * cell          # bottom-up row origin
        for f, p in enumerate(frames):
            a = img_array(p, cell)
            sheet[rb:rb + cell, f * cell:(f + 1) * cell, :] = a
    if hard_alpha:
        al = sheet[:, :, 3]
        sheet[:, :, 3] = np.where(al >= 0.4, 1.0, 0.0)
        sheet[:, :, :3] *= sheet[:, :, 3:4]
    return sheet

# ---------------------------------------------------------------------------
# 13. MODES
# ---------------------------------------------------------------------------
def do_sheets(names, outdir, cell, ppm, hard_alpha, want_mask):
    tmp = os.path.join(outdir, '_tmp')
    os.makedirs(tmp, exist_ok=True)
    os.makedirs(outdir, exist_ok=True)
    # Merge into any existing atlas.  Rendering a second batch with --units used to
    # overwrite atlas.json with just that batch, silently dropping every unit
    # rendered earlier even though their PNGs were still sitting right there.
    index = {}
    prev = os.path.join(outdir, 'atlas.json')
    if os.path.exists(prev):
        try:
            with open(prev) as fh:
                index = json.load(fh)
        except Exception:
            index = {}
    for key in names:
        wipe_scene()
        _MAT_CACHE.clear()
        _MASK_CACHE.clear()
        _MAT_BUMP.clear()   # holds nodes from the wiped scene; stale refs crash
        setup_stage(cell, ppm)
        u = make_unit(key)
        atlas = dict(unit=key, cell=cell, ppm=ppm, dirs=DIRS,
                     anchorX=cell // 2,
                     anchorY=round(cell / 2 + COS_E * ANCHOR_Z * ppm, 2),
                     note='row k == octant k from octPhi(); frames left to right',
                     anims={})
        for aname, (act, length, loop, fps) in u['actions'].items():
            swap_materials(u['mesh'], u['mat_keys'], False)
            paths = render_anim(u, aname, act, length, tmp, 'col')
            sheet = assemble(paths, cell, hard_alpha)
            fn = '%s_%s.png' % (key, aname)
            save_array(sheet, os.path.join(outdir, fn))
            entry = dict(frames=length, loop=loop, fps=fps, sheet=fn)
            if want_mask:
                swap_materials(u['mesh'], u['mat_keys'], True)
                mpaths = render_anim(u, aname, act, length, tmp, 'msk')
                msheet = assemble(mpaths, cell, hard_alpha)
                mfn = '%s_%s_mask.png' % (key, aname)
                save_array(msheet, os.path.join(outdir, mfn))
                entry['mask'] = mfn
                swap_materials(u['mesh'], u['mat_keys'], False)
            atlas['anims'][aname] = entry
            print('  [ok] %s %s -> %s' % (key, aname, fn))
        with open(os.path.join(outdir, '%s.json' % key), 'w') as fh:
            json.dump(atlas, fh, indent=1)
        index[key] = atlas
        # rewrite the index after every unit -- a full roster is well over an hour,
        # and an atlas written only at the end means the viewer is dead until then
        with open(os.path.join(outdir, 'atlas.json'), 'w') as fh:
            json.dump(index, fh, indent=1)
    shutil.rmtree(tmp, ignore_errors=True)

def do_preview(names, outdir, cell, ppm):
    """One contact sheet: a row of 8 facings per unit, then a walk + attack strip."""
    os.makedirs(outdir, exist_ok=True)
    tmp = os.path.join(outdir, '_tmp')
    os.makedirs(tmp, exist_ok=True)
    rows = []
    for key in names:
        wipe_scene()
        _MAT_CACHE.clear()
        _MASK_CACHE.clear()
        _MAT_BUMP.clear()   # holds nodes from the wiped scene; stale refs crash
        setup_stage(cell, ppm)
        u = make_unit(key)
        sc = bpy.context.scene
        # row A: 8 facings, mid-idle
        act, length, loop, fps = u['actions']['idle']
        assign_action(u['arm'], act)
        sc.frame_set(1)
        face = []
        for d in range(DIRS):
            u['rot'].rotation_euler = (0, 0, dir_yaw(d))
            p = os.path.join(tmp, 'pv_%s_f%d.png' % (key, d))
            sc.render.filepath = p[:-4]
            bpy.ops.render.render(write_still=True)
            face.append(p if os.path.exists(p) else p[:-4] + '.png')
        rows.append(('%s facings' % key, face))
        # row B: walk cycle, one facing (south-east)
        for aname in ('walk', 'attack', 'die'):
            if aname not in u['actions']:
                continue
            act, length, loop, fps = u['actions'][aname]
            assign_action(u['arm'], act)
            u['rot'].rotation_euler = (0, 0, dir_yaw(1))
            strip = []
            step = max(1, length // 8)
            for f in range(1, length + 1, step):
                sc.frame_set(f)
                p = os.path.join(tmp, 'pv_%s_%s_%d.png' % (key, aname, f))
                sc.render.filepath = p[:-4]
                bpy.ops.render.render(write_still=True)
                strip.append(p)
            rows.append(('%s %s' % (key, aname), strip[:8]))
        print('  [ok] preview %s' % key)

    cols = max(len(r[1]) for r in rows)
    sheet = np.zeros((len(rows) * cell, cols * cell, 4), dtype=np.float32)
    for i, (_, files) in enumerate(rows):
        rb = (len(rows) - 1 - i) * cell
        for j, p in enumerate(files):
            sheet[rb:rb + cell, j * cell:(j + 1) * cell, :] = img_array(p, cell)
    # dark backdrop so the sheet is readable as a flat image
    a = sheet[:, :, 3:4]
    bgc = np.array([0.045, 0.05, 0.06, 1.0], dtype=np.float32)
    sheet = sheet * a + bgc * (1 - a)
    sheet[:, :, 3] = 1.0
    out = os.path.join(outdir, 'contact.png')
    save_array(sheet, out)
    with open(os.path.join(outdir, 'contact.txt'), 'w') as fh:
        fh.write('rows top->bottom:\n' + '\n'.join(r[0] for r in rows) + '\n')
    print('CONTACT: %s' % out)
    shutil.rmtree(tmp, ignore_errors=True)

def do_blend(names, outdir, cell, ppm):
    os.makedirs(outdir, exist_ok=True)
    for key in names:
        wipe_scene()
        _MAT_CACHE.clear()
        _MASK_CACHE.clear()
        _MAT_BUMP.clear()   # holds nodes from the wiped scene; stale refs crash
        setup_stage(cell, ppm)
        make_unit(key)
        p = os.path.join(outdir, '%s.blend' % key)
        bpy.ops.wm.save_as_mainfile(filepath=p)
        print('  [ok] %s' % p)

# ---------------------------------------------------------------------------
def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('--mode', default='preview', choices=['preview', 'sheets', 'blend'])
    ap.add_argument('--units', default='all')
    ap.add_argument('--out', default=os.path.join(HERE, 'out'))
    ap.add_argument('--cell', type=int, default=CELL_DEFAULT)
    ap.add_argument('--ppm', type=float, default=PPM_DEFAULT)
    ap.add_argument('--soft-alpha', action='store_true')
    ap.add_argument('--no-mask', action='store_true')
    ap.add_argument('--anims', default='', help='comma list to restrict; default all the unit has')
    a = ap.parse_args(argv)
    if a.anims:
        only = set(a.anims.split(','))
        for spec in UNITS.values():
            spec['anims'] = [n for n in spec['anims'] if n in only]

    if np is None:
        raise SystemExit('numpy missing from this Blender build')
    names = list(UNITS) if a.units == 'all' else [n for n in a.units.split(',') if n]
    bad = [n for n in names if n not in UNITS]
    if bad:
        raise SystemExit('unknown units: %s' % bad)
    print('tc_forge: mode=%s units=%s cell=%d ppm=%.1f' % (a.mode, names, a.cell, a.ppm))

    if a.mode == 'preview':
        do_preview(names, a.out, a.cell, a.ppm)
    elif a.mode == 'sheets':
        do_sheets(names, a.out, a.cell, a.ppm, not a.soft_alpha, not a.no_mask)
    else:
        do_blend(names, a.out, a.cell, a.ppm)
    print('tc_forge: done')

# Importable as a library (the R3 exporter reuses the builders and the
# palette); set TC_FORGE_LIB=1 to suppress the CLI.
if os.environ.get('TC_FORGE_LIB') != '1':
    main()
