import argparse
import json
import os
import shutil
import sys
from pathlib import Path

import globox
from globox.annotation import Annotation
from PIL import Image

SUPPORTED_FORMATS = {"yolo", "coco", "pascal-voc", "labelme", "cvat"}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".webp", ".gif", ".avif"}


class ConversionFailure(Exception):
    pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", required=True)
    parser.add_argument("--from-format", required=True, dest="from_format")
    parser.add_argument("--to-format", required=True, dest="to_format")
    parser.add_argument("--output", default="./converted")
    parser.add_argument("--classes", default=None)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    try:
        input_dir = Path(args.dir).expanduser().resolve()
        if not input_dir.is_dir():
            raise ConversionFailure(f"Input directory not found: {args.dir}")

        if args.from_format not in SUPPORTED_FORMATS:
            raise ConversionFailure(f"Unsupported source format: {args.from_format}")

        if args.to_format not in SUPPORTED_FORMATS:
            raise ConversionFailure(f"Unsupported target format: {args.to_format}")

        result = convert_dataset(
            input_dir=input_dir,
            source_format=args.from_format,
            target_format=args.to_format,
            output_arg=args.output,
            classes_arg=args.classes,
            dry_run=args.dry_run,
        )
        print(json.dumps(result))
    except ConversionFailure as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
    except Exception as error:  # pragma: no cover - defensive fallback
        print(str(error), file=sys.stderr)
        raise SystemExit(1)


def convert_dataset(
    *,
    input_dir: Path,
    source_format: str,
    target_format: str,
    output_arg: str,
    classes_arg: str | None,
    dry_run: bool,
) -> dict:
    output_dir = Path(output_arg).expanduser().resolve()
    all_images = collect_images(input_dir)
    if not all_images:
        return {
            "success": True,
            "images_processed": 0,
            "annotations_converted": 0,
            "classes": [],
            "output_dir": str(output_dir),
            "dry_run": dry_run,
            "warnings": [f"No images found in {input_dir} — nothing to convert."]
        }

    index = build_image_index(input_dir, all_images)
    dataset = load_source_dataset(
        input_dir=input_dir,
        source_format=source_format,
        classes_arg=classes_arg,
        image_index=index,
    )

    images_processed = len(dataset["image_sources"])
    annotations_converted = dataset["annotations"].nb_boxes()
    result_classes = build_result_classes(dataset)
    warnings = list(dataset["warnings"])

    if dry_run:
        return {
            "success": True,
            "images_processed": images_processed,
            "annotations_converted": annotations_converted,
            "classes": result_classes,
            "output_dir": str(output_dir),
            "dry_run": True,
            "warnings": warnings,
        }

    prepare_output_directory(output_dir, output_arg)

    try:
        save_target_dataset(
            annotations=dataset["annotations"],
            dataset=dataset,
            output_dir=output_dir,
            source_format=source_format,
            target_format=target_format,
        )
    except Exception as error:
        emit_partial_error(
            error=str(error),
            output_dir=str(output_dir),
            dry_run=False,
            classes=result_classes,
            warnings=warnings,
            images_processed=images_processed,
            annotations_converted=annotations_converted,
        )

    return {
        "success": True,
        "images_processed": images_processed,
        "annotations_converted": annotations_converted,
        "classes": result_classes,
        "output_dir": str(output_dir),
        "dry_run": False,
        "warnings": warnings,
    }


