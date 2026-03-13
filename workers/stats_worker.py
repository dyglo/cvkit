import argparse
import json
import os

import numpy as np
from PIL import Image

SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".webp", ".gif", ".avif"}


def iter_images(root: str):
    for current_root, _, files in os.walk(root):
        for file_name in files:
            extension = os.path.splitext(file_name)[1].lower()
            if extension in SUPPORTED_EXTENSIONS:
                yield os.path.join(current_root, file_name)


def kb(value):
    return value / 1024.0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", required=True)
    args = parser.parse_args()

    channel_means = []
    channel_stds = []
    widths = []
    heights = []
    aspect_counts = {"landscape": 0, "square": 0, "portrait": 0}
    file_sizes_kb = []
    scanned = 0

    for image_path in iter_images(args.dir):
        with Image.open(image_path) as image:
            rgb = image.convert("RGB")
            array = np.asarray(rgb, dtype=np.float32)
            scanned += 1

            widths.append(rgb.width)
            heights.append(rgb.height)

            if rgb.width > rgb.height:
                aspect_counts["landscape"] += 1
            elif rgb.width < rgb.height:
                aspect_counts["portrait"] += 1
            else:
                aspect_counts["square"] += 1

            channel_means.append(array.mean(axis=(0, 1)))
            channel_stds.append(array.std(axis=(0, 1)))

        file_sizes_kb.append(kb(os.path.getsize(image_path)))

    if scanned == 0:
        raise SystemExit("No images found.")

    channel_means = np.asarray(channel_means)
    channel_stds = np.asarray(channel_stds)
    file_sizes = np.asarray(file_sizes_kb)

    result = {
        "channel_stats": {
            "R": {"mean": float(channel_means[:, 0].mean()), "std": float(channel_stds[:, 0].mean())},
            "G": {"mean": float(channel_means[:, 1].mean()), "std": float(channel_stds[:, 1].mean())},
            "B": {"mean": float(channel_means[:, 2].mean()), "std": float(channel_stds[:, 2].mean())}
        },
        "dimensions": {
            "width": {"min": int(np.min(widths)), "max": int(np.max(widths)), "mean": float(np.mean(widths))},
            "height": {"min": int(np.min(heights)), "max": int(np.max(heights)), "mean": float(np.mean(heights))}
        },
        "aspect_ratios": {key: value / scanned for key, value in aspect_counts.items()},
        "file_sizes": {
            "min_kb": float(np.min(file_sizes)),
            "max_kb": float(np.max(file_sizes)),
            "mean_kb": float(np.mean(file_sizes)),
            "median_kb": float(np.median(file_sizes))
        },
        "scanned": scanned
    }

    print(json.dumps(result))


if __name__ == "__main__":
    main()
