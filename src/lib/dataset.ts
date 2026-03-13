import {
  copyFile,
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';
import {formatBytes, isSupportedImagePath} from './image.js';
import type {
  AnnotationFormat,
  DatasetInspectResult,
  SplitResult,
  ValidationIssue,
  ValidationResult
} from '../types/index.js';

type ImageRecord = {
  path: string;
  relativePath: string;
  sizeBytes: number;
  formatLabel: string;
};

type CocoImageRecord = {
  id: number;
  file_name: string;
  width?: number;
  height?: number;
};

type CocoAnnotationRecord = {
  id?: number;
  image_id: number;
  category_id: number;
  bbox?: number[];
};

type CocoCategoryRecord = {
  id: number;
  name: string;
};

type CocoDocument = {
  images: CocoImageRecord[];
  annotations: CocoAnnotationRecord[];
  categories: CocoCategoryRecord[];
};

type DatasetItem = {
  imagePath: string;
  relativeImagePath: string;
  classIds: number[];
  annotationPath?: string;
  annotationRecord?: CocoImageRecord;
};

const FORMAT_LABELS: Record<string, string> = {
  '.jpg': 'JPEG',
  '.jpeg': 'JPEG',
  '.png': 'PNG',
  '.bmp': 'BMP',
  '.tiff': 'TIFF',
  '.webp': 'WEBP',
  '.gif': 'GIF',
  '.avif': 'AVIF'
};

export async function assertDirectoryExists(inputDir: string): Promise<string> {
  const resolved = path.resolve(inputDir);
  const info = await stat(resolved).catch((error: unknown) => {
    if (isErrno(error, 'ENOENT')) {
      throw new Error(`directory not found: ${inputDir}`);
    }

    throw error;
  });

  if (!info.isDirectory()) {
    throw new Error(`directory not found: ${inputDir}`);
  }

  return resolved;
}

export async function collectImages(inputDir: string): Promise<ImageRecord[]> {
  const root = await assertDirectoryExists(inputDir);
  const files = await walk(root);
  const images: ImageRecord[] = [];

  for (const filePath of files) {
    if (!isSupportedImagePath(filePath)) {
      continue;
    }

    const fileInfo = await stat(filePath);
    images.push({
      path: filePath,
      relativePath: toRelative(root, filePath),
      sizeBytes: fileInfo.size,
      formatLabel: FORMAT_LABELS[path.extname(filePath).toLowerCase()] ?? path.extname(filePath).slice(1).toUpperCase()
    });
  }

  return images.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

export async function detectAnnotationFormat(inputDir: string): Promise<AnnotationFormat | null> {
  return (await detectAnnotationInfo(inputDir)).format;
}

export async function inspectDataset(inputDir: string): Promise<DatasetInspectResult> {
  const root = await assertDirectoryExists(inputDir);
  const images = await collectImages(root);
  if (images.length === 0) {
    throw new Error(`no images found in ${inputDir} — nothing to process`);
  }

  const annotationInfo = await detectAnnotationInfo(root);
  const totalSizeBytes = images.reduce((sum, image) => sum + image.sizeBytes, 0);
  const formatCounts = new Map<string, number>();

  for (const image of images) {
    formatCounts.set(image.formatLabel, (formatCounts.get(image.formatLabel) ?? 0) + 1);
  }

  if (annotationInfo.format === 'yolo') {
    const yoloSummary = await summarizeYolo(root, images);
    return {
      datasetPath: inputDir,
      imageCount: images.length,
      annotatedCount: yoloSummary.annotatedCount,
      unannotatedCount: images.length - yoloSummary.annotatedCount,
      formatBreakdown: [...formatCounts.entries()].map(([label, count]) => ({label, count})),
      annotationFormat: 'yolo',
      mixedAnnotationFormats: annotationInfo.mixed,
      classBreakdown: yoloSummary.classBreakdown,
      totalSizeBytes
    };
  }

  return {
    datasetPath: inputDir,
    imageCount: images.length,
    annotatedCount: 0,
    unannotatedCount: images.length,
    formatBreakdown: [...formatCounts.entries()].map(([label, count]) => ({label, count})),
    annotationFormat: annotationInfo.format,
    mixedAnnotationFormats: annotationInfo.mixed,
    classBreakdown: [],
    totalSizeBytes
  };
}

export async function validateDataset(
  inputDir: string,
  format: AnnotationFormat,
  fix: boolean
): Promise<ValidationResult> {
  if (format === 'yolo') {
    return validateYoloDataset(inputDir, fix);
  }

  if (format === 'coco') {
    return validateCocoDataset(inputDir);
  }

  return validatePascalDataset(inputDir);
}

export async function splitDataset(
  inputDir: string,
  format: AnnotationFormat,
  outputDir: string,
  percentages: {train: number; val: number; test: number},
  seed: number
): Promise<SplitResult> {
  const root = await assertDirectoryExists(inputDir);
  if (percentages.train + percentages.val + percentages.test !== 100) {
    throw new Error('train, val, and test percentages must sum to 100.');
  }

  const absoluteOutputDir = path.resolve(outputDir);
  await rm(absoluteOutputDir, {recursive: true, force: true});
  await mkdir(absoluteOutputDir, {recursive: true});

  const items = await buildSplitItems(root, format);
  if (items.length === 0) {
    throw new Error(`no images found in ${inputDir} — nothing to process`);
  }

  const assignment = stratifyItems(items, percentages, seed);
  const splitNames: Array<'train' | 'val' | 'test'> = ['train', 'val', 'test'];
  const result: SplitResult = {
    outputDir,
    splits: splitNames.map((name) => ({
      name,
      percent: percentages[name],
      imageCount: 0,
      classCounts: {}
    }))
  };

  for (const splitName of splitNames) {
    await mkdir(path.join(absoluteOutputDir, splitName, 'images'), {recursive: true});
  }

  if (format === 'yolo') {
    for (const splitName of splitNames) {
      await mkdir(path.join(absoluteOutputDir, splitName, 'labels'), {recursive: true});
    }

    await copyIfExists(path.join(root, 'classes.txt'), path.join(absoluteOutputDir, 'classes.txt'));
    await copyIfExists(path.join(root, 'data.yaml'), path.join(absoluteOutputDir, 'data.yaml'));
    await copyIfExists(path.join(root, 'data.yml'), path.join(absoluteOutputDir, 'data.yml'));
  } else if (format === 'pascal-voc') {
    for (const splitName of splitNames) {
      await mkdir(path.join(absoluteOutputDir, splitName, 'annotations'), {recursive: true});
    }
  }

  const cocoBySplit: Record<'train' | 'val' | 'test', CocoDocument | null> = {
    train: format === 'coco' ? {images: [], annotations: [], categories: []} : null,
    val: format === 'coco' ? {images: [], annotations: [], categories: []} : null,
    test: format === 'coco' ? {images: [], annotations: [], categories: []} : null
  };
  const categories = format === 'coco' ? await loadCocoCategories(root) : [];
  for (const splitName of splitNames) {
    if (cocoBySplit[splitName]) {
      cocoBySplit[splitName]!.categories = categories;
    }
  }

  for (const item of items) {
    const splitName = assignment.get(item.relativeImagePath) ?? 'train';
    const splitResult = result.splits.find((entry) => entry.name === splitName);
    if (!splitResult) {
      continue;
    }

    splitResult.imageCount += 1;
    for (const classId of new Set(item.classIds)) {
      const key = String(classId);
      splitResult.classCounts[key] = (splitResult.classCounts[key] ?? 0) + 1;
    }

    await copyFile(
      item.imagePath,
      path.join(absoluteOutputDir, splitName, 'images', path.basename(item.imagePath))
    );

    if (format === 'yolo' && item.annotationPath) {
      await copyFile(
        item.annotationPath,
        path.join(absoluteOutputDir, splitName, 'labels', `${path.parse(item.imagePath).name}.txt`)
      );
    }

    if (format === 'pascal-voc' && item.annotationPath) {
      await copyFile(
        item.annotationPath,
        path.join(absoluteOutputDir, splitName, 'annotations', path.basename(item.annotationPath))
      );
    }

    if (format === 'coco' && item.annotationRecord) {
      cocoBySplit[splitName]?.images.push(item.annotationRecord);
    }
  }

  if (format === 'coco') {
    const source = await loadSingleCocoDocument(root);
    for (const splitName of splitNames) {
      const document = cocoBySplit[splitName];
      if (!document) {
        continue;
      }

      const imageIds = new Set(document.images.map((image) => image.id));
      document.annotations = source.annotations.filter((annotation) => imageIds.has(annotation.image_id));
      const annotationDir = path.join(absoluteOutputDir, splitName, 'annotations');
      await mkdir(annotationDir, {recursive: true});
      await writeFile(
        path.join(annotationDir, 'annotations.json'),
        `${JSON.stringify(document, null, 2)}\n`,
        'utf8'
      );
    }
  }

  return result;
}

export async function deleteDuplicateArtifacts(root: string, relativeImagePath: string): Promise<void> {
  const absoluteImagePath = path.join(root, relativeImagePath);
  await rm(absoluteImagePath, {force: true});
  const candidateLabel = await findYoloLabelPath(root, absoluteImagePath);
  if (candidateLabel) {
    await rm(candidateLabel, {force: true});
  }
}

export function renderBar(value: number, maxValue: number, width = 20): string {
  if (maxValue <= 0 || value <= 0) {
    return '';
  }

  return '█'.repeat(Math.max(1, Math.round((value / maxValue) * width)));
}

export function formatPercent(numerator: number, denominator: number): string {
  if (denominator === 0) {
    return '0.0%';
  }

  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

export {formatBytes};

async function detectAnnotationInfo(inputDir: string): Promise<{format: AnnotationFormat | null; mixed: boolean}> {
  const files = await walk(inputDir);
  const counts = {
    yolo: 0,
    coco: 0,
    'pascal-voc': 0
  } satisfies Record<AnnotationFormat, number>;

  for (const filePath of files) {
    const baseName = path.basename(filePath).toLowerCase();
    const extension = path.extname(filePath).toLowerCase();
    if (extension === '.txt' && baseName !== 'classes.txt') {
      counts.yolo += 1;
    } else if (extension === '.json') {
      counts.coco += 1;
    } else if (extension === '.xml') {
      counts['pascal-voc'] += 1;
    }
  }

  const sorted = Object.entries(counts)
    .filter(([, value]) => value > 0)
    .sort((left, right) => right[1] - left[1]);

  return {
    format: sorted[0]?.[0] as AnnotationFormat | undefined ?? null,
    mixed: sorted.length > 1
  };
}

async function summarizeYolo(
  root: string,
  images: ImageRecord[]
): Promise<{annotatedCount: number; classBreakdown: Array<{id: number; name: string; imageCount: number}>}> {
  const names = await loadClassNames(root);
  const classImageCounts = new Map<number, number>();
  let annotatedCount = 0;

  for (const image of images) {
    const labelPath = await findYoloLabelPath(root, image.path);
    if (!labelPath) {
      continue;
    }

    annotatedCount += 1;
    const classIds = await parseYoloClassIds(labelPath);
    for (const classId of new Set(classIds)) {
      classImageCounts.set(classId, (classImageCounts.get(classId) ?? 0) + 1);
    }
  }

  return {
    annotatedCount,
    classBreakdown: [...classImageCounts.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([id, imageCount]) => ({
        id,
        name: names.get(id) ?? `class_${id}`,
        imageCount
      }))
  };
}

async function validateYoloDataset(inputDir: string, fix: boolean): Promise<ValidationResult> {
  const root = await assertDirectoryExists(inputDir);
  const images = await collectImages(root);
  if (images.length === 0) {
    throw new Error(`no images found in ${inputDir} — nothing to process`);
  }

  const issues: ValidationIssue[] = [];
  let validImages = 0;
  let fixedCount = 0;
  let manualReviewCount = 0;

  for (const image of images) {
    const labelPath = await findYoloLabelPath(root, image.path);
    if (!labelPath) {
      issues.push({
        file: image.relativePath,
        type: 'Missing label',
        detail: 'missing label'
      });
      manualReviewCount += 1;
      continue;
    }

    const raw = await readFile(labelPath, 'utf8');
    const trimmed = raw.trim();
    if (!trimmed) {
      issues.push({
        file: toRelative(root, labelPath),
        type: 'Empty label',
        detail: 'empty label'
      });
      if (fix) {
        await rm(labelPath, {force: true});
        fixedCount += 1;
      } else {
        manualReviewCount += 1;
      }
      continue;
    }

    const nextLines: string[] = [];
    let hasBlockingIssue = false;
    let hadFix = false;

    for (const [index, line] of trimmed.split(/\r?\n/).entries()) {
      const parts = line.trim().split(/\s+/);
      if (parts.length !== 5) {
        issues.push({
          file: toRelative(root, labelPath),
          type: 'Malformed line',
          detail: `line ${index + 1}: expected 5 values`
        });
        hasBlockingIssue = true;
        continue;
      }

      const [classToken, ...bboxTokens] = parts;
      const classId = Number(classToken);
      if (!Number.isInteger(classId) || classId < 0) {
        issues.push({
          file: toRelative(root, labelPath),
          type: 'Invalid class ID',
          detail: `line ${index + 1}: ${classToken}`
        });
        hasBlockingIssue = true;
        continue;
      }

      const bboxValues = bboxTokens.map((token) => Number(token));
      if (bboxValues.some((value) => Number.isNaN(value))) {
        issues.push({
          file: toRelative(root, labelPath),
          type: 'Malformed line',
          detail: `line ${index + 1}: contains non-numeric values`
        });
        hasBlockingIssue = true;
        continue;
      }

      let clipped = false;
      const normalized = bboxValues.map((value) => {
        if (value < 0 || value > 1) {
          clipped = true;
          return Math.min(1, Math.max(0, value));
        }

        return value;
      });

      if (clipped) {
        issues.push({
          file: toRelative(root, labelPath),
          type: 'Out-of-bound box',
          detail: `line ${index + 1}: clipped to 0.0-1.0 range`
        });
        if (fix) {
          hadFix = true;
        } else {
          hasBlockingIssue = true;
        }
      }

      nextLines.push([String(classId), ...normalized.map((value) => trimFloat(value))].join(' '));
    }

    if (fix && hadFix) {
      await writeFile(labelPath, `${nextLines.join('\n')}\n`, 'utf8');
      fixedCount += 1;
    }

    if (hasBlockingIssue) {
      manualReviewCount += 1;
    } else {
      validImages += 1;
    }
  }

  return {
    format: 'yolo',
    scannedImages: images.length,
    validImages,
    issues,
    fixedCount,
    manualReviewCount
  };
}

async function validateCocoDataset(inputDir: string): Promise<ValidationResult> {
  const root = await assertDirectoryExists(inputDir);
  const images = await collectImages(root);
  if (images.length === 0) {
    throw new Error(`no images found in ${inputDir} — nothing to process`);
  }

  const issues: ValidationIssue[] = [];
  const jsonFiles = (await walk(root)).filter((filePath) => path.extname(filePath).toLowerCase() === '.json');

  for (const jsonFile of jsonFiles) {
    try {
      const parsed = JSON.parse(await readFile(jsonFile, 'utf8')) as Partial<CocoDocument>;
      if (!Array.isArray(parsed.images) || !Array.isArray(parsed.annotations) || !Array.isArray(parsed.categories)) {
        issues.push({
          file: toRelative(root, jsonFile),
          type: 'Missing required keys',
          detail: 'images, annotations, and categories are required'
        });
        continue;
      }

      const imageIds = new Map<number, CocoImageRecord>();
      for (const image of parsed.images) {
        if (!image || typeof image !== 'object' || typeof image.id !== 'number' || typeof image.file_name !== 'string') {
          continue;
        }

        imageIds.set(image.id, image as CocoImageRecord);
        if (!(await fileExists(resolveDatasetImage(root, image.file_name)))) {
          issues.push({
            file: toRelative(root, jsonFile),
            type: 'Annotation image missing',
            detail: image.file_name
          });
        }
      }

      for (const annotation of parsed.annotations as CocoAnnotationRecord[]) {
        if (!imageIds.has(annotation.image_id)) {
          issues.push({
            file: toRelative(root, jsonFile),
            type: 'Annotation image missing',
            detail: `image_id=${annotation.image_id}`
          });
        }

        if (Array.isArray(annotation.bbox) && (annotation.bbox[2] === 0 || annotation.bbox[3] === 0)) {
          issues.push({
            file: toRelative(root, jsonFile),
            type: 'Zero-sized bbox',
            detail: `image_id=${annotation.image_id}`
          });
        }
      }
    } catch {
      issues.push({
        file: toRelative(root, jsonFile),
        type: 'JSON parse error',
        detail: 'invalid JSON'
      });
    }
  }

  const affectedFiles = new Set(issues.map((issue) => issue.file));
  return {
    format: 'coco',
    scannedImages: images.length,
    validImages: Math.max(0, images.length - affectedFiles.size),
    issues,
    fixedCount: 0,
    manualReviewCount: issues.length
  };
}

async function validatePascalDataset(inputDir: string): Promise<ValidationResult> {
  const root = await assertDirectoryExists(inputDir);
  const images = await collectImages(root);
  if (images.length === 0) {
    throw new Error(`no images found in ${inputDir} — nothing to process`);
  }

  const issues: ValidationIssue[] = [];
  const xmlFiles = (await walk(root)).filter((filePath) => path.extname(filePath).toLowerCase() === '.xml');

  for (const xmlFile of xmlFiles) {
    const xml = await readFile(xmlFile, 'utf8');
    if (!/<annotation>/i.test(xml)) {
      issues.push({
        file: toRelative(root, xmlFile),
        type: 'XML parse error',
        detail: 'missing <annotation>'
      });
      continue;
    }

    const filename = readXmlTag(xml, 'filename');
    if (!filename) {
      issues.push({
        file: toRelative(root, xmlFile),
        type: 'Missing required tags',
        detail: 'filename'
      });
    } else if (!(await fileExists(resolveDatasetImage(root, filename)))) {
      issues.push({
        file: toRelative(root, xmlFile),
        type: 'Annotation image missing',
        detail: filename
      });
    }

    const objects = [...xml.matchAll(/<object>([\s\S]*?)<\/object>/gi)];
    for (const objectMatch of objects) {
      const objectXml = objectMatch[1];
      const xmin = Number(readXmlTag(objectXml, 'xmin'));
      const ymin = Number(readXmlTag(objectXml, 'ymin'));
      const xmax = Number(readXmlTag(objectXml, 'xmax'));
      const ymax = Number(readXmlTag(objectXml, 'ymax'));
      if ([xmin, ymin, xmax, ymax].some((value) => Number.isNaN(value))) {
        issues.push({
          file: toRelative(root, xmlFile),
          type: 'Missing required tags',
          detail: 'bounding box values'
        });
        continue;
      }

      if (xmax <= xmin || ymax <= ymin) {
        issues.push({
          file: toRelative(root, xmlFile),
          type: 'Invalid bounding box',
          detail: `xmin=${xmin}, ymin=${ymin}, xmax=${xmax}, ymax=${ymax}`
        });
      }
    }
  }

  const affectedFiles = new Set(issues.map((issue) => issue.file));
  return {
    format: 'pascal-voc',
    scannedImages: images.length,
    validImages: Math.max(0, images.length - affectedFiles.size),
    issues,
    fixedCount: 0,
    manualReviewCount: issues.length
  };
}

async function buildSplitItems(root: string, format: AnnotationFormat): Promise<DatasetItem[]> {
  if (format === 'yolo') {
    const images = await collectImages(root);
    const items: DatasetItem[] = [];
    for (const image of images) {
      const annotationPath = await findYoloLabelPath(root, image.path);
      items.push({
        imagePath: image.path,
        relativeImagePath: image.relativePath,
        classIds: annotationPath ? await parseYoloClassIds(annotationPath) : [],
        annotationPath
      });
    }

    return items;
  }

  if (format === 'coco') {
    const document = await loadSingleCocoDocument(root);
    const annotationsByImage = new Map<number, CocoAnnotationRecord[]>();
    for (const annotation of document.annotations) {
      const bucket = annotationsByImage.get(annotation.image_id) ?? [];
      bucket.push(annotation);
      annotationsByImage.set(annotation.image_id, bucket);
    }

    return document.images
      .map((image) => ({
        imagePath: resolveDatasetImage(root, image.file_name),
        relativeImagePath: toRelative(root, resolveDatasetImage(root, image.file_name)),
        classIds: (annotationsByImage.get(image.id) ?? []).map((annotation) => annotation.category_id),
        annotationRecord: image
      }))
      .filter((item) => item.imagePath);
  }

  const images = await collectImages(root);
  return Promise.all(
    images.map(async (image) => {
      const xmlPath = path.join(path.dirname(image.path), `${path.parse(image.path).name}.xml`);
      const xml = (await fileExists(xmlPath)) ? await readFile(xmlPath, 'utf8') : '';
      const classIds = [...xml.matchAll(/<name>(.*?)<\/name>/gi)].map((match) => stringToClassId(match[1]));
      return {
        imagePath: image.path,
        relativeImagePath: image.relativePath,
        classIds,
        annotationPath: (await fileExists(xmlPath)) ? xmlPath : undefined
      };
    })
  );
}

function stratifyItems(
  items: DatasetItem[],
  percentages: {train: number; val: number; test: number},
  seed: number
): Map<string, 'train' | 'val' | 'test'> {
  const splits: Array<'train' | 'val' | 'test'> = ['train', 'val', 'test'];
  const total = items.length;
  const targets = {
    train: Math.round((percentages.train / 100) * total),
    val: Math.round((percentages.val / 100) * total),
    test: total
  };
  targets.test = total - targets.train - targets.val;

  const labelTotals = new Map<number, number>();
  for (const item of items) {
    for (const classId of new Set(item.classIds)) {
      labelTotals.set(classId, (labelTotals.get(classId) ?? 0) + 1);
    }
  }

  const rng = createRng(seed);
  const ordered = [...items].sort((left, right) => {
    const rareLeft = Math.min(...left.classIds.map((classId) => labelTotals.get(classId) ?? total), total);
    const rareRight = Math.min(...right.classIds.map((classId) => labelTotals.get(classId) ?? total), total);
    if (rareLeft !== rareRight) {
      return rareLeft - rareRight;
    }

    if (left.classIds.length !== right.classIds.length) {
      return right.classIds.length - left.classIds.length;
    }

    return rng() < 0.5 ? -1 : 1;
  });

  const splitCounts = {train: 0, val: 0, test: 0};
  const splitLabelCounts = {
    train: new Map<number, number>(),
    val: new Map<number, number>(),
    test: new Map<number, number>()
  };
  const assignment = new Map<string, 'train' | 'val' | 'test'>();

  for (const item of ordered) {
    let bestSplit: 'train' | 'val' | 'test' = 'train';
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const split of splits) {
      const remaining = targets[split] - splitCounts[split];
      if (remaining <= 0) {
        continue;
      }

      let score = remaining * 10;
      for (const classId of new Set(item.classIds)) {
        const current = splitLabelCounts[split].get(classId) ?? 0;
        const desired = (labelTotals.get(classId) ?? 0) * (percentages[split] / 100);
        score -= Math.abs(current + 1 - desired);
      }

      if (item.classIds.length === 0) {
        score += remaining;
      }

      if (score > bestScore) {
        bestScore = score;
        bestSplit = split;
      }
    }

    assignment.set(item.relativeImagePath, bestSplit);
    splitCounts[bestSplit] += 1;
    for (const classId of new Set(item.classIds)) {
      splitLabelCounts[bestSplit].set(classId, (splitLabelCounts[bestSplit].get(classId) ?? 0) + 1);
    }
  }

  return assignment;
}

async function loadSingleCocoDocument(root: string): Promise<CocoDocument> {
  const jsonFiles = (await walk(root)).filter((filePath) => path.extname(filePath).toLowerCase() === '.json');
  if (jsonFiles.length === 0) {
    throw new Error('No COCO annotation file found.');
  }

  const parsed = JSON.parse(await readFile(jsonFiles[0], 'utf8')) as Partial<CocoDocument>;
  return {
    images: Array.isArray(parsed.images) ? parsed.images : [],
    annotations: Array.isArray(parsed.annotations) ? parsed.annotations : [],
    categories: Array.isArray(parsed.categories) ? parsed.categories : []
  };
}

async function loadCocoCategories(root: string): Promise<CocoCategoryRecord[]> {
  return (await loadSingleCocoDocument(root)).categories;
}

async function parseYoloClassIds(labelPath: string): Promise<number[]> {
  const raw = await readFile(labelPath, 'utf8');
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => Number(line.split(/\s+/)[0]))
    .filter((value) => Number.isInteger(value) && value >= 0);
}

async function loadClassNames(root: string): Promise<Map<number, string>> {
  const classesFile = path.join(root, 'classes.txt');
  if (await fileExists(classesFile)) {
    const content = await readFile(classesFile, 'utf8');
    return new Map(
      content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line, index) => [index, line])
    );
  }

  for (const candidate of [path.join(root, 'data.yaml'), path.join(root, 'data.yml')]) {
    if (!(await fileExists(candidate))) {
      continue;
    }

    const content = await readFile(candidate, 'utf8');
    const map = parseYamlNames(content);
    if (map.size > 0) {
      return map;
    }
  }

  return new Map();
}