def load_source_dataset(*, input_dir: Path, source_format: str, classes_arg: str | None, image_index: dict) -> dict:
    warnings: list[str] = []

    if source_format == "yolo":
        labels_dir = resolve_annotation_dir(input_dir, "labels")
        image_dir = input_dir / "images" if (input_dir / "images").is_dir() else input_dir
        extension = detect_single_image_extension(image_dir, image_index["all"])
        classes_path = resolve_classes_path(input_dir, classes_arg)
        class_names = read_class_names(classes_path) if classes_path else None
        if not class_names:
            raise ConversionFailure("YOLO conversion requires class names. Provide --classes or add classes.txt/data.yaml.")

        annotations = globox.AnnotationSet.from_yolo_v5(
            folder=str(labels_dir),
            image_folder=str(image_dir),
            image_extension=extension,
        )
        annotations.map_labels({str(index): label for index, label in enumerate(class_names)})
        image_sources = {
            image_path.name: image_path
            for image_path in collect_images(image_dir)
        }
        source_label_order = list(class_names)
    elif source_format == "coco":
        annotation_file = resolve_single_file(input_dir, preferred="annotations.json", extension=".json")
        annotations = globox.AnnotationSet.from_coco(file_path=str(annotation_file))
        image_sources = resolve_annotation_images(annotations, input_dir, image_index)
        source_label_order = read_coco_category_names(annotation_file)
    elif source_format == "pascal-voc":
        annotation_dir = resolve_annotation_dir(input_dir, "annotations")
        annotations = globox.AnnotationSet.from_pascal_voc(folder=str(annotation_dir))
        image_sources = resolve_annotation_images(annotations, input_dir, image_index)
        source_label_order = extract_label_order(annotations)
    elif source_format == "labelme":
        annotation_dir = resolve_annotation_dir(input_dir, "annotations")
        annotations = globox.AnnotationSet.from_labelme(folder=str(annotation_dir))
        image_sources = resolve_annotation_images(annotations, input_dir, image_index)
        source_label_order = extract_label_order(annotations)
    else:
        annotation_file = resolve_single_file(input_dir, preferred="annotations.xml", extension=".xml")
        annotations = globox.AnnotationSet.from_cvat(file_path=str(annotation_file))
        image_sources = resolve_annotation_images(annotations, input_dir, image_index)
        source_label_order = extract_label_order(annotations)

    missing_images = [image_id for image_id in list(annotations.image_ids) if image_id not in image_sources]
    if missing_images:
        raise ConversionFailure(f"Unable to locate {len(missing_images)} source image(s) referenced by annotations.")

    if source_format in {"yolo", "pascal-voc", "labelme"}:
        empty_count = add_missing_image_annotations(
            annotations=annotations,
            image_sources=image_sources,
            image_index=image_index,
            prefer_basename=(source_format == "yolo"),
        )
        if empty_count > 0:
            warnings.append(f"{empty_count} images had no annotations — copied without labels.")
    else:
        empty_count = sum(1 for annotation in annotations if len(annotation.boxes) == 0)
        if empty_count > 0:
            warnings.append(f"{empty_count} images had no annotations — copied without labels.")

    return {
        "annotations": annotations,
        "image_sources": image_sources,
        "source_label_order": source_label_order,
        "classes_path": classes_arg,
        "warnings": warnings,
    }


def save_target_dataset(*, annotations, dataset: dict, output_dir: Path, source_format: str, target_format: str):
    if target_format == "yolo":
        target_classes = build_target_yolo_classes(dataset)
        label_to_id = {label: index for index, label in enumerate(target_classes)}
        labels_dir = output_dir / "labels"
        images_dir = output_dir / "images"
        labels_dir.mkdir(parents=True, exist_ok=True)
        images_dir.mkdir(parents=True, exist_ok=True)
        annotations.save_yolo_v5(save_dir=str(labels_dir), label_to_id=label_to_id)
        write_classes_file(output_dir / "classes.txt", target_classes)
        copy_images(dataset["image_sources"], images_dir)
        return

    if target_format == "coco":
        label_order = build_result_classes(dataset)
        label_to_id = {label: index for index, label in enumerate(label_order)}
        imageid_to_id = {annotation.image_id: index for index, annotation in enumerate(annotations)}
        annotations.save_coco(
            path=str(output_dir / "annotations.json"),
            label_to_id=label_to_id,
            imageid_to_id=imageid_to_id,
        )
        images_dir = output_dir / "images"
        images_dir.mkdir(parents=True, exist_ok=True)
        copy_images(dataset["image_sources"], images_dir)
        return

    if target_format == "pascal-voc":
        annotation_dir = output_dir / "annotations"
        annotation_dir.mkdir(parents=True, exist_ok=True)
        annotations.save_pascal_voc(save_dir=str(annotation_dir))
        images_dir = output_dir / "images"
        images_dir.mkdir(parents=True, exist_ok=True)
        copy_images(dataset["image_sources"], images_dir)
        return

    if target_format == "labelme":
        annotations.save_labelme(save_dir=str(output_dir))
        copy_images(dataset["image_sources"], output_dir)
        return

    annotations.save_cvat(path=str(output_dir / "annotations.xml"))
    images_dir = output_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    copy_images(dataset["image_sources"], images_dir)


