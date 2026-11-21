#!/usr/bin/env python3
"""Put a Ghostlight Node firmware release on the flasher page.

    python3 flasher/sync_ghostlight_firmware.py DIR --tag vX.Y.Z

DIR holds the release's flasher.json and its *-full.bin files (see
.github/workflows/ghostlight-firmware.yml, which downloads them). This
writes, under flasher/ghostlight-node/:

    boards.json              the boards and version the page lists
    manifests/<board>.json   one ESP Web Tools manifest per board
    firmware/*-full.bin      the images (the previous release's are removed)

The images live on this site because browsers can't fetch GitHub release
downloads from another site (no CORS headers).
"""
import argparse
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "ghostlight-node")
REPO = "https://github.com/DefeatedWarrior/ghostlight-node-firmware"


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("dir", help="folder with flasher.json and the *-full.bin files")
    p.add_argument("--tag", required=True, help="release tag, for example v1.1.0")
    a = p.parse_args()

    with open(os.path.join(a.dir, "flasher.json"), encoding="utf-8") as f:
        rel = json.load(f)
    boards = rel.get("boards") or []
    if not boards:
        sys.exit("flasher.json lists no boards")
    for b in boards:
        if not os.path.isfile(os.path.join(a.dir, b["full"])):
            sys.exit(f"{b['full']} is missing from {a.dir}")

    fw = os.path.join(OUT, "firmware")
    man = os.path.join(OUT, "manifests")
    for d in (fw, man):
        if os.path.isdir(d):
            shutil.rmtree(d)
        os.makedirs(d)

    index = []
    for b in boards:
        shutil.copyfile(os.path.join(a.dir, b["full"]), os.path.join(fw, b["full"]))
        manifest = {
            "name": f"Ghostlight Node firmware ({b['board']})",
            "version": rel["version"],
            # A new install erases the whole flash: partition tables differ
            # between boards and releases, so old settings are not kept.
            "new_install_prompt_erase": False,
            # The firmware doesn't speak Improv; don't wait for it after
            # installing (setup is the page's "Set up over USB" tab).
            "new_install_improv_wait_time": 0,
            "builds": [{
                "chipFamily": b["chip_family"],
                "parts": [{"path": "../firmware/" + b["full"], "offset": 0}],
            }],
        }
        with open(os.path.join(man, b["board"] + ".json"), "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2)
            f.write("\n")
        index.append({
            "board": b["board"],
            "chip_family": b["chip_family"],
            "description": b.get("description", ""),
            "manifest": "manifests/" + b["board"] + ".json",
            "ota": b.get("ota", ""),
        })

    with open(os.path.join(OUT, "boards.json"), "w", encoding="utf-8") as f:
        json.dump({
            "tag": a.tag,
            "version": rel["version"],
            "release_url": f"{REPO}/releases/tag/{a.tag}",
            "boards": index,
        }, f, indent=2)
        f.write("\n")
    print(f"{a.tag}: {len(index)} boards")


if __name__ == "__main__":
    main()
