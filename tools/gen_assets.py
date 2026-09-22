# -*- coding: utf-8 -*-
"""Generate every piece of game art through the gpt-image-2.5-sunburst endpoint."""
import base64
import json
import os
import sys
import threading
import time
import urllib.request

API = "https://image.mlgb7.com/v1/images/generations"
KEY = "lupi_qVeEz3GTit6dShK18G6UnjQWo4B86hEffDvzYA5NcCs"
MODEL = "gpt-image-2.5-sunburst"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "assets", "raw")
os.makedirs(RAW, exist_ok=True)

WHITE = ("isolated on a pure solid flat white background, nothing else in the frame, "
         "no shadow on the background, no ground plane, the whole subject fully inside the frame, nothing cropped")

JOBS = [
    # ---------------- environment ----------------
    dict(name="sky_pano", size="1536x1024", prompt=(
        "Seamless 360 degree equirectangular panorama of a bright summer afternoon sky above a forest, "
        "deep vivid blue sky, soft white puffy cumulus clouds, warm golden sunlight, only sky and clouds, "
        "no ground, no trees, no horizon line, no sun disc, photorealistic, ultra detailed")),
    dict(name="ground_grass", size="1024x1024", prompt=(
        "Seamless tileable photorealistic texture, top down flat photo of lush green wild forest grass, "
        "short blades, small clover leaves, a few tiny yellow wildflowers, slightly damp dark soil showing through, "
        "even flat daylight, no shadows, no objects, no edges, extremely detailed natural photo")),
    dict(name="ground_dirt", size="1024x1024", prompt=(
        "Seamless tileable photorealistic texture, top down flat photo of a packed dry dirt hiking trail, "
        "light brown earth, small pebbles, scattered dry leaves and twigs, even flat daylight, no shadows, "
        "no objects, extremely detailed natural photo")),
    dict(name="tree_pine", size="1024x1536", prompt=(
        "One single tall photorealistic pine tree, whole tree from roots to crown, dense dark green needles, "
        "brown bark trunk, straight side view, " + WHITE)),
    dict(name="tree_oak", size="1024x1536", prompt=(
        "One single photorealistic broadleaf forest tree, whole tree from roots to crown, huge round green leafy "
        "canopy, thick brown trunk, side view, " + WHITE)),
    dict(name="tree_big", size="1024x1536", prompt=(
        "One single ancient giant forest tree, enormous thick mossy trunk, wide green canopy, hanging vines, "
        "whole tree from roots to crown, side view, photorealistic, " + WHITE)),
    dict(name="tree_bush", size="1024x1024", prompt=(
        "A single round green forest bush shrub, dense small leaves, a few red berries, whole bush, side view, "
        "photorealistic, " + WHITE)),
    dict(name="prop_log", size="1536x1024", prompt=(
        "A huge fallen tree trunk lying horizontally, moss covered bark, broken branches, side view, "
        "photorealistic forest prop, " + WHITE)),
    dict(name="prop_rock", size="1024x1024", prompt=(
        "A small cluster of big grey mossy forest boulders, photorealistic, " + WHITE)),
    dict(name="prop_hut", size="1536x1024", prompt=(
        "A cozy rustic wooden log cabin, mossy shingle roof, small stone chimney with thin smoke, wooden door, "
        "one round window, three quarter view, photorealistic stylized 3d render, " + WHITE)),
    dict(name="item_pinecone", size="1024x1024", prompt=(
        "A single glossy brown pinecone standing upright, softly glowing with warm golden light, small, centered, "
        "photorealistic game pickup item, " + WHITE)),
    # ---------------- river gorge and the log bridge ----------------
    dict(name="water_river", size="1024x1024", prompt=(
        "Seamless tileable photorealistic texture, top down flat photo of a shallow forest river surface, "
        "clear greenish brown fresh water, gentle ripples and small bright sunlight reflections, "
        "pebbles faintly visible under the water, even light, no edges, no objects, extremely detailed")),
    dict(name="tex_bark", size="1024x1024", prompt=(
        "Seamless tileable photorealistic texture of weathered tree bark on a fallen log, warm brown wood grain "
        "running horizontally, deep cracks and mossy patches, flat daylight, no edges, extremely detailed")),
    dict(name="tex_cliff", size="1024x1024", prompt=(
        "Seamless tileable photorealistic texture of a river bank cliff wall, dry brown soil with embedded grey "
        "stones and thin tree roots hanging down, flat daylight, no edges, extremely detailed")),
    dict(name="prop_stump", size="1024x1024", prompt=(
        "A freshly cut tree stump, flat pale sawn top showing tree rings, ragged dark bark on the sides, "
        "a few wood chips lying around the base, side view, photorealistic game prop, " + WHITE)),
    dict(name="tree_chopped", size="1024x1536", prompt=(
        "One single tall photorealistic pine tree with a large axe cut wedge notch chopped into the lower trunk, "
        "pale exposed wood inside the notch, wood chips scattered at the base, whole tree from roots to crown, "
        "straight side view, " + WHITE)),
    # ---------------- neighbours ----------------
    dict(name="char_xiongda", size="1024x1536", prompt=(
        "Full body 3d cartoon character standing upright on two legs: Xiong Da, a big strong brown bear, "
        "light tan muzzle and belly, small round ears, brown leather vest, confident friendly grin, hands on hips, "
        "hyper detailed realistic fur, cinematic soft studio light, centered, " + WHITE)),
    dict(name="char_guangtouqiang", size="1024x1536", prompt=(
        "Full body 3d cartoon character standing: a bald middle aged lumberjack man with a big black mustache, "
        "red plaid shirt, blue jeans, brown boots, small wood axe over his shoulder, grumpy comic expression, "
        "hyper detailed 3d render, centered, " + WHITE)),
    dict(name="char_squirrel", size="1024x1536", prompt=(
        "Full body 3d cartoon character standing on hind legs: a small cheerful orange brown squirrel with an "
        "enormous fluffy tail, huge eyes, buck teeth, one paw raised waving hello, hyper detailed realistic fur, "
        "centered, " + WHITE)),
    dict(name="char_monkey", size="1024x1536", prompt=(
        "Full body 3d cartoon character standing: a mischievous small monkey, light brown fur, cream colored face, "
        "long curly tail, tiny yellow cap, big grin, holding a banana, hyper detailed realistic fur, centered, " + WHITE)),
    dict(name="char_owl", size="1024x1536", prompt=(
        "Full body 3d cartoon character standing: a plump grey and brown owl with huge round yellow eyes, "
        "tufted ear feathers, folded wings, small orange feet, hyper detailed realistic feathers, centered, " + WHITE)),
    dict(name="char_cuihua", size="1024x1536", prompt=(
        "Full body 3d cartoon character standing upright on two legs: a gentle chubby dark brown female bear, "
        "lighter muzzle, pink flower hair clip, light blue vest, warm sweet smile, waving one paw, "
        "hyper detailed realistic fur, centered, " + WHITE)),
    # ---------------- player ----------------
    dict(name="portrait_xionger", size="1024x1024", prompt=(
        "Head and shoulders portrait of a chubby goofy 3d cartoon bear: Xiong Er, big round head, large friendly "
        "eyes, wide happy grin, light tan muzzle, small round ears, small blue vest, hyper detailed realistic fur, "
        "cinematic rim lighting, centered, " + WHITE)),
    dict(name="hands_xionger", size="1536x1024", prompt=(
        "Two separate furry brown bear paws seen from above, small in the frame, one in the bottom left corner and "
        "one in the bottom right corner, cartoon bear hands with dark claws and light tan paw pads, the paws are "
        "small and completely visible with wide empty white space all around them and they do not touch the image "
        "borders, hyper detailed realistic fur, the entire middle and upper area of the image is empty, " + WHITE)),
]

