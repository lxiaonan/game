# Report how much of each billboard texture is opaque art vs transparent padding.
# A sprite quad is sized from the full texture, so padding is rasterized (and
# alpha-tested) every frame for nothing.
import glob
import os

import numpy as np
from PIL import Image

print('%-22s %11s %19s %8s %8s' % ('file', 'pixels', 'opaque bbox', 'art%', 'bottom%'))
for f in sorted(glob.glob('assets/tex/*.png')):
    im = Image.open(f)
    if im.mode != 'RGBA':
        continue
    a = np.array(im)[:, :, 3]
    ys, xs = np.nonzero(a > 40)
    if len(xs) == 0:
        continue
    x0, x1, y0, y1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
    w, h = im.size
    art = 100.0 * (x1 - x0 + 1) * (y1 - y0 + 1) / (w * h)
    print('%-22s %5dx%-5d %4d,%4d-%-4d,%-4d %7.1f%% %7.1f%%'
          % (os.path.basename(f), w, h, x0, y0, x1, y1, art, 100.0 * (y1 + 1) / h))
