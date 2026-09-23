# -*- coding: utf-8 -*-
"""Second art batch: the new first person bear paws, plus the art for the new
regions / levels (swamp, night highland, level gate stones, new neighbours).

Run:  python tools/gen_assets2.py            # everything not already downloaded
      python tools/gen_assets2.py hands_pair # only these
Then: python tools/postprocess.py
"""
import os
import sys

from gen_assets import RAW, WHITE, main as _unused  # noqa: F401  (shared config)
from gen_assets import call, download, log, lock
import threading
import time

JOBS = [
    # ---------------------------------------------------------------- player
    # ONE image with both arms, so the two paws are guaranteed to share a style.
    # tools/postprocess.py splits it down the middle into hand_left / hand_right,
    # which is what lets each paw animate on its own.
    dict(name="hands_pair", size="1536x1024", prompt=(
        "First person video game view looking down at your own two front paws: two chubby furry brown bear "
        "forearms reaching forward into the frame from the bottom left and the bottom right corner, both arms "
        "angled inward towards the centre and slightly upward, thick realistic brown fur with lighter tan fur "
        "on the inner side of the arm, big rounded paws, five short stubby fingers each, glossy dark brown "
        "claws, soft light tan paw pads, foreshortened arms seen from behind the wrist, the paws are well "
        "separated with a wide gap between them, the whole upper half of the image and the exact centre of "
        "the image are empty white background, hyper detailed realistic fur, soft natural daylight, no body, "
        "no head, only the two arms, " + WHITE)),
    dict(name="portrait_xionger_v2", size="1024x1024", prompt=(
        "Head and shoulders portrait of a chubby goofy 3d cartoon bear cub: Xiong Er, big round fluffy head, "
        "large warm friendly eyes, wide happy grin showing a tongue, light tan muzzle with a dark brown nose, "
        "small round ears, a tiny blue vest, hyper detailed photorealistic fur with individual strands, "
        "cinematic rim lighting, shallow depth of field, centered, looking at the camera, " + WHITE)),
    # ---------------------------------------------------------------- swamp region
    dict(name="ground_swamp", size="1024x1024", prompt=(
        "Seamless tileable photorealistic texture, top down flat photo of a muddy forest swamp floor, dark wet "
        "peat, patches of green moss and algae, a few floating dead leaves and thin reeds, standing shallow "
        "water reflections, even overcast light, no shadows, no objects, no edges, extremely detailed natural photo")),
    dict(name="tree_dead", size="1024x1536", prompt=(
        "One single dead bare swamp tree, grey twisted trunk and crooked leafless branches, patches of pale "
        "green moss and hanging lichen, roots at the bottom, whole tree from roots to the topmost branch, "
        "straight side view, photorealistic, " + WHITE)),
    dict(name="prop_mushroom", size="1024x1024", prompt=(
        "A small cluster of giant glowing forest mushrooms, tall pale stems and wide amber orange caps with "
        "white spots, soft warm glow under the caps, a few small mushrooms around them, side view, "
        "photorealistic fantasy game prop, " + WHITE)),
    dict(name="char_frog", size="1024x1536", prompt=(
        "Full body 3d cartoon character standing: a plump cheerful green swamp frog with big glossy eyes, "
        "cream coloured belly, dark spots on its back, wearing a tiny woven reed hat, one hand raised waving, "
        "hyper detailed wet realistic skin, centered, " + WHITE)),
    # ---------------------------------------------------------------- highland / night region
    dict(name="sky_dusk", size="1536x1024", prompt=(
        "Seamless 360 degree equirectangular panorama of a dusk sky above a forest, deep indigo and violet "
        "gradient sky, a few thin pink and amber clouds, first stars appearing near the top, warm orange "
        "afterglow along the horizon band, only sky and clouds, no ground, no trees, no sun disc, "
        "photorealistic, ultra detailed")),
    dict(name="tex_stone", size="1024x1024", prompt=(
        "Seamless tileable photorealistic texture, top down flat photo of a grey mountain stone plateau, flat "
        "weathered granite slabs, thin cracks, small lichen patches, a little gravel, even flat daylight, "
        "no shadows, no objects, no edges, extremely detailed natural photo")),
    dict(name="prop_crystal", size="1024x1024", prompt=(
        "A cluster of tall glowing blue white crystals growing out of a rock, sharp faceted translucent "
        "crystal shards, inner light, small rock base, side view, photorealistic fantasy game prop, " + WHITE)),
    dict(name="prop_beehive", size="1024x1024", prompt=(
        "A big wild bee honeycomb hanging from a branch, golden honey dripping, a few small bees flying "
        "around it, side view, photorealistic stylized 3d render, " + WHITE)),
    dict(name="char_deer", size="1024x1536", prompt=(
        "Full body 3d cartoon character standing on four legs: a gentle young spotted deer with small "
        "branching antlers, big dark eyes, white belly, a little red scarf around its neck, "
        "hyper detailed realistic fur, centered, " + WHITE)),
    # ---------------------------------------------------------------- props / pickups
    dict(name="prop_totem", size="1024x1536", prompt=(
        "A tall ancient carved stone gateway pillar standing alone, weathered grey stone covered in moss, "
        "a glowing amber rune carved on its front face, small stones piled at its base, front view, "
        "photorealistic fantasy game prop, " + WHITE)),
    dict(name="item_honey", size="1024x1024", prompt=(
        "A small clay honey jar full of golden honey, a wooden stick resting in it, honey dripping down the "
        "side, softly glowing with warm golden light, small, centered, photorealistic game pickup item, " + WHITE)),
    dict(name="item_shroom", size="1024x1024", prompt=(
        "A single small glowing amber mushroom, pale stem, wide cap with white spots, softly glowing warm "
        "light, small, centered, photorealistic game pickup item, " + WHITE)),
    dict(name="prop_gate", size="1536x1024", prompt=(
        "A rustic wooden log gateway arch made of two rough posts and a crossbeam, a frayed rope and a small "
        "wooden sign hanging from the beam, moss on the posts, front view, photorealistic stylized 3d render, " + WHITE)),
]

if __name__ == "__main__":
    only = set(sys.argv[1:])
    jobs = [j for j in JOBS if not only or j["name"] in only]
    queue = list(jobs)

    def run():
        while True:
            with lock:
                if not queue:
                    return
                job = queue.pop(0)
            out = os.path.join(RAW, job["name"] + ".png")
            if os.path.exists(out) and os.path.getsize(out) > 20000:
                log("skip %s" % job["name"])
                continue
            started = time.time()
            try:
                url = call(job["prompt"], job["size"])
                size = download(url, out)
                log("ok   %-22s %6.1fs %8.1f KB" % (job["name"], time.time() - started, size / 1024.0))
            except Exception as exc:  # noqa: BLE001
                log("FAIL %-22s %s" % (job["name"], exc))
            # print the progress even when locked out
            with lock:
                print("     %d/%d done" % (sum(1 for j in jobs
                      if os.path.exists(os.path.join(RAW, j["name"] + ".png"))), len(jobs)), flush=True)

    threads = [threading.Thread(target=run) for _ in range(5)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    done = sum(1 for j in jobs if os.path.exists(os.path.join(RAW, j["name"] + ".png")))
    log("done: %d/%d" % (done, len(jobs)))