function parseYamlNames(content: string): Map<number, string> {
  const result = new Map<number, string>();
  const inlineMatch = content.match(/names:\s*\[(.*?)\]/s);
  if (inlineMatch) {
    inlineMatch[1]
      .split(',')
      .map((part) => part.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean)
      .forEach((name, index) => result.set(index, name));
    return result;
  }

  const block = content.match(/names:\s*\n([\s\S]+)/);
  if (!block) {
    return result;
  }

  for (const line of block[1].split(/\r?\n/)) {
    const mapped = line.match(/^\s*(\d+)\s*:\s*(.+?)\s*$/);
    if (mapped) {
      result.set(Number(mapped[1]), mapped[2].replace(/^['"]|['"]$/g, ''));
      continue;
    }

    const listed = line.match(/^\s*-\s*(.+?)\s*$/);
    if (listed) {
      result.set(result.size, listed[1].replace(/^['"]|['"]$/g, ''));
      continue;
    }

    if (line.trim() && !line.startsWith(' ')) {
      break;
    }
  }

  return result;
}

async function findYoloLabelPath(root: string, imagePath: string): Promise<string | undefined> {
  const parsed = path.parse(imagePath);
  const sameDir = path.join(parsed.dir, `${parsed.name}.txt`);
  if (await fileExists(sameDir)) {
    return sameDir;
  }

  if (path.basename(parsed.dir).toLowerCase() === 'images') {
    const sibling = path.join(path.dirname(parsed.dir), 'labels', `${parsed.name}.txt`);
    if (await fileExists(sibling)) {
      return sibling;
    }
  }

  const relative = path.relative(root, imagePath);
  const stripped = relative.replace(/^images[\\/]/i, '');
  const candidate = path.join(root, 'labels', `${path.parse(stripped).name}.txt`);
  if (await fileExists(candidate)) {
    return candidate;
  }

  return undefined;
}

async function walk(root: string): Promise<string[]> {
  const entries = await readdir(root, {withFileTypes: true});
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath)));
    } else {
      files.push(fullPath);
    }
  }

  return files;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copyIfExists(source: string, target: string): Promise<void> {
  if (await fileExists(source)) {
    await cp(source, target);
  }
}

function readXmlTag(xml: string, tagName: string): string | undefined {
  return xml.match(new RegExp(`<${tagName}>(.*?)</${tagName}>`, 'i'))?.[1]?.trim();
}

function resolveDatasetImage(root: string, fileName: string): string {
  if (fileName.includes('/') || fileName.includes('\\')) {
    return path.join(root, fileName);
  }

  const direct = path.join(root, fileName);
  const imagesDir = path.join(root, 'images', fileName);
  return direct.includes(path.sep) && direct !== root ? direct : imagesDir;
}

function trimFloat(value: number): string {
  return value.toFixed(6).replace(/\.?0+$/, '');
}

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function stringToClassId(value: string): number {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return hash;
}

function toRelative(root: string, filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join('/');
}

function isErrno(error: unknown, code: string): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}
