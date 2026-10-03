import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sheet import process
from PIL import Image
d, out = sys.argv[1], sys.argv[2]
scale = int(sys.argv[3]) if len(sys.argv) > 3 else 3
names = sorted(os.listdir(d))
groups = {}
for n in names:
    if n.endswith('.png'): groups.setdefault(n.rsplit('_',1)[0], []).append(n)
ims = {k: [process(os.path.join(d, f)) for f in v] for k, v in groups.items()}
fw, fh = next(iter(ims.values()))[0].size
cols = max(len(v) for v in ims.values())
sheet = Image.new('RGBA', (cols*fw, len(ims)*fh), (58, 62, 74, 255))
for r, (k, v) in enumerate(ims.items()):
    for c, im in enumerate(v): sheet.alpha_composite(im, (c*fw, r*fh))
sheet = sheet.resize((sheet.width*scale, sheet.height*scale), Image.NEAREST)
sheet.save(out)
