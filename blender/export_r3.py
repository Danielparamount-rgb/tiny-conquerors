"""
export_r3.py — turn the forge's unit geometry into R3's instanced vertex format.

This is the "stop using sprites" path: instead of pre-rendering the models to
flat sheets, hand the actual meshes to the game's WebGL renderer, which already
draws units as instanced part-swung geometry. We keep every one of its features
(instancing, team colour, age variants, shadows, topple) and only swap the boxed
parts for the sculpted ones.

Conventions R3 uses, which this has to convert into:
  * Y up, X forward, Z right.  Blender is Z up, Y forward, X right, so
    (X,Y,Z)_r3 = (y,z,x)_blender -- a cyclic swap, so handedness survives.
  * 1 world unit = 1 TILE. R3's man is ~0.8 tall, ours is ~1.85m, hence SCALE.
  * per-vertex PART index drives the shader's swing:
      2,3 = legs (about uPiv.x)   4,5,6 = arms (about uPiv.y)   else static
  * per-vertex TEAM MIX in [0,1]: mix(aCol, teamColour, mix).

  blender -b --factory-startup --python export_r3.py -- --lod 0.7
"""
import bpy, os, sys, json, argparse, struct, math
import numpy as np
os.environ['TC_FORGE_LIB'] = '1'

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import tc_forge as F

SCALE = 0.432          # 1.85m man -> 0.80 world units, matching R3's boxed man

# bone -> R3 part index. Our rig is a superset of R3's scheme, so this is a
# straight lookup; anything unlisted is static body.
PART = {}
for b in ('thighR', 'shinR', 'footR'):  PART[b] = 2
for b in ('thighL', 'shinL', 'footL'):  PART[b] = 3
for b in ('shoulderR', 'armR', 'forearmR', 'handR'): PART[b] = 4
for b in ('shoulderL', 'armL', 'forearmL', 'handL'): PART[b] = 5
# quadruped and vehicle limbs swing on the same two channels
for b in ('fthighR', 'fshinR', 'bthighL', 'bshinL'): PART[b] = 2
for b in ('fthighL', 'fshinL', 'bthighR', 'bshinR'): PART[b] = 3
for b in ('arm',):                       PART['arm'] = 4      # siege throwing arm
for b in ('sail', 'mast'):               PART[b] = 4          # ships: sail sway

# team surfaces: (aCol, mix). Mix < 1 with a dark aCol darkens the team colour,
# which is how teamDark stays a shade rather than becoming flat team paint.
TEAMMIX = {'team': ((0.0, 0.0, 0.0), 1.00),
           'teamDark': ((0.0, 0.0, 0.0), 0.62),
           'teamTrim': ((1.0, 1.0, 1.0), 0.80)}

def rgb(key):
    h = F.PAL[key].lstrip('#')
    return (int(h[0:2], 16) / 255.0, int(h[2:4], 16) / 255.0, int(h[4:6], 16) / 255.0)

def build(key):
    """Rebuild one unit's geometry with the forge's own builders (no scene)."""
    spec = F.UNITS[key]
    c = dict(spec['costume'])
    rig = spec['rig']
    B = F.Builder()
    if rig == 'horse':
        F.build_horse(B, c); F.build_man(B, c, zoff=0.27, yoff=-0.05)
    elif rig == 'beast':  F.build_beast(B, c)
    elif rig == 'siege':  F.build_siege(B, c)
    elif rig == 'ship':   F.build_ship(B, c)
    else:                 F.build_man(B, c)
    return B

