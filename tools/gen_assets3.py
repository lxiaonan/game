# -*- coding: utf-8 -*-
"""Third art batch: low ground clutter.

A textured plane with nothing standing up out of it is the single biggest reason
a first person forest floor reads as fake, and it is also where tiling is most
visible — there is no geometry to break up the repeat. These are drawn small
(0.3-0.9m) and scattered densely, so they do the breaking up.

Run:  python tools/gen_assets3.py
Then: python tools/postprocess.py
"""
import os
import sys
import threading
import time

from gen_assets import RAW, WHITE, call, download, log, lock

JOBS = [
    dict(name="prop_grass_tuft", size="1024x1024", prompt=(
        "One single clump of tall wild forest grass seen from the side, dense thin green blades of slightly "
        "different heights fanning outward, a few dry yellow-brown blades mixed in, whole clump fully inside "
        "the frame, straight side view, photorealistic, " + WHITE)),
    dict(name="prop_fern", size="1024x1024", prompt=(
        "One single forest fern plant seen from the side, wide arched green fronds fanning out from a short "
        "stem, whole plant fully inside the frame, straight side view, photorealistic, " + WHITE)),
    dict(name="prop_small_rock", size="1024x1024", prompt=(
        "Three separate small grey weathered stones lying on the ground, each about the size of a fist, "
        "mossy patches, seen from a low side view, the three stones clearly apart with white space between "
        "them, photorealistic, " + WHITE)),
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
                log("ok   %-20s %6.1fs %8.1f KB" % (job["name"], time.time() - started, size / 1024.0))
            except Exception as exc:  # noqa: BLE001
                log("FAIL %-20s %s" % (job["name"], exc))

    threads = [threading.Thread(target=run) for _ in range(3)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    done = sum(1 for j in jobs if os.path.exists(os.path.join(RAW, j["name"] + ".png")))
    log("done: %d/%d" % (done, len(jobs)))