def build_target_yolo_classes(dataset: dict) -> list[str]:
    classes_path = dataset.get("classes_path")
    if classes_path:
        classes = read_class_names(Path(classes_path).expanduser().resolve())
        labels = set(extract_label_order(dataset["annotations"]))
        missing = sorted(label for label in labels if label not in classes)
        if missing:
            raise ConversionFailure(f"Provided class file is missing labels required for YOLO output: {', '.join(missing)}")
        return classes

    label_order = build_result_classes(dataset)
    if not label_order:
        raise ConversionFailure("YOLO conversion requires class names. Provide --classes or add classes.txt/data.yaml.")
    return label_order


def build_result_classes(dataset: dict) -> list[str]:
    source_order = list(dataset.get("source_label_order") or [])
    used = extract_label_order(dataset["annotations"])
    result = []

    for label in source_order + used:
        if label and label not in result:
            result.append(label)

    return result


def read_coco_category_names(annotation_file: Path) -> list[str]:
    with annotation_file.open(encoding="utf8") as handle:
        content = json.load(handle)

    categories = content.get("categories", [])
    if not isinstance(categories, list):
        return []

    labels = []
    for category in categories:
        if not isinstance(category, dict):
            continue
        name = category.get("name")
        if isinstance(name, str) and name and name not in labels:
            labels.append(name)

    return labels


def extract_label_order(annotations) -> list[str]:
    labels = []
    for annotation in annotations:
        for box in annotation.boxes:
            if box.label not in labels:
                labels.append(box.label)
    return labels


def add_missing_image_annotations(*, annotations, image_sources: dict[str, Path], image_index: dict, prefer_basename: bool) -> int:
    added = 0
    for image_path in image_index["all"]:
        image_id = image_path.name if prefer_basename else image_index["relative"][image_path]
        if image_id in annotations.image_ids:
            continue

        if image_id not in image_sources:
            image_sources[image_id] = image_path

        annotations.add(Annotation(image_id=image_id, image_size=get_image_size(image_path), boxes=[]))
        added += 1

    return added


def resolve_annotation_images(annotations, root: Path, image_index: dict) -> dict[str, Path]:
    image_sources = {}
    for annotation in annotations:
        image_sources[annotation.image_id] = resolve_image_path(root, annotation.image_id, image_index)
    return image_sources


def resolve_image_path(root: Path, image_id: str, image_index: dict) -> Path:
    normalized = image_id.replace("\\", "/")
    direct = root / normalized
    if direct.is_file():
        return direct

    nested = root / "images" / normalized
    if nested.is_file():
        return nested

    relative_lookup = image_index["by_relative"].get(normalized.lower())
    if relative_lookup:
        return relative_lookup

    basename = Path(normalized).name.lower()
    matches = image_index["by_basename"].get(basename, [])
    if len(matches) == 1:
        return matches[0]

    raise ConversionFailure(f"Unable to locate image file for '{image_id}'.")


def collect_images(root: Path) -> list[Path]:
    images = []
    for current_root, _, files in os.walk(root):
        for file_name in files:
            candidate = Path(current_root) / file_name
            if candidate.suffix.lower() in IMAGE_EXTENSIONS:
                images.append(candidate.resolve())
    return sorted(images)


def build_image_index(root: Path, images: list[Path]) -> dict:
    by_relative = {}
    by_basename: dict[str, list[Path]] = {}
    relative = {}

    for image_path in images:
        rel = image_path.relative_to(root).as_posix()
        relative[image_path] = rel
        by_relative[rel.lower()] = image_path
        by_basename.setdefault(image_path.name.lower(), []).append(image_path)

    return {
        "all": images,
        "relative": relative,
        "by_relative": by_relative,
        "by_basename": by_basename,
    }


def resolve_annotation_dir(root: Path, folder_name: str) -> Path:
    preferred = root / folder_name
    if preferred.is_dir():
        return preferred
    return root


