"""
pack_sprites.py — turn the render output into something a web game can actually load.

The forge writes 128x128 cells sized for a pike and a death sprawl, which leaves
most of every sheet empty; 46 units come to 67MB of PNG. This crops each unit to
one tight box (shared across all its anims and facings so the atlas stays simple),
re-encodes, and writes app/sprites/ plus a compact atlas.

  blender -b --factory-startup --python pack_sprites.py -- --fmt WEBP --quality 100
"""
import bpy, os, sys, json, argparse
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))

def load(path):
    img = bpy.data.images.load(path, check_existing=False)
    img.colorspace_settings.name = 'Non-Color'
    img.alpha_mode = 'STRAIGHT'
    buf = np.empty(len(img.pixels), dtype=np.float32)
    img.pixels.foreach_get(buf)
    a = buf.reshape(img.size[1], img.size[0], 4)
    bpy.data.images.remove(img)
    return a

def save(arr, path, fmt, quality):
    h, w = arr.shape[0], arr.shape[1]
    img = bpy.data.images.new(os.path.basename(path), w, h, alpha=True)
    img.colorspace_settings.name = 'Non-Color'
    img.alpha_mode = 'STRAIGHT'
    img.pixels.foreach_set(arr.reshape(-1).astype(np.float32))
    sc = bpy.context.scene
    sc.render.image_settings.file_format = fmt
    sc.render.image_settings.color_mode = 'RGBA'
    if fmt == 'PNG':
        sc.render.image_settings.color_depth = '8'
        sc.render.image_settings.compression = 100
    else:
        try: sc.render.image_settings.quality = quality
        except Exception: pass
    img.save_render(filepath=path, scene=sc)
    bpy.data.images.remove(img)

def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('--sheets', default=os.path.join(HERE, 'sheets'))
    ap.add_argument('--out', default=os.path.abspath(
        os.path.join(HERE, '..', 'app', 'sprites')))
    ap.add_argument('--fmt', default='WEBP', choices=['WEBP', 'PNG'])
    ap.add_argument('--quality', type=int, default=100)
    ap.add_argument('--pad', type=int, default=1)
    a = ap.parse_args(argv)
    a.sheets = os.path.abspath(a.sheets); a.out = os.path.abspath(a.out)
    os.makedirs(a.out, exist_ok=True)
    ext = '.webp' if a.fmt == 'WEBP' else '.png'

    atlas = json.load(open(os.path.join(a.sheets, 'atlas.json')))
    packed, tot_in, tot_out = {}, 0, 0

    for key in sorted(atlas):
        u = atlas[key]; c = u['cell']
        loaded = {an: load(os.path.join(a.sheets, m['sheet']))
                  for an, m in u['anims'].items()}
        # ONE box per unit, unioned over every anim/facing/frame -- a per-frame
        # crop would make a running animation jitter against its own bounds.
        # Fold every cell down onto a single c x c coverage mask.
        acc = np.zeros((c, c), dtype=bool)
        for an, s in loaded.items():
            rows, cols = s.shape[0] // c, s.shape[1] // c
            for r in range(rows):
                for f in range(cols):
                    acc |= s[r*c:(r+1)*c, f*c:(f+1)*c, 3] > 0.5
        ys, xs = np.nonzero(acc)
        y0, y1 = int(ys.min()), int(ys.max())
        x0, x1 = int(xs.min()), int(xs.max())
        p = a.pad
        y0 = max(0, y0 - p); x0 = max(0, x0 - p)
        y1 = min(c - 1, y1 + p); x1 = min(c - 1, x1 + p)
        nh, nw = y1 - y0 + 1, x1 - x0 + 1

        # cells are stored bottom-up, so the anchor's Y flips with the crop
        entry = dict(cell=[nw, nh], dirs=8,
                     anchorX=round(u['anchorX'] - x0, 2),
                     anchorY=round(u['anchorY'] - (c - 1 - y1), 2),
                     anims={})
        for an, m in u['anims'].items():
            s = loaded[an]
            rows, cols = s.shape[0] // c, s.shape[1] // c
            out = np.zeros((rows * nh, cols * nw, 4), dtype=np.float32)
            for r in range(rows):
                for f in range(cols):
                    out[r*nh:(r+1)*nh, f*nw:(f+1)*nw, :] = \
                        s[r*c + y0:r*c + y1 + 1, f*c + x0:f*c + x1 + 1, :]
            fn = '%s_%s%s' % (key, an, ext)
            src = os.path.join(a.sheets, m['sheet'])
            tot_in += os.path.getsize(src)
            save(out, os.path.join(a.out, fn), a.fmt, a.quality)
            tot_out += os.path.getsize(os.path.join(a.out, fn))
            ent = dict(frames=m['frames'], fps=m['fps'], loop=m['loop'], sheet=fn)
            if m.get('mask'):
                ms = load(os.path.join(a.sheets, m['mask']))
                mo = np.zeros((rows * nh, cols * nw, 4), dtype=np.float32)
                for r in range(rows):
                    for f in range(cols):
                        mo[r*nh:(r+1)*nh, f*nw:(f+1)*nw, :] = \
                            ms[r*c + y0:r*c + y1 + 1, f*c + x0:f*c + x1 + 1, :]
                mfn = '%s_%s_m%s' % (key, an, ext)
                tot_in += os.path.getsize(os.path.join(a.sheets, m['mask']))
                save(mo, os.path.join(a.out, mfn), a.fmt, a.quality)
                tot_out += os.path.getsize(os.path.join(a.out, mfn))
                ent['mask'] = mfn
            entry['anims'][an] = ent
        packed[key] = entry
        print('  %-14s %3dx%-3d  (was %dx%d)' % (key, nw, nh, c, c))

    json.dump(packed, open(os.path.join(a.out, 'sprites.json'), 'w'),
              separators=(',', ':'))
    print('PACKED %d units  %.1fMB -> %.1fMB  (%.0f%%)'
          % (len(packed), tot_in/1e6, tot_out/1e6, 100.0*tot_out/max(1, tot_in)))

main()