lock = threading.Lock()


def log(*args):
    with lock:
        print(*args, flush=True)


def call(prompt, size, tries=4):
    payload = {"model": MODEL, "prompt": prompt, "n": 1, "size": size, "response_format": "url"}
    data = json.dumps(payload).encode("utf-8")
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(API, data=data, headers={
                "Content-Type": "application/json", "Authorization": "Bearer " + KEY,
                "User-Agent": UA, "Accept": "*/*"})
            with urllib.request.urlopen(req, timeout=600) as resp:
                body = json.loads(resp.read().decode("utf-8"))
            item = body["data"][0]
            return item.get("url") or ("data:image/png;base64," + item["b64_json"])
        except Exception as exc:  # noqa: BLE001
            last = exc
            detail = b""
            try:
                detail = exc.read()[:300]
            except Exception:
                pass
            log("  retry %d (%s) %s %s" % (i + 1, size, exc, detail))
            time.sleep(5 + 8 * i)
    raise RuntimeError("failed: %s" % last)


def download(url, path):
    if url.startswith("data:"):
        raw = base64.b64decode(url.split(",", 1)[1])
    else:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=600) as resp:
            raw = resp.read()
    with open(path, "wb") as handle:
        handle.write(raw)
    return len(raw)


def work(job):
    out = os.path.join(RAW, job["name"] + ".png")
    if os.path.exists(out) and os.path.getsize(out) > 20000:
        log("skip %s" % job["name"])
        return
    started = time.time()
    try:
        url = call(job["prompt"], job["size"])
        size = download(url, out)
        log("ok   %-20s %6.1fs %8.1f KB" % (job["name"], time.time() - started, size / 1024.0))
    except Exception as exc:  # noqa: BLE001
        log("FAIL %-20s %s" % (job["name"], exc))


def main():
    only = set(sys.argv[1:])
    jobs = [j for j in JOBS if not only or j["name"] in only]
    queue = list(jobs)

    def run():
        while True:
            with lock:
                if not queue:
                    return
                job = queue.pop(0)
            work(job)

    threads = [threading.Thread(target=run) for _ in range(5)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    done = sum(1 for j in jobs if os.path.exists(os.path.join(RAW, j["name"] + ".png")))
    log("done: %d/%d" % (done, len(jobs)))


if __name__ == "__main__":
    main()
