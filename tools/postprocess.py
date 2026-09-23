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
#
# The tiling surfaces ship at 512, not 1024, on purpose. `src/assets.js` already
# shrank them to 512 before uploading (the 1024 originals were ~3mm per texel on
# the ground, an order of magnitude finer than a screen can resolve), so the extra
# pixels in the PNG were pure download weight: nobody ever saw them. Keeping the
# shrink here too means the file, the upload and the human eye all agree — and the
# six of them go from 13.9MB of the site to 3.6MB. The 1024 masters stay in
# assets/raw, so nothing is lost.
PLAN = {
    "sky_pano": ("pano", 1024, "x"),
    "ground_grass": ("tile", 512, "xy"),
    "ground_dirt": ("tile", 512, "xy"),
    "water_river": ("tile", 512, "xy"),
    "tex_bark": ("tile", 512, "xy"),
    "tex_cliff": ("tile", 512, "xy"),
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

    # ---------------- batch 2: new paws, new regions, new levels ----------------
    "portrait_xionger_v2": ("cut", 512, None),
    "tree_dead": ("cut", 1024, None),
    "ground_swamp": ("tile", 512, "xy"),
    "tex_stone": ("tile", 512, "xy"),
    "prop_mushroom": ("cut", 768, None),
    "prop_beehive": ("cut", 640, None),
    "prop_totem": ("cut", 768, None),
    "prop_crystal": ("cut", 640, None),
    "prop_gate": ("cut", 1024, None),
    "item_honey": ("cut", 256, None),
    "item_shroom": ("cut", 256, None),
    "sky_dusk": ("pano", 1024, "x"),
    "char_frog": ("cut", 1024, None),
    "char_deer": ("cut", 1024, None),
    # ground clutter: drawn at 0.3-0.9m, so 384 is already more than the screen
    # can resolve, and there are thousands of them
    "prop_grass_tuft": ("cut", 384, None),
    "prop_fern": ("cut", 384, None),
    "prop_small_rock": ("cut", 256, None),
}

# raw name -> texture name, when they differ
RENAME = {
    "portrait_xionger_v2": "portrait_xionger",
}

# The one image with both arms is special cased: cutout() keeps only the single
# largest blob, which is exactly why the old hands_xionger.png ended up as one
# lone paw reused for both sprites. This one keeps both arms and splits them, so
# each paw gets its own texture and its own animation.
SPLIT_ARMS = ("hands_pair", [("hand_left", 0), ("hand_right", 1)], 512)


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


def cutout_multi(image, edge=2.0, keep_ratio=0.22, max_keep=4):
    """Same matte as cutout(), but keeps every blob that is big enough.

    A first person view of two arms is two separate blobs, and keeping only the
    largest one is how the old pair turned into a single paw.
    """
    rgb = np.asarray(image.convert("RGB"), dtype=np.float32)
    g = rgb.max(axis=2)
    mn = rgb.min(axis=2)
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
    labels, count = ndimage.label(solid)
    if count == 0:
        return cutout(image, edge)
    sizes = ndimage.sum(solid, labels, range(1, count + 1))
    order = np.argsort(sizes)[::-1][:max_keep]
    biggest = float(sizes[order[0]]) if len(order) else 1.0
    keep = [int(o) + 1 for o in order if sizes[o] >= biggest * keep_ratio]
    mask = np.isin(labels, keep)
    mask = ndimage.binary_erosion(mask, np.ones((3, 3)), iterations=int(edge))
    alpha = ndimage.gaussian_filter(mask.astype(np.float32), 1.1)
    alpha = np.clip((alpha - 0.28) / 0.55, 0.0, 1.0)

    a = alpha[..., None]
    safe = np.maximum(a, 0.35)
    unmatted = np.clip((rgb - (1.0 - a) * 255.0) / safe, 0, 255)
    blend = np.clip((a - 0.05) / 0.6, 0, 1)
    out = rgb * (1 - blend) + unmatted * blend
    rgba = np.concatenate([out, alpha[..., None] * 255.0], axis=2).astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


def split_arms(source, outputs, max_edge):
    """Cut the two paw blobs out of one generated frame, left first."""
    image = cutout_multi(Image.open(source).convert("RGBA"))
    alpha = np.asarray(image)[..., 3]
    labels, count = ndimage.label(alpha > 60)
    if count < 2:
        print("  ! split_arms: only %d blob(s) found, falling back to a 50/50 split" % count)
        w = image.width // 2
        halves = [image.crop((0, 0, w, image.height)), image.crop((w, 0, image.width, image.height))]
    else:
        sizes = ndimage.sum(alpha > 60, labels, range(1, count + 1))
        order = np.argsort(sizes)[::-1][:2] + 1
        blobs = []
        for label in order:
            ys, xs = np.where(labels == label)
            blobs.append((float(xs.mean()), int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())))
        blobs.sort(key=lambda b: b[0])
        halves = []
        for _, x0, x1, y0, y1 in blobs:
            pad = 10
            halves.append(image.crop((
                max(0, x0 - pad), max(0, y0 - pad),
                min(image.width, x1 + 1 + pad), min(image.height, y1 + 1 + pad),
            )))
    report = {}
    for (name, _), half in zip(outputs, halves):
        out = fit(half, max_edge)
        out = out.filter(ImageFilter.UnsharpMask(radius=1.4, percent=45, threshold=3))
        dst = os.path.join(TEX, name + ".png")
        out.save(dst, optimize=True)
        report[name] = dict(w=out.width, h=out.height, mode=out.mode,
                            kb=round(os.path.getsize(dst) / 1024.0, 1))
        print("%-20s %sx%s %s %sKB" % (name, out.width, out.height, out.mode, report[name]["kb"]))
    return report


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
        dst = os.path.join(TEX, RENAME.get(name, name) + ".png")
        image.save(dst, optimize=True)
        report[RENAME.get(name, name)] = dict(w=image.width, h=image.height, mode=image.mode,
                                              kb=round(os.path.getsize(dst) / 1024.0, 1))
        print("%-20s %sx%s %s %sKB" % (name, image.width, image.height, image.mode, report[RENAME.get(name, name)]["kb"]))

    split_src = os.path.join(RAW, SPLIT_ARMS[0] + ".png")
    if os.path.exists(split_src):
        report.update(split_arms(split_src, SPLIT_ARMS[1], SPLIT_ARMS[2]))
    else:
        print("missing", SPLIT_ARMS[0])

    with open(os.path.join(TEX, "manifest.json"), "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)


if __name__ == "__main__":
    main()
