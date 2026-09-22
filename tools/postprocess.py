# -*- coding: utf-8 -*-
"""Turn the raw generated art into game ready textures: tileable ground/panorama
and white-background cut-outs with real alpha channels."""
import json
import os

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "assets", "raw")
TEX = os.path.join(ROOT, "assets", "tex")
os.makedirs(TEX, exist_ok=True)

# name -> (kind, max edge, tile axes)
PLAN = {
    "sky_pano": ("pano", 2048, "x"),
    "ground_grass": ("tile", 1024, "xy"),
    "ground_dirt": ("tile", 1024, "xy"),
    "water_river": ("tile", 1024, "xy"),
    "tex_bark": ("tile", 1024, "xy"),
    "tex_cliff": ("tile", 1024, "xy"),
    "tree_pine": ("cut", 1024, None),
    "tree_oak": ("cut", 1024, None),
    "tree_big": ("cut", 1024, None),
    "tree_bush": ("cut", 640, None),
    "prop_log": ("cut", 1024, None),
    "prop_rock": ("cut", 640, None),
    "prop_hut": ("cut", 1280, None),
    "item_pinecone": ("cut", 256, None),
    "prop_stump": ("cut", 512, None),
    "tree_chopped": ("cut", 1024, None),
    "char_xiongda": ("cut", 1024, None),
    "char_guangtouqiang": ("cut", 1024, None),
    "char_squirrel": ("cut", 1024, None),
    "char_monkey": ("cut", 1024, None),
    "char_owl": ("cut", 1024, None),
    "char_cuihua": ("cut", 1024, None),
    "portrait_xionger": ("cut", 512, None),
    "hands_xionger": ("cut", 1024, None),
}


def crossfade(axis, image, band=0.5):
    """Make the image periodic along `axis` by rolling it half way round and
    feathering the new seam (the classic offset-and-blend texture trick)."""
    arr = np.asarray(image.convert("RGB"), dtype=np.float32)
    h, w, _ = arr.shape
    rolled = np.roll(arr, w // 2 if axis == "x" else h // 2, axis=1 if axis == "x" else 0)
    length = w if axis == "x" else h
    idx = np.arange(length, dtype=np.float32)
    centre = length / 2.0
    half = length * band / 2.0
    weight = np.clip(np.abs(idx - centre) / half, 0.0, 1.0)
    weight = weight * weight * (3 - 2 * weight)  # smoothstep
    if axis == "x":
        weight = weight[None, :, None]
    else:
        weight = weight[:, None, None]
    out = rolled * weight + arr * (1 - weight)
    return Image.fromarray(out.astype(np.uint8))


def make_tileable(image, axes, band=0.55):
    for axis in axes:
        image = crossfade(axis, image, band)
    return image


def cutout(image, edge=2.0):
    """Give a subject photographed on white a clean alpha channel."""
    rgb = np.asarray(image.convert("RGB"), dtype=np.float32)
    g = rgb.max(axis=2)
    mn = rgb.min(axis=2)
    # background = bright AND desaturated; shadows on white are grey so allow them
    near_white = (g > 232) & ((g - mn) < 16)
    if near_white.mean() < 0.05:
        near_white = g > 205
    labels, count = ndimage.label(near_white)
    if count:
        border = np.unique(np.concatenate([labels[0, :], labels[-1, :], labels[:, 0], labels[:, -1]]))
        border = border[border > 0]
        outside = np.isin(labels, border)
    else:
        outside = near_white
    solid = ~outside
    solid = ndimage.binary_closing(solid, np.ones((3, 3)), iterations=2)
    solid = ndimage.binary_fill_holes(solid)
    solid = ndimage.binary_opening(solid, np.ones((3, 3)))
    kept, count = ndimage.label(solid)
    if count > 1:
        sizes = ndimage.sum(solid, kept, range(1, count + 1))
        keep = np.argmax(sizes) + 1
        solid = kept == keep
    solid = ndimage.binary_erosion(solid, np.ones((3, 3)), iterations=int(edge))
    alpha = ndimage.gaussian_filter(solid.astype(np.float32), 1.1)
    alpha = np.clip((alpha - 0.28) / 0.55, 0.0, 1.0)

    a = alpha[..., None]
    safe = np.maximum(a, 0.35)
    unmatted = np.clip((rgb - (1.0 - a) * 255.0) / safe, 0, 255)
    blend = np.clip((a - 0.05) / 0.6, 0, 1)
    out = rgb * (1 - blend) + unmatted * blend
    rgba = np.concatenate([out, alpha[..., None] * 255.0], axis=2).astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


def trim(image, pad=6):
    alpha = np.asarray(image)[..., 3]
    ys, xs = np.where(alpha > 8)
    if len(ys) == 0:
        return image
    top, bottom = max(0, ys.min() - pad), min(image.height, ys.max() + 1 + pad)
    left, right = max(0, xs.min() - pad), min(image.width, xs.max() + 1 + pad)
    return image.crop((left, top, right, bottom))


def fit(image, max_edge):
    scale = max_edge / float(max(image.width, image.height))
    if scale >= 1:
        return image
    size = (max(1, int(round(image.width * scale))), max(1, int(round(image.height * scale))))
    return image.resize(size, Image.LANCZOS)


def main():
    report = {}
    for name, (kind, max_edge, axes) in PLAN.items():
        src = os.path.join(RAW, name + ".png")
        if not os.path.exists(src):
            print("missing", name)
            continue
        image = Image.open(src).convert("RGBA")
        if kind == "cut":
            image = cutout(image)
            image = trim(image)
            image = fit(image, max_edge)
            image = image.filter(ImageFilter.UnsharpMask(radius=1.4, percent=45, threshold=3))
        elif kind == "tile":
            image = make_tileable(image.convert("RGB"), axes or "xy")
            image = fit(image, max_edge)
        else:
            image = make_tileable(image.convert("RGB"), axes or "x")
            image = fit(image, max_edge)
        dst = os.path.join(TEX, name + ".png")
        image.save(dst, optimize=True)
        report[name] = dict(w=image.width, h=image.height, mode=image.mode,
                            kb=round(os.path.getsize(dst) / 1024.0, 1))
        print("%-20s %sx%s %s %sKB" % (name, image.width, image.height, image.mode, report[name]["kb"]))
    with open(os.path.join(TEX, "manifest.json"), "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)


if __name__ == "__main__":
    main()
