import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {maskConfigValue} from '../src/lib/config.js';
import {splitDataset, validateDataset} from '../src/lib/dataset.js';

test('maskConfigValue does not leak short secrets', () => {
  const masked = maskConfigValue('OPENAI_API_KEY', 'sk-test');
  assert.notEqual(masked, 'sk-test');
  assert.doesNotMatch(masked, /sk-test/);
});

test('maskConfigValue still masks PASSWORD and bare KEY secret names', () => {
  const passwordMasked = maskConfigValue('DB_PASSWORD', 'hunter2');
  const keyMasked = maskConfigValue('PRIVATE_KEY', 'abcd1234');

  assert.notEqual(passwordMasked, 'hunter2');
  assert.notEqual(keyMasked, 'abcd1234');
  assert.doesNotMatch(passwordMasked, /hunter2/);
  assert.doesNotMatch(keyMasked, /abcd1234/);
});

test('validateDataset resolves COCO images from images subdirectory and counts valid images correctly', async () => {
  const datasetDir = await mkdtemp(path.join(os.tmpdir(), 'cvkit-coco-'));
  try {
    const imagesDir = path.join(datasetDir, 'images');
    await mkdir(imagesDir, {recursive: true});
    await createImage(path.join(imagesDir, 'image-1.png'));
    await createImage(path.join(imagesDir, 'image-2.png'));

    await writeFile(
      path.join(datasetDir, 'annotations.json'),
      JSON.stringify(
        {
          images: [
            {id: 1, file_name: 'image-1.png'},
            {id: 2, file_name: 'image-2.png'}
          ],
          annotations: [
            {id: 1, image_id: 1, category_id: 0, bbox: [10, 10, 50, 50]},
            {id: 2, image_id: 2, category_id: 0, bbox: [0, 0, 0, 10]}
          ],
          categories: [{id: 0, name: 'object'}]
        },
        null,
        2
      ),
      'utf8'
    );

    const result = await validateDataset(datasetDir, 'coco', false);
    assert.equal(result.scannedImages, 2);
    assert.equal(result.validImages, 1);
    assert.equal(result.issues.length, 1);
    assert.equal(result.issues[0]?.type, 'Zero-sized bbox');
  } finally {
    await safeCleanup(datasetDir);
  }
});

test('splitDataset copies COCO images from images subdirectory', async () => {
  const datasetDir = await mkdtemp(path.join(os.tmpdir(), 'cvkit-coco-split-'));
  const outputDir = path.join(datasetDir, 'split-output');
  try {
    const imagesDir = path.join(datasetDir, 'images');
    await mkdir(imagesDir, {recursive: true});
    await createImage(path.join(imagesDir, 'frame-1.png'));

    await writeFile(
      path.join(datasetDir, 'annotations.json'),
      JSON.stringify(
        {
          images: [{id: 1, file_name: 'frame-1.png'}],
          annotations: [{id: 1, image_id: 1, category_id: 0, bbox: [1, 1, 20, 20]}],
          categories: [{id: 0, name: 'object'}]
        },
        null,
        2
      ),
      'utf8'
    );

    const result = await splitDataset(datasetDir, 'coco', outputDir, {train: 100, val: 0, test: 0}, 42);
    assert.equal(result.splits[0]?.imageCount, 1);
    const copied = path.join(outputDir, 'train', 'images', 'frame-1.png');
    const copiedBytes = await readFile(copied);
    assert.ok(copiedBytes.length > 0);
  } finally {
    await safeCleanup(datasetDir);
  }
});

test('splitDataset rejects output directory that matches input dataset directory', async () => {
  const datasetDir = await mkdtemp(path.join(os.tmpdir(), 'cvkit-split-guard-'));
  try {
    const imagesDir = path.join(datasetDir, 'images');
    const labelsDir = path.join(datasetDir, 'labels');
    await mkdir(imagesDir, {recursive: true});
    await mkdir(labelsDir, {recursive: true});
    await createImage(path.join(imagesDir, 'sample.png'));
    await writeFile(path.join(labelsDir, 'sample.txt'), '0 0.5 0.5 0.25 0.25\n', 'utf8');

    await assert.rejects(
      () => splitDataset(datasetDir, 'yolo', datasetDir, {train: 70, val: 20, test: 10}, 42),
      /output directory must be different/
    );
  } finally {
    await safeCleanup(datasetDir);
  }
});

test('validateDataset --fix does not rewrite YOLO files that still need manual review', async () => {
  const datasetDir = await mkdtemp(path.join(os.tmpdir(), 'cvkit-yolo-fix-'));
  try {
    const imagesDir = path.join(datasetDir, 'images');
    const labelsDir = path.join(datasetDir, 'labels');
    await mkdir(imagesDir, {recursive: true});
    await mkdir(labelsDir, {recursive: true});
    await createImage(path.join(imagesDir, 'sample.png'));

    const originalLabel = ['0 0.5 0.5 0.25', '1 1.2 0.5 0.2 0.2'].join('\n');
    const labelPath = path.join(labelsDir, 'sample.txt');
    await writeFile(labelPath, `${originalLabel}\n`, 'utf8');

    const result = await validateDataset(datasetDir, 'yolo', true);
    const after = await readFile(labelPath, 'utf8');

    assert.equal(result.fixedCount, 0);
    assert.ok(result.manualReviewCount > 0);
    assert.equal(after, `${originalLabel}\n`);
  } finally {
    await safeCleanup(datasetDir);
  }
});

async function createImage(filePath: string): Promise<void> {
  await sharp({
    create: {
      width: 32,
      height: 32,
      channels: 3,
      background: {r: 255, g: 0, b: 0}
    }
  })
    .png()
    .toFile(filePath);
}

async function safeCleanup(target: string): Promise<void> {
  const {rm} = await import('node:fs/promises');
  await rm(target, {recursive: true, force: true});
}