def resolve_single_file(root: Path, *, preferred: str, extension: str) -> Path:
    preferred_path = root / preferred
    if preferred_path.is_file():
        return preferred_path

    matches = sorted(path for path in root.glob(f"*{extension}") if path.is_file())
    if len(matches) == 1:
        return matches[0]

    if not matches:
        raise ConversionFailure(f"No {extension} annotation file found in {root}.")

    raise ConversionFailure(f"Multiple {extension} annotation files found in {root}. Specify a single dataset directory.")


def detect_single_image_extension(root: Path, all_images: list[Path]) -> str:
    extensions = sorted({image.suffix.lower() for image in collect_images(root) or all_images})
    if not extensions:
        raise ConversionFailure(f"No images found in {root}.")
    if len(extensions) > 1:
        raise ConversionFailure("YOLO conversion does not support mixed image extensions in one dataset.")
    return extensions[0]


def resolve_classes_path(root: Path, classes_arg: str | None) -> Path | None:
    candidates = []
    if classes_arg:
        candidates.append(Path(classes_arg).expanduser().resolve())

    candidates.extend([
        root / "classes.txt",
        root / "data.yaml",
        root / "data.yml",
    ])

    for candidate in candidates:
        if candidate and candidate.is_file():
            return candidate
    return None


def prepare_output_directory(output_dir: Path, output_arg: str):
    if output_dir.exists() and not output_dir.is_dir():
        raise ConversionFailure(f"Output path '{output_arg}' already exists and is not a directory.")

    if output_dir.exists() and any(output_dir.iterdir()):
        raise ConversionFailure(
            f"Output directory '{output_arg}' already exists and is not empty. Remove it or choose a different --output path."
        )

    output_dir.mkdir(parents=True, exist_ok=True)


def read_class_names(path: Path) -> list[str]:
    suffix = path.suffix.lower()
    content = path.read_text(encoding="utf8")

    if suffix == ".txt":
        return [line.strip() for line in content.splitlines() if line.strip()]

    return parse_yaml_names(content)


def parse_yaml_names(content: str) -> list[str]:
    inline = None
    for line in content.splitlines():
        if line.strip().startswith("names:") and "[" in line and "]" in line:
            inline = line.split(":", 1)[1].strip()
            break

    if inline is not None:
        inner = inline.strip()[1:-1]
        return [part.strip().strip("'\"") for part in inner.split(",") if part.strip()]

    lines = content.splitlines()
    for index, line in enumerate(lines):
        if line.strip() != "names:":
            continue

        names = []
        for candidate in lines[index + 1:]:
            stripped = candidate.strip()
            if not stripped:
                continue
            if candidate[:1] not in {" ", "\t"}:
                break
            if stripped.startswith("- "):
                names.append(stripped[2:].strip().strip("'\""))
                continue
            if ":" in stripped:
                _, value = stripped.split(":", 1)
                names.append(value.strip().strip("'\""))
                continue
        return names

    return []


def get_image_size(image_path: Path) -> tuple[int, int]:
    with Image.open(image_path) as image:
        return image.size


def copy_images(image_sources: dict[str, Path], destination_root: Path):
    for image_id, source_path in image_sources.items():
        target_path = destination_root / safe_relative_path(image_id)
        target_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_path, target_path)


def safe_relative_path(image_id: str) -> Path:
    candidate = Path(image_id.replace("\\", "/"))
    cleaned_parts = []
    for part in candidate.parts:
        if part in {"", ".", ".."}:
            continue
        cleaned_parts.append(part)

    if not cleaned_parts:
        raise ConversionFailure(f"Invalid image id '{image_id}'.")

    return Path(*cleaned_parts)


def write_classes_file(path: Path, classes: list[str]):
    path.write_text("".join(f"{label}\n" for label in classes), encoding="utf8")


def emit_partial_error(
    *,
    error: str,
    output_dir: str,
    dry_run: bool,
    classes: list[str],
    warnings: list[str],
    images_processed: int,
    annotations_converted: int,
):
    print(
        json.dumps(
            {
                "success": False,
                "error": error,
                "output_dir": output_dir,
                "dry_run": dry_run,
                "classes": classes,
                "warnings": warnings,
                "images_processed": images_processed,
                "annotations_converted": annotations_converted,
            }
        ),
        file=sys.stderr,
    )
    raise SystemExit(1)


if __name__ == "__main__":
    main()
