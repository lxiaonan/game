# Structural comparison between two screenshots of the same fixed pose.
#
# Used to check that a rendering optimisation did not change what is on screen.
# Animated things (tree sway, the campfire, pollen, wandering neighbours) differ
# between any two captures, so this does not demand identical pixels. It compares
# structure instead:
#   corr      - correlation of the downscaled luminance (layout must not move)
#   skyline   - correlation of the top-most foliage row per column (tree silhouettes)
#   foliage%  - share of green pixels (the forest must still be there)
#   diff%     - share of pixels that changed a lot
import sys

import numpy as np
from PIL import Image


def load(path, size=(320, 180)):
    im = Image.open(path).convert('RGB').resize(size, Image.BILINEAR)
    return np.asarray(im).astype(np.float32)


def luminance(a):
    return a @ np.array([0.299, 0.587, 0.114], dtype=np.float32)


def foliage_mask(a):
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    # green dominant, not blown out: leaves, grass, bushes
    return (g > r * 1.06) & (g > b * 1.12) & (g > 40) & (g < 245)


def skyline(a, size=(320, 180)):
    a = np.asarray(Image.open(a).convert('RGB').resize(size, Image.BILINEAR)).astype(np.float32)
    mask = foliage_mask(a)
    h, w = mask.shape
    profile = np.full(w, h, dtype=np.float32)
    for x in range(w):
        col = np.nonzero(mask[:, x])[0]
        if len(col):
            profile[x] = col[0]
    return profile


def corr(x, y):
    x = x - x.mean()
    y = y - y.mean()
    denom = np.sqrt((x * x).sum() * (y * y).sum())
    return float((x * y).sum() / denom) if denom else 0.0


def compare(path_a, path_b):
    a, b = load(path_a), load(path_b)
    la, lb = luminance(a), luminance(b)
    diff = np.abs(la - lb)
    fa, fb = foliage_mask(a), foliage_mask(b)
    inter = (fa & fb).sum()
    union = (fa | fb).sum()

    # Fit the best global brightness/contrast change between the two, so that a
    # deliberate tonal tweak (a different vignette blend, say) does not get
    # mistaken for the scene having moved.
    scale, offset = np.polyfit(la.ravel(), lb.ravel(), 1)
    matched = la * scale + offset
    mdiff = np.abs(matched - lb)

    print(f'{path_a.split("/")[-1]}  vs  {path_b.split("/")[-1]}')
    print(f'  luminance corr : {corr(la, lb):.4f}   (want > 0.90)')
    print(f'  skyline corr   : {corr(skyline(path_a), skyline(path_b)):.4f}   (want > 0.80)')
    print(f'  foliage IoU    : {inter / union if union else 0:.4f}   (want > 0.85)')
    print(f'  foliage        : {fa.mean() * 100:.2f}%  ->  {fb.mean() * 100:.2f}%'
          f'   (ratio {fb.mean() / fa.mean() if fa.mean() else 0:.3f}, want 0.85-1.15)')
    print(f'  mean |diff|    : {diff.mean():.2f}/255      pixels > 24: {(diff > 24).mean() * 100:.2f}%')
    print(f'  tone matched   : corr {corr(matched, lb):.4f}  mean |diff| {mdiff.mean():.2f}  '
          f'pixels > 24: {(mdiff > 24).mean() * 100:.2f}%   (gain {scale:.3f}, lift {offset:+.1f})')
    print(f'  brightness     : {la.mean():.1f}  ->  {lb.mean():.1f}')


if __name__ == '__main__':
    if len(sys.argv) == 3:
        compare(sys.argv[1], sys.argv[2])
    else:
        base = sys.argv[1]
        new = sys.argv[2]
        for pose in sys.argv[3:]:
            compare(f'{base}-{pose}.png', f'{new}-{pose}.png')
            print()
