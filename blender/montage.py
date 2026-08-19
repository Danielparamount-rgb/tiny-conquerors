"""
montage.py — build a roster overview from sheets that are ALREADY rendered.

Pure image compositing: it reads sheets/atlas.json and blits one cell per unit
into a grid. No rendering, no scene, so it costs a couple of seconds and can run
while a sheet render is still going.

  blender -b --factory-startup --python montage.py -- --sheets sheets --out roster.png
  blender -b --factory-startup --python montage.py -- --anim walk --unit knight --strip
"""

import bpy, os, sys, json, argparse
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))

# roster order: grouped by rig, so the grid reads as a unit tree rather than a bag
ORDER = [
    'villager', 'militia', 'spearman', 'pikeman', 'archer', 'crossbowman',
    'skirmisher', 'handcannon', 'petard', 'monk', 'king',
    'longbow', 'axeman', 'berserker', 'huskarl', 'teuton', 'woad', 'samurai',
    'jaguar', 'eagle', 'plumed', 'chukonu', 'janissary',
    'scout', 'knight', 'cataphract', 'mameluke', 'mangudai', 'missionary',
    'ram', 'mangonel', 'scorpion', 'treb', 'bombard',
    'fishing', 'cog', 'transport', 'galley', 'longboat', 'fireship', 'demo',
    'turtle', 'cannongalleon',
    'sheep', 'deer', 'boar',
]

def load(path):
    img = bpy.data.images.load(path, check_existing=False)
    img.colorspace_settings.name = 'Non-Color'
    img.alpha_mode = 'STRAIGHT'
    buf = np.empty(len(img.pixels), dtype=np.float32)
    img.pixels.foreach_get(buf)
    a = buf.reshape(img.size[1], img.size[0], 4)
    bpy.data.images.remove(img)
    return a

def save(arr, path):
    h, w = arr.shape[0], arr.shape[1]
    img = bpy.data.images.new(os.path.basename(path), w, h, alpha=True)
    img.colorspace_settings.name = 'Non-Color'
    img.alpha_mode = 'STRAIGHT'
    img.pixels.foreach_set(arr.reshape(-1).astype(np.float32))
    img.file_format = 'PNG'
    img.filepath_raw = path
    img.save()
    bpy.data.images.remove(img)

def cell_of(sheet, cell, d, f):
    """One sprite cell. Sheets are bottom-up, and octant 0 sits on the TOP row."""
    rows = sheet.shape[0] // cell
    rb = (rows - 1 - d) * cell
    return sheet[rb:rb + cell, f * cell:(f + 1) * cell, :]

def over(dst, src):
    """Straight-alpha composite of one cell onto an opaque backdrop."""
    a = src[:, :, 3:4]
    dst[:, :, :3] = src[:, :, :3] * a + dst[:, :, :3] * (1 - a)
    return dst

BG = np.array([0.043, 0.048, 0.056], dtype=np.float32)
LINE = np.array([0.14, 0.13, 0.11], dtype=np.float32)

def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('--sheets', default=os.path.join(HERE, 'sheets'))
    ap.add_argument('--out', default=os.path.join(HERE, 'roster.png'))
    ap.add_argument('--anim', default='idle')
    ap.add_argument('--dir', type=int, default=1)     # 3/4 view reads best
    ap.add_argument('--frame', type=int, default=0)
    ap.add_argument('--cols', type=int, default=8)
    ap.add_argument('--scale', type=int, default=2)
    ap.add_argument('--strip', action='store_true', help='one unit, all frames x facings')
    ap.add_argument('--unit', default='')
    a = ap.parse_args(argv)
    a.out = os.path.abspath(a.out)      # Blender's image save needs a real path
    a.sheets = os.path.abspath(a.sheets)

    with open(os.path.join(a.sheets, 'atlas.json')) as fh:
        atlas = json.load(fh)

    if a.strip:
        u = atlas[a.unit]
        m = u['anims'][a.anim]
        sheet = load(os.path.join(a.sheets, m['sheet']))
        c, S = u['cell'], a.scale
        W, H = m['frames'] * c * S, 8 * c * S
        out = np.zeros((H, W, 4), dtype=np.float32)
        out[:, :, :3] = BG
        out[:, :, 3] = 1.0
        for d in range(8):
            for f in range(m['frames']):
                cl = np.repeat(np.repeat(cell_of(sheet, c, d, f), S, axis=0), S, axis=1)
                rb = (8 - 1 - d) * c * S
                over(out[rb:rb + c * S, f * c * S:(f + 1) * c * S], cl)
        save(out, a.out)
        print('STRIP %s %s -> %s' % (a.unit, a.anim, a.out))
        return

    names = [n for n in ORDER if n in atlas]
    names += [n for n in atlas if n not in ORDER]
    missing = [n for n in ORDER if n not in atlas]
    S = a.scale
    cols = a.cols

    # Gather the cells first and crop each to its alpha bounds. A sprite cell is
    # sized for a spear and a death sprawl, so an idle pose leaves a lot of empty
    # frame -- cropping is most of what makes an overview legible.
    cells = []
    for n in names:
        u = atlas[n]
        anim = a.anim if a.anim in u['anims'] else sorted(u['anims'])[0]
        m = u['anims'][anim]
        sheet = load(os.path.join(a.sheets, m['sheet']))
        f = min(a.frame, m['frames'] - 1)
        cl = cell_of(sheet, u['cell'], a.dir % 8, f).copy()
        ys, xs = np.nonzero(cl[:, :, 3] > 0.5)
        if len(ys):
            cl = cl[ys.min():ys.max() + 1, xs.min():xs.max() + 1, :]
        cells.append(cl)

    ch = max(c.shape[0] for c in cells) + 6
    cwid = max(c.shape[1] for c in cells) + 6
    rows = (len(names) + cols - 1) // cols
    CW, CH = cwid * S, ch * S
    W, H = cols * CW, rows * CH
    out = np.zeros((H, W, 4), dtype=np.float32)
    out[:, :, :3] = BG
    out[:, :, 3] = 1.0

    for i, cl in enumerate(cells):
        cl = np.repeat(np.repeat(cl, S, axis=0), S, axis=1)
        h, w = cl.shape[0], cl.shape[1]
        cx, cy = i % cols, i // cols
        rb = (rows - 1 - cy) * CH          # bottom-up
        oy = rb + (CH - h) // 2
        ox = cx * CW + (CW - w) // 2
        over(out[oy:oy + h, ox:ox + w], cl)
        out[rb:rb + 1, cx * CW:(cx + 1) * CW, :3] = LINE
        out[rb:rb + CH, cx * CW:cx * CW + 1, :3] = LINE

    save(out, a.out)
    with open(os.path.splitext(a.out)[0] + '.txt', 'w') as fh:
        fh.write('%d units, %d cols, reading left-to-right top-to-bottom:\n' %
                 (len(names), cols))
        for i in range(0, len(names), cols):
            fh.write('  ' + ', '.join(names[i:i + cols]) + '\n')
        if missing:
            fh.write('not yet rendered: ' + ', '.join(missing) + '\n')
    print('ROSTER %d units -> %s' % (len(names), a.out))
    if missing:
        print('MISSING (still rendering): %s' % ', '.join(missing))

main()
