# -*- coding: utf-8 -*-
"""Re-run the texture post-processing for a single asset after regenerating it."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image  # noqa: E402

import postprocess as pp  # noqa: E402


def main():
    name = sys.argv[1]
    kind, max_edge, axes = pp.PLAN[name]
    image = Image.open(os.path.join(pp.RAW, name + ".png")).convert("RGBA")
    if kind == "cut":
        image = pp.trim(pp.cutout(image))
        image = pp.fit(image, max_edge)
    else:
        image = pp.fit(pp.make_tileable(image.convert("RGB"), axes or "x"), max_edge)
    dst = os.path.join(pp.TEX, pp.RENAME.get(name, name) + ".png")
    image.save(dst, optimize=True)
    print(name, image.size, image.mode, round(os.path.getsize(dst) / 1024.0, 1), "KB")


if __name__ == "__main__":
    main()
