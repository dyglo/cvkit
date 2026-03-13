import argparse
import json
import os
from collections import defaultdict

from PIL import Image
import imagehash

SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".webp", ".gif", ".avif"}


def iter_images(root: str):
    for current_root, _, files in os.walk(root):
        for file_name in files:
            extension = os.path.splitext(file_name)[1].lower()
            if extension in SUPPORTED_EXTENSIONS:
                absolute = os.path.join(current_root, file_name)
                yield absolute, os.path.relpath(absolute, root).replace("\\", "/")


def build_groups(items, threshold):
    parent = list(range(len(items)))

    def find(index):
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    def union(left, right):
        left_root = find(left)
        right_root = find(right)
        if left_root != right_root:
            parent[right_root] = left_root

    distances = {}
    for left_index in range(len(items)):
        for right_index in range(left_index + 1, len(items)):
            distance = items[left_index]["hash"] - items[right_index]["hash"]
            if distance <= threshold:
                union(left_index, right_index)
                distances[(left_index, right_index)] = distance

    groups = defaultdict(list)
    for index, _ in enumerate(items):
        groups[find(index)].append(index)

    results = []
    total_dupes = 0
    for members in groups.values():
        if len(members) < 2:
            continue
        files = [items[index]["relative_path"] for index in members]
        pair_distances = []
        for left_index in range(len(members)):
            for right_index in range(left_index + 1, len(members)):
                item_pair = tuple(sorted((members[left_index], members[right_index])))
                if item_pair in distances:
                    pair_distances.append(distances[item_pair])
        results.append({
            "distance": int(min(pair_distances) if pair_distances else 0),
            "files": sorted(files)
        })
        total_dupes += int(len(files))

    results.sort(key=lambda group: (group["distance"], group["files"]))
    return results, total_dupes


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", required=True)
    parser.add_argument("--threshold", type=int, default=10)
    args = parser.parse_args()

    items = []
    for absolute, relative in iter_images(args.dir):
        with Image.open(absolute) as image:
            items.append({
                "absolute_path": absolute,
                "relative_path": relative,
                "hash": imagehash.dhash(image)
            })

    groups, total_dupes = build_groups(items, args.threshold)
    print(json.dumps({
        "scanned": int(len(items)),
        "groups": groups,
        "total_dupes": int(total_dupes)
    }))


if __name__ == "__main__":
    main()