def convert(B):
    """Builder -> (interleaved float verts, index list). 11 floats per vertex:
    pos3, nrm3, col3, part, teammix."""
    V = [F.Vector(v) for v in B.verts]
    # face normals in Blender space first
    fn = []
    for f in B.faces:
        p0, p1, p2 = V[f[0]], V[f[1]], V[f[2]]
        n = (p1 - p0).cross(p2 - p0)
        fn.append(n.normalized() if n.length > 1e-9 else F.Vector((0, 0, 1)))
    # smooth vertices average the normals of the smooth faces touching them
    acc = {}
    for fi, f in enumerate(B.faces):
        if not B.face_smooth[fi]:
            continue
        for vi in f:
            acc.setdefault(vi, F.Vector((0, 0, 0)))
            acc[vi] += fn[fi]
    for k in acc:
        acc[k] = acc[k].normalized() if acc[k].length > 1e-9 else F.Vector((0, 0, 1))

    out, idx = [], []
    for fi, f in enumerate(B.faces):
        key = B.face_key[fi]
        col, mix = (TEAMMIX[key] if key in TEAMMIX else (rgb(key), 0.0))
        base = len(out) // 11
        for vi in f:
            p = V[vi]
            n = acc[vi] if (B.face_smooth[fi] and vi in acc) else fn[fi]
            part = PART.get(B.vert_bone[vi], 0)
            # Blender (x,y,z) -> R3 (y,z,x), scaled to tiles
            out += [p.y * SCALE, p.z * SCALE, p.x * SCALE,
                    n.y, n.z, n.x,
                    col[0], col[1], col[2], float(part), float(mix)]
        for k in range(1, len(f) - 1):     # fan-triangulate the quad
            idx += [base, base + k, base + k + 1]
    return out, idx

def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.abspath(os.path.join(HERE, '..', 'app')))
    ap.add_argument('--lod', type=float, default=1.0,
                    help='<1 lowers tube/ball segment counts for the 3D build')
    ap.add_argument('--units', default='all')
    a = ap.parse_args(argv)
    a.out = os.path.abspath(a.out)

    if a.lod < 0.999:
        # Sprites were rendered at 55px; on the 3D board a unit is ~40px, so the
        # silhouette can afford fewer segments. Patch the primitives once.
        oT, oB = F.Builder.tube, F.Builder.ball
        L = a.lod
        def tube(self, bone, key, rings, seg=10, **kw):
            kw['seg'] = max(5, int(round(seg * L))); return oT(self, bone, key, rings, **kw)
        def ball(self, bone, key, c, r, seg=10, bands=6, **kw):
            return oB(self, bone, key, c, r, seg=max(5, int(round(seg * L))),
                      bands=max(4, int(round(bands * L))), **kw)
        F.Builder.tube, F.Builder.ball = tube, ball

    names = list(F.UNITS) if a.units == 'all' else a.units.split(',')
    blob, ibuf, index, vtot, itot = bytearray(), bytearray(), {}, 0, 0
    for k in names:
        verts, idx = convert(build(k))          # build ONCE
        nv = len(verts) // 11
        rig = F.UNITS[k]['rig']
        piv = ([0.86, 1.30] if rig in ('man',) else
               [0.60, 1.57] if rig == 'horse' else [0.45, 0.70])
        index[k] = dict(vOff=vtot, vCount=nv, iOff=itot, iCount=len(idx),
                        piv=[round(piv[0] * SCALE, 4), round(piv[1] * SCALE, 4)])
        blob += struct.pack('<%df' % len(verts), *verts)
        # WebGL1 has no baseVertex, so indices must already point into the
        # shared buffer -- rebase them here or every unit draws unit 0's mesh
        ibuf += struct.pack('<%dI' % len(idx), *[i + vtot for i in idx])
        vtot += nv; itot += len(idx)
        print('  %-14s %5d verts %5d tris' % (k, nv, len(idx) // 3))

    os.makedirs(a.out, exist_ok=True)
    open(os.path.join(a.out, 'models.bin'), 'wb').write(bytes(blob) + bytes(ibuf))
    json.dump(dict(scale=SCALE, stride=11, vBytes=len(blob), units=index),
              open(os.path.join(a.out, 'models.json'), 'w'), separators=(',', ':'))
    print('EXPORTED %d units  %d verts  %d tris  %.2fMB'
          % (len(names), vtot, itot // 3, (len(blob) + len(ibuf)) / 1e6))

main()
